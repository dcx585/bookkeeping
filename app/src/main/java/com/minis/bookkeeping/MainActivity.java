package com.minis.bookkeeping;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.content.ContentValues;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.File;
import android.database.Cursor;
import android.provider.Telephony;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER = 10001;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ── JavaScript bridge: JS calls App.readClipboard() / App.fullscreen() etc ──
    public class AppBridge {
        private String esc(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n").replace("\r", "\\r")
                    .replace("\t", "\\t");
        }
        @JavascriptInterface
        public String keepAliveStatus() {
            boolean on = false;
            try { on = new java.io.File(getFilesDir(), "keepalive.on").exists(); } catch (Exception e) {}
            return "{\"on\":" + on + "}";
        }

        @JavascriptInterface
        public void keepAliveSet(final boolean on) {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    java.io.File f = new java.io.File(getFilesDir(), "keepalive.on");
                    Intent i = new Intent(MainActivity.this, KeepAliveService.class);
                    if (on) {
                        if (!f.exists()) f.createNewFile();
                        i.setAction(KeepAliveService.ACTION_START);
                    } else {
                        if (f.exists()) f.delete();
                        i.setAction(KeepAliveService.ACTION_STOP);
                    }
                    startService(i);
                } catch (Exception ignored) {}
            }});
        }

        /** 请求把本应用排除出电池优化（国产 ROM 上这是通知监听被杀的另一个原因） */
        @JavascriptInterface
        public void askBatteryWhitelist() {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    if (android.os.Build.VERSION.SDK_INT < 23) return;
                    android.os.PowerManager pm =
                            (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) return;
                    Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    i.setData(android.net.Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception ignored) {}
            }});
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = cm.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence txt = clip.getItemAt(0).getText();
                    return txt != null ? txt.toString() : "";
                }
                return "";
            } catch (Exception e) { return ""; }
        }
        @JavascriptInterface
        public String getClipboardText() {
            return readClipboard();
        }
        @JavascriptInterface
        public void notifyListen(String payload) {
            final String orig = (payload == null) ? "" : payload;
            mainHandler.post(new Runnable() { public void run() {
                try {
                    Intent i = new Intent(NotificationReaderService.ACTION_SEND);
                    i.setClass(MainActivity.this, NotificationReaderService.class);
                    i.putExtra("payload", orig);
                    startService(i);
                } catch (Exception ignored) {}
            } });
        }
        @JavascriptInterface
        public boolean hasNotifAccess() {
            return NotificationReaderService.isEnabled(MainActivity.this);
        }
        @JavascriptInterface
        public void openNotifSettings() {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"));
                } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (Exception ignored) {}
                }
            } });
        }
        @JavascriptInterface
        public String readImportedTx() {
            try {
                // 走 svc.read()：与 readPendingTx 同源，且顺带把超过 7 天的条自动清除
                return NotificationReaderService.queueRead(getFilesDir());
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public String readSms() {
            // 读短信：合并「收件箱(type=1)」与「全量(content://sms，不限 type)」两个查询。
            // 【关键】只查 type=1 会漏掉 5G消息/富媒体/厂商特殊存储的银行通知——
            //   这正是"明明有银行短信却读不到"的根因。且不能"第一个查到就 break"，
            //   否则只要有一条普通短信兜底就永不执行。
            try {
                android.content.ContentResolver cr = getContentResolver();
                String[] uris = {"content://sms/inbox", "content://sms"};
                String[] sels = {"type=1", null};
                java.util.HashSet<String> seen = new java.util.HashSet<>();
                java.util.TreeMap<Long, java.util.List<String>> byDate =
                    new java.util.TreeMap<>(java.util.Collections.reverseOrder());
                int total = 0;
                for (int k = 0; k < uris.length; k++) {
                    android.database.Cursor c = null;
                    try {
                        c = cr.query(android.net.Uri.parse(uris[k]),
                                new String[]{"address","body","date"}, sels[k], null, "date DESC");
                    } catch (Exception ei) { c = null; }
                    if (c == null) continue;
                    int ia = c.getColumnIndex("address");
                    int ib = c.getColumnIndex("body");
                    int id = c.getColumnIndex("date");
                    int n = 0;
                    try {
                        while (c.moveToNext() && n < 400) {
                            n++; total++;
                            if (ia < 0 || ib < 0 || id < 0) continue;
                            String addr = c.getString(ia);
                            String body = c.getString(ib);
                            if (body == null) body = "";
                            long date = c.getLong(id);
                            String key = addr + "|" + date + "|" + body.hashCode();
                            if (!seen.add(key)) continue;
                            String json = "{\"address\":\"" + esc(String.valueOf(addr))
                                + "\",\"body\":\"" + esc(body)
                                + "\",\"date\":" + date + "}";
                            java.util.List<String> bucket = byDate.get(date);
                            if (bucket == null) { bucket = new java.util.ArrayList<String>(); byDate.put(date, bucket); }
                            bucket.add(json);
                        }
                    } catch (Exception e2) { }
                    try { c.close(); } catch (Exception e3) {}
                }
                StringBuilder sb = new StringBuilder("[\n");
                int cnt = 0;
                for (java.util.List<String> bucket : byDate.values()) {
                    for (String json : bucket) {
                        if (cnt >= 200) break;
                        if (cnt > 0) sb.append(",\n");
                        sb.append(json);
                        cnt++;
                    }
                    if (cnt >= 200) break;
                }
                sb.append("\n]");
                return sb.toString();
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public String notifEvidence() {
            // 服务运行证据（key=value 文本）：收到多少通知、连过几次、扫描结果
            try { return NotificationReaderService.evidenceRead(getFilesDir()); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface
        public String reconnectListener() {
            try { NotificationReaderService.ensureBound(MainActivity.this); } catch (Throwable t) {}
            return notifStatus();
        }
        @JavascriptInterface
        public String notifStatus() {
            // 供 JS 显示「为什么没抓到」：是否授权 / 服务是否连接 / 队列条数
            boolean granted = false, conn = false;
            int qn = 0;
            try { granted = NotificationReaderService.isEnabled(MainActivity.this); } catch (Exception e) {}
            try { conn = NotificationReaderService.isConnected(); } catch (Exception e) {}
            try {
                String q = NotificationReaderService.queueRead(getFilesDir());
                if (q != null && q.length() > 4) {
                    qn = q.split("\"nkey\"").length - 1;
                }
            } catch (Exception e) {}
            boolean ka = false;
            try { ka = KeepAliveService.sRunning; } catch (Throwable t) {}
            return "{\"granted\":" + granted + ",\"connected\":" + conn + ",\"queue\":" + qn + ",\"ka\":" + ka + "}";
        }
        @JavascriptInterface
        public String a11yStatus() {
            // 无障碍通道是否启用（第二条抓取通道，绕过反复失效的通知监听）
            boolean on = false;
            try { on = NotifAccessibilityService.isEnabled(MainActivity.this); } catch (Exception e) {}
            return "{\"enabled\":" + on + "}";
        }
        @JavascriptInterface
        public void openA11ySettings() {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));
                } catch (Exception ignored) {}
            } });
        }
        @JavascriptInterface
        public String selfCheck() {
            // 环境自检：把"系统眼里的我"如实报出来，用于定位"绑不上"的真正原因
            //   exported: 清单里服务是否允许系统连接（必须 true）
            //   inList  : 系统「通知使用权」列表里是否含本应用
            //   raw     : 系统记录的原始 enabled_notification_listeners
            String exported = "?", inList = "false", raw = "";
            try {
                android.content.pm.ServiceInfo si = getPackageManager().getServiceInfo(
                        new android.content.ComponentName(MainActivity.this, NotificationReaderService.class), 0);
                exported = String.valueOf(si.exported);
            } catch (Exception e) { exported = "err"; }
            try {
                raw = android.provider.Settings.Secure.getString(
                        getContentResolver(), "enabled_notification_listeners");
            } catch (Exception e) { raw = ""; }
            if (raw == null) raw = "";
            String pkg = getPackageName();
            inList = String.valueOf(raw.contains(pkg));
            String escd = raw.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
            return "{\"exported\":\"" + exported + "\",\"inList\":" + inList
                 + ",\"pkg\":\"" + pkg + "\",\"raw\":\"" + escd + "\"}";
        }
        @JavascriptInterface
        public void requestRebind() {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    if (android.os.Build.VERSION.SDK_INT >= 24) {
                        android.service.notification.NotificationListenerService.requestRebind(
                            new android.content.ComponentName(
                                MainActivity.this, NotificationReaderService.class));
                    }
                } catch (Exception ignored) {}
            } });
        }
        @JavascriptInterface
        public void triggerScan() {
            mainHandler.post(new Runnable() { public void run() {
                try {
                    Intent i = new Intent(NotificationReaderService.ACTION_SEND);
                    i.setClass(MainActivity.this, NotificationReaderService.class);
                    startService(i);
                } catch (Exception e) {
                    // 不再静默：写进证据，否则"扫描没反应"永远查不出来
                    try { NotificationReaderService.evSet(getFilesDir(), "lastTriggerErr", String.valueOf(e)); } catch (Exception ignored) {}
                }
            } });
        }
        @JavascriptInterface
        public void saveText(String filename, String content) {
            final String fn = filename;
            final String body = content == null ? "" : content;
            mainHandler.post(new Runnable() { public void run() {
                try {
                    saveToDownloads(fn, body);
                    android.widget.Toast.makeText(MainActivity.this, "已保存到 下载/" + fn, android.widget.Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this, "保存失败: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
                }
            } });
        }
        @JavascriptInterface
        public void toast(String msg) {
            final String m = msg;
            mainHandler.post(new Runnable() { public void run() {
                android.widget.Toast.makeText(MainActivity.this, m, android.widget.Toast.LENGTH_SHORT).show();
            } });
        }
        @JavascriptInterface
        public boolean isFullscreen() {
            return (getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_FULLSCREEN) != 0;
        }
        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            mainHandler.post(new Runnable() { public void run() {
                if (on) {
                    getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                            WindowManager.LayoutParams.FLAG_FULLSCREEN);
                    getWindow().getDecorView().setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                }
            } });
        }
        @JavascriptInterface
        public String readPendingTx() {
            try {
                return NotificationReaderService.queueRead(getFilesDir());
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public void ackPendingTx(String idsJson) {
            final String ids = idsJson == null ? "[]" : idsJson;
            mainHandler.post(new Runnable() { public void run() {
                try {
                    org.json.JSONArray arr = new org.json.JSONArray(ids);
                    String[] list = new String[arr.length()];
                    for (int i=0;i<arr.length();i++) list[i]=arr.getString(i);
                    NotificationReaderService.queueAck(getFilesDir(), list);
                } catch (Exception ignored) {}
            } });
        }
        // 通用状态持久化(应用内部私有目录)：给 JS 存「已处理集合」「滞留箱」等，
        // 清缓存/重装不丢，也不导出到下载目录
        @JavascriptInterface
        public String readState(String name) {
            try {
                File f = new File(getFilesDir(), "state_" + (name == null ? "x" : name) + ".json");
                if (!f.exists()) return "";
                return NotificationReaderService.readText(f);
            } catch (Exception e) { return ""; }
        }
        @JavascriptInterface
        public void writeState(String name, String content) {
            final String nm = (name == null ? "x" : name);
            final String ct = content == null ? "" : content;
            mainHandler.post(new Runnable() { public void run() {
                try {
                    NotificationReaderService.writeText(
                        new File(getFilesDir(), "state_" + nm + ".json"), ct);
                } catch (Exception ignored) {}
            } });
        }
    }
    private AppBridge appBridge;

    // 保存文本到系统"下载"目录（Android 10+ 用 MediaStore，免存储权限）
    private void saveToDownloads(String filename, String content) throws Exception {
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "text/csv");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/");
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
            android.net.Uri uri = getContentResolver().insert(MediaStore.Downloads.getContentUri("external"), cv);
            if (uri != null) {
                java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(content.getBytes("UTF-8"));
                os.close();
                cv.clear();
                cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, cv, null, null);
                return;
            }
        }
        // 兼容 Android 9-：写公共下载目录
        java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists()) dir.mkdirs();
        java.io.File f = new java.io.File(dir, filename);
        java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
        fo.write(content.getBytes("UTF-8"));
        fo.close();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        appBridge = new AppBridge();
        webView.addJavascriptInterface(appBridge, "MinisBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                Intent i = params.createIntent();
                try { startActivityForResult(i, FILE_CHOOSER); return true; }
                catch (Exception e) { filePathCallback = null; return false; }
            }
        });
        webView.loadUrl("file:///android_asset/app.html");
        // 上次开着「自动记账」就把常驻服务拉起来（进程活着，通知监听才不会断）
        try {
            if (new java.io.File(getFilesDir(), "keepalive.on").exists()) {
                Intent ka = new Intent(this, KeepAliveService.class);
                ka.setAction(KeepAliveService.ACTION_START);
                startService(ka);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // 权限结果不需要额外处理，readSms/读通知时若未授权会返回空，JS端可提示
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == FILE_CHOOSER) {
            Uri[] results = null;
            if (res == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) results = new Uri[]{uri};
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() { super.onPause(); webView.onPause(); }

    @Override
    protected void onResume() {
        super.onResume(); webView.onResume();
        // 主动请求短信读取权限(银行/支付短信), 若未授权则提示授权
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            try {
                if (checkSelfPermission(android.Manifest.permission.READ_SMS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{android.Manifest.permission.READ_SMS}, 1001);
                }
            } catch (Exception e) {}
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && webView != null) {
            // 每次回到前台都触发自动记账（处理新收到的支付通知）
            mainHandler.postDelayed(new Runnable() { public void run() {
                try { webView.evaluateJavascript("try{autoBookkeep()}catch(e){}", null); } catch (Exception ignored) {}
            } }, 600);
        }
    }

    @Override
    protected void onDestroy() {
        webView.loadUrl("about:blank");
        webView.clearHistory();
        ((android.view.ViewGroup) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
