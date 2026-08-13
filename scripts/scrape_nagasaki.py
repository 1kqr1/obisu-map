"""長崎県警察サイトの「可搬式オービス運用計画」を取得し、構造化データに変換する。

長崎県サイトには日別×国道番号の一般速度取締り計画表もあるが、
可搬式オービスとの紐付けが一切なく、警察署（管轄エリア）の情報も
含まれないため、区間ジオメトリを生成できない（座標を出す根拠がない）。
そのため今回はこの一般表を採用せず、可搬式オービス専用の告知
（「８／１～８／３１　時津警察署管内で取締りを実施」のような1行）のみを対象とする。

出典: requirements.md 11.6節（長崎県調査記録）
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from calendar import monthrange
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from common import segment_id_for

BASE_URL = "https://www.police.pref.nagasaki.jp"
LIST_PAGE_URL = f"{BASE_URL}/police/kotsu-anzen/kotsu-torishimari/kotsu-torishimari-joho/"
REQUEST_INTERVAL_SEC = 3.0
USER_AGENT = "obisu-aggregator/0.1 (personal portfolio project; non-commercial)"
JST = timezone(timedelta(hours=9))

MONTH_HEADING_RE = re.compile(r"令和(?P<reiwa>\d+)年(?P<month>\d+)月")
# 正規化後の実際の表記例: "8/1~8/31\n時津警察署管内で取締りを実施"
PLAN_RE = re.compile(
    r"(?P<m1>\d+)/(?P<d1>\d+)\s*~\s*(?P<m2>\d+)/(?P<d2>\d+)"
    r"\s*(?P<station>\S+?警察署)管内で取締りを実施",
    re.DOTALL,
)
ROAD_PLACEHOLDER = "その他道路"  # 対象国道が特定できないことを示す（yamaguchiと同じ規約）


@dataclass
class ScheduleRecord:
    id: str
    date: str
    weekday: str
    road: str
    time_band: str
    police_station_raw: str
    segment_id: str
    prefecture: str = "長崎県"
    source: str = "長崎県警察"
    source_url: str = LIST_PAGE_URL
    fetched_at: str = ""


def reiwa_to_seireki(reiwa_year: int) -> int:
    return reiwa_year + 2018


def to_halfwidth(s: str) -> str:
    return unicodedata.normalize("NFKC", s)


def fetch_list_page() -> str:
    resp = requests.get(LIST_PAGE_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def parse_mobile_oribis_plan(html: str) -> tuple[date, date, str] | None:
    """ページ全文から「M/D〜M/D 〜警察署管内で取締りを実施」を抽出し、
    直近（ページ内で最後）の「令和X年Y月」見出しの西暦年と組み合わせる
    （告知文自体には年が含まれないため）。
    """
    soup = BeautifulSoup(html, "html.parser")
    text = to_halfwidth(soup.get_text(separator="\n", strip=True))

    month_matches = list(MONTH_HEADING_RE.finditer(text))
    if not month_matches:
        raise ValueError("ページから「令和X年Y月」の見出しが見つかりません")
    year = reiwa_to_seireki(int(month_matches[-1].group("reiwa")))

    m = PLAN_RE.search(text)
    if not m:
        return None

    start_month, start_day = int(m.group("m1")), int(m.group("d1"))
    end_month, end_day = int(m.group("m2")), int(m.group("d2"))
    station = m.group("station")

    end_day = min(end_day, monthrange(year, end_month)[1])
    start = date(year, start_month, start_day)
    end = date(year, end_month, end_day)
    return start, end, station


def build_records(start: date, end: date, station: str, fetched_at: str) -> list[ScheduleRecord]:
    seg_id = segment_id_for("nagasaki", ROAD_PLACEHOLDER, station)
    records = []
    d = start
    while d <= end:
        record_id = f"nagasaki-{d.isoformat()}-{seg_id.removeprefix('nagasaki-')}"
        records.append(
            ScheduleRecord(
                id=record_id,
                date=d.isoformat(),
                weekday="月火水木金土日"[d.weekday()] + "曜日",
                road=ROAD_PLACEHOLDER,
                time_band="unspecified",
                police_station_raw=station,
                segment_id=seg_id,
                fetched_at=fetched_at,
            )
        )
        d += timedelta(days=1)
    return records


def run(output_path: Path, local_html: Path | None = None) -> list[ScheduleRecord]:
    if local_html:
        html = local_html.read_text(encoding="utf-8")
    else:
        html = fetch_list_page()
        time.sleep(REQUEST_INTERVAL_SEC)

    fetched_at = datetime.now(tz=JST).isoformat(timespec="seconds")
    plan = parse_mobile_oribis_plan(html)
    records = build_records(*plan, fetched_at=fetched_at) if plan else []

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps([asdict(r) for r in records], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-html", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("data/processed/nagasaki_enforcement_raw.json")
    )
    args = parser.parse_args()

    try:
        records = run(args.output, local_html=args.local_html)
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] 長崎県データ取得に失敗しました: {exc}", file=sys.stderr)
        return 1

    if not records:
        print("[WARN] 可搬式オービス運用計画の記載が見つかりませんでした（0件）")
    print(f"[OK] {len(records)} 件のレコードを {args.output} に出力しました")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
