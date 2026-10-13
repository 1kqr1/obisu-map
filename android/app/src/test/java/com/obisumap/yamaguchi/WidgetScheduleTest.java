package com.obisumap.yamaguchi;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.ZonedDateTime;

public class WidgetScheduleTest {
    private FeedModel model(String bands) throws Exception {
        StringBuilder records = new StringBuilder();
        int i = 0;
        for (String band : bands.split(",")) {
            if (i > 0) records.append(',');
            records.append("{\"id\":\"").append(i++).append("\",\"title\":\"国道2号 / 岩国\",\"detail\":\"予定\",\"source_url\":\"https://www.pref.yamaguchi.lg.jp/site/police/1.html\",\"time_band\":\"").append(band).append("\"}");
        }
        return FeedModel.parse("{\"schema_version\":1,\"prefecture\":\"山口県\",\"hp_coverage_dates\":[\"2026-10-13\"],\"days\":{\"2026-10-13\":[" + records + "]}}", "2026-10-13");
    }
    private WidgetSchedule schedule(String bands, String instant) throws Exception { return new WidgetSchedule(model(bands), ZonedDateTime.parse(instant)); }
    @Test public void boundaryIsInclusiveAtStartExclusiveAtEnd() throws Exception {
        assertEquals(WidgetSchedule.State.BEFORE, schedule("day", "2026-10-13T05:59:59+09:00").rows.get(0).state);
        assertEquals(WidgetSchedule.State.WITHIN, schedule("day", "2026-10-13T06:00:00+09:00").rows.get(0).state);
        assertEquals(WidgetSchedule.State.ENDED, schedule("day", "2026-10-13T18:00:00+09:00").rows.get(0).state);
    }
    @Test public void sortsTimeWindowBeforeFinishedAndDoesNotCallUnknownFinished() throws Exception {
        WidgetSchedule s = schedule("day,night_early,unspecified", "2026-10-13T20:00:00+09:00");
        assertEquals("1", s.rows.get(0).item.id);
        assertEquals(1, s.within); assertEquals(1, s.ended); assertEquals(1, s.unknown);
        assertEquals(WidgetSchedule.State.UNKNOWN, s.rows.get(1).state);
        assertEquals("内1 予0 終1 告1", s.summary());
    }
    @Test public void previousNightAndJapanTimezoneAreHandled() throws Exception {
        assertEquals(WidgetSchedule.State.WITHIN, schedule("night_early", "2026-10-14T05:59:59+09:00").rows.get(0).state);
        assertEquals(WidgetSchedule.State.ENDED, schedule("night_early", "2026-10-14T06:00:00+09:00").rows.get(0).state);
        assertEquals(WidgetSchedule.State.WITHIN, schedule("early", "2026-10-12T16:00:00Z").rows.get(0).state);
    }
    @Test public void aggregatesOnlyIdenticalPublishedTimes() throws Exception {
        assertEquals("6-18", schedule("day,day", "2026-10-13T09:00:00+09:00").commonTime);
        assertEquals("", schedule("day,night_early,day", "2026-10-13T09:00:00+09:00").commonTime);
        assertEquals("", schedule("unspecified", "2026-10-13T09:00:00+09:00").commonTime);
    }
    @Test public void nextBoundaryIncludesMidnightForChangingFeedDate() {
        assertEquals(ZonedDateTime.parse("2026-10-14T00:00:00+09:00[Asia/Tokyo]"), WidgetSchedule.nextBoundary(ZonedDateTime.parse("2026-10-13T20:00:00+09:00")));
        assertEquals(18, WidgetSchedule.nextBoundary(ZonedDateTime.parse("2026-10-13T06:00:00+09:00")).getHour());
    }
}
