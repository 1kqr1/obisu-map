import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("feed", ROOT / "scripts/build_widget_feed.py")
feed_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed_module)


class WidgetFeedTests(unittest.TestCase):
    def setUp(self):
        self.hp = json.loads((ROOT / "tests/fixtures/yamaguchi_hp_20261013.json").read_text())
        self.x = json.loads((ROOT / "data/processed/yamaguchi_x_information.json").read_text())

    def test_yamaguchi_only_and_no_duplicate_schedule(self):
        alien = {**self.hp[0], "prefecture": "長崎県", "police_station_raw": "異県データ"}
        feed = feed_module.build_feed(self.hp + [alien], self.x)
        entries = feed["days"]["2026-10-13"]
        self.assertFalse(any("異県" in e["title"] for rows in feed["days"].values() for e in rows))
        # HPにのみある昼間・その他道路の7署を保持する。
        other = next(e for e in entries if e["time_band"] == "day" and e["title"].startswith("その他道路"))
        self.assertEqual(other["record_count"], 7)
        self.assertEqual(sum(e["record_count"] for e in entries if e["time_band"] in ["day", "night_early"]), 17)

    def test_previous_night_is_included_in_today_early_morning(self):
        feed = feed_module.build_feed(self.hp, self.x)
        early = [e for e in feed["days"]["2026-10-14"] if e["time_band"] == "early"]
        self.assertEqual({e["title"] for e in early}, {"国道191号 / 長門", "その他道路 / 宇部"})
        self.assertTrue(all("前日夜から" in e["detail"] for e in early))

    def test_orbis_and_friday_advisory_only_on_matching_dates(self):
        feed = feed_module.build_feed(self.hp, self.x)
        self.assertTrue(any(e["kind"] == "mobile_orbis" for e in feed["days"]["2026-10-08"]))
        self.assertFalse(any(e["kind"] == "mobile_orbis" for e in feed["days"]["2026-10-13"]))
        self.assertTrue(any(e["kind"] == "drink_driving" for e in feed["days"]["2026-10-16"]))
        # 16日はXの告知しかないので、HPの完全な計画を取得済みとしない。
        self.assertNotIn("2026-10-16", feed["hp_coverage_dates"])

    def test_x_missing_does_not_remove_hp(self):
        feed = feed_module.build_feed(self.hp, {})
        self.assertEqual(feed["x_status"], "unavailable")
        self.assertIn("2026-10-13", feed["hp_coverage_dates"])
        self.assertEqual(sum(e["record_count"] for e in feed["days"]["2026-10-13"]), 17)


if __name__ == "__main__":
    unittest.main()
