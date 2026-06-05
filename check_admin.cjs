const WebSocket = require('../manabites/node_modules/ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/1614');
const errors = [];

ws.on('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
  setTimeout(() => ws.close(), 5000);
});

ws.on('message', data => {
  const msg = JSON.parse(data);
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params?.exceptionDetails?.exception?.description || '').slice(0, 300));
  }
  if (msg.method === 'Console.messageAdded') {
    const m = msg.params?.message;
    if (m?.level === 'error') errors.push('ERROR: ' + m.text.slice(0, 300));
  }
});

ws.on('close', () => {
  console.log('=== CONSOLE ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(e));
  process.exit(0);
});
ws.on('error', e => { console.log('WS ERR:', e.message); process.exit(1); });
