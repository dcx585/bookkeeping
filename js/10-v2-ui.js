// ── 解析引擎开关与诊断面板（手写，勿放进 V2 自动生成块）──
if (typeof window.PARSE_V2 !== 'boolean') {
  window.PARSE_V2 = true;
  try {
    const _v2saved = safeRead('parse_v2', null);
    if (_v2saved === false) window.PARSE_V2 = false;
  } catch (e) { /* 读不到设置就用默认值 true */ }
}

/** 切换解析引擎，供设置界面调用 */
function setParseV2(on) {
  window.PARSE_V2 = !!on;
  try { safeWrite(() => localStorage.setItem('parse_v2', JSON.stringify(!!on))); } catch (e) {}
  try { ts(on ? '✅ 已切到新解析引擎（v2）' : '↩️ 已切回旧解析引擎'); } catch (e) {}
  return window.PARSE_V2;
}

/**
 * 解析诊断面板。
 *
 * 解决一个具体问题：「收到了但没记上」和「压根没收到」看着一模一样，
 * 但处理方式完全不同。这里能贴任一条通知原文，立刻告诉你：
 *   识别成哪家来源 / 取到多少金额 / 判成什么方向 / 还是没记上的原因
 */
function openParserDiag() {
  const on = !!window.PARSE_V2;
  const status = on
    ? '<b style="color:#2a7">新解析引擎（v2）已开启</b>'
    : '<b style="color:#c55">旧解析引擎（v1）运行中</b>';

  document.getElementById('pickerTitle').textContent = '解析诊断';
  document.getElementById('pickerList').innerHTML = `
    <div style="font-size:13px;line-height:1.6;text-align:left;padding:0 4px">
      <div style="margin-bottom:10px">当前：${status}</div>
      <button class="submit" style="width:100%;margin-bottom:14px"
        onclick="setParseV2(${!on});openParserDiag();">
        ${on ? '↩️ 切回旧引擎' : '✅ 启用新引擎'}
      </button>
      <div style="font-size:12px;color:var(--text3);margin-bottom:6px">
        粘贴一条通知/短信原文，看看它为什么没记上：
      </div>
      <textarea id="diagInput" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)"
        placeholder="例：微信支付：已支付¥4.85"></textarea>
      <button class="submit" style="width:100%;margin:8px 0"
        onclick="runParserDiag()">开始诊断</button>
      <div id="diagOut" style="font-size:13px;line-height:1.7"></div>
    </div>`;
  document.getElementById('pickerModal').style.display = 'flex';
}

function runParserDiag() {
  const el = document.getElementById('diagInput');
  const out = document.getElementById('diagOut');
  const raw = (el && el.value || '').trim();
  if (!raw) { out.innerHTML = '<span style="color:#c55">请先粘贴一条通知原文</span>'; return; }

  if (typeof diagnoseNotice !== 'function') {
    out.innerHTML = '<span style="color:#c55">诊断函数未加载</span>';
    return;
  }

  let d;
  try {
    d = diagnoseNotice({ title: raw, text: '', app: '' });
  } catch (e) {
    out.innerHTML = '<span style="color:#c55">诊断出错：' + e.message + '</span>';
    return;
  }

  const srcName = { WECHAT: '微信', ALIPAY: '支付宝', BANK: '银行', TAOBAO: '淘宝', JD: '京东', PDD: '拼多多', OTHER: '其他' }[d.source] || d.source;

  let html = '<div style="background:var(--card);border-radius:8px;padding:10px;margin-bottom:8px">';
  html += '来源：<b>' + srcName + '</b><br>';
  if (d.cents) html += '金额：<b>' + (d.cents / 100).toFixed(2) + ' 元</b><br>';
  if (d.type) html += '方向：<b>' + (d.type === 'income' ? '收入' : '支出') + '</b><br>';
  html += '</div>';

  if (d.ok) {
    html += '<div style="color:#2a7">✅ 这条能正常记账</div>';
  } else {
    html += '<div style="color:#c55">❌ 不会记账</div>';
    html += '<div style="font-size:12px;color:var(--text2);margin-top:4px">原因：' + d.reason + '</div>';
  }
  out.innerHTML = html;
}
