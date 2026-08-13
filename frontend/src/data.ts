import type {
  AppData,
  EnforcementSchedule,
  EnforcementSegment,
  FixedCamera,
  MobilePoint,
} from "./types";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

// 区間ベースの県（山口・長崎）のスケジュール・区間ファイル一覧。
// 県ごとに独立したファイルにしているのは、1県のデータ更新失敗が
// 他県の表示に影響しないようにするため（NFR-06と同じ考え方）。
const SEGMENT_SOURCES = [
  { schedules: "yamaguchi_enforcement_raw.json", segments: "enforcement_segments_yamaguchi.json" },
  { schedules: "nagasaki_enforcement_raw.json", segments: "enforcement_segments_nagasaki.json" },
];
const MOBILE_POINT_SOURCES = ["oita_enforcement_points.json"];

export async function loadAppData(): Promise<AppData> {
  const [fixedCameras, segmentSourceResults, mobilePointResults] = await Promise.all([
    fetchJson<FixedCamera[]>(`${DATA_BASE}/fixed_cameras.json`),
    Promise.all(
      SEGMENT_SOURCES.map(async (src) => ({
        schedules: await fetchJson<EnforcementSchedule[]>(`${DATA_BASE}/${src.schedules}`),
        segments: await fetchJson<EnforcementSegment[]>(`${DATA_BASE}/${src.segments}`),
      })),
    ),
    Promise.all(MOBILE_POINT_SOURCES.map((f) => fetchJson<MobilePoint[]>(`${DATA_BASE}/${f}`))),
  ]);

  const schedules = segmentSourceResults.flatMap((r) => r.schedules);
  const segments = segmentSourceResults.flatMap((r) => r.segments);
  const mobilePoints = mobilePointResults.flat();

  const timestamps = [
    ...schedules.map((s) => s.fetched_at),
    ...mobilePoints.map((p) => p.fetched_at),
  ].filter(Boolean);
  const lastUpdated = timestamps.length > 0 ? timestamps.sort().at(-1)! : null;

  return { fixedCameras, segments, schedules, mobilePoints, lastUpdated };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`データの取得に失敗しました: ${url} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function schedulesForSegment(
  schedules: EnforcementSchedule[],
  segmentId: string,
): EnforcementSchedule[] {
  return schedules
    .filter((s) => s.segment_id === segmentId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function schedulesForDate(
  schedules: EnforcementSchedule[],
  date: string,
): EnforcementSchedule[] {
  return schedules.filter((s) => s.date === date);
}
