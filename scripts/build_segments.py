"""取締り区間ジオメトリ（enforcement_segments_<prefecture>.json）を生成する。

山口県・長崎県の警察は「速度取締り予定」に住所を含まず、
「国道番号（不明な場合あり）× 警察署管轄」という単位でしか特定できない
（requirements.md 11.5, 11.6節）。警察署管轄の公式GISデータは存在しないため、
市区町村行政界で近似する（data/manual/police_station_jurisdiction_<prefecture>.json）。

処理の流れ:
  1. <prefecture>_enforcement_raw.json から実在する (road, police_station_raw) の組を集める
  2. 国道番号を特定できるものは、OSM上の該当国道ラインを取得する
  3. 管轄市区町村の行政界ポリゴン（OSM boundary relation）を取得する
  4. 国道ライン ∩ 市区町村ポリゴン を計算し、区間ジオメトリとする
  5. 国道番号を特定できないものは、市区町村ポリゴンそのものを区間とする
     （route指定なしの近似、精度はさらに低い）

同一市区町村を複数署が分割管轄しているケースは、市区町村単位の近似では
区別できない。この場合、複数の segment が同一のジオメトリを持つことになる。
既知の精度限界としてrequirements.mdに記載済み。

県ごとに独立実行できるようにしている（NFR-06）。1県のOverpass取得に
失敗しても他県には影響しない。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests
from shapely.geometry import LineString, mapping
from shapely.ops import polygonize, unary_union

from common import segment_id_for

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "obisu-aggregator/0.1 (personal portfolio project; non-commercial)"
OVERPASS_INTERVAL_SEC = 2.0
CACHE_DIR = Path("data/raw/osm_cache")
# 管轄区域自体が市区町村単位の近似（jurisdiction_accuracy参照）であり、
# それを上回る座標精度を保持しても意味がないため簡略化する。
# 0.0005度 ≈ 50m。ファイルサイズを約1/10に削減できることを確認済み。
SIMPLIFY_TOLERANCE_DEG = 0.0005
COORDINATE_DECIMALS = 5


@dataclass(frozen=True)
class PrefectureConfig:
    slug: str
    name_ja: str  # Overpassのarea["name"=...]検索に使う正式名

    @property
    def jurisdiction_path(self) -> Path:
        return Path(f"data/manual/police_station_jurisdiction_{self.slug}.json")

    @property
    def schedules_path(self) -> Path:
        return Path(f"data/processed/{self.slug}_enforcement_raw.json")

    @property
    def output_path(self) -> Path:
        return Path(f"data/processed/enforcement_segments_{self.slug}.json")


PREFECTURES = {
    "yamaguchi": PrefectureConfig("yamaguchi", "山口県"),
    "nagasaki": PrefectureConfig("nagasaki", "長崎県"),
}


def route_ref_number(road: str) -> str | None:
    m = re.match(r"国道(\d+)号", road)
    return m.group(1) if m else None


def _round_coords(obj):
    if isinstance(obj, (int, float)):
        return round(obj, COORDINATE_DECIMALS)
    if isinstance(obj, list):
        return [_round_coords(x) for x in obj]
    return obj


def to_geojson(geom) -> dict:
    simplified = geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    gj = mapping(simplified)
    gj["coordinates"] = _round_coords(gj["coordinates"])
    return gj


def _cache_path(query: str) -> Path:
    key = hashlib.sha256(query.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / f"{key}.json"


def overpass(query: str, retries: int = 4) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(query)
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                headers={"User-Agent": USER_AGENT},
                timeout=90,
            )
            resp.raise_for_status()
            data = resp.json()
            cache_file.write_text(json.dumps(data), encoding="utf-8")
            time.sleep(OVERPASS_INTERVAL_SEC)
            return data
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def fetch_municipality_polygon(name: str):
    query = f"""
    [out:json][timeout:60];
    relation["boundary"="administrative"]["name"="{name}"]["admin_level"="7"];
    out geom;
    """
    data = overpass(query)
    if not data["elements"]:
        raise ValueError(f"市区町村境界が見つかりません: {name}")
    rel = data["elements"][0]
    lines = [
        LineString([(pt["lon"], pt["lat"]) for pt in m["geometry"]])
        for m in rel["members"]
        if m["type"] == "way" and "geometry" in m and len(m["geometry"]) >= 2
    ]
    polys = list(polygonize(lines))
    if not polys:
        raise ValueError(f"ポリゴン化に失敗しました: {name}")
    return polys[0] if len(polys) == 1 else unary_union(polys)


def fetch_route_line(ref_number: str, prefecture_name: str):
    query = f"""
    [out:json][timeout:80];
    area["name"="{prefecture_name}"]["boundary"="administrative"]->.a;
    way["highway"]["ref"~"(^|;){ref_number}(;|$)"](area.a);
    out geom;
    """
    data = overpass(query)
    lines = [
        LineString([(pt["lon"], pt["lat"]) for pt in el["geometry"]])
        for el in data["elements"]
        if len(el.get("geometry", [])) >= 2
    ]
    if not lines:
        raise ValueError(f"国道{ref_number}号のラインが見つかりません")
    return unary_union(lines)


@dataclass
class SegmentBuilder:
    prefecture: PrefectureConfig
    jurisdiction: dict
    municipality_cache: dict = field(default_factory=dict)
    route_cache: dict = field(default_factory=dict)

    def station_lookup(self) -> dict:
        return {s["station_raw"]: s for s in self.jurisdiction["stations"]}

    def get_municipality_polygon(self, name: str):
        if name not in self.municipality_cache:
            self.municipality_cache[name] = fetch_municipality_polygon(name)
        return self.municipality_cache[name]

    def get_route_line(self, ref_number: str):
        if ref_number not in self.route_cache:
            self.route_cache[ref_number] = fetch_route_line(ref_number, self.prefecture.name_ja)
        return self.route_cache[ref_number]

    def build(self, road: str, station_raw: str) -> dict:
        lookup = self.station_lookup()
        station = lookup.get(station_raw)
        if station is None:
            raise ValueError(f"未知の警察署（対応表に未登録）: {station_raw}")

        municipalities = station["municipalities"]
        polys = [self.get_municipality_polygon(m) for m in municipalities]
        jurisdiction_poly = polys[0] if len(polys) == 1 else unary_union(polys)

        ref_number = route_ref_number(road)
        if ref_number is not None:
            route_line = self.get_route_line(ref_number)
            geometry = route_line.intersection(jurisdiction_poly)
            accuracy = "route_x_municipality_approx"
            geometry_source = (
                f"OpenStreetMap（国道{ref_number}号ライン）"
                f"× 市区町村行政界（{'/'.join(municipalities)}）の交差"
            )
        else:
            geometry = jurisdiction_poly
            accuracy = "municipality_only_approx"
            geometry_source = f"市区町村行政界（{'/'.join(municipalities)}）のみ（対象国道が特定不能なため）"

        if geometry.is_empty:
            raise ValueError(f"交差結果が空です: road={road} station={station_raw}")

        return {
            "id": segment_id_for(self.prefecture.slug, road, station_raw),
            "prefecture": self.prefecture.name_ja,
            "road": road,
            "police_station": station["station_official"],
            "police_station_raw": station_raw,
            "jurisdiction_municipality": municipalities,
            "jurisdiction_accuracy": accuracy,
            "geometry": to_geojson(geometry),
            "geometry_source": geometry_source,
            "notes": station.get("sub_municipality_note"),
        }


def run(prefecture: PrefectureConfig) -> int:
    jurisdiction = json.loads(prefecture.jurisdiction_path.read_text(encoding="utf-8"))
    schedules = json.loads(prefecture.schedules_path.read_text(encoding="utf-8"))

    pairs = sorted({(r["road"], r["police_station_raw"]) for r in schedules})
    print(f"[INFO] [{prefecture.slug}] {len(pairs)} 件のユニークな (road, station) の組を処理します")

    builder = SegmentBuilder(prefecture=prefecture, jurisdiction=jurisdiction)
    segments = []
    errors = []
    for road, station_raw in pairs:
        try:
            segments.append(builder.build(road, station_raw))
            print(f"  ok: {road} / {station_raw}")
        except Exception as exc:  # noqa: BLE001
            errors.append((road, station_raw, str(exc)))
            print(f"  NG: {road} / {station_raw} -> {exc}")

    prefecture.output_path.parent.mkdir(parents=True, exist_ok=True)
    prefecture.output_path.write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[OK] [{prefecture.slug}] {len(segments)} 件の区間を {prefecture.output_path} に出力しました")
    if errors:
        print(f"[WARN] [{prefecture.slug}] {len(errors)} 件でエラーが発生しました:")
        for road, station_raw, msg in errors:
            print(f"  - {road} / {station_raw}: {msg}")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefecture", choices=sorted(PREFECTURES), required=True)
    args = parser.parse_args()
    return run(PREFECTURES[args.prefecture])


if __name__ == "__main__":
    raise SystemExit(main())
