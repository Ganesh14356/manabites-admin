/**
 * Vercel serverless function — Razorpay API proxy
 * Keeps RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET safely server-side.
 *
 * POST /api/razorpay
 * Body: { action: string, ...params }
 */

const BASE = 'https://api.razorpay.com/v1';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return res.status(500).json({
      error: 'Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel environment variables.',
    });
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  const body = req.body;
  const { action, ...params } = body;

  let url = '';
  let method = 'GET';
  let fetchBody = undefined;

  switch (action) {
    case 'list_payments': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip: String(params.skip ?? 0),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
      });
      url = `${BASE}/payments?${qs}`;
      break;
    }
    case 'get_payment':
      url = `${BASE}/payments/${params.paymentId}`;
      break;

    case 'refund_payment':
      url = `${BASE}/payments/${params.paymentId}/refund`;
      method = 'POST';
      fetchBody = JSON.stringify({ amount: params.amount, speed: 'normal', notes: params.notes ?? {} });
      break;

    case 'list_orders': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip: String(params.skip ?? 0),
      });
      url = `${BASE}/orders?${qs}`;
      break;
    }
    case 'get_order':
      url = `${BASE}/orders/${params.orderId}`;
      break;

    case 'list_payouts': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip: String(params.skip ?? 0),
        account_number: params.accountNumber ?? '',
      });
      url = `${BASE}/payouts?${qs}`;
      break;
    }
    case 'create_payout':
      url = `${BASE}/payouts`;
      method = 'POST';
      fetchBody = JSON.stringify(params.payout);
      break;

    case 'list_settlements': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip: String(params.skip ?? 0),
      });
      url = `${BASE}/settlements?${qs}`;
      break;
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  try {
    const response = await fetch(url, { method, headers, body: fetchBody });
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
}
