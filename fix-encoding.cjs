const fs = require('fs');
const path = require('path');

const dir = 'src/pages/Admin';
const files = [
  'Complaints.tsx','CustomerCare.tsx','DailySettlements.tsx',
  'Expenses.tsx','Fines.tsx','RatingAppeals.tsx',
  'RefundManagement.tsx','ReviewsManagement.tsx','SOSAlerts.tsx'
];

const strReplacements = [
  ['â€“', '—'],  // â€" → —  (em dash)
  ['â€¦', '…'],  // â€¦ → …  (ellipsis)
  ['â€˜', '‘'],  // â€˜ → '  (left single quote)
  ['â€™', '’'],  // â€™ → '  (right single quote)
  ['â€œ', '“'],  // â€œ → "  (left double quote)
  ['â€�', '”'],  // â€ → "   (right double quote)
  ['Â·', '·'],        // Â· → ·   (middle dot)
  ['Ã', '×'],        // Ã— → ×   (multiply)
  ['âˆ’', '−'],  // âˆ' → −   (minus sign)
  ['â€º', '›'],  // â€º → ›
  ['â†’', '→'],  // â†' → →  (right arrow)
  ['â‚¹', '₹'],  // â‚¹ → ₹  (rupee)
  ['â”€', '─'],  // â"€ → ─  (box drawing)
  ['â„¹', 'ℹ️'], // â„¹ï¸ → ℹ️
  ['â­', '⭐'],  // â­ → ⭐  (star)
  ['â˜…', '★'],  // â˜… → ★  (black star)
  ['â˜†', '☆'],  // â˜† → ☆  (white star)
  ['â”', '✔'],  // âœ" → ✔ (check)
  ['â…', '✅'],  // âœ… → ✅
  ['Ã°Å¸Å½Â§', '🎧'], // ðŸŽ§ → 🎧
  // emoji: decode F0 9F sequences that got mangled as latin1
];

// Approach: treat the garbled text as windows-1252 and re-decode
function fixMojibake(content) {
  // Use Buffer to reinterpret the garbled characters back to original UTF-8 bytes
  // The files contain UTF-8 bytes that were interpreted as latin1 and re-encoded as UTF-8
  // So we need to: read as UTF-8 → encode as latin1 → re-read as UTF-8

  // Step 1: encode the string back to latin1 bytes
  const latin1Buf = Buffer.from(content, 'latin1');
  // Step 2: decode as UTF-8
  const fixed = latin1Buf.toString('utf8');
  return fixed;
}

files.forEach(file => {
  const fpath = path.join(dir, file);
  try {
    // Read raw bytes
    const rawBuf = fs.readFileSync(fpath);
    // The file is UTF-8 but contains double-encoded sequences
    // Re-read as binary/latin1 to get original bytes, then as UTF-8
    const latin1Content = rawBuf.toString('binary'); // same as latin1
    const fixed = Buffer.from(latin1Content, 'latin1').toString('utf8');

    // Verify it actually fixed something
    if (fixed !== rawBuf.toString('utf8')) {
      fs.writeFileSync(fpath, fixed, 'utf8');
      console.log('Fixed: ' + file);
    } else {
      console.log('No change: ' + file);
    }
  } catch(e) {
    console.error('Error on ' + file + ': ' + e.message);
  }
});
console.log('Done!');
