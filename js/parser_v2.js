/* ============================================================
 * 通知解析 v2 —— 按来源锚点提取（借鉴 blue-whale-keeper）
 *
 * 核心思想：旧版用一条大正则「找动作词附近的数字」，
 * 干扰数字（未读条数 [48条]、积分、红包金额）全都会被抓错。
 *
 * 新版改成「认准各家自己的货币锚点」：
 *   微信  → ¥ 符号
 *   支付宝 → 「元」字
 *   银行  → 「人民币」优先，退回 ¥
 *   电商  → 「实付/付款金额」这类带标签的优先，退回 ¥
 *
 * 这样 [48条]、6个积分、领1元红包 天然被排除。
 * ============================================================ */

// ---------- 金额锚点 ----------
// 带千分位与小数都支持，**允许前导负号**（银行短信常见「人民币-35.50」）
const NUM = '([-－]?[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[-－]?[0-9]{1,9}(?:\\.[0-9]{1,2})?)';

const RE_SYMBOL_FIRST = new RegExp('[¥￥]\\s*' + NUM);        // ¥ 后面的数——微信最常用
const RE_YUAN_LAST    = new RegExp(NUM + '\\s*元');           // 「元」前面的数——支付宝最常用
const RE_RMB_AMOUNT   = new RegExp('人民币\\s*' + NUM);       // 银行到账标准写法
const RE_PAID_NEAR    = new RegExp(
  '(?:实付|实付款|付款金额|支付金额|订单金额|应付|已付|共计|合计)\\s*[:：]?\\s*[¥￥]?\\s*' + NUM
);

// ---------- 来源识别 ----------
function detectSource(raw, appName) {
  const t = (raw || '') + ' ' + (appName || '');
  if (/支付宝|alipay/i.test(t)) return 'ALIPAY';
  if (/微信|财付通|wechat/i.test(t)) return 'WECHAT';
  if (/淘宝|天猫|taobao/i.test(t)) return 'TAOBAO';
  if (/京东|jd\.com|jingdong/i.test(t)) return 'JD';
  if (/拼多多|pinduoduo|pdd/i.test(t)) return 'PDD';

  // 银行识别要宽松：真实银行短信常常**不含银行名**，只写
  // 「您尾号1234的账户…」「您账户1234于…」。这些特征比银行名更可靠。
  const bankSignals = /银行|招商|工商|建设|农业|中国银行|交通银行|中信|浦发|民生|兴业|光大|华夏|广发|平安银行|邮储|邮政储蓄|银联|信用卡|储蓄卡|借记卡|尾号\s?\d{3,4}|卡号|账户\d|人民币|您尾号|您账户/;
  if (bankSignals.test(t)) return 'BANK';

  return 'OTHER';
}

// ---------- 金额提取（按来源认锚点） ----------
function toCents(s) {
  // 负数在银行短信里表示方向（「人民币-35.50」），金额本身取绝对值
  const n = Math.abs(parseFloat(String(s).replace(/[,－]/g, m => m === '－' ? '-' : '')));
  return isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function firstAmount(re, text) {
  const m = re.exec(text);
  if (!m) return null;
  return toCents(m[1]);
}

/**
 * 按来源提取金额。
 * @returns {cents:number|null, rule:string}  找不到可信金额 → cents 为 null，宁可放弃也不猜
 */
function extractAmount(source, text) {
  switch (source) {
    case 'WECHAT':
      // 微信只认 ¥ —— 它的通知必定带这个符号（"已支付¥4.85"）
      return { cents: firstAmount(RE_SYMBOL_FIRST, text), rule: 'wx.symbol' };

    case 'ALIPAY':
      // 支付宝认「元」—— 标准句式"你有一笔X元的支出"
      // 取第一个「数字+元」，句尾常有"领1元红包"这种陷阱
      return { cents: firstAmount(RE_YUAN_LAST, text), rule: 'alipay.yuan' };

    case 'BANK': {
      // 「人民币」优先（卡号、余额不会被误认），没有才退回 ¥
      let c = firstAmount(RE_RMB_AMOUNT, text);
      if (c != null) return { cents: c, rule: 'bank.rmb' };
      return { cents: firstAmount(RE_SYMBOL_FIRST, text), rule: 'bank.symbol' };
    }

    case 'TAOBAO':
    case 'JD':
    case 'PDD': {
      // 电商通知里常有多个 ¥（订单总额/红包/优惠券/积分），
      // 直接取第一个很容易抓错 —— 先认「实付」这种带标签的
      let c = firstAmount(RE_PAID_NEAR, text);
      if (c != null) return { cents: c, rule: 'shop.labeled' };
      c = firstAmount(RE_SYMBOL_FIRST, text);
      if (c != null) return { cents: c, rule: 'shop.symbol' };
      return { cents: firstAmount(RE_YUAN_LAST, text), rule: 'shop.yuan' };
    }

    default: {
      // 其他来源：三种锚点都试。
      //   加「人民币」是因为降级来的银行文本可能是「人民币-35.50」——
      //   既没有 ¥ 也没有「元」字，只认前两种会整个漏掉。
      let c = firstAmount(RE_SYMBOL_FIRST, text);
      if (c != null) return { cents: c, rule: 'any.symbol' };
      c = firstAmount(RE_YUAN_LAST, text);
      if (c != null) return { cents: c, rule: 'any.yuan' };
      return { cents: firstAmount(RE_RMB_AMOUNT, text), rule: 'any.rmb' };
    }
  }
}

// ---------- 方向判断 ----------
// 「转账」「红包」本身没有方向：
//   「转账给张三」=支出   「张三向我转账」=收入
//   「发出红包」  =支出   「收到红包」    =收入
// 所以用短语判断，且收入短语必须先查。
const PROVISIONAL_PATTERNS = [
  /向你转账/, /向我转账/, /向您转账/, /给您转账/,
  /转账给你/, /转账给我/,
  /请及时查收/, /待接收/, /待确认收款/, /等待对方确认/,
];

const INCOMING_PATTERNS = [
  /(?:向|给)[我您你]转账/,
  /收到[^，。|]{0,12}转账/,
  /收到[^，。|]{0,8}红包/,
  /领取[^，。|]{0,8}红包/,
  /红包[^，。|]{0,8}(?:到账|存入|入账|已领|已收)/,
  /(?:转账|红包)[^，。|]{0,8}(?:已到账|已存入|已入账)/,
  /已收款/,
  /收款[^，。|]{0,12}存入/,
  /收款成功/,
  /已收下/,
];

const OUTGOING_PATTERNS = [
  /(?:向|给)[^，。|]{1,16}转账/,        // 向张三转账（"向我"已在收入里拦掉）
  /转账给[^，。|]{1,16}/,
  /已转账/,
  /转账成功/,
  /(?:发出|发了|发送|已发)[^，。|]{0,6}红包/,
  /红包[^，。|]{0,6}(?:已发出|已发送)/,
];

const INCOME_WORDS  = ['收入', '入账', '收款', '到账', '存入', '退回', '退款', '转入', '工资', '收益', '报销'];
const EXPENSE_WORDS = ['支出', '消费', '付款', '支付', '扣款', '转出', '缴费', '还款', '取现', '代扣',
                       '充值', '购入', '买入', '买了', '花费', '花出', '应还', '已付'];

const FUTURE_MARKERS = ['将于', '即将', '预计', '应还', '待还', '将要', '将于明日', '将在'];

/**
 * 判断方向。
 * @returns {'income'|'expense'|null}  null = 判不出来，宁可放弃
 */
function detectDirection(text, source) {
  // 未来时态不是已发生的交易 —— 记进去等于凭空多一笔，时间还是错的
  if (FUTURE_MARKERS.some(m => text.includes(m))) return null;

  // 1) 转账/红包短语优先（收入必须先查）
  if (INCOMING_PATTERNS.some(re => re.test(text))) return 'income';
  if (OUTGOING_PATTERNS.some(re => re.test(text))) return 'expense';

  // 2) 洗掉品牌名再判词。
  //   「支付宝」三个字里含「支付」，而「支付」是支出词 ——
  //   「支付宝 | 20.00元」这种只有金额没有方向的通知会被瞎猜成支出，
  //   而它完全可能是退款到账。洗掉后判不出来就放弃。
  const cleaned = text
    .replace(/支付宝/g, '【第三方】')
    .replace(/微信支付/g, '【第三方】')
    .replace(/云闪付/g, '【第三方】')
    .replace(/财付通/g, '【第三方】');

  const hasIncome  = INCOME_WORDS.some(w => cleaned.includes(w));
  const hasExpense = EXPENSE_WORDS.some(w => cleaned.includes(w));

  if (hasIncome && !hasExpense) return 'income';
  if (hasExpense && !hasIncome) return 'expense';
  if (hasIncome && hasExpense) return null;   // 打架 → 放弃，错账比漏账难发现
  return null;
}

// ---------- 商户名提取 ----------
const MERCHANT_PATTERNS = [
  /商户[：:\s]+([^\s，。|]{2,20})/,
  /收款方[：:\s]+([^\s，。|]{2,20})/,
  /向\s*([^\s，。|]{2,20})\s*(?:付款|支付)/,
  /(?:付款方|付款人|汇款人|转入方|对方户名)[：:\s]+([^\s，。|]{2,24})/,
  /来自\s*([^\s，。|]{2,24})/,
];

function extractMerchant(text) {
  for (const re of MERCHANT_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]) {
      const v = m[1].trim();
      // 过滤掉明显不是商户的（纯金额、纯数字）
      if (/^\d+(\.\d+)?$/.test(v)) continue;
      return v;
    }
  }
  return '';
}

// ---------- 银行信号词 ----------
const BANK_CREDIT_WORDS = [
  '收入', '到账', '到账成功', '转入', '存入', '汇入', '入账', '已入账',
  '代发', '工资', '转入金额', '收入金额', '存入金额', '转入人民币',
];
// 命中任一就整条放弃 —— 避免与支付宝/微信重复记账
const BANK_DEBIT_WORDS = [
  '支出', '消费', '扣款', '已扣', '支付', '付款', '取现', '转出', '支出金额',
  '消费金额', '代扣', '快捷支付扣', '还款', '手续费',
  '提现',   // 自己账户间转移，记成收入会让总身家凭空变大
];

// ---------- 主解析入口 ----------
/**
 * 解析一条通知。
 * @returns 数组（一条通知可能合并多笔）
 */
function parseNoticeV2(n) {
  const title = n.title || '';
  const text  = n.text  || '';
  const app   = n.app   || '';
  const raw   = title + ' ' + text + ' ' + app;
  const time  = n.time || Date.now();

  const source = detectSource(raw, app);

  // 银行：只认收入。支出交给支付宝/微信，否则必然重复记账。
  // ★ 但「拒绝」不等于「丢弃」—— 降级走通用解析，
  //   由上层用「银行支出 → 待确认」标记，让用户一眼能删。
  //   直接丢弃会漏掉只在卡上扣的自动续费/手续费。
  if (source === 'BANK') {
    const isCredit = BANK_CREDIT_WORDS.some(w => raw.includes(w));
    const isDebit  = BANK_DEBIT_WORDS.some(w => raw.includes(w));

    // 明确的收入 → 收下
    if (isCredit && !isDebit) {
      const hit = extractAmount('BANK', raw);
      if (hit.cents) {
        return [{
          amount: hit.cents / 100,
          type: 'income',
          category: '其他',
          account: '银行卡',
          note: raw.slice(0, 40),
          merchant: extractMerchant(raw) || '银行',
          source,
          rule: hit.rule,
          confidence: 0.9,
          needConfirm: false,
          time,
        }];
      }
    }

    // 银行支出 / 提现 / 判不出来 → 走通用解析，标 needConfirm
    const fallback = parseGeneric(raw, { source: 'BANK', time, isBankDebit: true });
    return fallback;
  }

  return parseGeneric(raw, { source, time, isBankDebit: false });
}

/** 通用解析（非银行收入路径） */
function parseGeneric(raw, opts) {
  const source = opts.source;
  const time = opts.time;
  let amounts = findAllAnchoredAmounts(raw, source);

  // 银行降级路径：BANK 锚点只认「人民币」和 ¥，
  // 但降级来的文本可能两者都没有（如「缴费成功200.00元」）。
  // 退回通用锚点再试一次。
  if (!amounts.length && opts.isBankDebit) {
    amounts = findAllAnchoredAmounts(raw, 'OTHER');
  }
  if (!amounts.length) return [];

  const out = [];
  for (let i = 0; i < amounts.length; i++) {
    // ★ 切段时保留金额前面的上下文。
    //   旧逻辑从金额位置开始切，段文本变成「¥4.85」——
    //   方向词「已支付」被切掉了，判不出方向就整笔丢弃。
    //   改成：上一笔结束处 → 下一笔开始处（含前文）。
    const segStart = i === 0 ? 0 : amounts[i - 1].pos;
    const end = i + 1 < amounts.length ? amounts[i + 1].pos : raw.length;
    const seg = raw.slice(segStart, end);

    const amount = amounts[i].cents / 100;

    let type = detectDirection(seg, source);
    // 银行支出：方向词可能是「消费/支出/扣款」，detectDirection 能判；
    // 判不出来时，若已确定是银行扣款，按支出处理（宁记待确认，不静默丢）
    if (!type && opts.isBankDebit) type = 'expense';
    if (!type) continue;    // 判不出方向 → 放弃这条

    const merchant = extractMerchant(seg);
    out.push({
      amount,
      type,
      category: classifyByText(seg),
      account: accountBySource(source) || '银行卡',
      note: seg.slice(0, 40),
      merchant,
      source,
      rule: amounts[i].rule,
      confidence: merchant ? 0.9 : 0.6,
      // 银行支出 → 强制待确认：它多半与支付宝/微信重复，但也可能是
      // 只走银行卡的自动续费。收下来标待确认，用户一眼能看出并删掉。
      needConfirm: !!opts.isBankDebit,
      time: time + i * 1000,
    });
  }
  return out;
}

/**
 * 找出文本中所有「锚定金额」，按来源认锚点。
 * 这是取代旧 findAmounts 的关键差异：不再「动词附近找数字」。
 */
function findAllAnchoredAmounts(text, source) {
  const out = [];

  function collect(re, rule) {
    // ★ 必须每次都新建正则实例。
    //   共享的带 g 标志正则，lastIndex 会在多次调用间残留，
    //   导致 exec 从中间位置开始、甚至无限循环（踩过一次 GC 爆内存）。
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    let guard = 0;
    while ((m = rx.exec(text)) !== null) {
      if (++guard > 500) break;                 // 兜底：绝不死循环
      const cents = toCents(m[1]);
      if (cents != null) {
        // 排除余额类（"余额 1000.00元"不是交易金额）
        const before = text.slice(Math.max(0, m.index - 6), m.index);
        if (!/余额|剩余|结余|可用/.test(before)) {
          out.push({ cents, pos: m.index, rule });
        }
      }
      if (m[0].length === 0) rx.lastIndex++;    // 零宽匹配保护
    }
  }

  switch (source) {
    case 'WECHAT':
      collect(RE_SYMBOL_FIRST, 'wx.symbol');
      break;
    case 'ALIPAY':
      collect(RE_YUAN_LAST, 'alipay.yuan');
      break;
    case 'TAOBAO':
    case 'JD':
    case 'PDD':
      collect(RE_PAID_NEAR, 'shop.labeled');
      if (!out.length) collect(RE_SYMBOL_FIRST, 'shop.symbol');
      break;
    default:
      collect(RE_SYMBOL_FIRST, 'any.symbol');
      if (!out.length) collect(RE_YUAN_LAST, 'any.yuan');
      if (!out.length) collect(RE_RMB_AMOUNT, 'any.rmb');
  }

  // 按位置排序、去掉位置重叠的重复
  out.sort((a, b) => a.pos - b.pos);
  return out.filter((x, i) => i === 0 || x.pos !== out[i - 1].pos);
}

// ---------- 账户与分类 ----------
function accountBySource(source) {
  switch (source) {
    case 'WECHAT': return '微信';
    case 'ALIPAY': return '支付宝';
    case 'BANK':   return '银行卡';
    default:       return '';
  }
}

function classifyByText(s) {
  if (/餐饮|吃饭|美团|饿了么|餐厅|外卖|超市|便利店|买菜|零食|奶茶|咖啡/.test(s)) return '餐饮';
  if (/淘宝|天猫|京东|拼多多|购物|商城|消费|购买/.test(s)) return '购物';
  if (/话费|流量|充值|移动|联通|电信/.test(s)) return '话费';
  if (/地铁|公交|打车|滴滴|车票|加油|停车|高速|铁路|航空/.test(s)) return '交通';
  if (/还款|信用卡|花呗|借呗|白条/.test(s)) return '还款';
  return '其他';
}

// ---------- 诊断（排障用） ----------
/**
 * 解释「为什么没记上」。
 * 「收到了但没记上」和「压根没收到」看着一样，处理方式却完全不同。
 */
function diagnoseNotice(n) {
  const title = n.title || '';
  const text  = n.text  || '';
  const app   = n.app   || '';
  const raw   = title + ' ' + text + ' ' + app;
  const source = detectSource(raw, app);

  const hit = extractAmount(source, raw);
  if (!hit.cents) {
    const why = {
      WECHAT: '没找到 ¥ 符号（微信通知必定带它，可能这条不是支付通知）',
      ALIPAY: '没找到「数字+元」（支付宝标准句式里一定有）',
      BANK:   '没找到「人民币」或 ¥（银行到账通知的标准锚点）',
    }[source] || '没找到任何货币锚点（¥ 或 元）';
    return { ok: false, source, reason: why };
  }

  if (source === 'BANK') {
    const isCredit = BANK_CREDIT_WORDS.some(w => raw.includes(w));
    const isDebit  = BANK_DEBIT_WORDS.some(w => raw.includes(w));
    if (isDebit) return { ok: false, source, reason: '银行支出（避免与微信/支付宝重复，交给他俩记）', cents: hit.cents };
    if (!isCredit) return { ok: false, source, reason: '银行通知但没有收入信号', cents: hit.cents };
    return { ok: true, source, reason: '可记入（银行收入）', cents: hit.cents };
  }

  const type = detectDirection(raw, source);
  if (!type) return { ok: false, source, reason: '有金额 ' + (hit.cents / 100) + ' 元，但判断不出收支方向', cents: hit.cents };

  return { ok: true, source, reason: '可记入（' + (type === 'income' ? '收入' : '支出') + '）', cents: hit.cents, type };
}

// ---------- 导出 ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectSource, extractAmount, detectDirection, extractMerchant,
    parseNoticeV2, findAllAnchoredAmounts, diagnoseNotice,
    accountBySource, classifyByText,
  };
}
