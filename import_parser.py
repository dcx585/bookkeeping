#!/usr/bin/env python3
"""解析 Android 通知栏中的支付信息，输出 JSON"""
import sys, json, re

PAYMENT_PATTERNS = [
    # 银行扣款短信: "尾号1234 ... 支出100.00元"
    (r'.*?(?:支出|消费|扣款|付款).*?(\d+\.?\d*)\s*元', 'expense'),
    # 银行入账: "尾号1234 ... 收入/转入 100.00元"
    (r'.*?(?:存入|转入|到账|收入|工资).*?(\d+\.?\d*)\s*元', 'income'),
    # 微信支付: "微信支付 ... 100.00元" or "你已成功支付100.00元"
    (r'微信.*?(?:支付|付款|消费).*?(\d+\.?\d*)\s*元', 'expense'),
    # 微信到账: "微信收款100.00元" or "收到转账"
    (r'(?:收到|微信收款|转账给你).*?(\d+\.?\d*)\s*元', 'income'),
    # 支付宝支付: "支付宝.*?支付.*?(\d+\.?\d*)\s*元"
    (r'支付宝.*?(?:支付|付款|消费).*?(\d+\.?\d*)\s*元', 'expense'),
    # 支付宝到账: "支付宝.*?到账.*?(\d+\.?\d*)\s*元"
    (r'支付宝.*?(?:到账|收入).*?(\d+\.?\d*)\s*元', 'income'),
    # 通用: 任何"支出/消费/扣款 + 金额"
    (r'(?:支出|消费|扣款|付款|支付)[^\d]*?(\d+\.?\d*)\s*元', 'expense'),
    # 通用: 任何"入账/到账/收款 + 金额"
    (r'(?:存入|转入|到账|收款|收入|工资)[^\d]*?(\d+\.?\d*)\s*元', 'income'),
]

CATEGORY_KEYWORDS = {
    '餐饮': ['餐饮', '饭店', '外卖', '美团', '饿了么', '小吃', '奶茶', '咖啡', '肯德基', '麦当劳', '午餐', '晚餐', '早餐'],
    '交通': ['交通', '打车', '滴滴', '加油', '高速', '地铁', '公交', 'ETC', '停车', '货拉拉'],
    '购物': ['超市', '便利店', '购物', '淘宝', '京东', '拼多多', '天猫', '日用品', '水果', '菜市场'],
    '固定支出': ['话费', '流量', '房租', '水电', '物业', '宽带'],
    '医疗': ['医院', '药', '挂号', '门诊'],
}

def parse_amount(text):
    for pattern, ttype in PAYMENT_PATTERNS:
        m = re.match(pattern, text)
        if m:
            return float(m.group(1)), ttype
    return None, None

def guess_category(text):
    text = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                return cat
    return '其他'

def guess_account(text):
    text = text.lower()
    if any(w in text for w in ['微信', 'wechat']):
        return '微信'
    if any(w in text for w in ['支付宝', 'alipay']):
        return '支付宝'
    if any(w in text for w in ['花呗']):
        return '花呗'
    # 有银行信息 → 银行卡
    if any(w in text for w in ['银行', '储蓄卡', '信用卡', '尾号']):
        return '银行卡'
    return ''

def parse_notifications(notifications):
    results = []
    for n in notifications:
        title = n.get('title', '')
        body = n.get('body', '')
        text = title + ' ' + body
        
        amount, ttype = parse_amount(text)
        if amount is None or amount <= 0:
            continue
        
        cat = guess_category(text)
        acct = guess_account(text)
        note = title[:20] if title else body[:20]
        
        results.append({
            'amount': amount,
            'type': ttype,
            'category': cat,
            'account': acct,
            'note': note,
            'source': n.get('app', ''),
            'raw_title': title,
        })
    
    return results

if __name__ == '__main__':
    if len(sys.argv) > 1:
        data = json.loads(sys.argv[1])
    else:
        data = json.load(sys.stdin)
    
    notifs = data.get('notifications', [])
    results = parse_notifications(notifs)
    print(json.dumps(results, ensure_ascii=False, indent=2))
