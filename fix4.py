#!/usr/bin/env python3
import os, sys
sys.stdout.reconfigure(encoding='utf-8')

BASE = r'C:\Users\munja\Downloads\admin-restarent\src\pages\Admin'
FFFD = b'\xef\xbf\xbd'

STAR   = '⭐'.encode()        # ⭐
MDASH  = b'\xe2\x80\x94'         # —
MDOT   = b'\xc2\xb7'             # ·
RUPEE  = b'\xe2\x82\xb9'         # ₹
CC     = b'\xf0\x9f\x92\xb3'     # 💳 credit card
CASH   = b'\xf0\x9f\x92\xb5'     # 💵 dollar banknote
RIDER  = b'\xf0\x9f\x8f\x8d'     # 🏍 motorcycle

# --- RatingAppeals.tsx ---
fpath = os.path.join(BASE, 'RatingAppeals.tsx')
with open(fpath, 'rb') as f:
    data = f.read()
old = b'"text-5xl mb-3">' + FFFD + b'?</div>'
new = b'"text-5xl mb-3">' + STAR + b'</div>'
if old in data:
    data = data.replace(old, new)
    with open(fpath, 'wb') as f:
        f.write(data)
    print('RatingAppeals.tsx: fixed 5xl emoji to star')
else:
    print('RatingAppeals.tsx: NOT FOUND', repr(old))

# --- SOSAlerts.tsx ---
fpath = os.path.join(BASE, 'SOSAlerts.tsx')
with open(fpath, 'rb') as f:
    data = f.read()
original = data

fixes = [
    (b'Order cancelled ' + FFFD + b' customer',
     b'Order cancelled ' + MDASH + b' customer'),

    (b'?? Rider Waiting ' + FFFD + b' Customer Ghosted',
     RIDER + b' Rider Waiting ' + MDASH + b' Customer Ghosted'),

    (FFFD + b' ?{order.totalAmount}',
     MDOT + b' ' + RUPEE + b'{order.totalAmount}'),

    (b"'?? Prepaid order " + FFFD,
     b"'" + CC + b' Prepaid order ' + MDASH),

    (b"'?? COD order " + FFFD,
     b"'" + CASH + b' COD order ' + MDASH),
]

for old, new in fixes:
    count = data.count(old)
    if count:
        data = data.replace(old, new)
        print(f'SOSAlerts.tsx: fixed {repr(old[:35])}')
    else:
        print(f'SOSAlerts.tsx: NOT FOUND {repr(old[:40])}')

if data != original:
    with open(fpath, 'wb') as f:
        f.write(data)
    print('SOSAlerts.tsx saved')

# Final verification
print('\n--- Verification ---')
for fn in ['RatingAppeals.tsx', 'SOSAlerts.tsx']:
    with open(os.path.join(BASE, fn), 'rb') as f:
        d = f.read()
    count = d.count(FFFD)
    print(f'{fn}: {count} replacement chars remaining')
