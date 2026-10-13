import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

// 既存のTypeScriptコンパイラで本物の統合処理を読み込む。追加のテスト依存は不要。
const source = readFileSync(new URL("../src/schedules.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mergeSchedules } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const hp = JSON.parse(readFileSync(new URL("../../data/processed/yamaguchi_enforcement_raw.json", import.meta.url)));
const x = JSON.parse(readFileSync(new URL("../../data/processed/yamaguchi_x_information.json", import.meta.url))).schedules;

test("X本文にないHP予定を残し、123件の重複を増やさず出典を補足する", () => {
  const merged = mergeSchedules(hp, x);
  assert.equal(x.length, 123);
  assert.equal(merged.length, hp.length);
  assert.equal(merged.filter(s => s.additional_sources?.length).length, 123);
  const omitted = merged.find(s => s.date === "2026-10-13" && s.road === "その他道路" && s.police_station_raw === "柳井" && s.time_band === "day");
  assert.ok(omitted);
  assert.equal(omitted.source, "山口県警察");
  assert.equal(omitted.additional_sources, undefined);
});

test("HPにない将来のX予定も残し、重複インポートで増えない", () => {
  const added = { ...x[0], id: "future", date: "2026-12-01" };
  const merged = mergeSchedules(hp, [added, added]);
  assert.equal(merged.length, hp.length + 1);
  assert.equal(merged.find(s => s.id === "future").source_url, added.source_url);
  assert.equal(mergeSchedules(merged, [added]).length, merged.length);
});
