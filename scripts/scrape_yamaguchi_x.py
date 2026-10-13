"""公式X APIで山口県警の取締り投稿を取得する。画面スクレイピングは行わない。

HP計画は独立して維持し、同形式のX予定と、市内予告・強化日などの追加情報を出力する。
認証なしでは既存データを保持。解析できない取締り投稿も原文付きで残す。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

from common import segment_id_for

USERNAME = "YamaguchiPolice"
API = "https://api.x.com/2"
JST = timezone(timedelta(hours=9))
OUTPUT = Path("data/processed/yamaguchi_x_information.json")
KEYWORDS = re.compile(r"取締|取り締ま|オービス")
DATE_RE = re.compile(r"(?:(\d{4})年)?(\d{1,2})[/月](\d{1,2})(?:日)?")
WEEKDAYS = "月火水木金土日"


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def resolve_date(month: int, day: int, published: date, year: int | None = None) -> str:
    candidates = []
    for candidate_year in ([year] if year else [published.year - 1, published.year, published.year + 1]):
        try:
            candidates.append(date(candidate_year, month, day))
        except ValueError:
            pass
    if not candidates:
        raise ValueError("投稿の日付が不正です")
    return min(candidates, key=lambda d: abs((d - published).days)).isoformat()


def dates_in(text: str, published: date) -> list[str]:
    return sorted({resolve_date(int(m[2]), int(m[3]), published, int(m[1]) if m[1] else None)
                   for m in DATE_RE.finditer(text)})


def parse_post(post: dict, fetched_at: str) -> tuple[list[dict], list[dict]]:
    post_id = str(post["id"])
    if not re.fullmatch(r"\d+", post_id):
        raise ValueError("投稿IDが不正です")
    raw = post.get("note_post", {}).get("text") or post["text"]
    text = unicodedata.normalize("NFKC", raw)
    if not KEYWORDS.search(text):
        return [], []
    published_at = post["created_at"]
    published = datetime.fromisoformat(published_at.replace("Z", "+00:00")).astimezone(JST).date()
    source_url = f"https://x.com/{USERNAME}/status/{post_id}"
    source = {"source": "山口県警察 公式X", "source_url": source_url, "fetched_at": fetched_at}
    schedules = []
    daily = re.search(r"速度取締\s*情報\s*[（(](\d{1,2})/(\d{1,2})[）)]", text.replace("#", ""))
    parse_errors = []
    if daily:
        target_date = resolve_date(int(daily[1]), int(daily[2]), published)
        time_band = None
        for line in text.splitlines():
            line = re.sub(r"\s", "", line)
            if re.search(r"6時[~〜～]18時", line):
                time_band = "day"
                continue
            if re.search(r"18時[~〜～]翌6時", line):
                time_band = "night_early"
                continue
            route = re.fullmatch(r"(国道\d+号|国道その他|その他道路)[~〜～](.+)", line)
            if route and time_band:
                for station in route[2].split("、"):
                    if not station:
                        continue
                    segment_id = segment_id_for("yamaguchi", route[1], station)
                    schedules.append({
                        "id": f"yamaguchi-{target_date}-{segment_id.removeprefix('yamaguchi-')}-{time_band}",
                        "date": target_date, "weekday": WEEKDAYS[date.fromisoformat(target_date).weekday()] + "曜日",
                        "road": route[1], "time_band": time_band, "police_station_raw": station,
                        "segment_id": segment_id, "prefecture": "山口県", **source,
                    })
            elif line.startswith(("国道", "その他道路")):
                parse_errors.append(line)
        if schedules and not parse_errors:
            return schedules, []

    notice = {
        "id": f"yamaguchi-x-{post_id}", "prefecture": "山口県",
        "kind": "unparsed", "title": "取締り情報（原投稿を確認）",
        "dates": [], "time_band": "unspecified", "location": "原投稿を確認",
        "location_accuracy": "unspecified", "text": raw,
        "published_at": published_at, **source,
    }
    # 不明な書式・画像のみの投稿も原文とリンクを残す。
    try:
        notice["dates"] = dates_in(text, published)
    except ValueError:
        pass
    if "可搬式オービス" in text:
        notice.update(kind="mobile_orbis", title="可搬式オービスの取締り予告")
        locations = re.findall(r"([一-龥ぁ-んァ-ヶ]+(?:市|町|村))(?:内|地内)", DATE_RE.sub(" ", text))
        if locations:
            notice.update(location="、".join(dict.fromkeys(locations)), location_accuracy="city_level")
    elif "飲酒運転" in text and re.search(r"毎週\s*金曜日", text):
        month = re.search(r"(\d{1,2})月の飲酒運転取締り強化日", text)
        if month:
            first = date.fromisoformat(resolve_date(int(month[1]), 1, published))
            notice.update(kind="drink_driving", title="飲酒運転取締り強化日", location="山口県内全域")
            notice["dates"] = [(first + timedelta(days=i)).isoformat() for i in range(31)
                               if (first + timedelta(days=i)).month == first.month
                               and (first + timedelta(days=i)).weekday() == 4]
    return schedules, [notice]


def api_get(session: requests.Session, path: str, params: dict | None = None) -> dict:
    response = session.get(API + path, params=params, timeout=30)
    if not response.ok:
        # レスポンス本文・Authorizationをログに出さない。
        raise RuntimeError(f"X API HTTP {response.status_code}。認証・残高・利用制限を確認してください")
    payload = response.json()
    if payload.get("errors"):
        raise RuntimeError("X APIが部分的な取得エラーを返しました。既存データを保持します")
    return payload


def fetch_posts(token: str, previous: dict, max_pages: int = 5) -> tuple[list[dict], str | None]:
    with requests.Session() as session:
        session.headers["Authorization"] = f"Bearer {token}"
        user = api_get(session, f"/users/by/username/{USERNAME}")["data"]
        if user.get("username", "").lower() != USERNAME.lower():
            raise RuntimeError("公式アカウントを確認できませんでした")
        params = {"max_results": 100, "exclude": "replies,retweets", "post.fields": "created_at,note_post"}
        # 手動確認分の最新IDをカーソルに使うと未収集投稿が抜けるので、API成功時の値だけ使う。
        if previous.get("api_since_id"):
            params["since_id"] = previous["api_since_id"]
        else:
            params["start_time"] = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(timespec="seconds").replace("+00:00", "Z")
        posts = []
        for _ in range(max_pages):
            payload = api_get(session, f"/users/{user['id']}/tweets", params)
            posts.extend(payload.get("data", []))
            next_token = payload.get("meta", {}).get("next_token")
            if not next_token:
                newest = max((p["id"] for p in posts), key=int, default=previous.get("api_since_id"))
                return posts, newest
            params["pagination_token"] = next_token
        raise RuntimeError("X取得ページ数の上限に達しました。カーソル・既存データは更新しません")


def run(output: Path, local_posts: Path | None = None) -> dict:
    previous = read_json(output)
    fetched_at = now_iso()
    since_id = previous.get("api_since_id")
    if local_posts:
        payload = read_json(local_posts)
        if payload.get("account") != USERNAME:
            raise ValueError("ローカル投稿のaccountが公式アカウントと一致しません")
        posts = payload["data"]
        status = "manual_snapshot"
        verified_at = payload.get("verified_at", fetched_at)
    else:
        token = os.environ.get("X_BEARER_TOKEN")
        if not token:
            print("[SKIP] X_BEARER_TOKEN未設定。確認済み投稿を保持します")
            return previous
        posts, since_id = fetch_posts(token, previous)
        status = "api"
        verified_at = fetched_at

    # 投稿ID単位で差し替え。後のAPI取得で同一投稿が再取得されても重複しない。
    by_id = {p["id"]: p for p in previous.get("posts", [])}
    for post in posts:
        raw = post.get("note_post", {}).get("text") or post.get("text", "")
        if KEYWORDS.search(unicodedata.normalize("NFKC", raw)):
            by_id[post["id"]] = {"id": post["id"], "text": raw, "created_at": post["created_at"]}
    schedules, notices = {}, {}
    for post in sorted(by_id.values(), key=lambda p: int(p["id"])):
        parsed, extra = parse_post(post, fetched_at)
        schedules.update({r["id"]: r for r in parsed})
        notices.update({r["id"]: r for r in extra})
    result = {"account": USERNAME, "status": status, "verified_at": verified_at,
              "api_last_success_at": fetched_at if status == "api" else previous.get("api_last_success_at"),
              "api_since_id": since_id, "posts": list(by_id.values()),
              "schedules": list(schedules.values()), "notices": list(notices.values())}
    write_json(output, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-posts", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        result = run(args.output, args.local_posts)
    except Exception as exc:
        print(f"[ERROR] X取得失敗。既存データを保持: {exc}", file=sys.stderr)
        return 1
    print(f"[OK] X予定 {len(result.get('schedules', []))} 件、追加情報 {len(result.get('notices', []))} 件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
