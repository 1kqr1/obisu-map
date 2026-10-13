package com.obisumap.yamaguchi;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
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
                    && (model.items.isEmpty() || hasText(host.getWindow().getDecorView(), model.items.get(0).title)));
            if (shown[0]) break;
            Thread.sleep(250);
        }
        assertTrue("Actual data date must be rendered", hasText(host.getWindow().getDecorView(), model.dateLabel()));
        if (!model.items.isEmpty()) assertTrue("First enforcement item must be rendered", hasText(host.getWindow().getDecorView(), model.items.get(0).title));
        screenshot("widget-screen.png");
        instrumentation.runOnMainSync(host::finish);
    }
}
