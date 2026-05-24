'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

// ── Razorpay client factory ──────────────────────────────────────
function createRazorpayClient() {
  const Razorpay = require('razorpay');
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// ── POST /api/refund-payment ─────────────────────────────────────
// Body: { razorpayPaymentId: string, amount?: number (in ₹) }
app.post('/api/refund-payment', async (req, res) => {
  try {
    const { razorpayPaymentId, amount } = req.body || {};
    if (!razorpayPaymentId) {
      return res.status(400).json({ success: false, error: 'razorpayPaymentId is required' });
    }

    const client = createRazorpayClient();
    const opts = { speed: 'normal' };

    if (amount) {
      opts.amount = Math.round(Number(amount) * 100); // convert ₹ → paise
    }

    const refund = await client.payments.refund(razorpayPaymentId, opts);

    return res.json({
      success: true,
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100, // paise → ₹
    });
  } catch (err) {
    console.error('[Refund Error]', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Refund failed' });
  }
});

// ── GET /api/health ──────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ── Vite dev middleware OR static build serving ──────────────────
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    // Dynamically import Vite (ESM) from CJS using dynamic import
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(__dirname, 'dist');
    app.use(express.static(dist));
    app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.listen(port, () => {
    console.log(`\n  Admin Panel → http://localhost:${port}`);
    console.log(`  Razorpay refund API ready\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
