package com.obisumap.yamaguchi;

import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetHostView;
import android.content.ComponentName;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.util.SizeF;
import java.util.Collections;

/** エミュレータで本物のAppWidgetHostへ配置し、リスト描画を確認する検証用画面。 */
public class WidgetHostTestActivity extends Activity {
    public AppWidgetHost host;
    public int widgetId;
    public boolean bound;
    public AppWidgetHostView widgetView;
    private TextView label;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 64, 24, 24);
        root.setBackgroundColor(0xffe8edf3);
        label = new TextView(this); label.setText("山口県ウィジェット 実表示の検証"); label.setTextSize(18); root.addView(label);
        setContentView(root);
        host = new AppWidgetHost(this, 9191);
        widgetId = host.allocateAppWidgetId();
        AppWidgetManager manager = getSystemService(AppWidgetManager.class);
        ComponentName provider = new ComponentName("com.obisumap.yamaguchi", "com.obisumap.yamaguchi.TodayWidget");
        bound = manager.bindAppWidgetIdIfAllowed(widgetId, provider);
        if (!bound) { label.setText("Widget bind failed"); return; }
        widgetView = host.createView(this, widgetId, manager.getAppWidgetInfo(widgetId));
        root.addView(widgetView, new LinearLayout.LayoutParams(-1, 900));
        host.startListening();
        resize(280, 340);
    }
    public void resize(int width, int height) {
        float density = getResources().getDisplayMetrics().density;
        widgetView.setLayoutParams(new LinearLayout.LayoutParams(Math.round(width * density), Math.round(height * density)));
        widgetView.updateAppWidgetSize(new Bundle(), Collections.singletonList(new SizeF(width, height)));
        label.setText("ウィジェット表示テスト · " + width + "×" + height + "dp");
    }
    @Override public void onDestroy() {
        if (host != null) { host.stopListening(); host.deleteHost(); }
        super.onDestroy();
    }
}
