package com.obisumap.yamaguchi;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 公表された道路名だけから表示を作る。未公表の国道番号は推測しない。 */
public final class RoadPresentation {
    private static final Pattern NUMBER = Pattern.compile("^国道([0-9]{1,3})号$");
    public final String road, stations, number, badgeTop, badgeMain;
    public final boolean numbered;
    public final int order;
    public RoadPresentation(FeedModel.Item item) {
        boolean speed = "speed".equals(item.kind);
        String[] legacy = item.title.split(" / ", 2);
        road = speed ? (!item.road.isEmpty() ? item.road : legacy[0]) : item.title;
        String jurisdiction = !item.stations.isEmpty() ? item.stations : (speed && legacy.length > 1 ? legacy[1] : "");
        stations = jurisdiction.isEmpty() ? "" : "管内：" + jurisdiction;
        Matcher match = NUMBER.matcher(road);
        numbered = speed && match.matches();
        number = numbered ? match.group(1) : "";
        if (numbered) { badgeTop = "国道"; badgeMain = number; order = Integer.parseInt(number); }
        else if (speed && road.startsWith("国道")) { badgeTop = "国道"; badgeMain = "不明"; order = 1000; }
        else if (speed) { badgeTop = "道路"; badgeMain = "その他"; order = 1001; }
        else if ("mobile_orbis".equals(item.kind)) { badgeTop = "可搬式"; badgeMain = "予告"; order = -3; }
        else if ("drink_driving".equals(item.kind)) { badgeTop = "飲酒"; badgeMain = "取締り"; order = -2; }
        else { badgeTop = "県警X"; badgeMain = "告知"; order = -1; }
    }
    public String roadLabel() { return "国道その他".equals(road) ? "国道（番号未公表）" : road; }
}
