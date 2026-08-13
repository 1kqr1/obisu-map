"""山口県警察「速度取締り計画」PDFを取得し、構造化データに変換する。

出力は住所・座標を含まない（元データに存在しないため）。
道路名 × 実施警察署（表記ゆれのまま）× 日付 × 時間帯のレコードを出力し、
警察署管轄→市区町村の対応付け（区間ジオメトリの生成）は別工程で行う。

参照: requirements.md 6.1 (DS-2), 7.3, 11.5節
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

from common import segment_id_for

BASE_URL = "https://www.pref.yamaguchi.lg.jp"
LIST_PAGE_URL = f"{BASE_URL}/site/police/10456.html"
# 山口県サイトはrobots.txtが存在しない（404, 2026-08-14確認）が、
# 自主的に最低3秒間隔をあける方針とする（requirements.md 6.2節）。
REQUEST_INTERVAL_SEC = 3.0
USER_AGENT = (
    "obisu-aggregator/0.1 (personal portfolio project; "
    "non-commercial; contact via GitHub repository)"
)
JST = timezone(timedelta(hours=9))

WAREKI_RE = re.compile(r"令和(?P<year>\d+)年(?P<month>\d+)月\s*(?P<half>前半|後半)")


@dataclass
class ScheduleRecord:
    """1件 = ある日付・時間帯・道路・警察署 の取締り実施レコード。

    police_station_raw はPDF記載のまま（例: "下関"）。正式な警察署名・
    管轄市区町村への変換はI-7（対応表作成）で別途行う。
    """

    id: str
    date: str
    weekday: str
    road: str
    time_band: str  # "day" | "night_early"
    police_station_raw: str
    segment_id: str
    prefecture: str = "山口県"
    source: str = "山口県警察"
    source_url: str = LIST_PAGE_URL
    fetched_at: str = ""


def to_halfwidth(s: str) -> str:
    return unicodedata.normalize("NFKC", s)


def reiwa_to_seireki(reiwa_year: int) -> int:
    return reiwa_year + 2018


def discover_pdf_links(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf") and "速度取締り計画" in a.get_text():
            urls.append(href if href.startswith("http") else BASE_URL + href)
    return urls


def fetch_list_page() -> str:
    resp = requests.get(LIST_PAGE_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    # Content-TypeヘッダーにcharsetがなくrequestsがISO-8859-1を誤検出するため、
    # レスポンス本体から推定したエンコーディング（実際はUTF-8）を明示する。
    resp.encoding = resp.apparent_encoding
    return resp.text


def download_pdf(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = url.rsplit("/", 1)[-1]
    dest = dest_dir / filename
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest


def parse_table(pdf_path: Path) -> list[ScheduleRecord]:
    with pdfplumber.open(pdf_path) as pdf:
        table = pdf.pages[0].extract_table()

    if not table or len(table) < 4:
        raise ValueError(f"想定した表構造が見つかりません: {pdf_path}")

    title = to_halfwidth(table[0][0] or "")
    m = WAREKI_RE.search(title)
    if not m:
        raise ValueError(f"タイトル行から年月を抽出できません: {title!r}")
    year = reiwa_to_seireki(int(m.group("year")))
    month = int(m.group("month"))

    fetched_at = datetime.now(tz=JST).isoformat(timespec="seconds")

    records: list[ScheduleRecord] = []
    current_date: str | None = None
    current_weekday: str | None = None

    for row in table[3:]:
        if len(row) < 5:
            continue
        date_cell, weekday_cell, road_cell, day_cell, night_cell = row[:5]

        if date_cell:
            day_match = re.match(r"(\d+)", to_halfwidth(date_cell))
            if day_match:
                current_date = f"{year:04d}-{month:02d}-{int(day_match.group(1)):02d}"
                current_weekday = weekday_cell

        if not road_cell or current_date is None:
            continue
        road = to_halfwidth(road_cell).replace(" ", "").replace("　", "")

        for cell, band in ((day_cell, "day"), (night_cell, "night_early")):
            if not cell:
                continue
            for station in cell.split("、"):
                station = station.strip()
                if not station:
                    continue
                seg_id = segment_id_for("yamaguchi", road, station)
                record_id = f"yamaguchi-{current_date}-{seg_id.removeprefix('yamaguchi-')}-{band}"
                records.append(
                    ScheduleRecord(
                        id=record_id,
                        date=current_date,
                        weekday=current_weekday or "",
                        road=road,
                        time_band=band,
                        police_station_raw=station,
                        segment_id=seg_id,
                        fetched_at=fetched_at,
                    )
                )
    return records


def run(output_path: Path, raw_dir: Path, local_pdf: list[Path] | None = None) -> list[ScheduleRecord]:
    pdf_paths: list[Path] = []

    if local_pdf:
        pdf_paths = local_pdf
    else:
        html = fetch_list_page()
        time.sleep(REQUEST_INTERVAL_SEC)
        pdf_urls = discover_pdf_links(html)
        if not pdf_urls:
            raise RuntimeError(
                "一覧ページから「速度取締り計画」PDFのリンクが見つかりませんでした。"
                "サイト構造が変更された可能性があります。"
            )
        for url in pdf_urls:
            pdf_paths.append(download_pdf(url, raw_dir))
            time.sleep(REQUEST_INTERVAL_SEC)

    all_records: list[ScheduleRecord] = []
    for path in pdf_paths:
        all_records.extend(parse_table(path))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps([asdict(r) for r in all_records], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return all_records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--local-pdf",
        nargs="*",
        type=Path,
        help="ネットワーク取得せず、指定したローカルPDFをパースする（開発・検証用）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/processed/yamaguchi_enforcement_raw.json"),
    )
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    args = parser.parse_args()

    try:
        records = run(args.output, args.raw_dir, local_pdf=args.local_pdf)
    except Exception as exc:  # noqa: BLE001 — GitHub Actionsのログに理由を残すため捕捉して失敗させる
        print(f"[ERROR] 山口県データ取得に失敗しました: {exc}", file=sys.stderr)
        return 1

    print(f"[OK] {len(records)} 件のレコードを {args.output} に出力しました")
    if records:
        print("サンプル:", json.dumps(asdict(records[0]), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
