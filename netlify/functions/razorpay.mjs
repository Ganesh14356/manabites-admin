/**
 * Netlify serverless function — Razorpay API proxy
 * Keeps RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET safely server-side.
 *
 * POST /.netlify/functions/razorpay
 * Body: { action: string, ...params }
 *
 * Actions:
 *  list_payments   – { count, skip, from, to }
 *  get_payment     – { paymentId }
 *  refund_payment  – { paymentId, amount (paise) }
 *  list_orders     – { count, skip }
 *  get_order       – { orderId }
 *  list_payouts    – { count, skip }
 *  create_payout   – { payout: RazorpayXPayoutPayload }
 *  list_settlements– { count, skip }
 */

const BASE = 'https://api.razorpay.com/v1';

export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Netlify environment variables.' }),
    };
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { action, ...params } = body;

  let url = '';
  let method = 'GET';
  let fetchBody = undefined;

  switch (action) {
    // ── Payments ───────────────────────────────────────────────────────────────
    case 'list_payments': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip:  String(params.skip  ?? 0),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to   ? { to:   params.to   } : {}),
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

    // ── Orders ─────────────────────────────────────────────────────────────────
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

    // ── Payouts (Razorpay X) ───────────────────────────────────────────────────
    case 'list_payouts': {
      const qs = new URLSearchParams({
        count:       String(params.count ?? 50),
        skip:        String(params.skip  ?? 0),
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

    // ── Settlements ────────────────────────────────────────────────────────────
    case 'list_settlements': {
      const qs = new URLSearchParams({
        count: String(params.count ?? 50),
        skip:  String(params.skip  ?? 0),
      });
      url = `${BASE}/settlements?${qs}`;
      break;
    }

    default:
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
  }

  try {
    const res = await fetch(url, { method, headers, body: fetchBody });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err) }) };
  }
};
