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
        if (view instanceof TextView && ((TextView) view).getText().toString().contains(text)) return true;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++)
            if (hasText(((ViewGroup) view).getChildAt(i), text)) return true;
        return false;
    }
    private void screenshot(String name) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
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
        // AppWidgetHostへのRemoteViews配送を待つ。エミュレータだけで実施。
        for (int i = 0; i < 40; i++) {
            final boolean[] shown = {false};
            instrumentation.runOnMainSync(() -> shown[0] = hasText(host.getWindow().getDecorView(), "山口 きょうの取締り"));
            if (shown[0]) break;
            Thread.sleep(250);
        }
        assertTrue(hasText(host.getWindow().getDecorView(), "山口 きょうの取締り"));
        screenshot("widget-screen.png");
        instrumentation.runOnMainSync(host::finish);
    }
}
