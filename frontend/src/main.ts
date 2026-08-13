import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { ObisuMap } from "./map";
import { loadAppData, schedulesForSegment } from "./data";
import { geocode, fetchRoute, segmentsAlongRoute, fixedCamerasAlongRoute } from "./route";
import type { AppData } from "./types";

const mapEl = document.getElementById("map")!;
const form = document.getElementById("route-form") as HTMLFormElement;
const fromInput = document.getElementById("from-input") as HTMLInputElement;
const toInput = document.getElementById("to-input") as HTMLInputElement;
const dateInput = document.getElementById("date-input") as HTMLInputElement;
const statusEl = document.getElementById("route-status")!;
const resultsEl = document.getElementById("route-results")!;
const lastUpdatedEl = document.getElementById("last-updated")!;
const clearButton = document.getElementById("clear-route-button") as HTMLButtonElement;

dateInput.value = toLocalISODate(new Date());

function toLocalISODate(d: Date): string {
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const obisuMap = new ObisuMap(mapEl);

let appData: AppData | null = null;

async function init(): Promise<void> {
  await obisuMap.whenReady();
  try {
    appData = await loadAppData();
    obisuMap.setData(appData.segments, appData.schedules, appData.fixedCameras);
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

  try {
    const [from, to] = await Promise.all([geocode(fromInput.value), geocode(toInput.value)]);
    const route = await fetchRoute(from, to);
    obisuMap.showRoute(route.line);
    clearButton.hidden = false;

    const targetDate = dateInput.value;
    const matchedSegments = segmentsAlongRoute(route.line, appData.segments).filter((seg) =>
      schedulesForSegment(appData!.schedules, seg.id).some((s) => !targetDate || s.date === targetDate),
    );
    const matchedCameras = fixedCamerasAlongRoute(route.line, appData.fixedCameras);

    setStatus(
      `${from.label} → ${to.label}（約${route.distanceKm.toFixed(1)}km, ${Math.round(route.durationMin)}分）`,
      false,
    );
    renderResults(matchedSegments, matchedCameras, appData, targetDate);
  } catch (err) {
    setStatus(`検索に失敗しました: ${(err as Error).message}`, true);
  }
});

clearButton.addEventListener("click", () => {
  obisuMap.clearRoute();
  clearButton.hidden = true;
  resultsEl.innerHTML = "";
  setStatus("", false);
});

function renderResults(
  segments: ReturnType<typeof segmentsAlongRoute>,
  cameras: ReturnType<typeof fixedCamerasAlongRoute>,
  data: AppData,
  targetDate: string,
): void {
  if (segments.length === 0 && cameras.length === 0) {
    resultsEl.innerHTML = "<p>経路沿いにオービス・取締り予定は見つかりませんでした。</p>";
    return;
  }

  let html = "";
  if (cameras.length > 0) {
    html += `<h2>固定式オービス（${cameras.length}件）</h2><ul>`;
    for (const cam of cameras) {
      html += `<li>${escapeHtml(cam.road)}</li>`;
    }
    html += "</ul>";
  }
  if (segments.length > 0) {
    html += `<h2>可搬式オービス 取締り区間（${segments.length}件）</h2><ul>`;
    for (const seg of segments) {
      const dates = schedulesForSegment(data.schedules, seg.id)
        .filter((s) => !targetDate || s.date === targetDate)
        .map((s) => s.date)
        .join(", ");
      html += `<li>${escapeHtml(seg.road)} / ${escapeHtml(seg.police_station)}${dates ? `（${escapeHtml(dates)}）` : ""}</li>`;
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
