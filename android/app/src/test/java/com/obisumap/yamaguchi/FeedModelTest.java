package com.obisumap.yamaguchi;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;

public class FeedModelTest {
    private String fixture() throws Exception {
        return new String(getClass().getResourceAsStream("/fixture.json").readAllBytes(), StandardCharsets.UTF_8);
    }
    @Test public void onlyRequestedDateIsShown() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-13");
        assertTrue(model.covered);
        assertTrue(model.items.stream().anyMatch(i -> i.title.contains("柳井") && i.title.contains("山陽小野田")));
        assertFalse(model.items.stream().anyMatch(i -> i.title.contains("可搬式オービス")));
    }
    @Test public void unknownDateDoesNotSayNoEnforcement() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2027-01-01");
        assertFalse(model.covered);
        assertEquals(0, model.items.size());
        assertTrue(model.emptyMessage().contains("取得できていません"));
    }
    @Test public void earlyMorningUsesPreviousNight() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-14");
        assertEquals(2, model.items.stream().filter(i -> i.detail.contains("前日夜から")).count());
    }
    @Test public void xOnlyDateIsMarkedAsPartial() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-16");
        assertFalse(model.covered);
        assertTrue(model.items.stream().anyMatch(i -> i.title.contains("飲酒運転")));
    }
    @Test public void usesJapanDateAcrossMidnight() {
        assertEquals(LocalDate.of(2026, 10, 14), Instant.parse("2026-10-13T15:00:00Z").atZone(FeedModel.JAPAN).toLocalDate());
    }
    @Test public void onlyOfficialSourcesCanBeOpened() {
        assertTrue(FeedModel.allowedSourceUrl("https://x.com/YamaguchiPolice/status/123"));
        assertTrue(FeedModel.allowedSourceUrl("https://www.pref.yamaguchi.lg.jp/site/police/10456.html"));
        assertFalse(FeedModel.allowedSourceUrl("javascript:alert(1)"));
        assertFalse(FeedModel.allowedSourceUrl("https://x.com.evil.example/YamaguchiPolice/status/123"));
        assertFalse(FeedModel.allowedSourceUrl("https://x.com/AnotherAccount/status/123"));
    }
    @Test public void oldFeedStillSeparatesRoadAndPoliceJurisdiction() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-13");
        RoadPresentation road = new RoadPresentation(model.items.get(0));
        assertEquals("国道2号", road.road);
        assertEquals("2", road.number);
        assertTrue(road.stations.contains("岩国"));
        assertTrue(road.stations.contains("周南"));
        assertEquals("管内：岩国・周南", road.stations);
    }
    @Test public void unidentifiedRoadDoesNotInventNationalRouteNumber() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-13");
        for (FeedModel.Item item : model.items) {
            RoadPresentation road = new RoadPresentation(item);
            if (road.road.equals("国道その他") || road.road.equals("その他道路")) {
                assertFalse(road.numbered); assertEquals("", road.number);
            }
        }
    }
    @Test public void xNoticeRemainsNoticeRatherThanRoadSign() throws Exception {
        FeedModel model = FeedModel.parse(fixture(), "2026-10-08");
        FeedModel.Item item = model.items.stream().filter(i -> i.kind.equals("mobile_orbis")).findFirst().get();
        RoadPresentation road = new RoadPresentation(item);
        assertFalse(road.numbered); assertEquals("可搬式", road.badgeTop);
        assertTrue(item.timeLabel(true).contains("岩国市"));
    }
}
