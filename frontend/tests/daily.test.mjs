import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../src/daily.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dailySchedules, activeSegments, todayInJapan } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const hp = JSON.parse(readFileSync(new URL("../../tests/fixtures/yamaguchi_hp_20261013.json", import.meta.url)));

test("日本時間の午前0時で今日が変わる（端末の地域に依存しない）", () => {
  assert.equal(todayInJapan(new Date("2026-10-12T14:59:59Z")), "2026-10-12");
  assert.equal(todayInJapan(new Date("2026-10-12T15:00:00Z")), "2026-10-13");
});
test("初期表示の日付のみを残し、前日夜の翌朝分を補足する", () => {
  const rows = dailySchedules(hp, "2026-10-13");
  const same = hp.filter(s => s.date === "2026-10-13");
  const previousNight = hp.filter(s => s.date === "2026-10-12" && s.time_band === "night_early");
  assert.equal(rows.length, same.length + previousNight.length);
  assert.ok(rows.every(s => s.date === "2026-10-13" && s.prefecture === "山口県"));
  assert.deepEqual(rows.filter(s => s.time_band === "early").map(s => s.segment_id), previousNight.map(s => s.segment_id));
  assert.ok(dailySchedules(hp, "2026-10-13", "day").every(s => s.time_band === "day"));
  assert.ok(dailySchedules(hp, "2026-10-13", "night").every(s => ["early", "night_early"].includes(s.time_band)));
  const nextMorning = dailySchedules(hp, "2026-10-14", "night").filter(s => s.time_band === "early");
  assert.ok(nextMorning.length > 0);
  assert.ok(nextMorning.every(s => s.weekday === "水"), "翌朝分の曜日も翌日に合わせる");
});
test("予定のない過去の区間と他県を地図に出さない。未取得日は空", () => {
  const row = hp.find(s => s.date === "2026-10-13");
  const foreign = { ...row, id: "nagasaki", prefecture: "長崎県", segment_id: "nagasaki" };
  const selected = dailySchedules([row, foreign], "2026-10-13");
  const segments = [{ id: row.segment_id, prefecture: "山口県" }, { id: "old", prefecture: "山口県" }, { id: "nagasaki", prefecture: "長崎県" }];
  assert.deepEqual(activeSegments(segments, selected).map(s => s.id), [row.segment_id]);
  assert.deepEqual(dailySchedules(hp, "2026-12-01"), []);
  assert.equal(hp.filter(s => s.time_band === "early").length, 0, "原データを変更しない");
});
