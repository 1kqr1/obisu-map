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
    private void screenshot(String name) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.waitForIdleSync();
        // RemoteViewsの値が反映されてからSurfaceFlingerにフレームが届くまで待つ。
        Thread.sleep(1000);
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        File output = new File(instrumentation.getTargetContext().getExternalFilesDir(null), name);
        try (FileOutputStream file = new FileOutputStream(output)) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, file); }
    }
    private void waitForMode(WidgetHostTestActivity host, boolean compact, FeedModel model) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        String title = compact ? "山口 取締り" : "山口 きょうの取締り";
        for (int attempt = 0; attempt < 80; attempt++) {
            final boolean[] ready = {false};
            instrumentation.runOnMainSync(() -> {
                TextView heading = host.widgetView.findViewById(R.id.widget_title);
                TextView number = host.widgetView.findViewById(R.id.road_badge_number);
                ready[0] = heading != null && title.equals(heading.getText().toString())
                        && (model.items.isEmpty() || number != null && new RoadPresentation(model.items.get(0)).badgeMain.equals(number.getText().toString()));
            });
            if (ready[0]) return;
            Thread.sleep(250);
        }
        screenshot("widget-failed-mode.png");
        instrumentation.runOnMainSync(() -> {
            TextView heading = host.widgetView.findViewById(R.id.widget_title);
            TextView number = host.widgetView.findViewById(R.id.road_badge_number);
            System.out.println("Resize diagnostics: title=" + (heading == null ? "null" : heading.getText())
                    + " badge=" + (number == null ? "null" : number.getText())
                    + " host=" + host.widgetView.getWidth() + "x" + host.widgetView.getHeight());
        });
        fail("Widget size switch must render the title and road badge: " + title);
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
            instrumentation.runOnMainSync(() -> shown[0] = hasText(host.getWindow().getDecorView(), model.dateLabel())
                    && (model.items.isEmpty() || hasText(host.getWindow().getDecorView(), new RoadPresentation(model.items.get(0)).roadLabel())));
            if (shown[0]) break;
            Thread.sleep(250);
        }
        assertTrue("Actual data date must be rendered", hasText(host.getWindow().getDecorView(), model.dateLabel()));
        if (!model.items.isEmpty()) assertTrue("First enforcement item must be rendered", hasText(host.getWindow().getDecorView(), new RoadPresentation(model.items.get(0)).roadLabel()));
        screenshot("widget-screen.png");
        AppWidgetProviderInfo info = host.widgetView.getAppWidgetInfo();
        assertEquals("Both resize directions must be supported", AppWidgetProviderInfo.RESIZE_BOTH, info.resizeMode);
        instrumentation.runOnMainSync(() -> host.resize(180, 180));
        waitForMode(host, true, model);
        screenshot("widget-compact.png");
        instrumentation.runOnMainSync(() -> host.resize(360, 480));
        waitForMode(host, false, model);
        screenshot("widget-expanded.png");
        instrumentation.runOnMainSync(() -> host.resize(280, 340));
        waitForMode(host, false, model);
        screenshot("widget-restored.png");
        instrumentation.runOnMainSync(host::finish);
    }
}
