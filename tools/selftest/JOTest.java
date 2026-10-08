// 单独验证 jsonObjects 的括号配平逻辑（与本项目 Java 实现逐行等价）
import java.util.*;

public class JOTest {
    static List<String> jsonObjects(String json) {
        List<String> out = new ArrayList<>();
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
            if (j >= n) break;
        }
        return out;
    }

    static int ok = 0, bad = 0;
    static void t(String name, List<String> got, int expect) {
        if (got.size() == expect) { ok++; System.out.println("✓ " + name + " → " + got.size() + " 条"); }
        else { bad++; System.out.println("✗ " + name + " → 得到 " + got.size() + " 条，应为 " + expect);
               for (String g : got) System.out.println("      " + g); }
    }

    public static void main(String[] a) {
        t("空数组", jsonObjects("[]"), 0);
        t("普通两条", jsonObjects("[{\"id\":\"a\",\"nkey\":\"n1\"},{\"id\":\"b\",\"nkey\":\"n2\"}]"), 2);
        // 核心：正文含花括号（旧正则会切碎）
        t("正文含 {张}", jsonObjects("[{\"id\":\"b1\",\"text\":\"客户{张}消费96元\"},{\"id\":\"b2\",\"text\":\"充值100元\"}]"), 2);
        t("正文含多个括号", jsonObjects("[{\"id\":\"c1\",\"text\":\"{a}{b}{c}\"},{\"id\":\"c2\",\"text\":\"ok\"}]"), 2);
        // 字符串里的转义引号（不应提前结束字符串）
        t("转义引号", jsonObjects("[{\"id\":\"d1\",\"text\":\"他说\\\"{好}\\\"\"},{\"id\":\"d2\",\"text\":\"x\"}]"), 2);
        t("转义反斜杠", jsonObjects("[{\"id\":\"e1\",\"text\":\"路径\\\\\"},{\"id\":\"e2\",\"text\":\"y\"}]"), 2);
        // 嵌套对象
        t("嵌套对象", jsonObjects("[{\"id\":\"f1\",\"ext\":{\"a\":1,\"b\":{\"c\":2}}}]"), 1);
        // 未闭合（损坏数据）不能死循环
        t("未闭合不挂死", jsonObjects("[{\"id\":\"g1\",\"text\":\"没有闭合\""), 0);
        // 中文与 emoji
        t("中文emoji", jsonObjects("[{\"id\":\"h1\",\"text\":\"💰充值100元😀\"}]"), 1);

        // 逐条验证 id 能正确取出（这是 ack 的关键）
        List<String> r = jsonObjects("[{\"id\":\"b1\",\"text\":\"客户{张}消费96元\"},{\"id\":\"b2\",\"text\":\"充值100元\"}]");
        boolean allHaveId = true;
        for (String o : r) {
            java.util.regex.Matcher im = java.util.regex.Pattern.compile("\"id\":\"([^\"]+)\"").matcher(o);
            if (!im.find()) allHaveId = false;
        }
        if (allHaveId) { ok++; System.out.println("✓ 每条都能取出 id（旧正则做不到）"); }
        else { bad++; System.out.println("✗ 有条目取不出 id"); }

        System.out.println("\n通过 " + ok + " / 失败 " + bad);
        System.exit(bad > 0 ? 1 : 0);
    }
}
