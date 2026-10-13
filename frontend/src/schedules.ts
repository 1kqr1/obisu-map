import type { EnforcementSchedule } from "./types";

// X本文にないHP予定も保持。重複した予定はHPを主出典とし、Xリンクを補足する。
export function mergeSchedules(hp: EnforcementSchedule[], x: EnforcementSchedule[]): EnforcementSchedule[] {
  const key = (s: EnforcementSchedule) => JSON.stringify([s.prefecture, s.date, s.time_band, s.road, s.police_station_raw]);
  const merged = new Map(hp.map((s) => [key(s), { ...s }]));
  for (const schedule of x) {
    const existing = merged.get(key(schedule));
    if (!existing) {
      merged.set(key(schedule), { ...schedule });
    } else if (existing.source_url !== schedule.source_url) {
      const sources = existing.additional_sources ?? [];
      if (!sources.some((s) => s.source_url === schedule.source_url)) {
        existing.additional_sources = [...sources, { source: schedule.source, source_url: schedule.source_url }];
      }
    }
  }
  return [...merged.values()];
}
