/* ============================================================
   ai-parse.js —— 记账 App 的 AI 兜底解析
   ------------------------------------------------------------
   接法：在 app.html 的 <script> 里引入，再在更多菜单加一个按钮。

   特点：
     · 密钥只存本机 localStorage，不上传、不写日志
     · 支持多家供应商，设置页里可以切换
     · 本地解析优先，AI 只在本地失败时兜底
     · 离线可用：没配 key 就完全不启用
   ============================================================ */
(function () {
  'use strict';

  /* App 里的提示函数叫 ts()，不叫 toast()。做一层兼容，避免两处都改。 */
  function toast(msg) {
    if (typeof ts === 'function') return ts(msg);
    var e = document.getElementById('toast');
    if (!e) { console.log('[AI]', msg); return; }
    e.textContent = msg;
    e.classList.add('show');
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.classList.remove('show'); }, 2000);
  }


  /* ==================== 供应商预设 ==================== */
  /* 用户只需要填 key，地址和模型名已经写好了 */
  var PRESETS = {
    siliconflow: {
      label: '硅基流动',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      note: '国内直连，注册送额度'
    },
    deepseek: {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      note: '便宜，中文好'
    },
    zhipu: {
      label: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      note: 'flash 模型免费'
    },
    dashscope: {
      label: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-turbo',
      note: '阿里云'
    },
    kimi: {
      label: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      note: '长文本'
    },
    custom: {
      label: '自定义',
      baseUrl: '',
      model: '',
      note: '任何 OpenAI 兼容接口'
    }
  };

  var KEY_STORE = 'bk_ai_config';

  /* ==================== 配置读写 ==================== */

  function loadCfg() {
    try {
      var raw = localStorage.getItem(KEY_STORE);
      if (!raw) return { provider: '', models: {} };
      return JSON.parse(raw);
    } catch (e) {
      return { provider: '', models: {} };
    }
  }

  function saveCfg(cfg) {
    localStorage.setItem(KEY_STORE, JSON.stringify(cfg));
  }

  function getProviderConf(name) {
    var cfg = loadCfg();
    var m = cfg.models && cfg.models[name];
    if (!m) return null;
    var preset = PRESETS[name] || PRESETS.custom;
    return {
      name: name,
      baseUrl: m.baseUrl || preset.baseUrl,
      model: m.model || preset.model,
      key: m.key || ''
    };
  }

  function activeProvider() {
    var cfg = loadCfg();
    if (!cfg.provider) return null;
    var c = getProviderConf(cfg.provider);
    if (!c || !c.key) return null;
    return c;
  }

  /* ==================== 提示词 ==================== */
  /* 和「更多」菜单里的分类保持一致 */

  function getCategories() {
    var cats = ['餐饮', '交通', '购物', '居住', '医疗', '教育', '娱乐', '通讯', '人情', '其他'];
    /* 如果 App 里有自定义分类，读出来 */
    try {
      if (window.state && window.state.budget) {
        var custom = Object.keys(window.state.budget).filter(function (k) {
          return cats.indexOf(k) < 0;
        });
        if (custom.length) cats = cats.concat(custom);
      }
    } catch (e) { /* 读不到就用默认 */ }
    return cats;
  }

  var ACCOUNTS = ['微信', '支付宝', '银行卡', '现金', '信用卡'];

  function buildPrompt(cats) {
    return [
      '你是记账助手，从支付通知里提取账目信息。',
      '',
      '规则：',
      '1. amount 只填「实际支付金额」，不要填余额、不要填优惠前原价。',
      '2. 收入也写正数，type 标 income。',
      '3. category 只能从这些里选：' + cats.join('、'),
      '4. account 只能从这些里选：' + ACCOUNTS.join('、'),
      '5. 判断不出就填默认值，confidence 调低，reason 说明原因。',
      '6. 验证码、广告、快递通知不是账目，amount 填 0。',
      '',
      '只输出 JSON，不要任何解释、不要 markdown 代码块：',
      '{"amount":数字,"type":"expense或income","category":"分类","account":"账户","merchant":"商家","note":"备注","date":"YYYY-MM-DD","confidence":0到1,"reason":"说明"}'
    ].join('\n');
  }

  /* ==================== 请求 ==================== */

  function cleanJson(s) {
    s = String(s || '').trim();
    var m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) s = m[1].trim();
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    return s;
  }

  async function callAI(text, opts) {
    opts = opts || {};
    var conf = opts.conf || activeProvider();
    if (!conf) throw new Error('NO_CONFIG');

    var cats = getCategories();
    var today = new Date().toISOString().slice(0, 10);

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 30000);

    var res;
    try {
      res = await fetch(conf.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + conf.key
        },
        body: JSON.stringify({
          model: conf.model,
          temperature: 0,
          max_tokens: 400,
          messages: [
            { role: 'system', content: buildPrompt(cats) },
            { role: 'user', content: '今天是 ' + today + '。\n\n通知内容：\n' + text }
          ]
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求超时');
      throw new Error('网络错误：' + e.message);
    }

    var raw = await res.text();

    if (!res.ok) {
      var msg = '';
      try {
        var d = JSON.parse(raw);
        msg = (d.error && d.error.message) || d.message || '';
      } catch (e) { msg = raw.slice(0, 200); }
      if (res.status === 401) throw new Error('密钥无效');
      if (res.status === 402) throw new Error('余额不足');
      if (res.status === 429) throw new Error('请求太频繁');
      throw new Error('HTTP ' + res.status + '：' + msg);
    }

    var data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error('返回格式异常'); }

    var content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    if (!content) throw new Error('模型没返回内容');

    var obj;
    try { obj = JSON.parse(cleanJson(content)); }
    catch (e) { throw new Error('模型返回的不是 JSON'); }

    return normalize(obj, text, conf, cats);
  }

  /* ==================== 清洗 ==================== */

  function normalize(raw, text, conf, cats) {
    var amount = toNum(raw.amount);
    if (amount == null) amount = toNum(String(raw.amount || '').replace(/[^\d.\-]/g, ''));

    var category = pickFrom(raw.category, cats, '其他');
    var account = pickFrom(raw.account, ACCOUNTS, guessAccount(text));

    var conf01 = toNum(raw.confidence);
    if (conf01 == null) conf01 = 0.5;
    conf01 = Math.max(0, Math.min(1, conf01));

    return {
      amount: amount == null ? 0 : Math.round(amount * 100) / 100,
      type: raw.type === 'income' ? 'income' : 'expense',
      category: category,
      account: account,
      merchant: String(raw.merchant || '').trim().slice(0, 40),
      note: String(raw.note || '').trim().slice(0, 60),
      date: validDate(raw.date) || new Date().toISOString().slice(0, 10),
      confidence: conf01,
      reason: String(raw.reason || '').trim().slice(0, 100),
      _ai: { provider: conf.name, model: conf.model, raw: text }
    };
  }

  function toNum(v) {
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'string') {
      var n = parseFloat(v.replace(/[^\d.\-]/g, ''));
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function pickFrom(v, list, fallback) {
    if (!v) return fallback;
    var s = String(v).trim();
    for (var i = 0; i < list.length; i++) if (list[i] === s) return s;
    for (var j = 0; j < list.length; j++) if (s.indexOf(list[j]) >= 0) return list[j];
    return fallback;
  }

  function guessAccount(t) {
    if (/微信/.test(t)) return '微信';
    if (/支付宝|花呗/.test(t)) return '支付宝';
    if (/银行|尾号|卡号|储蓄卡/.test(t)) return '银行卡';
    if (/现金/.test(t)) return '现金';
    return '其他';
  }

  function validDate(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = s.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    return null;
  }

  function pad(n) { return String(n).length === 1 ? '0' + n : String(n); }

  /* ==================== 本地预筛 ==================== */

  var NOT_TX = [
    /验证码|校验码/, /取件码|快递|包裹/, /优惠券|活动|促销/,
    /退订|TD/, /登录|注册|密码/, /广告|推广/
  ];

  function looksLikeTx(text) {
    if (!text || text.length < 5) return false;
    for (var i = 0; i < NOT_TX.length; i++) if (NOT_TX[i].test(text)) return false;
    return /\d+(\.\d{1,2})?\s*元|¥|￥|支付|付款|消费|收入|支出|转账|充值/.test(text);
  }

  /* ==================== UI ==================== */

  function ensureModal() {
    if (document.getElementById('aiModal')) return;
    var html = '<div class="modal" id="aiModal"><div class="sheet" style="max-height:85vh;overflow-y:auto">' +
      '<h3>🤖 AI 解析</h3>' +
      '<div id="aiBody"></div>' +
      '<button class="cancel-btn" onclick="AIPARSE.close()" style="margin-top:12px">关闭</button>' +
      '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function renderMain() {
    ensureModal();
    var cfg = loadCfg();
    var cur = cfg.provider;
    var body = document.getElementById('aiBody');

    var rows = Object.keys(PRESETS).map(function (k) {
      var p = PRESETS[k];
      var has = cfg.models && cfg.models[k] && cfg.models[k].key;
      var mark = has ? (k === cur ? '✅ ' : '🔑 ') : '⚪ ';
      return '<button class="cancel-btn" style="margin:0;text-align:left" onclick="AIPARSE.openProvider(\'' + k + '\')">' +
        mark + p.label + (has ? '' : '（未配置）') +
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + p.note + '</div></button>';
    }).join('');

    body.innerHTML =
      '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">' +
      '本地解析不了的通知，可以用 AI 兜底。密钥只存在本机，不会上传。' +
      '</div>' +
      '<div style="display:grid;gap:8px;margin-bottom:12px">' + rows + '</div>' +
      (cur ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<button class="cancel-btn" onclick="AIPARSE.test()" style="margin:0">🔌 测试连接</button>' +
        '<button class="cancel-btn" onclick="AIPARSE.openManual()" style="margin:0">✏️ 手动解析</button>' +
        '</div>' : '');
  }

  function openProvider(name) {
    ensureModal();
    var cfg = loadCfg();
    var saved = (cfg.models && cfg.models[name]) || {};
    var preset = PRESETS[name];
    var body = document.getElementById('aiBody');

    body.innerHTML =
      '<h4 style="margin-bottom:10px">' + preset.label + '</h4>' +
      '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">' + preset.note + '</div>' +
      '<label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px">API 密钥</label>' +
      '<input id="aiKey" type="password" placeholder="sk-..." value="' + (saved.key || '') + '" ' +
      'style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:10px;box-sizing:border-box">' +
      '<label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px">接口地址</label>' +
      '<input id="aiUrl" type="text" value="' + (saved.baseUrl || preset.baseUrl) + '" ' +
      'style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:10px;box-sizing:border-box;font-size:12px">' +
      '<label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px">模型名</label>' +
      '<input id="aiModel" type="text" value="' + (saved.model || preset.model) + '" ' +
      'style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:14px;box-sizing:border-box;font-size:12px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<button class="cancel-btn" onclick="AIPARSE.back()" style="margin:0">返回</button>' +
      '<button style="margin:0;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px" ' +
      'onclick="AIPARSE.saveProvider(\'' + name + '\')">保存并启用</button>' +
      '</div>';
  }

  function saveProvider(name) {
    var key = document.getElementById('aiKey').value.trim();
    var url = document.getElementById('aiUrl').value.trim();
    var model = document.getElementById('aiModel').value.trim();
    if (!key) { toast('密钥不能为空'); return; }

    var cfg = loadCfg();
    cfg.models = cfg.models || {};
    cfg.models[name] = { key: key, baseUrl: url, model: model };
    cfg.provider = name;
    saveCfg(cfg);
    toast('已启用 ' + PRESETS[name].label);
    renderMain();
  }

  async function testConn() {
    var conf = activeProvider();
    if (!conf) { toast('请先配置密钥'); return; }
    toast('正在测试…');
    try {
      var r = await callAI('顺丰快递 到付 12 元');
      if (!r || !r.amount) throw new Error('返回金额为 0');
      toast('✅ 连接正常，解析出 ¥' + r.amount);
    } catch (e) {
      toast('❌ ' + e.message);
    }
  }

  function openManual() {
    ensureModal();
    var body = document.getElementById('aiBody');
    body.innerHTML =
      '<div style="font-size:12px;color:var(--text2);margin-bottom:8px">粘贴一条通知或随手记，让 AI 解析</div>' +
      '<textarea id="aiText" rows="5" placeholder="例如：微信支付：已支付¥15.80" ' +
      'style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);box-sizing:border-box;font-family:inherit;margin-bottom:10px;resize:vertical"></textarea>' +
      '<div id="aiResult"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">' +
      '<button class="cancel-btn" onclick="AIPARSE.back()" style="margin:0">返回</button>' +
      '<button style="margin:0;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px" ' +
      'onclick="AIPARSE.runManual()">解析</button>' +
      '</div>';
  }

  async function runManual() {
    var text = (document.getElementById('aiText').value || '').trim();
    var out = document.getElementById('aiResult');
    if (!text) { out.innerHTML = '<div style="color:var(--red)">请输入内容</div>'; return; }

    out.innerHTML = '<div style="color:var(--text2);font-size:13px">解析中…</div>';
    try {
      var tx = await callAI(text);
      out.innerHTML =
        '<div style="background:var(--bg2);border-radius:10px;padding:12px;font-size:13px;line-height:1.7">' +
        '<div style="font-size:20px;font-weight:700;margin-bottom:6px">' +
        (tx.type === 'income' ? '+' : '-') + ' ¥' + tx.amount.toFixed(2) + '</div>' +
        '<div>分类：' + tx.category + '　账户：' + tx.account + '</div>' +
        (tx.merchant ? '<div>商家：' + tx.merchant + '</div>' : '') +
        '<div>备注：' + tx.note + '</div>' +
        '<div>日期：' + tx.date + '</div>' +
        '<div style="color:var(--text3);margin-top:6px">置信度 ' + tx.confidence + ' · ' + tx.reason + '</div>' +
        '</div>' +
        '<button style="width:100%;margin-top:10px;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px" ' +
        'onclick=\'AIPARSE.apply(' + JSON.stringify(tx).replace(/'/g, "\\'") + ')\'>记入账本</button>';
    } catch (e) {
      out.innerHTML = '<div style="color:var(--red);font-size:13px">❌ ' + e.message + '</div>';
    }
  }

  function applyTx(tx) {
    try {
      /* 用 App 自己的存储函数，不绕过它 */
      if (typeof atx !== 'function' || typeof stx !== 'function' || typeof uid !== 'function') {
        toast('找不到记账接口，请手动录入');
        return;
      }
      var data = atx();
      var entry = {
        id: uid(),
        time: tx.date + 'T12:00:00',
        type: tx.type === 'income' ? 'income' : 'expense',
        amount: tx.amount,
        note: tx.note || tx.merchant || 'AI 解析',
        account: tx.account,
        category: tx.category,
        createdAt: Date.now()
      };
      /* 记下是 AI 解析的，方便以后核对 */
      if (tx._ai) entry.aiSrc = tx._ai.provider + '/' + tx._ai.model;

      data.push(entry);
      stx(data);

      /* 触发界面刷新（App 里的函数名是 ra） */
      if (typeof ra === 'function') ra();

      toast('已记入 ¥' + tx.amount.toFixed(2));
      close();
    } catch (e) {
      toast('录入失败：' + e.message);
    }
  }

  function back() { renderMain(); }

  function close() {
    var m = document.getElementById('aiModal');
    if (m) m.classList.remove('show');
  }

  /* ==================== 对外接口 ==================== */

  window.AIPARSE = {
    open: function () { renderMain(); document.getElementById('aiModal').classList.add('show'); },
    close: close,
    back: back,
    openProvider: openProvider,
    saveProvider: saveProvider,
    test: testConn,
    openManual: openManual,
    runManual: runManual,
    apply: applyTx,
    /* 供其他代码调用 */
    parse: callAI,
    looksLikeTx: looksLikeTx,
    activeProvider: activeProvider
  };

})();
