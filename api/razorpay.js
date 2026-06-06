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

    // ── Bank account verification (Fund Account Validation / penny-drop) ──
    // Flow: create contact → create fund account → create validation.
    // Razorpay sends a small amount (default ₹1) FROM the platform's RazorpayX
    // account TO the bank account to confirm it is real & active, and returns
    // the bank's registered account-holder name. There is no "reversal" —
    // the amount is the verification cost, it is not debited from the vendor.
    case 'verify_bank_account': {
      const { accountNumber, ifsc, accountHolderName, restaurantId } = params;
      if (!accountNumber || !ifsc || !accountHolderName) {
        return res.status(400).json({ error: 'accountNumber, ifsc and accountHolderName are required' });
      }

      try {
        const contactRes = await fetch(`${BASE}/contacts`, {
          method: 'POST', headers,
          body: JSON.stringify({
            name: accountHolderName,
            type: 'vendor',
            reference_id: restaurantId || undefined,
          }),
        });
        const contact = await contactRes.json();
        if (!contactRes.ok) return res.status(contactRes.status).json({ error: contact.error ?? contact, step: 'create_contact' });

        const fundAccountRes = await fetch(`${BASE}/fund_accounts`, {
          method: 'POST', headers,
          body: JSON.stringify({
            contact_id: contact.id,
            account_type: 'bank_account',
            bank_account: { name: accountHolderName, ifsc, account_number: accountNumber },
          }),
        });
        const fundAccount = await fundAccountRes.json();
        if (!fundAccountRes.ok) return res.status(fundAccountRes.status).json({ error: fundAccount.error ?? fundAccount, step: 'create_fund_account' });

        const validationRes = await fetch(`${BASE}/fund_accounts/validations`, {
          method: 'POST', headers,
          body: JSON.stringify({
            fund_account: { id: fundAccount.id },
            amount: 100, // ₹1 in paise — Razorpay's minimum penny-drop amount
            currency: 'INR',
            notes: restaurantId ? { restaurantId } : undefined,
          }),
        });
        const validation = await validationRes.json();
        if (!validationRes.ok) return res.status(validationRes.status).json({ error: validation.error ?? validation, step: 'create_validation' });

        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({ contact, fundAccount, validation });
      } catch (err) {
        return res.status(502).json({ error: String(err) });
      }
    }

    case 'get_fund_account_validation':
      url = `${BASE}/fund_accounts/validations/${params.validationId}`;
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
