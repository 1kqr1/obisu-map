package com.obisumap.yamaguchi;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LinearLayout content;
    private boolean registered;
    private final BroadcastReceiver changed = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { render(); }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            content.setPadding(dp(20) + bars.left, dp(16) + bars.top, dp(20) + bars.right, dp(20) + bars.bottom);
            return insets;
        });
        handleSource(getIntent()); render(); UpdateJob.schedule(this, false); refresh();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleSource(intent); }
    private void handleSource(Intent intent) {
        String url = intent.getStringExtra("source_url");
        if (url != null && FeedModel.allowedSourceUrl(url)) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        intent.removeExtra("source_url");
    }
    @Override protected void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changed, new IntentFilter(FeedStore.CHANGED), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(changed, new IntentFilter(FeedStore.CHANGED));
        registered = true; render();
    }
    @Override protected void onPause() { if (registered) { unregisterReceiver(changed); registered = false; } super.onPause(); }
    @Override protected void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
    private void refresh() {
        Toast.makeText(this, "取締り情報を更新しています", Toast.LENGTH_SHORT).show();
        worker.submit(() -> FeedStore.refresh(getApplicationContext()));
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(0xff1d3557);
        if (bold) view.setTypeface(null, android.graphics.Typeface.BOLD);
        view.setPadding(0, dp(8), 0, dp(8)); content.addView(view); return view;
    }
    private void button(String label, Runnable action) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setMinHeight(dp(48));
        content.addView(view, new LinearLayout.LayoutParams(-1, -2)); view.setOnClickListener(v -> action.run());
    }
    private void render() {
        if (content == null || isFinishing()) return;
        content.removeAllViews(); FeedModel model = FeedStore.cached(this);
        text("山口 きょうの取締り", 23, true);
        text((model == null ? FeedModel.today() : model.dateLabel()) + " / 山口県全域", 15, false);
        button("ホーム画面にウィジェットを追加", () -> {
            AppWidgetManager manager = getSystemService(AppWidgetManager.class);
            if (manager.isRequestPinAppWidgetSupported()) manager.requestPinAppWidget(new ComponentName(this, TodayWidget.class), null, null);
            else Toast.makeText(this, "ホーム画面を長押しし、ウィジェットから追加してください", Toast.LENGTH_LONG).show();
        });
        button("最新情報を取得", this::refresh);
        if (model == null) text("取締り情報を未取得です。通信状況を確認し、更新してください。", 14, false);
        else {
            if (!model.covered) text(model.coverageMessage(), 14, true);
            if (model.items.isEmpty()) text(model.emptyMessage(), 14, false);
            for (FeedModel.Item item : model.items) {
                text(item.title, 16, true); text(item.detail, 13, false);
                if (FeedModel.allowedSourceUrl(item.sourceUrl)) button("県警の原情報を見る", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(item.sourceUrl))));
            }
            text(model.sourceLabel(), 12, false);
        }
        text(FeedStore.status(this), 12, false);
        button("地図を開く", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://orbis.1kqr1.com/"))));
        text("公表予定以外にも取締りが行われ、予定は変更される場合があります。\n\nウィジェットは約30分ごとに更新を試みます。省電力設定などで遅れる場合は更新ボタンを押してください。\n\n位置情報・連絡先・アカウント登録は不要です。", 12, false);
    }
}
