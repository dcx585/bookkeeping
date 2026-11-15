// ── 自动记账自检（2026-11-15）──
// 起因：用户反馈「通知导入里显示已自动入账，但流水里没有」和
//       「银行卡有流水但账户余额没扣」。这两句描述对应三种完全不同的原因，
//       靠猜没用 —— 把三者摊开：日志与账本是否一致 / 账户是否对得上 / 交易落在哪个月。
//
// ① autoLog 说记了，账本里到底有没有
// ② 账本里有没有「账户名不在当前账户列表」的记录（余额永远算不进去）
// ③ 交易时间落在哪个月（用本地时间算，别被 UTC 串的月份过滤挡住）

function buildAutoDiag() {
  const L = [];
  const tx = atx();
  const accts = ga();
  const log = (typeof loadAutoLog === 'function') ? loadAutoLog() : [];

  L.push('<b>账本</b>：共 ' + tx.length + ' 笔；账户列表：' + accts.join(' / '));
  L.push('<b>最近一次自动记账</b>：' +
    (window.__autoLastRun ? new Date(window.__autoLastRun).toLocaleString() : '本次打开 App 后还没跑过'));

  // ③ 按月分布（本地时间）
  const byYm = {};
  tx.forEach(t => {
    const ym = ymOf(t.time) || '(时间无效)';
    byYm[ym] = (byYm[ym] || 0) + 1;
  });
  L.push('<b>按月分布</b>（本地时间）：' +
    Object.keys(byYm).sort().map(k => k + ' ' + byYm[k] + '笔').join(' · ') +
    '<br>当前查看月份：<b>' + cm + '</b>');

  // ② 账户对不上的记录
  const orphan = tx.filter(t => {
    if (t.type === 'transfer') return false;
    const a = t.account || '';
    return !a || accts.indexOf(a) < 0;
  });
  if (orphan.length) {
    L.push('<b style="color:#b4513c">账户对不上的 ' + orphan.length + ' 笔</b>' +
      '（这些钱不会计入任何账户余额）：<br>' +
      orphan.slice(-8).map(t =>
        '· ¥' + Number(t.amount).toFixed(2) + ' 账户=' +
        (t.account ? '「' + t.account + '」' : '<b>空</b>') +
        ' ' + String(t.note || '').slice(0, 24)
      ).join('<br>'));
  } else {
    L.push('<b>账户</b>：✓ 全部记录都能对上');
  }

  // ① autoLog 与账本核对
  if (!log.length) {
    L.push('<b>自动入账日志</b>：暂无记录');
    return L.join('<div style="height:8px"></div>');
  }

  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
  const rows = log.slice(-10).reverse().map(entry => {
    const ym = ymOf(entry.ts);
    const hit = tx.find(t =>
      t.auto && near(t.amount, entry.amount) &&
      (t.account || '') === (entry.account || '') &&
      ymOf(t.time) === ym);
    return { entry, hit, ym };
  });
  const miss = rows.filter(r => !r.hit);

  L.push('<b>自动入账日志</b>：共 ' + log.length + ' 条；最近 10 条里 ' +
    '<b style="color:' + (miss.length ? '#b4513c' : '#2e7d32') + '">' +
    miss.length + ' 条在账本里找不到</b>');
  L.push(rows.map(r =>
    '· ' + (r.ym || '?') + ' ¥' + Number(r.entry.amount).toFixed(2) +
    ' ' + (r.entry.type === 'income' ? '收入' : '支出') +
    ' 账户=' + (r.entry.account || '<b>空</b>') + ' → ' +
    (r.hit ? '<span style="color:#2e7d32">账本有</span>'
           : '<span style="color:#b4513c">账本<b>没有</b></span>')
  ).join('<br>'));
  if (miss.length) {
    L.push('<span style="color:#b4513c">→ 日志写了但账本没这笔：问题在写入那一步，不是"没识别到"。</span>');
  }

  return L.join('<div style="height:8px"></div>');
}

function openAutoDiag() {
  const out = document.getElementById('autodiagOut');
  if (out) out.innerHTML = buildAutoDiag();
  document.getElementById('autodiagModal').classList.add('show');
}

function copyAutoDiag() {
  const out = document.getElementById('autodiagOut');
  const txt = (out ? out.innerText : '').replace(/\n{3,}/g, '\n\n');
  try {
    if (window.MinisBridge && window.MinisBridge.copyText) {
      window.MinisBridge.copyText(txt);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt);
    } else {
      const ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    if (typeof ts === 'function') ts('已复制自检结果');
  } catch (e) {
    if (typeof ts === 'function') ts('复制失败：' + e.message);
  }
}
