package com.minis.bookkeeping;
import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 通知采集服务。
 *
 * ★ 修掉一条致命 bug（v1.15~v1.17 一直存在）：
 *   网页端桥接原先写的是 `new NotificationReaderService().read()`。
 *   但 Service 的文件 API（getFilesDir）依赖系统绑定时注入的 base Context；
 *   `new` 出来的实例 mBase == null → getFilesDir() 直接抛 NullPointerException
 *   → 被 catch 吞掉 → 网页端永远读到 "[]"、诊断证据永远全 0。
 *   表现就是：服务其实在正常收通知、正常写文件，但【读的人一开口就崩】。
 *
 *   修法：所有文件读写抽成 static + 显式 dir 参数。
 *     · 服务自身（已被绑定，有 Context）→ 传 getFilesDir()
 *     · 网页桥接（在 Activity 内，有 Context）→ 传 Activity 的 getFilesDir()
 *   两边都不再 new 服务实例。
 */
public class NotificationReaderService extends NotificationListenerService {
    public static final String ACTION_SEND = "com.minis.bookkeeping.SEND_PAYLOAD";
    private static final String TAG = "NotifReader";
    private static final Object LOCK = new Object();

    /** 待处理条目的存活期：7 天后自动清除 */
    public static final long TTL_MS = 7L * 24 * 3600 * 1000;

    // ── 基础文件读写（静态、不依赖 Context）──────────────────
    public static String readText(File f) {
        try {
            if (f == null || !f.exists()) return "";
            byte[] b = new byte[(int) Math.min(f.length(), 4L * 1024 * 1024)];
            FileInputStream fi = new FileInputStream(f);
            int off = 0, r;
            while (off < b.length && (r = fi.read(b, off, b.length - off)) > 0) { off += r; }
            fi.close();
            return new String(b, 0, off, "UTF-8");
        } catch (Exception e) { return ""; }
    }
    public static void writeText(File f, String s) {
        try {
            FileOutputStream fo = new FileOutputStream(f);
            fo.write((s == null ? "" : s).getBytes("UTF-8"));
            fo.close();
        } catch (Exception e) {}
    }
    private static File qfOf(File dir) { return new File(dir, "imported_tx.json"); }
    private static File evOf(File dir) { return new File(dir, "notif_evidence.json"); }
    private static File seenOf(File dir) { return new File(dir, "seen_nkeys.json"); }

    // ── 队列：读（顺带清理超期）/ 追加 / 消费确认 ──────────────
    public static String queueRead(File dir) {
        synchronized (LOCK) {
            File qf = qfOf(dir);
            if (!qf.exists()) return "[]";
            String json = readText(qf);
            long now = System.currentTimeMillis();
            StringBuilder out = new StringBuilder("[");
            boolean first = true, dropped = false;
            for (String obj : jsonObjects(json)) {
                Matcher tm = Pattern.compile("\"time\":(\\d+)").matcher(obj);
                long t = tm.find() ? Long.parseLong(tm.group(1)) : now;
                if (now - t > TTL_MS) { dropped = true; continue; }   // 超过7天 → 清除
                if (!first) out.append(",");
                first = false;
                out.append(obj);
            }
            out.append("]");
            String res = out.toString();
            if (dropped) writeText(qf, res);
            return res;
        }
    }
    /**
     * 从 JSON 数组文本里逐个切出顶层对象。
     * ★ 不用正则 \{[^\{\}]*\} —— 通知正文含 { 或 } 时会被切碎，
     *   导致对象丢失 id → 永远 ack 不掉 → 队列残留、待处理框反复出现同一笔。
     *   这里做【花括号配平 + 字符串/转义感知】的逐字符扫描，任意嵌套都安全。
     */
    private static java.util.List<String> jsonObjects(String json) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (json == null) return out;
        int i = 0, n = json.length();
        while (i < n) {
            if (json.charAt(i) != '{') { i++; continue; }
            int depth = 0;
            boolean inStr = false, esc = false;
            int start = i, j = i;
            for (; j < n; j++) {
                char c = json.charAt(j);
                if (esc) { esc = false; continue; }
                if (c == '\\') { esc = true; continue; }
                if (c == '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c == '{') depth++;
                else if (c == '}') { depth--; if (depth == 0) { out.add(json.substring(start, j + 1)); i = j + 1; break; } }
            }
            if (j >= n) break;   // 未闭合 → 停止，避免死循环
        }
        return out;
    }
    private static void queueAppend(File dir, String entry) {
        synchronized (LOCK) {
            File qf = qfOf(dir);
            String pending = readText(qf).trim();
            String next;
            if (pending.isEmpty() || pending.equals("[]")) {
                next = "[" + entry + "]";
            } else {
                String base = pending;
                if (base.endsWith("]")) base = base.substring(0, base.length() - 1);
                if (base.endsWith(",")) base = base.substring(0, base.length() - 1);
                next = base + "," + entry + "]";
            }
            writeText(qf, next);
        }
    }
    private static boolean queueHasNkey(File dir, String nkey) {
        if (nkey == null) return false;
        synchronized (LOCK) {
            if (nkeyInSeen(dir, nkey)) return true;              // 已处理过 → 不再追加
            String q = queueRead(dir);
            return q.contains("\"nkey\":\"" + esc(nkey) + "\"");
        }
    }
    /** 消费确认：删除指定 id，并把它们的 nkey 记入「已处理」，防止重复入队 */
    public static void queueAck(File dir, String[] ids) {
        if (ids == null || ids.length == 0) return;
        java.util.Set<String> set = new java.util.HashSet<>();
        for (String i : ids) set.add(i);
        synchronized (LOCK) {
            File qf = qfOf(dir);
            String json = readText(qf);
            if (json.isEmpty()) return;
            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            for (String obj : jsonObjects(json)) {
                boolean drop = false;
                Matcher im = Pattern.compile("\"id\":\"([^\"]+)\"").matcher(obj);
                if (im.find() && set.contains(im.group(1))) drop = true;
                if (drop) {
                    Matcher nm = Pattern.compile("\"nkey\":\"([^\"]+)\"").matcher(obj);
                    if (nm.find()) markSeen(dir, nm.group(1));
                } else {
                    if (!first) out.append(",");
                    first = false;
                    out.append(obj);
                }
            }
            out.append("]");
            writeText(qf, out.toString());
        }
    }

    // ── 已处理集合（seen）─────────────────────────────────
    private static void markSeen(File dir, String nkey) {
        if (nkey == null || nkey.isEmpty()) return;
        synchronized (LOCK) {
            File sf = seenOf(dir);
            String cur = readText(sf);
            long now = System.currentTimeMillis();
            StringBuilder out = new StringBuilder("[");
            boolean first = true, exists = false;
            for (String obj : jsonObjects(cur)) {
                Matcher tm = Pattern.compile("\"ts\":(\\d+)").matcher(obj);
                long t = tm.find() ? Long.parseLong(tm.group(1)) : now;
                if (now - t > TTL_MS) continue;                  // 超期清除
                if (obj.contains("\"nkey\":\"" + esc(nkey) + "\"")) exists = true;
                if (!first) out.append(",");
                first = false;
                out.append(obj);
            }
            out.append("]");
            String next = out.toString();
            if (!exists) {
                String add = "{\"nkey\":\"" + esc(nkey) + "\",\"ts\":" + now + "}";
                String base = next.endsWith("]") ? next.substring(0, next.length() - 1) : next;
                if (base.endsWith(",")) base = base.substring(0, base.length() - 1);
                next = base + "," + add + "]";
            }
            writeText(sf, next);
        }
    }
    private static boolean nkeyInSeen(File dir, String nkey) {
        if (nkey == null) return false;
        synchronized (LOCK) {
            String s = readText(seenOf(dir));
            if (s.isEmpty()) return false;
            long now = System.currentTimeMillis();
            for (String obj : jsonObjects(s)) {
                if (!obj.contains("\"nkey\":\"" + esc(nkey) + "\"")) continue;
                Matcher tm = Pattern.compile("\"ts\":(\\d+)").matcher(obj);
                if (tm.find()) {
                    try { if (now - Long.parseLong(tm.group(1)) > TTL_MS) return false; } catch (Exception ignored) {}
                }
                return true;
            }
            return false;
        }
    }

    // ── 运行证据（用客观记录代替猜测）────────────────────────
    public static String evidenceRead(File dir) { return readText(evOf(dir)); }
    public static void evSet(File dir, String k, String v) {
        synchronized (LOCK) {
            java.util.HashMap<String, String> m = evMap(dir);
            m.put(k, v);
            evWrite(dir, m);
        }
    }
    public static void evInc(File dir, String k, String tsKey) {
        synchronized (LOCK) {
            java.util.HashMap<String, String> m = evMap(dir);
            int cur = 0; try { cur = Integer.parseInt(m.get(k)); } catch (Exception e) {}
            m.put(k, String.valueOf(cur + 1));
            if (tsKey != null) m.put(tsKey, String.valueOf(System.currentTimeMillis()));
            evWrite(dir, m);
        }
    }
    private static java.util.HashMap<String, String> evMap(File dir) {
        java.util.HashMap<String, String> m = new java.util.HashMap<>();
        String s = readText(evOf(dir));
        for (String line : s.split("\n")) {
            int i = line.indexOf('=');
            if (i > 0) m.put(line.substring(0, i), line.substring(i + 1));
        }
        return m;
    }
    private static void evWrite(File dir, java.util.HashMap<String, String> m) {
        StringBuilder sb = new StringBuilder();
        for (java.util.Map.Entry<String, String> e : m.entrySet())
            sb.append(e.getKey()).append('=').append(e.getValue()).append('\n');
        writeText(evOf(dir), sb.toString());
    }
    /** 一条通知到达：记时间/来源/是否支付类 */
    private static void evRecordNotif(File dir, String app, boolean isPay) {
        synchronized (LOCK) {
            java.util.HashMap<String, String> m = evMap(dir);
            m.put("lastNotifTs", String.valueOf(System.currentTimeMillis()));
            m.put("lastNotifApp", app == null ? "" : app);
            String ck = isPay ? "notifPay" : "notifNonPay";
            int c = 0; try { c = Integer.parseInt(m.get(ck)); } catch (Exception e) {}
            m.put(ck, String.valueOf(c + 1));
            evWrite(dir, m);
        }
    }

    // ── 判定 / 工具 ────────────────────────────────────────
    /** 判定 / 工具 ──────────────────────────────────────── */
    /** 记录最近被滤掉的通知样本（诊断用）：若银行通知被误判为"非支付"，这里能看见 */
    private static void evRecordFiltered(File dir, String app, String title, String text) {
        synchronized (LOCK) {
            java.util.HashMap<String, String> m = evMap(dir);
            // 轮转：filtered_1..filtered_5（1 最新）
            for (int i = 5; i > 1; i--) {
                String prev = m.get("filtered_" + (i - 1));
                if (prev != null) m.put("filtered_" + i, prev);
            }
            String one = ((app == null ? "" : app) + " ∥ " + (title == null ? "" : title)
                          + " ∥ " + (text == null ? "" : text)).replace("\n", " ");
            if (one.length() > 160) one = one.substring(0, 160);
            m.put("filtered_1", one);
            evWrite(dir, m);
        }
    }
    public static boolean isEnabled(Context ctx) {
        try {
            String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
            return flat != null && flat.contains(ctx.getPackageName());
        } catch (Exception e) { return false; }
    }
    private static String hash(String s) {
        long h = 1125899906842597L;
        if (s == null) s = "";
        for (int i = 0; i < s.length(); i++) h = 31 * h + s.charAt(i);
        return Long.toHexString(h);
    }
    /** 支付类通知：必须同时有「金额」+「支付关键词」，聊天/新闻/验证码一律不入队 */
    private static boolean looksLikePayment(String title, String text) {
        String s = ((title == null ? "" : title) + " " + (text == null ? "" : text)).trim();
        if (s.length() < 4) return false;
        // ★ 修（2026-10-08）：这里的金额正则原来只认「¥15.80」和「15.80元」两种写法，
        //   而微信/支付宝的通知经常【两种都不带】——
        //   如「已支付15.80」「你已成功付款25.00」「支付成功 32.50」。
        //   结果：这些通知在这一步就被判为"非支付"【直接丢弃】，
        //   根本没进队列，网页端自然"什么都没收到"。
        //
        //   本层职责只是【粗筛】：把明显不是支付的挡掉（验证码/营销/物流）。
        //   精确解析金额与分类由网页端 findAmounts 负责。
        //   所以这里【宁可宽松】——宽了最多多进队列让网页端再判，
        //   严了则会静默丢真实支付通知（就是之前"微信不显示"的原因）。
        boolean hasAmt = Pattern.compile(
            "([\u00a5\uffe5]\\s?\\d)"
          + "|(\\d[\\d,]*(\\.\\d{1,2})?\\s*\u5143)"
          + "|(\\d+(\\.\\d{1,2})?)"     // 裸数字也算（15.80 / 32.50）
        ).matcher(s).find();
        if (!hasAmt) return false;
        return Pattern.compile(
            "\u652f\u4ed8|\u6d88\u8d39|\u652f\u51fa|\u6536\u5165|\u5230\u8d26|\u6263\u6b3e|\u9000\u6b3e|\u8f6c\u8d26|\u6536\u6b3e|\u5165\u8d26|\u4ea4\u6613|\u4f59\u989d|\u4ed8\u6b3e|\u94f6\u884c\u5361|\u50a8\u84c4\u5361|\u4fe1\u7528\u5361|\u82b1\u5457|\u8fd8\u6b3e"
        ).matcher(s).find();
    }

    /**
     * 外部通道（无障碍）送进来的通知 —— 与 onNotificationPosted 走【完全相同】的
     * 判定/证据/去重/入队逻辑，避免出现"两套逻辑各判各的"这种老毛病。
     *
     * @param src "a11y" 等来源标记（写进证据，便于区分是哪条通道抓到的）
     */

    /**
     * 外部通道（无障碍）送进来的通知 —— 与 onNotificationPosted 走【完全相同】的
     * 判定/证据/去重/入队逻辑，避免出现"两套逻辑各判各的"这种老毛病。
     */
    public static void appendExternal(File dir, String pkg, String rawText, String src) {
        try {
            if (rawText == null) return;
            String text = rawText.replace('\u0000', ' ').trim();
            if (text.length() < 4) return;
            String title = "";
            String body = text;
            int nl = text.indexOf('\n');
            if (nl > 0 && nl < 60) { title = text.substring(0, nl).trim(); body = text.substring(nl + 1).trim(); }
            String fulltext = body.replace('\n', ' ').trim();
            if (fulltext.isEmpty()) fulltext = text.replace('\n', ' ').trim();
            boolean isPay = looksLikePayment(title, fulltext);
            evInc(dir, "a11yEvents", "lastA11yEventTs");
            evSet(dir, "lastA11yApp", pkg == null ? "" : pkg);
            if (!isPay) { evRecordFiltered(dir, pkg, title, fulltext); return; }
            evInc(dir, "a11yPay", "lastA11yPayTs");
            String nkey = pkg + "|a11y|" + hash(title + "\u0001" + fulltext);
            if (queueHasNkey(dir, nkey)) return;
            String id = java.util.UUID.randomUUID().toString().substring(0, 8)
                      + "_" + System.currentTimeMillis();
            String entry =
                  "{\"id\":\"" + id
                  + "\",\"nkey\":\"" + esc(nkey)
                  + "\",\"app\":\"" + esc(pkg)
                  + "\",\"title\":\"" + esc(title)
                  + "\",\"text\":\"" + esc(fulltext)
                  + "\",\"src\":\"" + esc(src == null ? "ext" : src)
                  + "\",\"time\":" + System.currentTimeMillis() + "}";
            queueAppend(dir, entry);
        } catch (Exception e) {
            Log.e(TAG, "appendExternal err", e);
        }
    }

    private static String str(CharSequence cs) {
        String v = cs == null ? "" : cs.toString();
        return v.equals("null") ? "" : v;
    }
    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    // ── 生命周期 ──────────────────────────────────────────
    @Override
    public IBinder onBind(Intent intent) { return super.onBind(intent); }

    public static volatile boolean sConnected = false;
    public static boolean isConnected() { return sConnected; }

    /* ★ 2026-11-07：系统把监听解绑后不会自己绑回来（国产 ROM 尤其明显）。
       这个是唯一正路：主动 requestRebind，让系统把服务重新接上。 */
    public static void ensureBound(Context ctx) {
        try {
            NotificationListenerService.requestRebind(
                new ComponentName(ctx, NotificationReaderService.class));
        } catch (Throwable t) {}
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        sConnected = true;
        evInc(getFilesDir(), "connectCount", "lastConnectTs");
        // 刚连上时补抓一次通知栏，避免断连期间漏掉的支付
        try {
            StatusBarNotification[] sns = getActiveNotifications();
            if (sns != null) for (StatusBarNotification sbn : sns) appendNotification(sbn);
        } catch (Exception e) { Log.e(TAG, "catchup err", e); }
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        sConnected = false;
        evInc(getFilesDir(), "disconnectCount", "lastDisconnectTs");
        try {
            if (android.os.Build.VERSION.SDK_INT >= 24) {
                requestRebind(new android.content.ComponentName(
                        getApplicationContext(), NotificationReaderService.class));
            }
        } catch (Exception e) { Log.e(TAG, "rebind err", e); }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try { appendNotification(sbn); } catch (Exception e) { Log.e(TAG, "queue err", e); }
    }
    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        try { appendNotification(sbn); } catch (Exception e) { Log.e(TAG, "rm err", e); }
    }
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_SEND.equals(intent.getAction())) {
            File dir = getFilesDir();
            int active = -1; boolean nul = false;
            try {
                StatusBarNotification[] sns = getActiveNotifications();
                if (sns == null) { nul = true; active = 0; }   // null = 服务未被系统绑定
                else { active = sns.length; for (StatusBarNotification sbn : sns) appendNotification(sbn); }
            } catch (Exception e) { Log.e(TAG, "full err", e); }
            evSet(dir, "lastScanActive", String.valueOf(active));
            evSet(dir, "lastScanNull", nul ? "1" : "0");
            evInc(dir, "scanCount", "lastScanTs");
        }
        return START_STICKY;
    }

    /** 把一条通知追加进队列 */
    private void appendNotification(StatusBarNotification sbn) throws Exception {
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;
        String title = str(n.extras.getCharSequence("android.title"));
        String text = str(n.extras.getCharSequence("android.text"));
        String big = str(n.extras.getCharSequence("android.bigText"));
        String textLines = str(n.extras.getCharSequence("android.textLines"));
        String sub = str(n.extras.getCharSequence("android.subText"));
        String sum = str(n.extras.getCharSequence("android.summaryText"));
        String fulltext = (textLines + " " + text + " " + big + " " + sub + " " + sum).trim();
        String combined = title + " " + fulltext;
        if (combined.trim().isEmpty()) return;
        File dir = getFilesDir();
        boolean isPay = looksLikePayment(title, fulltext);
        evRecordNotif(dir, sbn.getPackageName(), isPay);   // 硬证据：确实收到过
        if (!isPay) { evRecordFiltered(dir, sbn.getPackageName(), title, fulltext); return; }
        // 唯一键 = 包名 | 通知id | 内容哈希。
        // 只用 package|id 会被固定 id 的支付通知永久拦死（"第一条能记、之后全不来"）。
        String nkey = sbn.getPackageName() + "|" + sbn.getId() + "|" + hash(title + "\u0001" + fulltext);
        if (queueHasNkey(dir, nkey)) return;
        String id = java.util.UUID.randomUUID().toString().substring(0, 8)
                  + "_" + System.currentTimeMillis();
        String entry =
              "{\"id\":\"" + id
              + "\",\"nkey\":\"" + esc(nkey)
              + "\",\"app\":\"" + esc(sbn.getPackageName())
              + "\",\"title\":\"" + esc(title)
              + "\",\"text\":\"" + esc(fulltext)
              + "\",\"time\":" + System.currentTimeMillis() + "}";
        queueAppend(dir, entry);
    }
}
