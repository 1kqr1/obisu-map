import * as maplibregl from "maplibre-gl";
import type { EnforcementSegment, EnforcementSchedule, FixedCamera, MobilePoint } from "./types";
import { schedulesForSegment, timeBandLabel } from "./data";

// maplibre-glは実行時にimport.meta.urlから自身のWorkerファイルのURLを逆算する
// （sibling maplibre-gl-worker.mjsを探す）。Viteの本番ビルドは全体を1つのJSに
// バンドルしてしまうため、import.meta.urlがバンドル本体のURLになり、
// 存在しないパスを探しに行って失敗する（GeoJSONソースの処理が止まり、
// 地図に何も描画されなくなる。エラーは出ないため気づきにくい）。
// Worker本体は同ディレクトリのmaplibre-gl-shared.mjsをimportして依存するため、
// `?url`で単体コピーすると依存先が欠けて壊れる（実際に踏んだ）。
// scripts/copy-maplibre-worker.mjsで両ファイルをpublic/maplibre/に
// セットでコピーし、固定パスで明示的に教える。
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

const YAMAGUCHI_CENTER: [number, number] = [131.47, 34.18];

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: "raster",
      // 標準地図は国道=赤・高速道路=緑と、こちらのオーバーレイ色と丸かぶりして
      // 見分けがつかなくなるため、オーバーレイ前提の淡色地図に変更。
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
  },
  layers: [{ id: "gsi", type: "raster", source: "gsi" }],
};

// ルート検索でヒットした要素を「太い線で囲む」ためのハイライト色。
// 基図にも他のレイヤーにも使っていない色にして、絶対に埋もれないようにする。
const HIGHLIGHT_COLOR = "#d100d1";

export interface MapFilters {
  prefectures: string[];
  showFixed: boolean;
  showMobileSegments: boolean;
  showMobilePoints: boolean;
}

export const ALL_PREFECTURES = ["山口県", "長崎県", "大分県"];

export function defaultFilters(): MapFilters {
  return {
    prefectures: [...ALL_PREFECTURES],
    showFixed: true,
    showMobileSegments: true,
    showMobilePoints: true,
  };
}

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
      properties: { id: seg.id, accuracy: seg.jurisdiction_accuracy, prefecture: seg.prefecture },
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
      properties: { id: cam.id, prefecture: cam.prefecture },
    })),
  };
}

function mobilePointsToFeatureCollection(points: MobilePoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({
        type: "Feature",
        id: p.id,
        geometry: { type: "Point", coordinates: [p.lon as number, p.lat as number] },
        properties: { id: p.id, prefecture: p.prefecture },
      })),
  };
}

export class ObisuMap {
  readonly map: maplibregl.Map;
  private segments: EnforcementSegment[] = [];
  private schedules: EnforcementSchedule[] = [];
  private cameras: FixedCamera[] = [];
  private mobilePoints: MobilePoint[] = [];
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
    // "load" は全ソースの初期タイルが揃うまで待つため、ワーカー等の初期化が
    // 少しでも遅いと発火が遅延・停止することがあった（実際に再現）。
    // ソース・レイヤーを追加できるようになるだけなら "style.load" で十分。
    if (this.map.isStyleLoaded()) return;
    await new Promise<void>((resolve) => this.map.once("style.load" as "load", () => resolve()));
  }

  setData(
    segments: EnforcementSegment[],
    schedules: EnforcementSchedule[],
    cameras: FixedCamera[],
    mobilePoints: MobilePoint[],
  ): void {
    this.segments = segments;
    this.schedules = schedules;
    this.cameras = cameras;
    this.mobilePoints = mobilePoints;

    const { lines, polygons } = segmentsToFeatureCollections(segments);
    this.ensureSource("segments-lines", lines);
    this.ensureSource("segments-polygons", polygons);
    this.ensureSource("cameras", camerasToFeatureCollection(cameras));
    this.ensureSource("mobile-points", mobilePointsToFeatureCollection(mobilePoints));

    if (!this.map.getLayer("segments-route-line")) {
      this.map.addLayer({
        id: "segments-route-line",
        type: "line",
        source: "segments-lines",
        paint: { "line-color": "#e63946", "line-width": 4, "line-opacity": 0.85 },
      });
    }
    if (!this.map.getLayer("segments-municipality-fill")) {
      this.map.addLayer(
        {
          id: "segments-municipality-fill",
          type: "fill",
          source: "segments-polygons",
          paint: { "fill-color": "#f4a261", "fill-opacity": 0.12, "fill-outline-color": "#f4a261" },
        },
        "segments-route-line",
      );
    }
    if (!this.map.getLayer("mobile-points-circle")) {
      this.map.addLayer({
        id: "mobile-points-circle",
        type: "circle",
        source: "mobile-points",
        paint: {
          "circle-radius": 6,
          "circle-color": "#e76f51",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
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

    this.ensureHighlightLayers();
    this.wireInteractions();
  }

  /**
   * ルート検索でヒットした要素を「太い線で丸ごと囲む」ための専用レイヤー。
   * feature-stateで色を出し分ける方式は、MapLibreのGeoJSONソースが
   * 文字列idを内部で保持せず数値idにすり替えてしまうため機能しなかった
   * （queryRenderedFeaturesで実測: 指定した文字列idが失われ0が返ってくる）。
   * その回避として、ヒットした要素だけを別ソースに複製し最前面に重ねる。
   * 正確な範囲より「ここを見ろ」という視認性を優先し、太さは大きめにしてある。
   */
  private ensureHighlightLayers(): void {
    this.ensureSource("highlight-polygons", { type: "FeatureCollection", features: [] });
    this.ensureSource("highlight-lines", { type: "FeatureCollection", features: [] });
    this.ensureSource("highlight-points", { type: "FeatureCollection", features: [] });

    if (!this.map.getLayer("highlight-polygon-fill")) {
      this.map.addLayer({
        id: "highlight-polygon-fill",
        type: "fill",
        source: "highlight-polygons",
        paint: { "fill-color": HIGHLIGHT_COLOR, "fill-opacity": 0.25 },
      });
    }
    if (!this.map.getLayer("highlight-polygon-outline")) {
      this.map.addLayer({
        id: "highlight-polygon-outline",
        type: "line",
        source: "highlight-polygons",
        paint: { "line-color": HIGHLIGHT_COLOR, "line-width": 8, "line-opacity": 0.9 },
      });
    }
    if (!this.map.getLayer("highlight-line")) {
      this.map.addLayer({
        id: "highlight-line",
        type: "line",
        source: "highlight-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": HIGHLIGHT_COLOR, "line-width": 16, "line-opacity": 0.5 },
      });
    }
    if (!this.map.getLayer("highlight-point-halo")) {
      this.map.addLayer({
        id: "highlight-point-halo",
        type: "circle",
        source: "highlight-points",
        paint: {
          "circle-radius": 22,
          "circle-color": HIGHLIGHT_COLOR,
          "circle-opacity": 0.3,
          "circle-stroke-color": HIGHLIGHT_COLOR,
          "circle-stroke-width": 3,
          "circle-stroke-opacity": 0.9,
        },
      });
    }
  }

  /** FR-12/13: 直近のルート検索でヒットした要素を地図上で強調表示する。 */
  setMatches(ids: { segmentIds?: string[]; cameraIds?: string[]; pointIds?: string[] }): void {
    const segIdSet = new Set(ids.segmentIds ?? []);
    const matchedSegments = this.segments.filter((s) => segIdSet.has(s.id));
    const { lines, polygons } = segmentsToFeatureCollections(matchedSegments);
    this.ensureSource("highlight-lines", lines);
    this.ensureSource("highlight-polygons", polygons);

    const camIdSet = new Set(ids.cameraIds ?? []);
    const pointIdSet = new Set(ids.pointIds ?? []);
    const highlightPoints: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        ...this.cameras
          .filter((c) => camIdSet.has(c.id))
          .map((c) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
            properties: {},
          })),
        ...this.mobilePoints
          .filter((p) => pointIdSet.has(p.id) && p.lat != null && p.lon != null)
          .map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lon as number, p.lat as number] },
            properties: {},
          })),
      ],
    };
    this.ensureSource("highlight-points", highlightPoints);
  }

  clearMatches(): void {
    this.ensureSource("highlight-lines", { type: "FeatureCollection", features: [] });
    this.ensureSource("highlight-polygons", { type: "FeatureCollection", features: [] });
    this.ensureSource("highlight-points", { type: "FeatureCollection", features: [] });
  }

  /** FR-05: 種別・県によるフィルタリング。 */
  applyFilters(filters: MapFilters): void {
    const prefFilter: maplibregl.FilterSpecification = [
      "in",
      ["get", "prefecture"],
      ["literal", filters.prefectures],
    ];
    for (const layerId of ["segments-route-line", "segments-municipality-fill"]) {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, "visibility", filters.showMobileSegments ? "visible" : "none");
        this.map.setFilter(layerId, prefFilter);
      }
    }
    if (this.map.getLayer("mobile-points-circle")) {
      this.map.setLayoutProperty(
        "mobile-points-circle",
        "visibility",
        filters.showMobilePoints ? "visible" : "none",
      );
      this.map.setFilter("mobile-points-circle", prefFilter);
    }
    if (this.map.getLayer("cameras-point")) {
      this.map.setLayoutProperty("cameras-point", "visibility", filters.showFixed ? "visible" : "none");
      this.map.setFilter("cameras-point", prefFilter);
    }
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

    this.map.on("click", "mobile-points-circle", (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const point = this.mobilePoints.find((p) => p.id === feature.properties?.id);
      if (point) this.showMobilePointPopup(point, e.lngLat);
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

  private showMobilePointPopup(point: MobilePoint, lngLat: maplibregl.LngLatLike): void {
    const html = `
      <div class="popup">
        <h3>可搬式オービス（${escapeHtml(point.prefecture)}）</h3>
        <p>${escapeHtml(point.raw_location)}</p>
        <p>${point.date}（${point.weekday}） ${timeBandLabel(point.time_band)}</p>
        <p class="popup-accuracy">精度: 町丁レベル（住所文字列からのジオコーディング）</p>
        <p class="popup-source">出典: <a href="${escapeHtml(point.source_url)}" target="_blank" rel="noopener">${escapeHtml(point.source)}</a></p>
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
    this.clearMatches();
  }
}

function todayISO(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
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
