import type { AppData, EnforcementSchedule, EnforcementSegment, FixedCamera } from "./types";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

export async function loadAppData(): Promise<AppData> {
  const [fixedCameras, segments, schedules] = await Promise.all([
    fetchJson<FixedCamera[]>(`${DATA_BASE}/fixed_cameras.json`),
    fetchJson<EnforcementSegment[]>(`${DATA_BASE}/enforcement_segments.json`),
    fetchJson<EnforcementSchedule[]>(`${DATA_BASE}/yamaguchi_enforcement_raw.json`),
  ]);

  const timestamps = schedules.map((s) => s.fetched_at).filter(Boolean);
  const lastUpdated = timestamps.length > 0 ? timestamps.sort().at(-1)! : null;

  return { fixedCameras, segments, schedules, lastUpdated };
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
