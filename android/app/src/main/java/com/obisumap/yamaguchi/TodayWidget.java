package com.obisumap.yamaguchi;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.os.Bundle;
import android.util.SizeF;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import android.widget.RemoteViews;

public final class TodayWidget extends AppWidgetProvider {
    public static final String REFRESH = "com.obisumap.yamaguchi.REFRESH";
    private static final String TICK = "com.obisumap.yamaguchi.SCHEDULE_TICK";
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAll(context); UpdateJob.schedule(context, false); UpdateJob.schedule(context, true);
    }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, id));
    }
    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (REFRESH.equals(action)) { renderAll(context); UpdateJob.schedule(context, true); }
        else if (TICK.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_BOOT_COMPLETED.equals(action)) renderAll(context);
    }
    private static PendingIntent tickIntent(Context context) {
        return PendingIntent.getBroadcast(context, 2003, new Intent(context, TodayWidget.class).setAction(TICK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onDisabled(Context context) {
        context.getSystemService(android.app.job.JobScheduler.class).cancel(2001);
        context.getSystemService(AlarmManager.class).cancel(tickIntent(context));
    }
    public static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, id));
        // Inexact alarm:省電力設定で遅れることがあるため、画面に判定の基準時刻を残す。
        if (ids.length > 0) context.getSystemService(AlarmManager.class).set(AlarmManager.RTC_WAKEUP,
                WidgetSchedule.nextBoundary(ZonedDateTime.now(FeedModel.JAPAN)).toInstant().toEpochMilli(), tickIntent(context));
    }
    public static RemoteViews views(Context context, int widgetId) {
        FeedModel model = FeedStore.cached(context);
        WidgetSchedule schedule = new WidgetSchedule(model, ZonedDateTime.now(FeedModel.JAPAN));
        Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId);
        ArrayList<SizeF> requested = options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
        Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
        if (requested != null && !requested.isEmpty()) {
            for (SizeF size : requested) sizes.put(size, sizedViews(context, widgetId, model, schedule, size));
        } else {
            for (SizeF size : new SizeF[]{new SizeF(160, 140), new SizeF(250, 240), new SizeF(360, 180), new SizeF(320, 360)})
                sizes.put(size, sizedViews(context, widgetId, model, schedule, size));
        }
        return sizes.size() == 1 ? sizes.values().iterator().next() : new RemoteViews(sizes);
    }
    private static RemoteViews sizedViews(Context context, int widgetId, FeedModel model, WidgetSchedule schedule, SizeF size) {
        boolean pair = size.getWidth() >= 360 && size.getWidth() / size.getHeight() >= 1.5f;
        boolean compact = size.getWidth() < 250 || pair;
        boolean aggregateTime = !compact && !schedule.commonTime.isEmpty();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.today_widget);
        String date = model == null ? FeedModel.today() : model.date;
        String summary = date.substring(5).replace('-', '/') + "  " + schedule.summary();
        if (aggregateTime) summary += "  " + schedule.commonTime;
        views.setTextViewText(R.id.widget_title, "山口 取締り");
        views.setTextViewText(R.id.widget_date, summary);
        views.setContentDescription(R.id.widget_date, date + " 公表予定: 予定時間内" + schedule.within + "件、開始前" + schedule.before + "件、時間終了" + schedule.ended + "件、時間未公表" + schedule.unknown + "件" + (aggregateTime ? "、共通時間" + schedule.commonTime : ""));
        views.setTextViewText(R.id.widget_message, model == null ? "更新して公表情報を取得" : model.coverageMessage());
        views.setViewVisibility(R.id.widget_message, model != null && model.covered ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.widget_empty, model == null ? "情報を未取得です" : model.emptyMessage());
        String clock = schedule.now.format(DateTimeFormatter.ofPattern("HH:mm"));
        String foot = clock + "基準 · 内=予定時間内";
        String checked = FeedStore.compactStatus(context);
        if ("通信エラー".equals(checked)) foot = clock + "基準 · 通信エラー · 内=予定時間内";
        else if (size.getWidth() >= 300) foot += " · " + checked;
        if (model != null && size.getWidth() >= 250) foot += " · " + ("manual_snapshot".equals(model.xStatus) ? "X確認分" : "api".equals(model.xStatus) ? "X取得済" : "X未取得");
        views.setTextViewText(R.id.widget_freshness, foot);
        views.setContentDescription(R.id.widget_freshness, foot + "。実施確認ではありません。公表外の取締り・予定変更があります。" + (model == null ? "" : model.sourceLabel()));
        boolean hasItems = !schedule.rows.isEmpty();
        views.setViewVisibility(R.id.widget_list, hasItems ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_empty, hasItems ? View.GONE : View.VISIBLE);
        RemoteViews.RemoteCollectionItems.Builder rows = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2);
        for (int i = 0; i < schedule.rows.size(); i += pair ? 2 : 1) {
            RemoteViews row;
            if (pair) {
                row = new RemoteViews(context.getPackageName(), R.layout.widget_dense_pair);
                row.addView(R.id.row_left, denseRow(context, schedule.rows.get(i), i == 0, false, true));
                if (i + 1 < schedule.rows.size()) row.addView(R.id.row_right, denseRow(context, schedule.rows.get(i + 1), false, false, true));
            } else row = denseRow(context, schedule.rows.get(i), i == 0, aggregateTime, compact);
            rows.addItem(schedule.rows.get(i).item.id.hashCode(), row);
        }
        views.setRemoteAdapter(R.id.widget_list, rows.build());
        Intent app = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(context, widgetId, app, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, open);
        views.setOnClickPendingIntent(R.id.widget_title, open);
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, widgetId + 10000, app, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, widgetId,
                new Intent(context, TodayWidget.class).setAction(REFRESH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return views;
    }
    private static RemoteViews denseRow(Context context, WidgetSchedule.Row data, boolean first, boolean aggregateTime, boolean compact) {
        FeedModel.Item item = data.item;
        RoadPresentation road = new RoadPresentation(item);
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_dense_row);
        row.setTextViewText(R.id.road_badge_number, road.numbered ? road.number : "speed".equals(item.kind) ? road.road.startsWith("国道") ? "?" : "他" : "告");
        row.setTextViewText(R.id.row_title, road.roadLabel());
        String area = road.stations.replaceFirst("^管内：", "");
        row.setTextViewText(R.id.row_stations, area.isEmpty() ? "公表告知" : area);
        row.setTextViewText(R.id.row_state, data.state.mark);
        row.setTextViewText(R.id.row_detail, WidgetSchedule.shortTime(item));
        row.setViewVisibility(R.id.row_detail, aggregateTime ? View.GONE : View.VISIBLE);
        row.setInt(R.id.row_state_bar, "setBackgroundColor", data.state.color);
        row.setTextColor(R.id.row_state, data.state.color);
        boolean ended = data.state == WidgetSchedule.State.ENDED;
        row.setInt(R.id.road_badge_number, "setBackgroundResource", ended || !road.numbered ? R.drawable.road_dense_neutral : R.drawable.road_dense_badge);
        row.setTextColor(R.id.row_title, ended ? 0xFF9AA0A6 : 0xFF202124);
        row.setTextColor(R.id.row_stations, ended ? 0xFF9AA0A6 : 0xFF525B68);
        row.setTextColor(R.id.row_detail, ended ? 0xFF9AA0A6 : 0xFF525B68);
        row.setInt(R.id.row_root, "setBackgroundColor", first && data.state == WidgetSchedule.State.WITHIN ? 0xFFFFF3F2
                : first && data.state == WidgetSchedule.State.BEFORE ? 0xFFF0F6FF : Color.WHITE);
        row.setContentDescription(R.id.row_root, road.roadLabel() + "、" + area + "、" + data.state.label + "、" + item.timeLabel(false) + "。公表予定であり実施確認ではありません。");
        // 小サイズは項目のタップもアプリを開く。通常サイズは省略前の原情報へ進める。
        Intent fill = new Intent();
        if (!compact) fill.putExtra("source_url", item.sourceUrl);
        row.setOnClickFillInIntent(R.id.row_root, fill);
        return row;
    }
}
