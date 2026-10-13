import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scrape_yamaguchi_x import fetch_posts, parse_post, resolve_date, run

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data/manual/yamaguchi_x_verified_20261013.json"
STAMP = "2026-10-13T17:00:00+09:00"


class ParsingTests(unittest.TestCase):
    def test_verified_posts_and_hp_coverage(self):
        posts = json.loads(SEED.read_text())["data"]
        schedules, notices = [], []
        for post in posts:
            daily, extra = parse_post(post, STAMP)
            schedules.extend(daily)
            notices.extend(extra)
        self.assertEqual(len(schedules), 123)
        self.assertEqual(len(notices), 2)
        mobile = next(n for n in notices if n["kind"] == "mobile_orbis")
        self.assertEqual(mobile["dates"], ["2026-10-08"])
        self.assertEqual(mobile["location"], "岩国市")
        self.assertEqual(mobile["time_band"], "unspecified")
        self.assertNotIn("lat", mobile)
        friday = next(n for n in notices if n["kind"] == "drink_driving")
        self.assertEqual(friday["dates"], ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"])

    def test_year_rollover(self):
        self.assertEqual(resolve_date(1, 1, date(2026, 12, 31)), "2027-01-01")
        self.assertEqual(resolve_date(12, 31, date(2027, 1, 1)), "2026-12-31")

    def test_unknown_and_image_only_posts_are_preserved(self):
        for text in ["明日は取締りを実施します。詳細は画像を参照。", "【速度取締 情報（10/14）】\n県道123号:山口"]:
            daily, extra = parse_post({"id": "123", "created_at": "2026-10-13T08:00:00Z", "text": text}, STAMP)
            self.assertEqual(daily, [])
            self.assertEqual(extra[0]["text"], text)
            self.assertEqual(extra[0]["kind"], "unparsed")

    def test_attached_date_without_spaces(self):
        _, extra = parse_post({"id": "123", "created_at": "2026-10-07T08:00:00Z", "text": "可搬式オービス取締り情報\n10月8日岩国市内"}, STAMP)
        self.assertEqual(extra[0]["location"], "岩国市")

    def test_no_token_preserves_exact_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.json"
            path.write_text('{"notices": [{"id": "old"}]}')
            before = path.read_bytes()
            with patch.dict(os.environ, {}, clear=True):
                run(path)
            self.assertEqual(path.read_bytes(), before)

    def test_repeated_import_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.json"
            first = run(path, SEED)
            second = run(path, SEED)
            self.assertEqual([s["id"] for s in first["schedules"]], [s["id"] for s in second["schedules"]])
            self.assertEqual(len(second["posts"]), 16)
            self.assertEqual(len(second["notices"]), 2)
            self.assertIsNone(second["api_since_id"])

    def test_failed_api_does_not_replace_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.json"
            run(path, SEED)
            before = path.read_bytes()
            with patch.dict(os.environ, {"X_BEARER_TOKEN": "test-only"}), patch("scrape_yamaguchi_x.fetch_posts", side_effect=RuntimeError("HTTP 401")):
                with self.assertRaises(RuntimeError):
                    run(path)
            self.assertEqual(path.read_bytes(), before)

    def test_pagination_and_incremental_cursor(self):
        calls = []
        def fake_get(session, path, params=None):
            calls.append((path, dict(params or {})))
            if "/by/username/" in path:
                return {"data": {"id": "456", "username": "YamaguchiPolice"}}
            if (params or {}).get("pagination_token"):
                return {"data": [{"id": "101"}]}
            return {"data": [{"id": "103"}], "meta": {"next_token": "next"}}
        with patch("scrape_yamaguchi_x.api_get", side_effect=fake_get):
            posts, cursor = fetch_posts("test-only", {"api_since_id": "100"})
        self.assertEqual(cursor, "103")
        self.assertEqual([p["id"] for p in posts], ["103", "101"])
        self.assertEqual(calls[1][1]["since_id"], "100")
        self.assertEqual(calls[2][1]["pagination_token"], "next")

    def test_page_limit_does_not_advance_cursor(self):
        with patch("scrape_yamaguchi_x.api_get", side_effect=[
            {"data": {"id": "456", "username": "YamaguchiPolice"}},
            {"data": [{"id": "103"}], "meta": {"next_token": "next"}},
        ]):
            with self.assertRaisesRegex(RuntimeError, "上限"):
                fetch_posts("test-only", {"api_since_id": "100"}, max_pages=1)


if __name__ == "__main__":
    unittest.main()
