package com.minis.bookkeeping;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * 常驻前台服务 —— 只干一件事：让进程活着。
 *
 * 为什么需要它（2026-11-07）：
 *   通知监听服务是被系统"按需绑定"的，进程一被清掉，监听就没了信号，
 *   症状就是用户说的「装一次只能用一次」—— 刚装好能记，过几天就无声无息。
 *   常驻前台服务把进程钉住，监听才不会断。
 *
 * 开关：files/keepalive.on 存在即常驻（JS 端可关）。
 */
public class KeepAliveService extends Service {
    public static final String ACTION_START = "com.minis.bookkeeping.KEEPALIVE_START";
    public static final String ACTION_STOP  = "com.minis.bookkeeping.KEEPALIVE_STOP";
    private static final String CH = "bookkeeping_keepalive";
    private static final int ID = 7001;

    public static volatile boolean sRunning = false;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        sRunning = true;
        heal();
    }

    @Override public void onDestroy() {
        sRunning = false;
        try { handler.removeCallbacksAndMessages(null); } catch (Throwable t) {}
        super.onDestroy();
    }

    /* ★ 2026-11-07 自愈：系统把通知监听解绑后不会自己绑回来。
       常驻服务活着就每 45 秒检查一次，断了就 requestRebind。
       这是「装一次只能用一次」的直接解药 —— 只要进程还在，监听一定被接回去。 */
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            try {
                if (!NotificationReaderService.isConnected()) {
                    NotificationReaderService.ensureBound(KeepAliveService.this);
                }
            } catch (Throwable t) {}
            handler.postDelayed(this, 45000);
        }
    };
    private void heal() { handler.removeCallbacks(tick); handler.postDelayed(tick, 3000); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            sRunning = false;
            try { stopForeground(true); } catch (Exception ignored) {}
            stopSelf();
            return START_NOT_STICKY;
        }
        show();
        heal();
        return START_STICKY;
    }

    private void show() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CH, "自动记账常驻",
                        NotificationManager.IMPORTANCE_MIN);
                ch.setShowBadge(false);
                ch.enableVibration(false);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(this, CH)
                    : new Notification.Builder(this);
            b.setContentTitle("记账 · 正在听支付通知")
             .setContentText("关掉「自动记账」这个通知就消失")
             .setSmallIcon(android.R.drawable.stat_notify_sync)
             .setOngoing(true)
             .setPriority(Notification.PRIORITY_MIN);
            Notification n = b.build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(ID, n);
            }
        } catch (Exception ignored) {}
    }
}
