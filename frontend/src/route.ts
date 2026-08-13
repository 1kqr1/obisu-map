import * as turf from "@turf/turf";
import type { EnforcementSegment, FixedCamera } from "./types";

const GSI_ADDRESS_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const OSRM_DEMO = "https://router.project-osrm.org/route/v1/driving";

// 経路との突き合わせ時の許容誤差。ルーティングAPIとOSMから個別に取得した
// 道路ラインは同じ道でも数十m単位でズレることがあるための緩衝。
const ROUTE_MATCH_BUFFER_KM = 0.1;
const FIXED_CAMERA_BUFFER_M = 500;

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

/** FR-12: 可搬式の取締り区間は、経路との交差（許容誤差付き）で抽出する。 */
export function segmentsAlongRoute(
  routeLine: GeoJSON.LineString,
  segments: EnforcementSegment[],
): EnforcementSegment[] {
  const routeBuffer = turf.buffer(turf.lineString(routeLine.coordinates), ROUTE_MATCH_BUFFER_KM, {
    units: "kilometers",
  });
  if (!routeBuffer) return [];
  return segments.filter((seg) => {
    try {
      return turf.booleanIntersects(routeBuffer, seg.geometry);
    } catch {
      return false;
    }
  });
}

/** FR-12: 固定式は経路から指定距離（既定500m）以内の点を抽出する。 */
export function fixedCamerasAlongRoute(
  routeLine: GeoJSON.LineString,
  cameras: FixedCamera[],
  maxDistanceM = FIXED_CAMERA_BUFFER_M,
): FixedCamera[] {
  const line = turf.lineString(routeLine.coordinates);
  return cameras.filter((cam) => {
    const dist = turf.pointToLineDistance(turf.point([cam.lon, cam.lat]), line, {
      units: "meters",
    });
    return dist <= maxDistanceM;
  });
}
