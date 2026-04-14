/**
 * Netlify Edge Function — Razorpay API proxy (FREE tier)
 * Runs on Deno at the edge — no Node.js required, no paid plan needed.
 *
 * POST /api/razorpay
 */

const BASE = 'https://api.razorpay.com/v1';

export default async function handler(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  const KEY_ID     = Netlify.env.get('RAZORPAY_KEY_ID');
  const KEY_SECRET = Netlify.env.get('RAZORPAY_KEY_SECRET');

  if (!KEY_ID || !KEY_SECRET) {
    return json({
      error: 'Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Netlify environment variables.',
    }, 500);
  }

  // btoa works in Deno / edge runtime (no Buffer needed)
  const auth = btoa(`${KEY_ID}:${KEY_SECRET}`);
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, ...params } = body;

  let url = '';
  let method = 'GET';
  let fetchBody = undefined;

  switch (action) {
    case 'list_payments': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 100),
        skip:  String(params.skip  ?? 0),
        ...(params.from ? { from: String(params.from) } : {}),
        ...(params.to   ? { to:   String(params.to)   } : {}),
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
        skip:  String(params.skip  ?? 0),
      });
      url = `${BASE}/orders?${qs}`;
      break;
    }
    case 'get_order':
      url = `${BASE}/orders/${params.orderId}`;
      break;

    case 'list_payouts': {
      const qs = new URLSearchParams({
        count:          String(params.count ?? 50),
        skip:           String(params.skip  ?? 0),
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
        skip:  String(params.skip  ?? 0),
      });
      url = `${BASE}/settlements?${qs}`;
      break;
    }

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }

  try {
    const res = await fetch(url, { method, headers, body: fetchBody });
    const data = await res.json();
    return json(data, res.status);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const config = { path: '/api/razorpay' };
