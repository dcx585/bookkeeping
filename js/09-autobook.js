// ── 自动记账模块 ──
const AUTO_THRESHOLD = 30;          // ¥30 以下自动入账
const DEDUP_WINDOW = 5*60*1000;     // 5分钟内同指纹视为同一条（防重叠重复）
const SPECIAL_SPEND = [/应急金/,/规划金/,/花呗/,/借呗/,/白条/,/理财/,/基金/,/定投/,/学费/,/房租/,/保险费?/,/医疗/,/还款/,/公积金/,/转账/,/工资/,/薪水/,/薪资/,/退款/,/红包/];

function payFingerprint(s, account, amount, time){
  const m = s.match(/(?:流水号|商户单号|订单号|交易号|单号|付款单号)[:：\s]*([A-Za-z0-9]{6,})/i)
         || s.match(/([0-9]{10,})/);
  if(m) return 'ref:'+m[1];
  const win=Math.floor((time||Date.now())/DEDUP_WINDOW);
  return 'amt:'+(account||'?')+':'+(amount||0).toFixed(2)+':'+win;
}

// ── 严格「纯支付信息」判定 ──
// 用途：短信收件箱里混着验证码/广告/催缴/物流等，必须先剔干净，只留真·支付信息。
// 必须同时满足：① 有金额；② 有支付动作或账户词；③ 不是验证码/营销/催缴/物流。
function looksLikePaymentText(s){
  if(!s) return false;
  s=String(s);
  // ① 排除非交易短信
  if(/验证码|校验码|动态码|登录码|激活码|取件码|签收码|提货码/.test(s)) return false;
  if(/退订|回T退|回复TD|点击链接|点击下载|立即领取|优惠券|促销|抽奖|限时|特惠|办卡|贷款|理财推荐|保险推荐/.test(s)) return false;
  // ★ 额度/授信类通知不是消费：它们只"告知"额度，不是钱动了。
  //   例「您的花呗额度已提升至5000元」「信用卡可用额度50000元」——
  //   payWord 会命中"花呗/信用卡"，金额也能解析出来 → 会被当成 5000 元支出记进账（假账）。
  //   判据：出现【提额/额度/可用额度/授信】且没有【已支付/已扣款/已消费】等"钱真动了"的完成语。
  if(/提额|额度|可用额度|授信|限额|分期额度|临时额度/.test(s)
     && !/已支付|已扣款|已消费|支付成功|扣款成功|消费成功|已支出|已还款|还款成功|已到账|已收款/.test(s)) return false;
  if(/快递|包裹|已签收|派送|物流|外卖已送达|订单已/.test(s) && !/[¥￥]\s?\d/.test(s)) return false;
  const done=/已支付|已扣款|已消费|支付成功|扣款成功|交易成功|消费成功|已支出|入账成功|已到账|已收款|已退回|已退款|支出成功|已完成|已缴费|已充值|已转入|已转出/;
  if(/余额不足|欠费|请及时|温馨提醒|温馨提示|应缴|应还|现提醒|不足/.test(s) && !done.test(s)) return false;
  // ② 必须有金额
  // ★ 直接复用解析用的 findAmounts，不再自己维护一套金额正则。
  //   以前两套规则不一致：判定说"非支付"，解析却能算出金额 →
  //   像「网上支付人民币-35.50」这种真实银行通知被判成非支付【直接丢掉】。
  if(!findAmounts(s).length) return false;
  // ③ 必须有支付动作词或账户词
  const payWord=/支付|消费|支出|收入|到账|扣款|退款|退回|转账|收款|入账|交易|付款|还款|存入|转入|转出|缴费|充值|银行卡|储蓄卡|信用卡|借记卡|花呗|借呗|白条|尾号|卡号|实付|余额|人民币/;
  return payWord.test(s);
}
// ── 自动入账统一闸门（v1/v2 两条解析路径必须共用，否则开关一换行为就变） ──
// 规则：金额≤AUTO_THRESHOLD 且 非专项资金 且 账户是"日常兜底账户"(微信/银行卡) → 自动入账
//       其余一律进待确认框，由用户点头后再 ack。
// ★ 2026-11-15：v2 分支原先只透传 parseNoticeV2 的 needConfirm，
//   完全绕过阈值与账户判定 —— 开 v2（默认）时大额会被静默自动记账、
//   银行卡小额反而卡在待确认、且专项资金识别失效。统一到这里。
function autoBookGate(b){
  const segText = (b && b.note) || '';
  const special = (b && b.type === 'expense') ? SPECIAL_SPEND.find(re => re.test(segText)) : null;
  const dailyAccts = ['微信','银行卡'];
  const isDailyAcct = !!(b && b.account) && dailyAccts.indexOf(b.account) >= 0;
  const amount = Number((b && b.amount) || 0);
  const needConfirm = !!special || amount > AUTO_THRESHOLD || !(b && b.account) || !isDailyAcct;
  return { special: special ? special.toString() : null, needConfirm: needConfirm };
}
