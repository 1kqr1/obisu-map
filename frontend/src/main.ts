import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { ObisuMap, defaultFilters, type MapFilters } from "./map";
import {
  loadAppData,
  schedulesForSegment,
  timeBandLabel,
  timeBandMatchesFilter,
  type TimeBandFilter,
} from "./data";
import {
  geocode,
  fetchRoute,
  segmentsAlongRoute,
  pointsAlongRoute,
  routeProgressKm,
  segmentRouteProgressKm,
} from "./route";
import type { AppData, EnforcementSegment, FixedCamera, MobilePoint } from "./types";

const mapEl = document.getElementById("map")!;
const form = document.getElementById("route-form") as HTMLFormElement;
const fromInput = document.getElementById("from-input") as HTMLInputElement;
const toInput = document.getElementById("to-input") as HTMLInputElement;
const dateInput = document.getElementById("date-input") as HTMLInputElement;
const timeBandInput = document.getElementById("time-band-input") as HTMLSelectElement;
const statusEl = document.getElementById("route-status")!;
const resultsEl = document.getElementById("route-results")!;
const lastUpdatedEl = document.getElementById("last-updated")!;
const clearButton = document.getElementById("clear-route-button") as HTMLButtonElement;
const xStatusEl = document.getElementById("x-information-status")!;
const xNoticesEl = document.getElementById("x-notices")!;
const xSelectedDateOnly = document.getElementById("x-selected-date-only") as HTMLInputElement;

const filterFixed = document.getElementById("filter-fixed") as HTMLInputElement;
const filterMobileSegments = document.getElementById("filter-mobile-segments") as HTMLInputElement;
const filterMobilePoints = document.getElementById("filter-mobile-points") as HTMLInputElement;
const filterPrefCheckboxes = Array.from(
  document.querySelectorAll<HTMLInputElement>(".filter-pref"),
);

dateInput.value = toLocalISODate(new Date());

function toLocalISODate(d: Date): string {
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const obisuMap = new ObisuMap(mapEl);

let appData: AppData | null = null;
let lastRouteLine: GeoJSON.LineString | null = null;

function currentFilters(): MapFilters {
  return {
    prefectures: filterPrefCheckboxes.filter((c) => c.checked).map((c) => c.value),
    showFixed: filterFixed.checked,
    showMobileSegments: filterMobileSegments.checked,
    showMobilePoints: filterMobilePoints.checked,
  };
}

function onFiltersChanged(): void {
  obisuMap.applyFilters(currentFilters());
  renderXInformation();
  if (lastRouteLine && appData) {
    renderMatches(lastRouteLine, appData, dateInput.value, timeBandInput.value as TimeBandFilter);
  }
}

for (const el of [filterFixed, filterMobileSegments, filterMobilePoints, ...filterPrefCheckboxes]) {
  el.addEventListener("change", onFiltersChanged);
}
timeBandInput.addEventListener("change", onFiltersChanged);
dateInput.addEventListener("change", onFiltersChanged);
xSelectedDateOnly.addEventListener("change", renderXInformation);

function renderXInformation(): void {
  if (!appData) return;
  const info = appData.xInformation;
  const verified = info.verified_at ? info.verified_at.slice(0, 10) : "不明";
  xStatusEl.textContent = info.status === "api"
    ? `公式X 最終取得: ${verified}`
    : info.status === "manual_snapshot"
      ? `確認済み投稿（${verified}確認）。自動更新は準備中です。`
      : "公式Xの情報を読み込めませんでした。HPの予定を表示しています。";
  const prefSet = new Set(currentFilters().prefectures);
  const geometryIds = new Set(appData.segments.map((s) => s.id));
  // 新しい路線・未知の管轄でジオメトリを作れなくても、予定自体は落とさない。
  const unmapped = appData.schedules.filter((s) => !geometryIds.has(s.segment_id) && prefSet.has(s.prefecture))
    .filter((s) => !xSelectedDateOnly.checked || !dateInput.value || s.date === dateInput.value)
    .filter((s) => timeBandMatchesFilter(s.time_band, timeBandInput.value as TimeBandFilter));
  const unmappedHtml = unmapped.length ? `<details class="x-notice"><summary>地図に表示できない予定（${unmapped.length}件）</summary><ul>${unmapped.map((s) =>
    `<li>${escapeHtml(s.date)} ${escapeHtml(timeBandLabel(s.time_band))} ${escapeHtml(s.road)} / ${escapeHtml(s.police_station_raw)}</li>`
  ).join("")}</ul><p>場所は各県警の原情報を確認してください。</p></details>` : "";
  const notices = info.notices
    .filter((n) => prefSet.has(n.prefecture))
    .filter((n) => !xSelectedDateOnly.checked || !dateInput.value || n.dates.length === 0 || n.dates.includes(dateInput.value))
    .filter((n) => timeBandMatchesFilter(n.time_band, timeBandInput.value as TimeBandFilter))
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  if (!notices.length) {
    xNoticesEl.innerHTML = "<p>この条件に該当する追加情報はありません。</p>" + unmappedHtml;
    return;
  }
  const today = toLocalISODate(new Date());
  xNoticesEl.innerHTML = notices.map((n) => {
    const past = n.dates.length > 0 && n.dates.every((d) => d < today);
    const dateLabel = n.dates.length ? n.dates.map((d) => d.slice(5).replace("-", "/")).join("・") : "日付は原投稿を確認";
    // 市内予告は場所を特定できないため、地図の点や特定国道へ変換しない。
    const source = /^https:\/\/x\.com\/YamaguchiPolice\/status\/\d+$/.test(n.source_url)
      ? `<a href="${escapeHtml(n.source_url)}" target="_blank" rel="noopener noreferrer">公式Xの原投稿</a>` : "出典を確認できません";
    return `<article class="x-notice">
      <h3>${escapeHtml(n.title)}${past ? "（過去の告知）" : ""}</h3>
      <p>${escapeHtml(dateLabel)} / ${escapeHtml(n.location)}</p>
      <p>${escapeHtml(timeBandLabel(n.time_band))}${n.location_accuracy === "city_level" ? "・市内の具体的な場所は公表されていません" : ""}</p>
      <details><summary>投稿内容</summary><p class="x-notice-text">${escapeHtml(n.text)}</p></details>
      <p>${source}</p>
    </article>`;
  }).join("") + unmappedHtml;
}

async function init(): Promise<void> {
  await obisuMap.whenReady();
  try {
    appData = await loadAppData();
    obisuMap.setData(appData.segments, appData.schedules, appData.fixedCameras, appData.mobilePoints);
    obisuMap.applyFilters(defaultFilters());
    renderXInformation();
    if (appData.lastUpdated) {
      const d = new Date(appData.lastUpdated);
      lastUpdatedEl.textContent = `データ最終更新: ${d.toLocaleString("ja-JP")}`;
    }
  } catch (err) {
    setStatus(`データの読み込みに失敗しました: ${(err as Error).message}`, true);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!appData) return;
  setStatus("経路を検索しています…", false);
  resultsEl.innerHTML = "";
  clearButton.hidden = true;
  lastRouteLine = null;

  try {
    const [from, to] = await Promise.all([geocode(fromInput.value), geocode(toInput.value)]);
    const route = await fetchRoute(from, to);
    obisuMap.showRoute(route.line);
    clearButton.hidden = false;
    lastRouteLine = route.line;

    setStatus(
      `${from.label} → ${to.label}（約${route.distanceKm.toFixed(1)}km, ${Math.round(route.durationMin)}分）`,
      false,
    );
    renderMatches(route.line, appData, dateInput.value, timeBandInput.value as TimeBandFilter);
  } catch (err) {
    setStatus(`検索に失敗しました: ${(err as Error).message}`, true);
  }
});

clearButton.addEventListener("click", () => {
  obisuMap.clearRoute();
  clearButton.hidden = true;
  lastRouteLine = null;
  resultsEl.innerHTML = "";
  setStatus("", false);
});

function renderMatches(
  routeLine: GeoJSON.LineString,
  data: AppData,
  targetDate: string,
  targetTimeBand: TimeBandFilter,
): void {
  const filters = currentFilters();
  const prefSet = new Set(filters.prefectures);

  const matchedSegments = filters.showMobileSegments
    ? segmentsAlongRoute(routeLine, data.segments)
        .filter((seg) => prefSet.has(seg.prefecture))
        .filter((seg) =>
          schedulesForSegment(data.schedules, seg.id).some(
            (s) => (!targetDate || s.date === targetDate) && timeBandMatchesFilter(s.time_band, targetTimeBand),
          ),
        )
    : [];

  const matchedCameras = filters.showFixed
    ? pointsAlongRoute(routeLine, data.fixedCameras).filter((c) => prefSet.has(c.prefecture))
    : [];

  const matchedPoints = filters.showMobilePoints
    ? pointsAlongRoute(routeLine, data.mobilePoints)
        .filter((p) => prefSet.has(p.prefecture))
        .filter((p) => !targetDate || p.date === targetDate)
        .filter((p) => timeBandMatchesFilter(p.time_band, targetTimeBand))
    : [];

  // FR-13: 出発地からの経路上の順序で並べる。
  const segmentsSorted = matchedSegments
    .map((seg) => ({ seg, progress: segmentRouteProgressKm(routeLine, seg) }))
    .sort((a, b) => a.progress - b.progress)
    .map((x) => x.seg);
  const camerasSorted = matchedCameras
    .map((c) => ({ c, progress: routeProgressKm(routeLine, c.lat as number, c.lon as number) }))
    .sort((a, b) => a.progress - b.progress)
    .map((x) => x.c);
  const pointsSorted = matchedPoints
    .map((p) => ({ p, progress: routeProgressKm(routeLine, p.lat as number, p.lon as number) }))
    .sort((a, b) => a.progress - b.progress)
    .map((x) => x.p);

  obisuMap.setMatches({
    segmentIds: segmentsSorted.map((s) => s.id),
    cameraIds: camerasSorted.map((c) => c.id),
    pointIds: pointsSorted.map((p) => p.id),
  });

  renderResults(segmentsSorted, camerasSorted, pointsSorted, data, targetDate, targetTimeBand);
}

function renderResults(
  segments: EnforcementSegment[],
  cameras: FixedCamera[],
  points: MobilePoint[],
  data: AppData,
  targetDate: string,
  targetTimeBand: TimeBandFilter,
): void {
  if (segments.length === 0 && cameras.length === 0 && points.length === 0) {
    resultsEl.innerHTML = "<p>経路沿いにオービス・取締り予定は見つかりませんでした。</p>";
    return;
  }

  let html = "";
  if (cameras.length > 0) {
    html += `<h2>固定式オービス（${cameras.length}件）</h2><ul>`;
    for (const cam of cameras) {
      html += `<li>${escapeHtml(cam.road)}（${escapeHtml(cam.prefecture)}）</li>`;
    }
    html += "</ul>";
  }
  if (segments.length > 0) {
    html += `<h2>速度取締り予定の区間（${segments.length}件、出発地から近い順）</h2><ul>`;
    for (const seg of segments) {
      const dates = schedulesForSegment(data.schedules, seg.id)
        .filter((s) => !targetDate || s.date === targetDate)
        .filter((s) => timeBandMatchesFilter(s.time_band, targetTimeBand))
        .map((s) => `${s.date}(${timeBandLabel(s.time_band)})`)
        .join(", ");
      html += `<li>${escapeHtml(seg.road)} / ${escapeHtml(seg.police_station)}（${escapeHtml(seg.prefecture)}）${dates ? `（${escapeHtml(dates)}）` : ""}</li>`;
    }
    html += "</ul>";
  }
  if (points.length > 0) {
    html += `<h2>可搬式オービス 取締り地点（${points.length}件、出発地から近い順）</h2><ul>`;
    for (const p of points) {
      html += `<li>${escapeHtml(p.raw_location)}（${escapeHtml(p.prefecture)}） ${p.date}(${escapeHtml(timeBandLabel(p.time_band))})</li>`;
    }
    html += "</ul>";
  }
  resultsEl.innerHTML = html;
}

function setStatus(message: string, isError: boolean): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

init();
