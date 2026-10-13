// 山口県警取り締まり情報 — Scriptable版 1.0.1
// ホーム画面のScriptableウィジェットから、このスクリプトを選んでください。
// 公表情報を利用する非公式ウィジェット。🚨は予定時間内であり、実施確認ではありません。
const WIDGET_VERSION = "1.0.1";
const WIDGET_NAME = "山口県警取り締まり情報";
const SITE_URL = "https://orbis.1kqr1.com/";
const FEED_URL = SITE_URL + "data/widget_yamaguchi.json";
const HOUR = 3600000;

function japanParts(now) {
  const shifted = new Date(now.getTime() + 9 * HOUR).toISOString();
  return { day: shifted.slice(0, 10), dateLabel: shifted.slice(5, 10).replace("-", "/"), time: shifted.slice(11, 16) };
}
function validateFeed(feed) {
  if (!feed || feed.schema_version !== 1 || feed.prefecture !== "山口県" || feed.timezone !== "Asia/Tokyo"
      || !Array.isArray(feed.hp_coverage_dates) || !feed.days || typeof feed.days !== "object" || Array.isArray(feed.days)) {
    throw new Error("山口県のデータ形式を確認できません");
  }
  for (const [day, entries] of Object.entries(feed.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(entries)) throw new Error("日付の形式が不正です");
    for (const item of entries) if (!item || typeof item.id !== "string" || typeof item.title !== "string"
        || typeof item.time_band !== "string" || typeof item.source_url !== "string") throw new Error("予定の形式が不正です");
  }
  return feed;
}
function sourceURL(value) {
  return /^https:\/\/www\.pref\.yamaguchi\.lg\.jp\/(?:site\/police\/|uploaded\/attachment\/)[^\s]*$/.test(value)
      || /^https:\/\/x\.com\/YamaguchiPolice\/status\/\d+(?:\?[^\s]*)?$/.test(value) ? value : SITE_URL;
}
function roadInfo(item) {
  const legacy = item.title.split(" / ");
  const speed = (item.kind || "speed") === "speed";
  const road = speed ? item.road || legacy[0] : item.title;
  const number = speed && /^国道([0-9]{1,3})号$/.exec(road);
  const area = Array.isArray(item.police_stations) && item.police_stations.length
      ? item.police_stations.join("・") : speed ? legacy.slice(1).join(" / ") : item.detail || "公表告知";
  return { road: road === "国道その他" ? "国道（番号未公表）" : road, area,
    badge: number ? number[1] : speed ? road.startsWith("国道") ? "?" : "他" : "告",
    number: number ? Number(number[1]) : speed ? road.startsWith("国道") ? 1000 : 1001 : -1 };
}
function scheduleFor(feed, now) {
  const jp = japanParts(now);
  const dayStart = Date.parse(jp.day + "T00:00:00+09:00");
  const rows = ((feed && feed.days[jp.day]) || []).map(item => {
    let start = null, end = null, time = "未公表";
    if ((item.kind || "speed") === "speed") {
      if (item.time_band === "day") { start = dayStart + 6 * HOUR; end = dayStart + 18 * HOUR; time = "6-18"; }
      else if (item.time_band === "night_early") { start = dayStart + 18 * HOUR; end = dayStart + 30 * HOUR; time = "18-翌6"; }
      else if (item.time_band === "early") { start = dayStart; end = dayStart + 6 * HOUR; time = "0-6"; }
    }
    const state = start === null ? "unknown" : now.getTime() < start ? "before" : now.getTime() < end ? "within" : "ended";
    return { item, ...roadInfo(item), start, end, time, state };
  });
  const priority = { within: 0, before: 1, unknown: 2, ended: 3 };
  rows.sort((a, b) => priority[a.state] - priority[b.state]
      || (a.state === "before" ? a.start - b.start : 0) || a.number - b.number || a.item.id.localeCompare(b.item.id));
  const counts = { within: 0, before: 0, ended: 0, unknown: 0 };
  rows.forEach(row => counts[row.state]++);
  const summary = `🚨${counts.within} 予定${counts.before} 終${counts.ended}` + (counts.unknown ? ` 告${counts.unknown}` : "");
  const covered = !!feed && feed.hp_coverage_dates.includes(jp.day);
  return { ...jp, rows, counts, summary, covered };
}
function nextRefresh(now) {
  const dayStart = Date.parse(japanParts(now).day + "T00:00:00+09:00");
  const boundary = [dayStart + 6 * HOUR, dayStart + 18 * HOUR, dayStart + 24 * HOUR].find(value => value > now.getTime());
  return new Date(Math.min(now.getTime() + 30 * 60000, boundary));
}
async function readFeed() {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.libraryDirectory(), "yamaguchi-enforcement-widget-v1.json");
  let cache = null;
  try {
    if (fm.fileExists(cachePath)) {
      cache = JSON.parse(fm.readString(cachePath));
      validateFeed(cache.feed);
    }
  } catch (_) { cache = null; }
  try {
    const request = new Request(FEED_URL);
    request.timeoutInterval = 10;
    request.headers = { "Cache-Control": "no-cache" };
    request.onRedirect = () => null;
    const raw = await request.loadString();
    if (!request.response || request.response.statusCode !== 200 || raw.length > 1000000) throw new Error("通信失敗");
    const feed = validateFeed(JSON.parse(raw));
    const result = { feed, checkedAt: new Date().toISOString(), failed: false };
    try { fm.writeString(cachePath, JSON.stringify({ feed, checkedAt: result.checkedAt })); } catch (_) { /* 表示は継続する */ }
    return result;
  } catch (_) {
    return { feed: cache ? cache.feed : null, checkedAt: cache ? cache.checkedAt : null, failed: true };
  }
}
function palette() {
  const color = (light, dark) => Color.dynamic(new Color(light), new Color(dark));
  return { surface: color("FFFFFF", "161B22"), text: color("202124", "E6EDF3"), secondary: color("525B68", "9DA7B3"),
    ended: color("9AA0A6", "87919C"), divider: color("E9ECEF", "30363D"), badge: color("1A73E8", "2563AD"),
    neutralBadge: color("9AA0A6", "57616D"), within: color("D93025", "FF8078"), before: color("1A73E8", "8AB4F8"),
    highlightWithin: color("FFF3F2", "351E24"), highlightBefore: color("F0F6FF", "15283F") };
}
function label(stack, value, font, color) {
  const text = stack.addText(value);
  text.font = font; text.textColor = color; text.lineLimit = 1; text.minimumScaleFactor = 1;
  return text;
}
function rowView(parent, data, first, p, small, narrow) {
  const row = parent.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.size = new Size(0, 44);
  if (!small) row.url = sourceURL(data.item.source_url);
  if (first && data.state === "within") row.backgroundColor = p.highlightWithin;
  else if (first && data.state === "before") row.backgroundColor = p.highlightBefore;
  const statusColor = data.state === "within" ? p.within : data.state === "before" ? p.before : p.ended;
  const bar = row.addStack(); bar.size = new Size(3, 28); bar.backgroundColor = statusColor;
  row.addSpacer(4);
  const badge = row.addStack(); badge.size = new Size(30, 28); badge.cornerRadius = 6;
  badge.backgroundColor = data.state === "ended" || data.number >= 1000 || data.number < 0 ? p.neutralBadge : p.badge;
  badge.centerAlignContent(); badge.addSpacer();
  label(badge, data.badge, Font.boldSystemFont(13), Color.white()); badge.addSpacer();
  row.addSpacer(5);
  const body = row.addStack(); body.layoutVertically(); body.size = new Size(narrow ? small ? 39 : 48 : small ? 52 : 66, 32);
  const ink = data.state === "ended" ? p.ended : p.text;
  label(body, data.road, Font.boldSystemFont(13), ink);
  body.addSpacer(3);
  label(body, data.area || "公表告知", Font.systemFont(11), data.state === "ended" ? p.ended : p.secondary);
  row.addSpacer();
  const state = row.addStack(); state.layoutVertically(); state.size = new Size(44, 32);
  state.centerAlignContent();
  const mark = { within: "🚨", before: "予定", ended: "終", unknown: "告" }[data.state];
  label(state, mark, Font.boldSystemFont(data.state === "within" ? 14 : 11), statusColor).centerAlignText();
  state.addSpacer(2);
  label(state, data.time, Font.regularMonospacedSystemFont(11), data.state === "ended" ? p.ended : p.secondary).centerAlignText();
}
function makeWidget(result, now, family) {
  const model = scheduleFor(result.feed, now);
  const p = palette();
  const widget = new ListWidget(); widget.backgroundColor = p.surface; widget.setPadding(8, 8, 8, 8);
  widget.url = SITE_URL; widget.refreshAfterDate = nextRefresh(now);
  const small = family === "small";
  const narrow = typeof Device !== "undefined" && Device.screenSize().width < 375;
  if (narrow) widget.setPadding(6, 6, 6, 6);
  const columns = small ? 1 : 2;
  const limit = small ? narrow ? 1 : 2 : family === "medium" ? narrow ? 2 : 4 : 8;
  const head = widget.addStack(); head.layoutHorizontally(); head.centerAlignContent();
  const heading = head.addStack(); heading.layoutVertically();
  label(heading, WIDGET_NAME, Font.boldSystemFont(small ? 11 : 13), p.text);
  label(heading, model.dateLabel + " " + model.summary, Font.systemFont(11), p.secondary);
  head.addSpacer();
  if (!small) { const refresh = label(head, "↻", Font.systemFont(22), p.before); refresh.url = URLScheme.forRunningScript(); }
  widget.addSpacer(3);
  let visibleLimit = limit;
  if (!model.covered) {
    label(widget, "本日のHP計画は未取得", Font.systemFont(11), p.secondary);
    visibleLimit = Math.max(0, limit - columns);
  }
  if (!result.feed || !model.rows.length) {
    label(widget, !result.feed ? "情報を未取得です" : model.covered ? "公表情報に本日の予定なし" : "公表情報を取得できていません", Font.systemFont(11), p.text);
    label(widget, "公表外の取締り・変更あり", Font.systemFont(11), p.secondary);
  } else {
    const shown = model.rows.slice(0, visibleLimit);
    for (let i = 0; i < shown.length; i += columns) {
      const line = widget.addStack(); line.layoutHorizontally();
      const left = line.addStack(); left.layoutVertically(); left.size = new Size(narrow ? small ? 125 : 134 : small ? 138 : 152, 0); rowView(left, shown[i], i === 0, p, small, narrow);
      if (columns === 2) {
        line.addSpacer(4);
        const rule = line.addStack(); rule.size = new Size(1, 44); rule.backgroundColor = p.divider;
        line.addSpacer(4);
        const right = line.addStack(); right.layoutVertically(); right.size = new Size(narrow ? 134 : 152, 0);
        if (shown[i + 1]) rowView(right, shown[i + 1], false, p, small, narrow);
      }
      if (i + columns < shown.length) { const rule = widget.addStack(); rule.size = new Size(0, 1); rule.backgroundColor = p.divider; }
    }
  }
  widget.addSpacer();
  const more = Math.max(0, model.rows.length - visibleLimit);
  const footer = model.time + "基準 · " + (result.failed ? "通信エラー" : "🚨=予定時間内") + (more ? ` · 他${more}件` : "");
  label(widget, footer, Font.systemFont(11), p.secondary);
  return widget;
}
async function main() {
  let family = config.widgetFamily || "medium";
  if (config.runsInApp) {
    const choice = new Alert(); choice.title = WIDGET_NAME; choice.message = "表示サイズを選んでプレビューします。ホーム画面では追加したウィジェットのサイズに合わせます。";
    choice.addAction("中サイズ（おすすめ）"); choice.addAction("小サイズ"); choice.addAction("大サイズ"); choice.addCancelAction("キャンセル");
    const index = await choice.presentSheet();
    if (index < 0) { Script.complete(); return; }
    family = ["medium", "small", "large"][index];
  }
  const result = await readFeed();
  const widget = makeWidget(result, new Date(), family);
  Script.setWidget(widget);
  if (config.runsInApp) {
    if (family === "small") await widget.presentSmall();
    else if (family === "large" || family === "extraLarge") await widget.presentLarge();
    else await widget.presentMedium();
  }
  Script.complete();
}
if (typeof Script !== "undefined") await main();
