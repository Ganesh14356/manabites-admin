const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const dir = 'src/pages/Admin';
const files = [
  'Complaints.tsx','CustomerCare.tsx','DailySettlements.tsx',
  'Expenses.tsx','Fines.tsx','RatingAppeals.tsx',
  'RefundManagement.tsx','ReviewsManagement.tsx','SOSAlerts.tsx'
];

files.forEach(file => {
  const fpath = path.join(dir, file);
  try {
    const rawBuf = fs.readFileSync(fpath);
    const mojibake = rawBuf.toString('utf8');
    const w1252Buf = iconv.encode(mojibake, 'windows-1252');
    const fixed = w1252Buf.toString('utf8');
    if (fixed !== mojibake) {
      fs.writeFileSync(fpath, fixed, 'utf8');
      console.log('Fixed: ' + file + ' (' + rawBuf.length + ' -> ' + Buffer.byteLength(fixed) + ' bytes)');
    } else {
      console.log('No change: ' + file);
    }
  } catch(e) {
    console.error('Error on ' + file + ': ' + e.message);
  }
});
console.log('Done!');
