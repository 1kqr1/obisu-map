export interface FixedCamera {
  id: string;
  type: "fixed";
  subtype: string;
  lat: number;
  lon: number;
  road: string;
  prefecture: string;
  accuracy: "exact" | "town_level" | "city_level" | "failed";
  source: string;
  source_url: string;
  updated_at: string;
}

export interface EnforcementSegment {
  id: string;
  prefecture: string;
  road: string;
  police_station: string;
  police_station_raw: string;
  jurisdiction_municipality: string[];
  jurisdiction_accuracy: "route_x_municipality_approx" | "municipality_only_approx";
  geometry: GeoJSON.Geometry;
  geometry_source: string;
  notes: string | null;
}

// time_bandは県ごとに区分の考え方が異なる（山口: day/night_early、大分: morning/afternoon等）。
// 無理に統一せず、県別の生の値をそのまま保持する。
export interface EnforcementSchedule {
  id: string;
  date: string;
  weekday: string;
  road: string;
  time_band: string;
  police_station_raw: string;
  segment_id: string;
  prefecture: string;
  source: string;
  source_url: string;
  fetched_at: string;
}

// 大分県のように住所レベルで地名が特定できる県は、区間ハイライトではなく
// 点＋座標（ジオコーディング結果）として扱う。
export interface MobilePoint {
  id: string;
  date: string;
  weekday: string;
  time_band: string;
  raw_location: string;
  lat: number | null;
  lon: number | null;
  accuracy: "town_level" | "failed";
  prefecture: string;
  source: string;
  source_url: string;
  fetched_at: string;
}

export interface AppData {
  fixedCameras: FixedCamera[];
  segments: EnforcementSegment[];
  schedules: EnforcementSchedule[];
  mobilePoints: MobilePoint[];
  lastUpdated: string | null;
}
