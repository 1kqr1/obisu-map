import type { EnforcementSchedule, EnforcementSegment } from "./types";

/** The page and widget use Japan's calendar even when the device is abroad. */
export function todayInJapan(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

export type DailyTimeFilter = "all" | "day" | "night";

export function dailySchedules(
  schedules: EnforcementSchedule[], date: string, filter: DailyTimeFilter = "all",
): EnforcementSchedule[] {
  const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  return schedules.filter(s => s.prefecture === "山口県")
    .flatMap(s => s.date === date ? [s]
      : s.date === previousDate && s.time_band === "night_early"
        ? [{ ...s, id: `${s.id}-early`, date, weekday: "日月火水木金土"[new Date(`${date}T00:00:00Z`).getUTCDay()], time_band: "early" }] : [])
    .filter(s => filter === "all" || s.time_band === "unspecified"
      || (filter === "day" ? s.time_band === "day" : ["early", "night_early", "night"].includes(s.time_band)));
}

export function activeSegments(segments: EnforcementSegment[], schedules: EnforcementSchedule[]): EnforcementSegment[] {
  const ids = new Set(schedules.map(s => s.segment_id));
  return segments.filter(s => s.prefecture === "山口県" && ids.has(s.id));
}
