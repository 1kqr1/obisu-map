package com.obisumap.yamaguchi;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.os.Bundle;
import android.util.SizeF;
import android.util.TypedValue;
import java.util.LinkedHashMap;
import java.util.Map;
import android.widget.RemoteViews;

public final class TodayWidget extends AppWidgetProvider {
    public static final String REFRESH = "com.obisumap.yamaguchi.REFRESH";
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAll(context); UpdateJob.schedule(context, false); UpdateJob.schedule(context, true);
    }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, id));
    }
    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (REFRESH.equals(intent.getAction())) { renderAll(context); UpdateJob.schedule(context, true); }
    }
    @Override public void onDisabled(Context context) {
        context.getSystemService(android.app.job.JobScheduler.class).cancel(2001);
    }
    public static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, id));
    }
    public static RemoteViews views(Context context, int widgetId) {
        FeedModel model = FeedStore.cached(context);
        Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
        sizes.put(new SizeF(160, 160), sizedViews(context, widgetId, model, 0));
        sizes.put(new SizeF(250, 240), sizedViews(context, widgetId, model, 1));
        sizes.put(new SizeF(320, 360), sizedViews(context, widgetId, model, 2));
        return new RemoteViews(sizes);
    }
    private static RemoteViews sizedViews(Context context, int widgetId, FeedModel model, int size) {
        boolean compact = size == 0;
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.today_widget);
        String date = model == null ? FeedModel.today() : model.dateLabel();
        views.setTextViewText(R.id.widget_title, compact ? "山口 取締り" : "山口 きょうの取締り");
        views.setTextViewText(R.id.widget_date, date + (compact ? "" : " / 県内全域"));
        int padding = Math.round((compact ? 8 : 12) * context.getResources().getDisplayMetrics().density);
        views.setViewPadding(R.id.widget_root, padding, padding, padding, padding);
        views.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, compact ? 14 : 15);
        views.setTextViewText(R.id.widget_message, model == null ? "更新して公表情報を取得してください" : model.coverageMessage());
        views.setViewVisibility(R.id.widget_message, model != null && model.covered ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.widget_empty, model == null ? "情報を未取得です" : model.emptyMessage());
        String xLabel = model == null ? "" : "manual_snapshot".equals(model.xStatus) ? " · X確認済み分" : "api".equals(model.xStatus) ? " · X取得済み" : " · X未取得";
        views.setTextViewText(R.id.widget_freshness, FeedStore.status(context) + xLabel);
        views.setTextViewText(R.id.widget_sources, model == null ? "" : model.sourceLabel());
        views.setViewVisibility(R.id.widget_sources, size == 2 ? View.VISIBLE : View.GONE);
        boolean hasItems = model != null && !model.items.isEmpty();
        views.setViewVisibility(R.id.widget_list, hasItems ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_empty, hasItems ? View.GONE : View.VISIBLE);
        RemoteViews.RemoteCollectionItems.Builder rows = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2);
        if (model != null) for (int i = 0; i < model.items.size(); i++) {
            FeedModel.Item item = model.items.get(i);
            RemoteViews row = new RemoteViews(context.getPackageName(), compact ? R.layout.widget_row_compact : R.layout.widget_row);
            RoadViews.bind(row, item, compact);
            row.setOnClickFillInIntent(R.id.row_root, new Intent().putExtra("source_url", item.sourceUrl));
            rows.addItem(item.id.hashCode(), row);
        }
        views.setRemoteAdapter(R.id.widget_list, rows.build());
        Intent app = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(context, widgetId, app, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, widgetId + 10000, app, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, widgetId,
                new Intent(context, TodayWidget.class).setAction(REFRESH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return views;
    }
}
