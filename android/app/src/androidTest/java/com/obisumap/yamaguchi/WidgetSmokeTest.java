package com.obisumap.yamaguchi;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.appwidget.AppWidgetProviderInfo;
import android.widget.TextView;
import android.view.View;
import android.view.ViewGroup;
import java.io.File;
import java.io.FileOutputStream;

public class WidgetSmokeTest {
    private boolean hasText(View view, String text) {
        if (view instanceof TextView && view.isShown() && ((TextView) view).getText().toString().contains(text)) return true;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++)
            if (hasText(((ViewGroup) view).getChildAt(i), text)) return true;
        return false;
    }
    // AppWidgetHostViewの子はRemoteViewsの名前空間なので、外側のfindViewByIdでは探索できない。
    private View findById(View view, int id) {
        if (view.getId() == id) return view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            View found = findById(((ViewGroup) view).getChildAt(i), id);
            if (found != null) return found;
        }
        return null;
    }
    private String expectedBadge(FeedModel model) {
        FeedModel.Item item = new WidgetSchedule(model, java.time.ZonedDateTime.now(FeedModel.JAPAN)).rows.get(0).item;
        RoadPresentation road = new RoadPresentation(item);
        return road.numbered ? road.number : "speed".equals(item.kind) ? road.road.startsWith("国道") ? "?" : "他" : "告";
    }
    private int fullyVisibleRows(View view, android.graphics.Rect clip) {
        int count = 0;
        if (view.getId() == R.id.row_root && view.isShown()) {
            int[] xy = new int[2]; view.getLocationOnScreen(xy);
            if (xy[1] >= clip.top && xy[1] + view.getHeight() <= clip.bottom) count++;
        }
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++)
            count += fullyVisibleRows(((ViewGroup) view).getChildAt(i), clip);
        return count;
    }
    private void assertVisibleRows(WidgetHostTestActivity host, int minimum) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            View list = findById(host.widgetView, R.id.widget_list);
            android.graphics.Rect clip = new android.graphics.Rect();
            assertTrue(list.getGlobalVisibleRect(clip));
            assertTrue("Fully visible rows: " + fullyVisibleRows(list, clip), fullyVisibleRows(list, clip) >= minimum);
        });
    }
    private void screenshot(String name) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.waitForIdleSync();
        // RemoteViewsの値が反映されてからSurfaceFlingerにフレームが届くまで待つ。
        Thread.sleep(1000);
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        File output = new File(instrumentation.getTargetContext().getExternalFilesDir(null), name);
        try (FileOutputStream file = new FileOutputStream(output)) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, file); }
    }
    private void waitForMode(WidgetHostTestActivity host, boolean pair, FeedModel model) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        String title = "山口 取締り";
        for (int attempt = 0; attempt < 80; attempt++) {
            final boolean[] ready = {false};
            instrumentation.runOnMainSync(() -> {
                TextView heading = (TextView) findById(host.widgetView, R.id.widget_title);
                TextView number = (TextView) findById(host.widgetView, R.id.road_badge_number);
                ready[0] = heading != null && title.equals(heading.getText().toString())
                        && ((findById(host.widgetView, R.id.row_left) != null) == pair)
                        && (model.items.isEmpty() || number != null && expectedBadge(model).equals(number.getText().toString()));
            });
            if (ready[0]) return;
            Thread.sleep(250);
        }
        screenshot("widget-failed-mode.png");
        final String[] diagnostics = {""};
        instrumentation.runOnMainSync(() -> {
            TextView heading = (TextView) findById(host.widgetView, R.id.widget_title);
            TextView number = (TextView) findById(host.widgetView, R.id.road_badge_number);
            diagnostics[0] = "title=" + (heading == null ? "null" : heading.getText())
                    + " badge=" + (number == null ? "null" : number.getText())
                    + " host=" + host.widgetView.getWidth() + "x" + host.widgetView.getHeight();
        });
        fail("Widget size switch must render the title and road badge: " + title + " · " + diagnostics[0]);
    }
    @Test public void nativeScreenAndActualWidgetRender() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.waitForIdleSync();
        assertTrue(hasText(activity.getWindow().getDecorView(), "山口 きょうの取締り"));
        screenshot("native-screen.png");
        instrumentation.runOnMainSync(activity::finish);
        Intent hostIntent = new Intent(context, WidgetHostTestActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        WidgetHostTestActivity host = (WidgetHostTestActivity) instrumentation.startActivitySync(hostIntent);
        instrumentation.waitForIdleSync();
        assertTrue("Widget binding must succeed", host.bound);
        FeedModel model = FeedStore.cached(context);
        assertNotNull("Bootstrap or fetched feed must be present", model);
        // 初期レイアウトにもタイトルはあるので、日付とデータ行の配送まで待つ。
        for (int i = 0; i < 80; i++) {
            final boolean[] shown = {false};
            instrumentation.runOnMainSync(() -> shown[0] = hasText(host.getWindow().getDecorView(), model.date.substring(5).replace('-', '/'))
                    && (model.items.isEmpty() || hasText(host.getWindow().getDecorView(), new RoadPresentation(new WidgetSchedule(model, java.time.ZonedDateTime.now(FeedModel.JAPAN)).rows.get(0).item).roadLabel())));
            if (shown[0]) break;
            Thread.sleep(250);
        }
        assertTrue("Actual data date must be rendered", hasText(host.getWindow().getDecorView(), model.date.substring(5).replace('-', '/')));
        if (!model.items.isEmpty()) assertTrue("First enforcement item must be rendered", hasText(host.getWindow().getDecorView(), new RoadPresentation(new WidgetSchedule(model, java.time.ZonedDateTime.now(FeedModel.JAPAN)).rows.get(0).item).roadLabel()));
        screenshot("widget-screen.png");
        AppWidgetProviderInfo info = host.widgetView.getAppWidgetInfo();
        assertEquals("Both resize directions must be supported", AppWidgetProviderInfo.RESIZE_BOTH, info.resizeMode);
        instrumentation.runOnMainSync(() -> host.resize(180, 180));
        waitForMode(host, false, model);
        screenshot("widget-compact.png");
        instrumentation.runOnMainSync(() -> host.resize(360, 480));
        waitForMode(host, false, model);
        screenshot("widget-expanded.png");
        if (model.items.size() >= 6) assertVisibleRows(host, 6);
        instrumentation.runOnMainSync(() -> host.resize(360, 240));
        waitForMode(host, true, model);
        screenshot("widget-wide.png");
        if (model.items.size() >= 6) assertVisibleRows(host, 6);
        instrumentation.runOnMainSync(() -> host.resize(280, 340));
        waitForMode(host, false, model);
        screenshot("widget-restored.png");
        instrumentation.runOnMainSync(host::finish);
    }
}
