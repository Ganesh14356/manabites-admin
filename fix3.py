#!/usr/bin/env python3
"""Fix remaining broken emoji/chars in admin pages after W1252 iconv pass."""
import os

BASE = r'C:\Users\munja\Downloads\admin-restarent\src\pages\Admin'

FFFD = b'\xef\xbf\xbd'  # U+FFFD replacement char
VS16 = b'\xef\xb8\x8f'  # U+FE0F variation selector-16

# --- per-file replacements (order matters: longer patterns first) ---
FIXES = {
    'CustomerCare.tsx': [
        # '🛵' : '??' -> '🛵' : '🍱'  (restaurant/food box icon)
        (FFFD + b'?' + FFFD, '🍱'.encode()),
    ],
    'Fines.tsx': [
        # '🛵 Riders' : '🍽️ Restaurants'
        (FFFD + b'?' + FFFD + FFFD + b'?', '🍽️'.encode()),
    ],
    'DailySettlements.tsx': [
        # ℹ️  — the ℹ (U+2139) is intact, only the FE0F is broken
        (b'\xe2\x84\xb9' + FFFD + b'?', 'ℹ️'.encode()),
    ],
    'ReviewsManagement.tsx': [
        # ⚠️  — ⚠ (U+26A0) intact, FE0F broken
        (b'\xe2\x9a\xa0' + FFFD + b'?', '⚠️'.encode()),
        # lone ⭐ icon (full replacement)
        (FFFD + b'?', '⭐'.encode()),
    ],
    'RefundManagement.tsx': [
        # Fix in document order so first-match replacement works correctly.
        # We'll do string-level replacements with context anchors to avoid
        # conflating ❌ vs 🏦 (both produce same broken pattern).

        # @6028: title 'XX Refund Request Rejected'  → ❌
        (FFFD + b'?' + FFFD + b' Refund Request Rejected',
         '❌ Refund Request Rejected'.encode()),

        # @8330 & @8334: 'original' ? 'XX Issued'  → 🏦
        (FFFD + b'?' + FFFD + b' Issued',
         '🏦 Issued'.encode()),

        # @15555: >XX Original</span>  → 🏦
        (FFFD + b'?' + FFFD + b' Original</span>',
         '🏦 Original</span>'.encode()),

        # @19029: 'XX Original Payment'  → 🏦
        (FFFD + b'?' + FFFD + b' Original Payment',
         '🏦 Original Payment'.encode()),

        # @9951: lone replacement in heading  → 🚨
        (b'Food Fraud Alerts ' + FFFD + b' Requires',
         b'Food Fraud Alerts \xf0\x9f\x9a\xa8 Requires'),

        # @10284: separator between order id and restaurant name  → ·
        (b'className="text-sm" /> ' + FFFD + b' {',
         b'className="text-sm" /> \xc2\xb7 {'),
    ],
}

for filename, replacements in FIXES.items():
    fpath = os.path.join(BASE, filename)
    with open(fpath, 'rb') as f:
        data = f.read()

    original = data
    for old, new in replacements:
        count = data.count(old)
        if count:
            data = data.replace(old, new)
            print(f'  {filename}: replaced {count}x {repr(old[:20])} → {repr(new[:20])}')
        else:
            print(f'  {filename}: NOT FOUND {repr(old[:30])}')

    if data != original:
        with open(fpath, 'wb') as f:
            f.write(data)
        print(f'  ✓ {filename} saved')
    else:
        print(f'  — {filename} unchanged')

print('\nDone!')
