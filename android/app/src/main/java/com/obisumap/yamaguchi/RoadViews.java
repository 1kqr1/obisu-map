package com.obisumap.yamaguchi;

import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.widget.ImageView;
import android.widget.RemoteViews;
import android.widget.TextView;

/** 同じ道路バッジと読める管内表示を、アプリとウィジェットで共用する。 */
public final class RoadViews {
    private static int background(FeedModel.Item item, RoadPresentation road) {
        if (!"speed".equals(item.kind)) return R.drawable.road_notice_badge;
        return road.road.startsWith("国道") ? R.drawable.road_shield : R.drawable.road_other_badge;
    }
    private static int timeColor(FeedModel.Item item) {
        return item.timeBand.equals("night_early") || item.timeBand.equals("early") || item.timeBand.equals("night")
                ? Color.rgb(67, 56, 138) : Color.rgb(143, 81, 14);
    }
    private static float numberSize(RoadPresentation road, boolean compact) {
        return road.numbered ? (compact ? (road.number.length() == 3 ? 18 : 21) : (road.number.length() == 3 ? 24 : 28)) : (compact ? 11 : 15);
    }
    public static void bind(RemoteViews row, FeedModel.Item item, boolean compact) {
        RoadPresentation road = new RoadPresentation(item);
        row.setImageViewResource(R.id.road_badge_background, background(item, road));
        row.setTextViewText(R.id.road_badge_top, road.badgeTop);
        row.setTextViewTextSize(R.id.road_badge_top, TypedValue.COMPLEX_UNIT_DIP, compact ? 8 : 10);
        row.setTextViewText(R.id.road_badge_number, road.badgeMain);
        row.setTextViewTextSize(R.id.road_badge_number, TypedValue.COMPLEX_UNIT_DIP, numberSize(road, compact));
        row.setTextViewText(R.id.row_title, road.roadLabel());
        row.setTextViewText(R.id.row_stations, road.stations);
        row.setViewVisibility(R.id.row_stations, road.stations.isEmpty() ? View.GONE : View.VISIBLE);
        row.setTextViewText(R.id.row_detail, item.timeLabel(compact));
        row.setTextColor(R.id.row_detail, timeColor(item));
        row.setContentDescription(R.id.row_root, item.title + "、" + item.timeLabel(compact) + "。県警の原情報を見る");
    }
    public static void bind(View row, FeedModel.Item item) {
        RoadPresentation road = new RoadPresentation(item);
        ((ImageView) row.findViewById(R.id.road_badge_background)).setImageResource(background(item, road));
        TextView top = row.findViewById(R.id.road_badge_top);
        top.setText(road.badgeTop); top.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 10);
        TextView number = row.findViewById(R.id.road_badge_number);
        number.setText(road.badgeMain); number.setTextSize(TypedValue.COMPLEX_UNIT_DIP, numberSize(road, false));
        ((TextView) row.findViewById(R.id.row_title)).setText(road.roadLabel());
        TextView stations = row.findViewById(R.id.row_stations);
        stations.setText(road.stations); stations.setVisibility(road.stations.isEmpty() ? View.GONE : View.VISIBLE);
        TextView time = row.findViewById(R.id.row_detail);
        time.setText(item.timeLabel(false)); time.setTextColor(timeColor(item));
        row.setContentDescription(item.title + "、" + item.timeLabel(false) + "。県警の原情報を見る");
    }
}
