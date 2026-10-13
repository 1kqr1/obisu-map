package com.obisumap.yamaguchi;

import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** 公表予定の時間帯との比較。実際の取締り実施を確認した状態ではない。 */
public final class WidgetSchedule {
    public enum State {
        WITHIN("内", "予定時間内", 0, 0xFFD93025),
        BEFORE("予", "予定開始前", 1, 0xFF1A73E8),
        UNKNOWN("告", "時間未公表の告知", 2, 0xFF9AA0A6),
        ENDED("終", "予定時間終了", 3, 0xFF9AA0A6);
        public final String mark, label;
        public final int order, color;
        State(String mark, String label, int order, int color) {
            this.mark = mark; this.label = label; this.order = order; this.color = color;
        }
    }
    public static final class Row {
        public final FeedModel.Item item;
        public final State state;
        public final ZonedDateTime start;
        Row(FeedModel.Item item, State state, ZonedDateTime start) { this.item = item; this.state = state; this.start = start; }
    }
    public final List<Row> rows = new ArrayList<>();
    public final ZonedDateTime now;
    public final String commonTime;
    public final int within, before, ended, unknown;
    public WidgetSchedule(FeedModel model, ZonedDateTime clock) {
        now = clock.withZoneSameInstant(FeedModel.JAPAN);
        int active = 0, pending = 0, finished = 0, untimed = 0;
        String common = null;
        if (model != null) for (FeedModel.Item item : model.items) {
            LocalDate date = LocalDate.parse(model.date);
            ZonedDateTime start = null, end = null;
            if ("speed".equals(item.kind)) switch (item.timeBand) {
                case "day": start = date.atTime(6, 0).atZone(FeedModel.JAPAN); end = date.atTime(18, 0).atZone(FeedModel.JAPAN); break;
                case "night_early": start = date.atTime(18, 0).atZone(FeedModel.JAPAN); end = date.plusDays(1).atTime(6, 0).atZone(FeedModel.JAPAN); break;
                case "early": start = date.atStartOfDay(FeedModel.JAPAN); end = date.atTime(6, 0).atZone(FeedModel.JAPAN); break;
                default: break;
            }
            State state = start == null ? State.UNKNOWN : now.isBefore(start) ? State.BEFORE : now.isBefore(end) ? State.WITHIN : State.ENDED;
            switch (state) { case WITHIN: active++; break; case BEFORE: pending++; break; case ENDED: finished++; break; default: untimed++; }
            rows.add(new Row(item, state, start));
            String time = shortTime(item);
            common = common == null ? time : common.equals(time) ? common : "";
        }
        rows.sort(Comparator.comparingInt((Row row) -> row.state.order)
                .thenComparing(row -> row.state == State.BEFORE ? row.start : now)
                .thenComparingInt(row -> new RoadPresentation(row.item).order).thenComparing(row -> row.item.id));
        within = active; before = pending; ended = finished; unknown = untimed;
        commonTime = common == null || "未公表".equals(common) ? "" : common;
    }
    public String summary() { return "内" + within + " 予" + before + " 終" + ended + (unknown > 0 ? " 告" + unknown : ""); }
    public static String shortTime(FeedModel.Item item) {
        if (!"speed".equals(item.kind)) return "未公表";
        switch (item.timeBand) { case "day": return "6-18"; case "night_early": return "18-翌6"; case "early": return "0-6"; default: return "未公表"; }
    }
    public static ZonedDateTime nextBoundary(ZonedDateTime time) {
        ZonedDateTime local = time.withZoneSameInstant(FeedModel.JAPAN);
        for (int hour : new int[]{6, 18}) {
            ZonedDateTime boundary = local.toLocalDate().atTime(hour, 0).atZone(FeedModel.JAPAN);
            if (boundary.isAfter(local)) return boundary;
        }
        return local.toLocalDate().plusDays(1).atStartOfDay(FeedModel.JAPAN);
    }
}
