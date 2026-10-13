"""Android/iPhoneで共用できる、山口県限定のウィジェット用データを生成する。"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9))
TIME_LABELS = {"day": "昼間 6:00〜18:00", "night_early": "夜間 18:00〜翌6:00", "unspecified": "時間帯の記載なし"}


def build_feed(hp: list[dict], x: dict) -> dict:
    # HPにのみある予定を維持し、Xの同じ予定で二重計上しない。
    schedules = {}
    coverage = sorted({s["date"] for s in hp if s["prefecture"] == "山口県"})
    for record in x.get("schedules", []) + hp:
        if record["prefecture"] != "山口県":
            continue
        key = (record["date"], record["time_band"], record["road"], record["police_station_raw"])
        schedules[key] = record
    grouped = defaultdict(list)
    for record in schedules.values():
        grouped[(record["date"], record["time_band"], record["road"])].append(record)
    days = {d: [] for d in coverage}
    for (day, band, road), records in sorted(grouped.items()):
        stations = list(dict.fromkeys(r["police_station_raw"] for r in records))
        days.setdefault(day, []).append({
            "id": f"{day}-{band}-{road}", "kind": "speed",
            "title": road + " / " + "・".join(stations),
            "road": road, "police_stations": stations,
            "detail": TIME_LABELS.get(band, band) + "　実施署管内",
            "time_band": band, "source_url": records[0]["source_url"],
            "record_count": len(records),
        })
        # 今日の0〜6時は前日夜の計画に含まれる。日付をまたぐ早朝分も表示する。
        if band == "night_early":
            next_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
            days.setdefault(next_day, []).append({
                "id": f"{next_day}-early-{road}", "kind": "speed",
                "title": road + " / " + "・".join(stations),
                "road": road, "police_stations": stations,
                "detail": "早朝 0:00〜6:00（前日夜から）　実施署管内",
                "time_band": "early", "source_url": records[0]["source_url"], "record_count": len(records),
            })
    for notice in x.get("notices", []):
        if notice["prefecture"] != "山口県":
            continue
        for day in notice["dates"]:
            days.setdefault(day, []).append({
                "id": notice["id"] + "-" + day, "kind": notice["kind"],
                "title": notice["title"],
                "detail": notice["location"] + " / " + TIME_LABELS.get(notice["time_band"], notice["time_band"]),
                "time_band": notice["time_band"], "source_url": notice["source_url"], "record_count": 0,
            })
    for entries in days.values():
        entries.sort(key=lambda e: (0 if e["kind"] != "speed" else 1, {"early": 0, "day": 1, "night_early": 2}.get(e["time_band"], 3), e["title"]))
    return {
        "schema_version": 1, "prefecture": "山口県", "timezone": "Asia/Tokyo",
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "hp_updated_at": max((s.get("fetched_at", "") for s in hp if s["prefecture"] == "山口県"), default=""),
        "hp_coverage_dates": coverage, "x_status": x.get("status", "unavailable"),
        "x_verified_at": x.get("verified_at"), "days": days,
        "notice": "公表予定以外にも取締りが行われ、予定は変更される場合があります。",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/processed/widget_yamaguchi.json")
    args = parser.parse_args()
    hp = json.loads((ROOT / "data/processed/yamaguchi_enforcement_raw.json").read_text())
    x = json.loads((ROOT / "data/processed/yamaguchi_x_information.json").read_text())
    feed = build_feed(hp, x)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.output.with_suffix(".tmp")
    tmp.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(args.output)
    print(f"[OK] 山口県ウィジェット用 {len(feed['days'])} 日分")


if __name__ == "__main__":
    main()
