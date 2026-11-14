package com.minis.bookkeeping;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Log;

/**
 * 无障碍读通知（第二条抓取通道）
 *
 * 为什么需要它：
 *   NotificationListenerService（通知使用权）在国产 ROM 上会被反复解绑 ——
 *   我们实测到"服务连接4次、最近6天前；主动扫描通知栏84次全是0条"，
 *   而短信通道完全正常。说明通知监听这条通道被系统掐死了，修不好只能绕过去。
 *
 *   无障碍服务走的是另一条通道（TYPE_NOTIFICATION_STATE_CHANGED），
 *   国产 ROM 对它的限制明显更松，且不会被"通知使用权"那套绑定机制反复解绑。
 *
 * 设计：只做采集，不做解析。
 *   把通知的 package / 文本原样交给 NotificationReaderService.appendExternal()，
 *   复用同一套去重、证据、队列逻辑 —— 不再另起一套，避免"两套逻辑打架"。
 */
public class NotifAccessibilityService extends AccessibilityService {

    private static final String TAG = "NotifA11y";

    /** 无障碍是否已启用（供 JS 显示诊断） */
    public static boolean isEnabled(android.content.Context ctx) {
        try {
            String flat = Settings.Secure.getString(ctx.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (flat == null || flat.isEmpty()) return false;
            // 系统记录里可能写全名或短名，按"含包名 + 含本服务名"判断
            String pkg = ctx.getPackageName();
            if (!flat.contains(pkg)) return false;
            return flat.contains("NotifAccessibilityService");
        } catch (Exception e) { return false; }
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        try {
            AccessibilityServiceInfo info = new AccessibilityServiceInfo();
            info.eventTypes = AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.notificationTimeout = 0;          // 不要延迟，来了就报
            info.flags = AccessibilityServiceInfo.DEFAULT
                       | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
            setServiceInfo(info);
        } catch (Exception e) { Log.e(TAG, "cfg err", e); }
        try { NotificationReaderService.evInc(getFilesDir(), "a11yConnectCount", "lastA11yConnectTs"); } catch (Exception e) {}
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        try {
            if (event.getEventType() != AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) return;
            CharSequence pkgCs = event.getPackageName();
            String pkg = pkgCs == null ? "" : pkgCs.toString();
            if (pkg.isEmpty()) return;
            // 忽略自己，避免自触发
            if (pkg.equals(getPackageName())) return;

            // 通知文本可能散落在：event.getText()（列表）、contentDescription、以及
            // 通知布局里的 TextView（getText / getBigText）。三层都要挖，漏一层就漏账。
            StringBuilder sb = new StringBuilder();
            java.util.List<CharSequence> texts = event.getText();
            if (texts != null) {
                for (CharSequence c : texts) {
                    if (c != null) sb.append(c).append('\n');
                }
            }
            CharSequence desc = event.getContentDescription();
            if (desc != null) sb.append(desc);

            // 再从节点树里取 title / text（Android 上通知的两行正文常在这里）
            try {
                AccessibilityNodeInfo root = event.getParcelableData() instanceof android.app.Notification
                        ? null : getRootInActiveWindow();
                // 优先用通知自身的 extras（如果能拿到 Notification 对象）
                if (event.getParcelableData() instanceof android.app.Notification) {
                    android.app.Notification n = (android.app.Notification) event.getParcelableData();
                    if (n != null && n.extras != null) {
                        sb.append('\n').append(safe(n.extras.getCharSequence("android.title")));
                        sb.append('\n').append(safe(n.extras.getCharSequence("android.text")));
                        sb.append('\n').append(safe(n.extras.getCharSequence("android.bigText")));
                        CharSequence[] tl = n.extras.getCharSequenceArray("android.textLines");
                        if (tl != null) for (CharSequence t : tl) sb.append('\n').append(safe(t));
                        sb.append('\n').append(safe(n.extras.getCharSequence("android.subText")));
                        sb.append('\n').append(safe(n.extras.getCharSequence("android.summaryText")));
                    }
                }
                if (root != null) {
                    collectText(root, sb, 0);
                }
            } catch (Exception ignored) {}

            String text = sb.toString().replace('\u0000', ' ').trim();
            if (text.isEmpty()) return;

            // 交给统一的采集逻辑（复用去重/证据/队列，不另起一套）
            NotificationReaderService.appendExternal(getFilesDir(), pkg, text, "a11y");
        } catch (Exception e) {
            Log.e(TAG, "evt err", e);
        }
    }

    private void collectText(AccessibilityNodeInfo node, StringBuilder sb, int depth) {
        if (node == null || depth > 4) return;
        try {
            CharSequence t = node.getText();
            if (t != null && t.length() > 0) sb.append('\n').append(t);
            int n = node.getChildCount();
            for (int i = 0; i < n; i++) collectText(node.getChild(i), sb, depth + 1);
        } catch (Exception ignored) {}
    }

    private String safe(CharSequence cs) {
        if (cs == null) return "";
        String s = cs.toString();
        return "null".equals(s) ? "" : s;
    }

    @Override
    public void onInterrupt() { }

    @Override
    public boolean onUnbind(Intent intent) {
        try { NotificationReaderService.evInc(getFilesDir(), "a11yUnbindCount", "lastA11yUnbindTs"); } catch (Exception e) {}
        return super.onUnbind(intent);
    }
}
