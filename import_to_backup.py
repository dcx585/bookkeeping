import json, sys
from datetime import datetime

# Read parsed transactions
with open('/var/minis/shared/bookkeeping/imported_tx.json') as f:
    imported = json.load(f)

if not imported:
    print("没有新的支付通知")
    sys.exit(0)

# Build backup format
today = datetime.now().strftime('%Y-%m-%d')
tx_list = []
for i, t in enumerate(imported):
    tx_list.append({
        'id': f'imp_{today}_{i}',
        'time': today + 'T12:00:00',
        'type': t['type'],
        'amount': t['amount'],
        'note': t.get('note', ''),
        'account': t.get('account', ''),
        'category': t.get('category', '其他')
    })

backup = {'tx': tx_list, 'budget': {}, 'accts': [], 'bg': None}

with open('/var/minis/shared/bookkeeping/import_backup.json', 'w') as f:
    json.dump(backup, f, ensure_ascii=False)

print(f"✅ 生成导入文件：{len(tx_list)} 条")
for t in tx_list:
    print(f"  {'收入' if t['type']=='income' else '支出'} ¥{t['amount']} · {t['category']} · {t['note']}")
