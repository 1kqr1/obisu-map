"""大分県警察「交通指導取締り情報」CSVを取得し、構造化データに変換する。

山口県と異なり、大分県のCSVには具体的な地名（例:「大分市神崎」）が
記載されており、住所検索APIによる点ジオコーディングが可能な粒度を持つ。
そのため大分県は enforcement_segments（区間ハイライト）ではなく、
mobile_points（点＋座標）として扱う。

出典: requirements.md 11.6節（大分県調査記録）
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.pref.oita.jp"
LIST_PAGE_URL = f"{BASE_URL}/site/keisatu/torishimarijouhou2.html"
GSI_ADDRESS_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch"
REQUEST_INTERVAL_SEC = 3.0
GEOCODE_INTERVAL_SEC = 1.0
USER_AGENT = "obisu-aggregator/0.1 (personal portfolio project; non-commercial)"
JST = timezone(timedelta(hours=9))

# FR-02は可搬式オービス（速度取締り）を対象とするため、他の取締り種別は対象外とする。
TARGET_ENFORCEMENT_TYPE = "速度違反"


@dataclass
class MobilePointRecord:
    id: str
    date: str
    weekday: str
    time_band: str  # "morning" | "afternoon" (大分県は午前/午後の2区分)
    raw_location: str
    lat: float | None
    lon: float | None
    accuracy: str  # "town_level" | "failed"
    prefecture: str = "大分県"
    source: str = "大分県警察"
    source_url: str = LIST_PAGE_URL
    fetched_at: str = ""


TIME_BAND_MAP = {"午前": "morning", "午後": "afternoon", "夜間": "night"}


def discover_csv_links(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".csv"):
            urls.append(href if href.startswith("http") else BASE_URL + href)
    return urls


def fetch_list_page() -> str:
    resp = requests.get(LIST_PAGE_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def download_csv(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = url.rsplit("/", 1)[-1]
    dest = dest_dir / filename
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest


def parse_csv(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        if row.get("取締種別") != TARGET_ENFORCEMENT_TYPE:
            continue
        date_str = row["日"].strip()
        date_iso = datetime.strptime(date_str, "%Y/%m/%d").strftime("%Y-%m-%d")
        rows.append(
            {
                "date": date_iso,
                "weekday": row["曜日"].strip(),
                "time_band": TIME_BAND_MAP.get(row["時間帯"].strip(), row["時間帯"].strip()),
                "raw_location": row["場所"].strip(),
            }
        )
    return rows


class Geocoder:
    """同一地名を何度も検索しないようにキャッシュする。"""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, float] | None] = {}

    def geocode(self, place: str) -> tuple[float, float] | None:
        query = f"大分県{place}"
        if query in self._cache:
            return self._cache[query]
        resp = requests.get(
            GSI_ADDRESS_SEARCH,
            params={"q": query},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        time.sleep(GEOCODE_INTERVAL_SEC)
        result: tuple[float, float] | None = None
        if resp.ok:
            data = resp.json()
            if data:
                lon, lat = data[0]["geometry"]["coordinates"]
                result = (lat, lon)
        self._cache[query] = result
        return result


def run(output_path: Path, raw_dir: Path, local_csv: list[Path] | None = None) -> list[MobilePointRecord]:
    csv_paths: list[Path] = []

    if local_csv:
        csv_paths = local_csv
    else:
        html = fetch_list_page()
        time.sleep(REQUEST_INTERVAL_SEC)
        csv_urls = discover_csv_links(html)
        if not csv_urls:
            raise RuntimeError(
                "一覧ページからCSVリンクが見つかりませんでした。サイト構造が変更された可能性があります。"
            )
        for url in csv_urls:
            csv_paths.append(download_csv(url, raw_dir))
            time.sleep(REQUEST_INTERVAL_SEC)

    fetched_at = datetime.now(tz=JST).isoformat(timespec="seconds")
    geocoder = Geocoder()
    records: list[MobilePointRecord] = []

    for path in csv_paths:
        for i, row in enumerate(parse_csv(path)):
            coords = geocoder.geocode(row["raw_location"])
            lat, lon = coords if coords else (None, None)
            accuracy = "town_level" if coords else "failed"
            record_id = f"oita-{row['date']}-{row['time_band']}-{i}-{path.stem}"
            records.append(
                MobilePointRecord(
                    id=record_id,
                    date=row["date"],
                    weekday=row["weekday"],
                    time_band=row["time_band"],
                    raw_location=row["raw_location"],
                    lat=lat,
                    lon=lon,
                    accuracy=accuracy,
                    fetched_at=fetched_at,
                )
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps([asdict(r) for r in records], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-csv", nargs="*", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("data/processed/oita_enforcement_points.json")
    )
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    args = parser.parse_args()

    try:
        records = run(args.output, args.raw_dir, local_csv=args.local_csv)
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] 大分県データ取得に失敗しました: {exc}", file=sys.stderr)
        return 1

    failed = sum(1 for r in records if r.accuracy == "failed")
    print(f"[OK] {len(records)} 件のレコードを {args.output} に出力しました（ジオコーディング失敗: {failed}件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
