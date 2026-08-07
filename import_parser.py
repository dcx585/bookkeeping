#!/usr/bin/env python3
"""解析 Android 通知栏中的支付信息，输出 JSON"""
import sys, json, re

def extract_payment(text):
    """Extract amount and type from payment notification text.
    Returns (amount, 'expense'|'income') or (None, None)
    """
    # === unified amount patterns ===
    # ¥ 符号: "已支付¥0.10" "支出¥100" "收款¥50"
    m = re.search(r'(?:支付|支出|消费|扣款|付款).*?[¥￥]\s*(\d+\.?\d*)', text)
    if m:
        return float(m.group(1)), 'expense'
    
    m = re.search(r'[¥￥]\s*(\d+\.?\d*)', text)
    if m:
        # Check context: 已支付/付款/扣款 = expense, 到账/收款/收入 = income
        if re.search(r'(?:已付|支付|付款|消费|扣款)', text):
            return float(m.group(1)), 'expense'
        if re.search(r'(?:到账|收款|收入|转入)', text):
            return float(m.group(1)), 'income'
        # Default: ¥ symbol usually means payment
        return float(m.group(1)), 'expense'
    
    # 元 suffix: "支出100.00元" "到账500元"
    m = re.search(r'(\d+\.?\d*)\s*元', text)
    if m:
        amount = float(m.group(1))
        # Check what's before the number
        prefix = text[:m.start()]
        if re.search(r'(?:已付|支付|支出|付款|消费|扣款)', prefix):
            return amount, 'expense'
        if re.search(r'(?:到账|收款|收入|存入|转入|工资)', prefix):
            return amount, 'income'
        return amount, 'expense'  # default
    
    return None, None

CATEGORY_KEYWORDS = {
    '餐饮': ['餐饮', '饭店', '外卖', '美团', '饿了么', '小吃', '奶茶', '咖啡', '肯德基', '麦当劳', '午餐', '晚餐', '早餐'],
    '交通': ['交通', '打车', '滴滴', '加油', '高速', '地铁', '公交', 'ETC', '停车', '货拉拉'],
    '购物': ['超市', '便利店', '购物', '淘宝', '京东', '拼多多', '天猫', '日用品', '水果', '菜市场'],
    '固定支出': ['话费', '流量', '房租', '水电', '物业', '宽带'],
    '医疗': ['医院', '药', '挂号', '门诊'],
}

def guess_category(text):
    text_lower = text
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return cat
    return '其他'

def guess_account(text):
    if any(w in text for w in ['微信', 'wechat']):
        return '微信'
    if any(w in text for w in ['支付宝', 'alipay']):
        return '支付宝'
    if any(w in text for w in ['花呗']):
        return '花呗'
    if any(w in text for w in ['银行', '储蓄卡', '信用卡', '尾号']):
        return '银行卡'
    return ''

def parse_notifications(notifications):
    results = []
    skip_words = ['申请', '提醒', '通知', '广告', '收款码牌', '套包', '红包', '优惠', '活动']
    for n in notifications:
        title = n.get('title', '')
        body = n.get('body', '')
        text = title + ' ' + body
        
        # Skip non-payment notifications
        if any(w in text for w in skip_words):
            continue
        
        amount, ttype = extract_payment(text)
        if amount is None or amount <= 0:
            continue
        
        cat = guess_category(text)
        acct = guess_account(text)
        note = body[:25] if body else title[:25]
        
        results.append({
            'amount': amount,
            'type': ttype,
            'category': cat,
            'account': acct,
            'note': note,
            'source': n.get('app', ''),
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
