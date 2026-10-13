package com.obisumap.yamaguchi;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.net.URI;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Androidと独立した日付・表示モデル。端末のタイムゾーンに関わらず日本の日付を使う。 */
public final class FeedModel {
    public static final ZoneId JAPAN = ZoneId.of("Asia/Tokyo");
    public final String date;
    public final List<Item> items;
    public final boolean covered;
    public final String hpUpdatedAt;
    public final String xStatus;
    public final String xVerifiedAt;

    public static final class Item {
        public final String id, title, detail, sourceUrl, kind, road, stations, timeBand;
        public Item(String id, String title, String detail, String sourceUrl, String kind, String road, String stations, String timeBand) {
            this.id = id; this.title = title; this.detail = detail; this.sourceUrl = sourceUrl;
            this.kind = kind; this.road = road; this.stations = stations; this.timeBand = timeBand;
        }
        public String timeLabel(boolean compact) {
            if (!"speed".equals(kind)) return detail;
            switch (timeBand) {
                case "day": return compact ? "昼間 6〜18時" : "昼間 6:00〜18:00";
                case "night_early": return compact ? "夜間 18〜翌6時" : "夜間 18:00〜翌6:00";
                case "early": return compact ? "早朝 0〜6時・前日夜から" : "早朝 0:00〜6:00（前日夜から）";
                default: return detail;
            }
        }
    }

    private FeedModel(String date, List<Item> items, boolean covered, String hpUpdatedAt, String xStatus, String xVerifiedAt) {
        this.date = date; this.items = items; this.covered = covered;
        this.hpUpdatedAt = hpUpdatedAt; this.xStatus = xStatus; this.xVerifiedAt = xVerifiedAt;
    }

    public static String today() { return LocalDate.now(JAPAN).toString(); }
    public static FeedModel parse(String raw, String targetDate) throws JSONException {
        JSONObject json = new JSONObject(raw);
        if (json.getInt("schema_version") != 1 || !"山口県".equals(json.getString("prefecture"))) {
            throw new JSONException("山口県のデータ形式を確認できません");
        }
        List<Item> items = new ArrayList<>();
        JSONArray records = json.getJSONObject("days").optJSONArray(targetDate);
        if (records != null) {
            for (int i = 0; i < records.length(); i++) {
                JSONObject record = records.getJSONObject(i);
                JSONArray stationNames = record.optJSONArray("police_stations");
                List<String> names = new ArrayList<>();
                if (stationNames != null) for (int n = 0; n < stationNames.length(); n++) names.add(stationNames.getString(n));
                items.add(new Item(record.getString("id"), record.getString("title"), record.getString("detail"), record.getString("source_url"),
                        record.optString("kind", "speed"), record.optString("road", ""), String.join("・", names), record.optString("time_band", "unspecified")));
            }
        }
        items.sort(java.util.Comparator.comparingInt(i -> new RoadPresentation(i).order));
        boolean covered = false;
        JSONArray dates = json.getJSONArray("hp_coverage_dates");
        for (int i = 0; i < dates.length(); i++) covered |= targetDate.equals(dates.getString(i));
        return new FeedModel(targetDate, items, covered, json.optString("hp_updated_at", ""),
                json.optString("x_status", "unavailable"), json.optString("x_verified_at", ""));
    }

    public String dateLabel() {
        return LocalDate.parse(date).format(DateTimeFormatter.ofPattern("M月d日（E）", Locale.JAPANESE));
    }
    public String coverageMessage() {
        return covered ? "" : "本日のHP計画は未取得です。表示情報は一部の可能性があります。";
    }
    public String emptyMessage() {
        return covered ? "取得した公表情報に本日の予定はありません。\n予定外の取締りは行われる場合があります。"
                : "本日の公表予定を取得できていません。\n更新するか、県警の原情報をご確認ください。";
    }
    public String sourceLabel() {
        String hp = hpUpdatedAt.length() >= 16 ? hpUpdatedAt.substring(5, 16).replace('T', ' ') : "未取得";
        String x = "manual_snapshot".equals(xStatus) ? "Xは確認済み投稿（自動更新準備中）"
                : "api".equals(xStatus) ? "X確認 " + (xVerifiedAt.length() >= 10 ? xVerifiedAt.substring(0, 10) : "不明") : "X未取得";
        return "HP更新 " + hp + " / " + x;
    }
    public static boolean allowedSourceUrl(String url) {
        try {
            URI uri = URI.create(url);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null) return false;
            if ("www.pref.yamaguchi.lg.jp".equals(uri.getHost())) return uri.getPath().startsWith("/site/police/") || uri.getPath().startsWith("/uploaded/attachment/");
            return "x.com".equals(uri.getHost()) && uri.getPath().matches("/YamaguchiPolice/status/[0-9]+");
        } catch (IllegalArgumentException ex) { return false; }
    }
}
