package com.obisumap.yamaguchi;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class UpdateJob extends JobService {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Future<?> running;
    public static void schedule(Context context, boolean immediate) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        JobInfo.Builder builder = new JobInfo.Builder(immediate ? 2002 : 2001, new ComponentName(context, UpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
        if (immediate) builder.setMinimumLatency(0);
        else builder.setPeriodic(30 * 60 * 1000L, 10 * 60 * 1000L).setPersisted(true);
        scheduler.schedule(builder.build());
    }
    @Override public boolean onStartJob(JobParameters params) {
        running = worker.submit(() -> { FeedStore.refresh(getApplicationContext()); jobFinished(params, false); });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        if (running != null) running.cancel(true);
        return true;
    }
    @Override public void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
}
