/**
 * Vercel serverless function — Cashfree Payouts API proxy
 * Keeps CASHFREE_CLIENT_ID + CASHFREE_CLIENT_SECRET safely server-side.
 *
 * POST /api/cashfree
 * Body: { action: string, ...params }
 *
 * Actions: add_beneficiary | get_beneficiary | transfer | transfer_status | list_transfers | get_balance
 */

const BASE = process.env.CASHFREE_BASE_URL || 'https://payout-gamma.cashfree.com';

// Token cache (warm across serverless invocations within same instance)
let _token = null;
let _tokenExpiry = 0;

async function getToken(clientId, clientSecret) {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch(`${BASE}/payout/v1/authorize`, {
    method: 'POST',
    headers: { 'X-Client-Id': clientId, 'X-Client-Secret': clientSecret, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (data.status !== 'SUCCESS') throw new Error(`Cashfree auth failed: ${data.message || JSON.stringify(data)}`);
  _token = data.data.token;
  _tokenExpiry = Date.now() + 4.5 * 60 * 1000;
  return _token;
}

async function cfPost(path, body, token) {
  const res = await fetch(`${BASE}/payout/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function cfGet(path, token) {
  const res = await fetch(`${BASE}/payout/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const CLIENT_ID     = process.env.CASHFREE_CLIENT_ID;
  const CLIENT_SECRET = process.env.CASHFREE_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Cashfree credentials not configured in Vercel env vars.' });
  }

  const { action, ...params } = req.body || {};

  try {
    const token = await getToken(CLIENT_ID, CLIENT_SECRET);

    switch (action) {

      case 'add_beneficiary': {
        const { beneId, name, email, phone, bankAccount, ifsc, address } = params;
        if (!beneId || !name || !bankAccount || !ifsc)
          return res.status(400).json({ error: 'beneId, name, bankAccount, ifsc required' });
        const data = await cfPost('/addBeneficiary', {
          beneId, name,
          email:    email || 'noreply@manabites.in',
          phone:    phone || '9999999999',
          bankAccount,
          ifsc:     ifsc.toUpperCase(),
          address1: address || 'Hyderabad, Telangana',
          city: 'Hyderabad', state: 'Telangana', pincode: '500001',
        }, token);
        return res.status(200).json(data);
      }

      case 'get_beneficiary': {
        const { beneId } = params;
        if (!beneId) return res.status(400).json({ error: 'beneId required' });
        const data = await cfGet(`/getBeneficiary/${beneId}`, token);
        return res.status(200).json(data);
      }

      case 'transfer': {
        const { transferId, amount, beneId, remarks } = params;
        if (!transferId || !amount || !beneId)
          return res.status(400).json({ error: 'transferId, amount, beneId required' });
        if (Number(amount) < 1)
          return res.status(400).json({ error: 'Minimum transfer amount is ₹1' });
        const data = await cfPost('/requestTransfer', {
          beneId, amount: String(amount), transferId,
          transferMode: 'banktransfer',
          remarks: remarks || 'ManaBites Settlement',
        }, token);
        return res.status(200).json(data);
      }

      case 'transfer_status': {
        const { transferId } = params;
        if (!transferId) return res.status(400).json({ error: 'transferId required' });
        const data = await cfGet(`/getTransferStatus?transferId=${encodeURIComponent(transferId)}`, token);
        return res.status(200).json(data);
      }

      case 'list_transfers': {
        const { maxReturn = 20, lastReturnId = '' } = params;
        const qs = new URLSearchParams({ maxReturn: String(maxReturn), ...(lastReturnId ? { lastReturnId } : {}) });
        const data = await cfGet(`/getTransfers?${qs}`, token);
        return res.status(200).json(data);
      }

      case 'get_balance': {
        const data = await cfGet('/getBalance', token);
        return res.status(200).json(data);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[cashfree]', action, err.message);
    return res.status(502).json({ error: err.message || 'Cashfree API error' });
  }
}
