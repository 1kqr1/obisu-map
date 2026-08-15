import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { ObisuMap, defaultFilters, type MapFilters } from "./map";
import { loadAppData, schedulesForSegment } from "./data";
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
const statusEl = document.getElementById("route-status")!;
const resultsEl = document.getElementById("route-results")!;
const lastUpdatedEl = document.getElementById("last-updated")!;
const clearButton = document.getElementById("clear-route-button") as HTMLButtonElement;

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
(window as any).__debugMap = obisuMap;

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
  if (lastRouteLine && appData) {
    renderMatches(lastRouteLine, appData, dateInput.value);
  }
}

for (const el of [filterFixed, filterMobileSegments, filterMobilePoints, ...filterPrefCheckboxes]) {
  el.addEventListener("change", onFiltersChanged);
}

async function init(): Promise<void> {
  await obisuMap.whenReady();
  try {
    appData = await loadAppData();
    obisuMap.setData(appData.segments, appData.schedules, appData.fixedCameras, appData.mobilePoints);
    obisuMap.applyFilters(defaultFilters());
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
    renderMatches(route.line, appData, dateInput.value);
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

function renderMatches(routeLine: GeoJSON.LineString, data: AppData, targetDate: string): void {
  const filters = currentFilters();
  const prefSet = new Set(filters.prefectures);

  const matchedSegments = filters.showMobileSegments
    ? segmentsAlongRoute(routeLine, data.segments)
        .filter((seg) => prefSet.has(seg.prefecture))
        .filter((seg) =>
          schedulesForSegment(data.schedules, seg.id).some((s) => !targetDate || s.date === targetDate),
        )
    : [];

  const matchedCameras = filters.showFixed
    ? pointsAlongRoute(routeLine, data.fixedCameras).filter((c) => prefSet.has(c.prefecture))
    : [];

  const matchedPoints = filters.showMobilePoints
    ? pointsAlongRoute(routeLine, data.mobilePoints)
        .filter((p) => prefSet.has(p.prefecture))
        .filter((p) => !targetDate || p.date === targetDate)
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

  renderResults(segmentsSorted, camerasSorted, pointsSorted, data, targetDate);
}

function renderResults(
  segments: EnforcementSegment[],
  cameras: FixedCamera[],
  points: MobilePoint[],
  data: AppData,
  targetDate: string,
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
    html += `<h2>可搬式オービス 取締り区間（${segments.length}件、出発地から近い順）</h2><ul>`;
    for (const seg of segments) {
      const dates = schedulesForSegment(data.schedules, seg.id)
        .filter((s) => !targetDate || s.date === targetDate)
        .map((s) => s.date)
        .join(", ");
      html += `<li>${escapeHtml(seg.road)} / ${escapeHtml(seg.police_station)}（${escapeHtml(seg.prefecture)}）${dates ? `（${escapeHtml(dates)}）` : ""}</li>`;
    }
    html += "</ul>";
  }
  if (points.length > 0) {
    html += `<h2>可搬式オービス 取締り地点（${points.length}件、出発地から近い順）</h2><ul>`;
    for (const p of points) {
      html += `<li>${escapeHtml(p.raw_location)}（${escapeHtml(p.prefecture)}） ${p.date}</li>`;
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
