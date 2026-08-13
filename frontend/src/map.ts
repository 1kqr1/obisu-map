import * as maplibregl from "maplibre-gl";
import type { EnforcementSegment, EnforcementSchedule, FixedCamera } from "./types";
import { schedulesForSegment } from "./data";

const YAMAGUCHI_CENTER: [number, number] = [131.47, 34.18];

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
  },
  layers: [{ id: "gsi", type: "raster", source: "gsi" }],
};

// MapLibreはGeoJSONソース内でPolygon/MultiPolygonとMultiLineStringが混在すると、
// geometry-typeフィルタで出し分けようとしても一方のジオメトリが描画されない
// （内部のタイル化処理がジオメトリ種別混在をうまく扱えない模様）。
// そのためソース自体をジオメトリ種別ごとに分ける。
function segmentsToFeatureCollections(segments: EnforcementSegment[]): {
  lines: GeoJSON.FeatureCollection;
  polygons: GeoJSON.FeatureCollection;
} {
  const lines: GeoJSON.Feature[] = [];
  const polygons: GeoJSON.Feature[] = [];
  for (const seg of segments) {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      id: seg.id,
      geometry: seg.geometry,
      properties: { id: seg.id, accuracy: seg.jurisdiction_accuracy },
    };
    if (seg.geometry.type === "LineString" || seg.geometry.type === "MultiLineString") {
      lines.push(feature);
    } else {
      polygons.push(feature);
    }
  }
  return {
    lines: { type: "FeatureCollection", features: lines },
    polygons: { type: "FeatureCollection", features: polygons },
  };
}

function camerasToFeatureCollection(cameras: FixedCamera[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cameras.map((cam) => ({
      type: "Feature",
      id: cam.id,
      geometry: { type: "Point", coordinates: [cam.lon, cam.lat] },
      properties: { id: cam.id },
    })),
  };
}

export class ObisuMap {
  readonly map: maplibregl.Map;
  private segments: EnforcementSegment[] = [];
  private schedules: EnforcementSchedule[] = [];
  private cameras: FixedCamera[] = [];
  private popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      center: YAMAGUCHI_CENTER,
      zoom: 9,
      attributionControl: false,
    });
    this.map.on("error", (e) => console.error("MAP ERROR", e.error));
    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    this.map.addControl(
      new maplibregl.AttributionControl({
        customAttribution: "© OpenStreetMap contributors",
      }),
    );
  }

  async whenReady(): Promise<void> {
    if (this.map.loaded()) return;
    await new Promise<void>((resolve) => this.map.once("load", () => resolve()));
  }

  setData(segments: EnforcementSegment[], schedules: EnforcementSchedule[], cameras: FixedCamera[]): void {
    this.segments = segments;
    this.schedules = schedules;
    this.cameras = cameras;

    const { lines, polygons } = segmentsToFeatureCollections(segments);
    this.ensureSource("segments-lines", lines);
    this.ensureSource("segments-polygons", polygons);
    this.ensureSource("cameras", camerasToFeatureCollection(cameras));

    if (!this.map.getLayer("segments-route-line")) {
      this.map.addLayer({
        id: "segments-route-line",
        type: "line",
        source: "segments-lines",
        paint: {
          "line-color": "#e63946",
          "line-width": 4,
          "line-opacity": 0.85,
        },
      });
    }
    if (!this.map.getLayer("segments-municipality-fill")) {
      this.map.addLayer(
        {
          id: "segments-municipality-fill",
          type: "fill",
          source: "segments-polygons",
          paint: {
            "fill-color": "#f4a261",
            "fill-opacity": 0.12,
            "fill-outline-color": "#f4a261",
          },
        },
        "segments-route-line",
      );
    }
    if (!this.map.getLayer("cameras-point")) {
      this.map.addLayer({
        id: "cameras-point",
        type: "circle",
        source: "cameras",
        paint: {
          "circle-radius": 6,
          "circle-color": "#1d3557",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }

    this.wireInteractions();
  }

  private ensureSource(id: string, data: GeoJSON.FeatureCollection): void {
    const existing = this.map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
    } else {
      this.map.addSource(id, { type: "geojson", data });
    }
  }

  private interactionsWired = false;
  private wireInteractions(): void {
    if (this.interactionsWired) return;
    this.interactionsWired = true;

    for (const layerId of ["segments-route-line", "segments-municipality-fill"]) {
      this.map.on("click", layerId, (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const segment = this.segments.find((s) => s.id === feature.properties?.id);
        if (segment) this.showSegmentPopup(segment, e.lngLat);
      });
      this.map.on("mouseenter", layerId, () => {
        this.map.getCanvas().style.cursor = "pointer";
      });
      this.map.on("mouseleave", layerId, () => {
        this.map.getCanvas().style.cursor = "";
      });
    }

    this.map.on("click", "cameras-point", (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const camera = this.cameras.find((c) => c.id === feature.properties?.id);
      if (camera) this.showCameraPopup(camera, e.lngLat);
    });
  }

  private showSegmentPopup(segment: EnforcementSegment, lngLat: maplibregl.LngLatLike): void {
    const upcoming = schedulesForSegment(this.schedules, segment.id).filter(
      (s) => s.date >= todayISO(),
    );
    const scheduleRows = upcoming
      .slice(0, 8)
      .map((s) => `<li>${s.date}（${s.weekday}） ${timeBandLabel(s.time_band)}</li>`)
      .join("");

    const html = `
      <div class="popup">
        <h3>${escapeHtml(segment.road)} — ${escapeHtml(segment.police_station)}</h3>
        <p class="popup-accuracy">${accuracyLabel(segment.jurisdiction_accuracy)}</p>
        ${segment.notes ? `<p class="popup-note">${escapeHtml(segment.notes)}</p>` : ""}
        <p class="popup-source">出典: ${escapeHtml(segment.geometry_source)}</p>
        ${
          scheduleRows
            ? `<p class="popup-label">今後の取締り予定日:</p><ul>${scheduleRows}</ul>`
            : `<p class="popup-note">今後の予定データはありません</p>`
        }
      </div>`;
    this.popup.setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  private showCameraPopup(camera: FixedCamera, lngLat: maplibregl.LngLatLike): void {
    const html = `
      <div class="popup">
        <h3>固定式オービス</h3>
        <p>${escapeHtml(camera.road)}</p>
        <p class="popup-accuracy">位置精度: ${escapeHtml(camera.accuracy)}</p>
        <p class="popup-source">出典: <a href="${escapeHtml(camera.source_url)}" target="_blank" rel="noopener">${escapeHtml(camera.source)}</a></p>
      </div>`;
    this.popup.setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  showRoute(line: GeoJSON.LineString): void {
    this.ensureSource("route", { type: "FeatureCollection", features: [{ type: "Feature", geometry: line, properties: {} }] });
    if (!this.map.getLayer("route-line")) {
      this.map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#2a9d8f", "line-width": 5, "line-opacity": 0.7 },
      });
    }
    const bounds = line.coordinates.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(line.coordinates[0] as [number, number], line.coordinates[0] as [number, number]),
    );
    this.map.fitBounds(bounds, { padding: 60 });
  }

  clearRoute(): void {
    this.ensureSource("route", { type: "FeatureCollection", features: [] });
  }
}

function todayISO(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function timeBandLabel(band: string): string {
  return band === "day" ? "昼間(6:00-18:00)" : "早朝・夜間(18:00-翌6:00)";
}

function accuracyLabel(accuracy: string): string {
  if (accuracy === "route_x_municipality_approx") {
    return "精度: 中〜低（国道×市区町村での近似。実際の取締り地点はこの区間内のどこか）";
  }
  return "精度: 低（対象国道が特定できず、市区町村全域を表示）";
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
