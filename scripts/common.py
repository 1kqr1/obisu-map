"""複数スクリプト間で共有するユーティリティ。

scrape_yamaguchi.py（スケジュール抽出）と build_segments.py（区間ジオメトリ生成）の
両方が同じ segment_id を導出できるよう、道路名のスラグ化ロジックをここに一本化する。
"""

from __future__ import annotations

import re


def slugify_road(road: str) -> str:
    m = re.match(r"国道(\d+)号", road)
    if m:
        return f"r{m.group(1)}"
    if road == "国道その他":
        return "kokudo-other"
    if road == "その他道路":
        return "other-road"
    return re.sub(r"[^0-9a-zA-Z]+", "-", road).strip("-")


def segment_id_for(prefecture_slug: str, road: str, station_raw: str) -> str:
    return f"{prefecture_slug}-{slugify_road(road)}-{station_raw}"
