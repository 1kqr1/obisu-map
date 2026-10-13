package com.obisumap.yamaguchi;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

public final class FeedStore {
    public static final String FEED_URL = "https://orbis.1kqr1.com/data/widget_yamaguchi.json";
    public static final String CHANGED = "com.obisumap.yamaguchi.DATA_CHANGED";
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("feed", Context.MODE_PRIVATE); }
    public static FeedModel cached(Context context) {
        String raw = prefs(context).getString("json", "");
        if (raw.isEmpty()) {
            // 初回オフラインでも同梱した公表情報を使う。端末の確認時刻は未取得のまま。
            try (InputStream input = context.getAssets().open("bootstrap.json")) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int read;
                while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                raw = bytes.toString(StandardCharsets.UTF_8.name());
            } catch (Exception ex) { return null; }
        }
        try { return FeedModel.parse(raw, FeedModel.today()); }
        catch (Exception ex) { return null; }
    }
    public static String status(Context context) {
        String checked = prefs(context).getString("checked", "未取得");
        return prefs(context).getBoolean("failed", false) ? "通信エラー・前回確認 " + checked : "端末確認 " + checked;
    }
    public static String compactStatus(Context context) {
        if (prefs(context).getBoolean("failed", false)) return "通信エラー";
        String checked = prefs(context).getString("checked", "未取得");
        int space = checked.indexOf(' ');
        return space < 0 ? "確認 " + checked : "確認 " + checked.substring(space + 1);
    }
    public static void refresh(Context context) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(FEED_URL).openConnection();
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "YamaguchiTodayWidget/1.0");
            connection.setRequestProperty("Cache-Control", "no-cache");
            if (connection.getResponseCode() != 200) throw new Exception("HTTP error");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int read;
                while ((read = input.read(buffer)) != -1) {
                    if (bytes.size() + read > 1_000_000) throw new Exception("Feed too large");
                    bytes.write(buffer, 0, read);
                }
            }
            String raw = bytes.toString(StandardCharsets.UTF_8.name());
            FeedModel.parse(raw, FeedModel.today()); // 検証を通ってから既存キャッシュを差し替える。
            String checked = ZonedDateTime.now(FeedModel.JAPAN).format(DateTimeFormatter.ofPattern("M/d HH:mm"));
            prefs(context).edit().putString("json", raw).putString("checked", checked).putBoolean("failed", false).commit();
        } catch (Exception ex) {
            prefs(context).edit().putBoolean("failed", true).commit();
        } finally {
            if (connection != null) connection.disconnect();
            TodayWidget.renderAll(context);
            context.sendBroadcast(new Intent(CHANGED).setPackage(context.getPackageName()));
        }
    }
}
