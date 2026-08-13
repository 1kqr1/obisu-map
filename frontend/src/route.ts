import * as turf from "@turf/turf";
import type { EnforcementSegment, FixedCamera, MobilePoint } from "./types";

const GSI_ADDRESS_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const OSRM_DEMO = "https://router.project-osrm.org/route/v1/driving";

// 経路との突き合わせ時の許容誤差。ルーティングAPIとOSMから個別に取得した
// 道路ラインは同じ道でも数十m単位でズレることがあるための緩衝。
const ROUTE_MATCH_BUFFER_KM = 0.1;
const POINT_BUFFER_M = 500;

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
}

/** 国土地理院 住所検索APIでジオコーディングする。非公式APIのため失敗しうる（requirements.md 11.5節）。 */
export async function geocode(query: string): Promise<GeocodeResult> {
  const url = `${GSI_ADDRESS_SEARCH}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`住所検索に失敗しました（${res.status}）`);
  }
  const results = (await res.json()) as Array<{
    geometry: { coordinates: [number, number] };
    properties: { title: string };
  }>;
  if (results.length === 0) {
    throw new Error(`「${query}」に該当する住所が見つかりませんでした`);
  }
  const [lon, lat] = results[0].geometry.coordinates;
  return { lat, lon, label: results[0].properties.title };
}

export interface RouteResult {
  line: GeoJSON.LineString;
  distanceKm: number;
  durationMin: number;
}

/** OSRMデモサーバーで走行ルートを取得する。個人利用の検証用途（requirements.md 9.3節）。 */
export async function fetchRoute(from: GeocodeResult, to: GeocodeResult): Promise<RouteResult> {
  const url = `${OSRM_DEMO}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ルート検索に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("経路が見つかりませんでした");
  }
  const route = data.routes[0];
  return {
    line: route.geometry as GeoJSON.LineString,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

// 長距離ルートはOSRMから数千点のポリラインが返ることがあり、turf.bufferは
// 頂点数に対して非常に重い（5,821点で約11秒かかることを実測）。
// 許容誤差(ROUTE_MATCH_BUFFER_KM)より十分細かい間引きなら結果はほぼ変わらないため、
// バッファ計算の直前で簡略化する（同条件で計測: 417点まで間引いて計33ms）。
const ROUTE_SIMPLIFY_TOLERANCE_DEG = 0.0005; // 約50m

/** FR-12: 区間（線・面）は、経路との交差（許容誤差付き）で抽出する。 */
export function segmentsAlongRoute(
  routeLine: GeoJSON.LineString,
  segments: EnforcementSegment[],
): EnforcementSegment[] {
  const simplified = turf.simplify(turf.lineString(routeLine.coordinates), {
    tolerance: ROUTE_SIMPLIFY_TOLERANCE_DEG,
    highQuality: false,
  });
  const routeBuffer = turf.buffer(simplified, ROUTE_MATCH_BUFFER_KM, { units: "kilometers" });
  if (!routeBuffer) return [];
  return segments.filter((seg) => {
    try {
      return turf.booleanIntersects(routeBuffer, seg.geometry);
    } catch {
      return false;
    }
  });
}

interface LatLon {
  lat: number | null;
  lon: number | null;
}

/** FR-12: 点（固定式・大分県の可搬式ポイント）は経路から指定距離（既定500m）以内を抽出する。 */
export function pointsAlongRoute<T extends LatLon>(
  routeLine: GeoJSON.LineString,
  points: T[],
  maxDistanceM = POINT_BUFFER_M,
): T[] {
  const line = turf.lineString(routeLine.coordinates);
  return points.filter((p) => {
    if (p.lat == null || p.lon == null) return false;
    const dist = turf.pointToLineDistance(turf.point([p.lon, p.lat]), line, { units: "meters" });
    return dist <= maxDistanceM;
  });
}

/** FR-13: 出発地からの経路上の順序で並べるための概算距離(km)。 */
export function routeProgressKm(routeLine: GeoJSON.LineString, lat: number, lon: number): number {
  const line = turf.lineString(routeLine.coordinates);
  const nearest = turf.nearestPointOnLine(line, turf.point([lon, lat]), { units: "kilometers" });
  return nearest.properties.location ?? 0;
}

/**
 * FR-13: 区間ジオメトリの重心を代表点として進行距離を求める。
 * 区間は路線ライン・市区町村ポリゴンなど形状が一定でないため、
 * 経路との厳密な交差計算はせず、重心と経路上の最近点で近似する
 * （並び替え用の概算であり、距離表示そのものには使わない）。
 */
export function segmentRouteProgressKm(routeLine: GeoJSON.LineString, segment: EnforcementSegment): number {
  const centroid = turf.centroid(turf.feature(segment.geometry));
  const [lon, lat] = centroid.geometry.coordinates;
  return routeProgressKm(routeLine, lat, lon);
}

export type { FixedCamera, MobilePoint };
