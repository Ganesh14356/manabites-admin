/**
 * POST /api/masked-call  (admin version — customer care calls)
 * All calls from admin/customer-care are MASKED via MSG91 click-to-call.
 * MSG91 calls the agent first; when answered, bridges to the customer.
 *
 * Body: { agentNumber, customerNumber, orderId?, callType? }
 */

const normalise = (n) =>
  String(n).replace(/\D/g, '').replace(/^0+/, '').replace(/^(\d{10})$/, '91$1');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { agentNumber, customerNumber, orderId, callType = 'customer_care' } = body;

  if (!agentNumber || !customerNumber) {
    return res.status(400).json({ error: 'agentNumber and customerNumber are required' });
  }

  const agent    = normalise(agentNumber);
  const customer = normalise(customerNumber);
  const authKey  = process.env.MSG91_AUTH_KEY;

  if (!authKey) {
    return res.status(200).json({ success: true, fallback: true, targetNumber: customer });
  }

  try {
    const response = await fetch('https://api.msg91.com/api/v5/call/click2call', {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_number:    agent,
        customer_number: customer,
        extra_params:    { call_type: callType, ...(orderId ? { order_id: orderId } : {}) },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `MSG91 ${response.status}`);

    return res.status(200).json({ success: true, masked: true, callId: data.request_id || data.id || null });
  } catch (err) {
    console.error('[masked-call admin]', err.message);
    return res.status(200).json({ success: true, fallback: true, targetNumber: customer });
  }
}
