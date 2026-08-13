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

export interface EnforcementSchedule {
  id: string;
  date: string;
  weekday: string;
  road: string;
  time_band: "day" | "night_early";
  police_station_raw: string;
  segment_id: string;
  prefecture: string;
  source: string;
  source_url: string;
  fetched_at: string;
}

export interface AppData {
  fixedCameras: FixedCamera[];
  segments: EnforcementSegment[];
  schedules: EnforcementSchedule[];
  lastUpdated: string | null;
}
