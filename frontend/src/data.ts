import type {
  AppData,
  EnforcementSchedule,
  EnforcementSegment,
  FixedCamera,
  MobilePoint,
  XInformation,
} from "./types";
import { mergeSchedules } from "./schedules";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

// サイトで取得・表示するのは山口県の公表情報のみ。
const SEGMENT_SOURCES = [
  { schedules: "yamaguchi_enforcement_raw.json", segments: "enforcement_segments_yamaguchi.json" },
];
const MOBILE_POINT_SOURCES: string[] = [];

export async function loadAppData(): Promise<AppData> {
  const [fixedCameras, segmentSourceResults, mobilePointResults, xInformation, coverage, guides] = await Promise.all([
    fetchJson<FixedCamera[]>(`${DATA_BASE}/fixed_cameras.json`),
    Promise.all(
      SEGMENT_SOURCES.map(async (src) => ({
        schedules: await fetchJson<EnforcementSchedule[]>(`${DATA_BASE}/${src.schedules}`),
        segments: await fetchJson<EnforcementSegment[]>(`${DATA_BASE}/${src.segments}`),
      })),
    ),
    Promise.all(MOBILE_POINT_SOURCES.map((f) => fetchJson<MobilePoint[]>(`${DATA_BASE}/${f}`))),
    fetchJson<XInformation>(`${DATA_BASE}/yamaguchi_x_information.json`).catch(() => ({
      status: "unavailable" as const, verified_at: null, schedules: [], notices: [],
    })),
    fetchJson<{ hp_coverage_dates: string[] }>(`${DATA_BASE}/widget_yamaguchi.json`).catch(() => null),
    fetchJson<{ anchors: AppData["labelAnchors"] }>(`${DATA_BASE}/yamaguchi_label_anchors.json`).catch(() => ({ anchors: {} })),
  ]);

  const schedules = mergeSchedules(segmentSourceResults.flatMap((r) => r.schedules), xInformation.schedules);
  const segments = segmentSourceResults.flatMap((r) => r.segments);
  const mobilePoints = mobilePointResults.flat();

  const timestamps = [
    ...schedules.map((s) => s.fetched_at),
    ...mobilePoints.map((p) => p.fetched_at),
  ].filter(Boolean);
  const lastUpdated = timestamps.length > 0 ? timestamps.sort().at(-1)! : null;

  return {
    fixedCameras: fixedCameras.filter(c => c.prefecture === "山口県"),
    segments: segments.filter(s => s.prefecture === "山口県"),
    schedules: schedules.filter(s => s.prefecture === "山口県"),
    mobilePoints, lastUpdated, xInformation,
    hpCoverageDates: coverage?.hp_coverage_dates ?? segmentSourceResults.flatMap(r => r.schedules.map(s => s.date)),
    labelAnchors: guides.anchors,
  };
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

const TIME_BAND_LABELS: Record<string, string> = {
  day: "昼間 6:00〜18:00",
  night_early: "夜間 18:00〜翌6:00",
  early: "早朝 0:00〜6:00（前日夜から）",
  morning: "午前",
  afternoon: "午後",
  night: "夜間",
  unspecified: "時間帯不明",
};

export function timeBandLabel(band: string): string {
  return TIME_BAND_LABELS[band] ?? band;
}

export type TimeBandFilter = "all" | "day" | "night";

// 県によってtime_bandの粒度が違う（山口: day/night_early、大分: morning/afternoon、
// 長崎: unspecified）ため、ユーザー向けには「昼間/早朝・夜間」の2択に丸めて判定する。
// unspecified（長崎、時間帯の記載自体がない）は絞り込みでは除外しない
// （「この時間帯には無い」と言い切れる根拠がないため、除外すると誤った安心感になる）。
export function timeBandMatchesFilter(band: string, filter: TimeBandFilter): boolean {
  if (filter === "all") return true;
  if (band === "unspecified") return true;
  if (filter === "day") return band === "day" || band === "morning" || band === "afternoon";
  return band === "night_early" || band === "night" || band === "early";
}
