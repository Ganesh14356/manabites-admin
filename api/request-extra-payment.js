/**
 * POST /api/request-extra-payment
 * Creates a Razorpay Payment Link for extra amount due after admin edits order items.
 * Body: { orderId, amount (rupees), customerName, customerPhone, customerEmail? }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY_ID     = process.env.RAZORPAY_KEY_ID;
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ error: 'Razorpay credentials not configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { orderId, amount, customerName, customerPhone, customerEmail } = body;

  if (!orderId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'orderId and amount (>0) are required' });
  }

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');

  const payload = JSON.stringify({
    amount:      Math.round(Number(amount) * 100), // paise
    currency:    'INR',
    accept_partial: false,
    description: `Extra payment for order #${String(orderId).slice(-6).toUpperCase()} — items updated by admin`,
    customer: {
      name:  customerName  || 'Customer',
      contact: customerPhone ? String(customerPhone).replace(/\D/g, '').replace(/^91/, '') : undefined,
      email:   customerEmail || undefined,
    },
    notify:  { sms: !!customerPhone, email: !!customerEmail },
    reminder_enable: true,
    notes:   { orderId },
    callback_url:    '',
    callback_method: 'get',
  });

  try {
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.description || `Razorpay ${response.status}`);
    }

    return res.status(200).json({
      success:     true,
      paymentLink: data.short_url,
      linkId:      data.id,
    });
  } catch (err) {
    console.error('[request-extra-payment]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
