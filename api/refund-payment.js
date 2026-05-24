/**
 * POST /api/refund-payment
 * Body: { razorpayPaymentId: string, amount: number (rupees) }
 * Returns: { success: true, refundId: string, status: string }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const KEY_ID     = process.env.RAZORPAY_KEY_ID;
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ success: false, error: 'Razorpay credentials not configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { razorpayPaymentId, amount } = body;

  if (!razorpayPaymentId) {
    return res.status(400).json({ success: false, error: 'razorpayPaymentId is required' });
  }

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const payload = JSON.stringify({
    speed: 'normal',
    ...(amount ? { amount: Math.round(Number(amount) * 100) } : {}),
  });

  try {
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        body: payload,
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.description || data?.error || `Razorpay error ${response.status}`;
      return res.status(response.status).json({ success: false, error: msg });
    }

    return res.status(200).json({
      success:  true,
      refundId: data.id,
      status:   data.status,
    });
  } catch (err) {
    return res.status(502).json({ success: false, error: String(err?.message ?? err) });
  }
}
