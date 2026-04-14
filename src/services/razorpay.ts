/**
 * Frontend service — calls the Netlify function proxy.
 * Never exposes Razorpay secret key to the browser.
 */

// Vercel serverless function — Node.js, full internet access
const ENDPOINT = '/api/razorpay';

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.description ?? data?.error ?? `Razorpay error ${res.status}`);
  }
  return data as T;
}

// ── Payment types ──────────────────────────────────────────────────────────────

export interface RazorpayPayment {
  id: string;
  entity: 'payment';
  amount: number;           // paise
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string | null;
  invoice_id: string | null;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status: string | null;
  captured: boolean;
  description: string | null;
  card_id: string | null;
  bank: string | null;
  wallet: string | null;
  vpa: string | null;
  email: string;
  contact: string;
  notes: Record<string, string>;
  fee: number | null;
  tax: number | null;
  error_code: string | null;
  error_description: string | null;
  created_at: number;        // unix ts
}

export interface RazorpayOrder {
  id: string;
  entity: 'order';
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPayout {
  id: string;
  entity: 'payout';
  fund_account_id: string;
  amount: number;
  currency: string;
  fees: number;
  tax: number;
  status: 'processing' | 'processed' | 'reversed' | 'failed' | 'cancelled' | 'queued' | 'pending';
  purpose: string;
  utr: string | null;
  mode: string;
  narration: string | null;
  created_at: number;
}

export interface RazorpayRefund {
  id: string;
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  status: 'pending' | 'processed' | 'failed';
  created_at: number;
}

export interface RazorpayCollection<T> {
  entity: 'collection';
  count: number;
  items: T[];
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const razorpay = {
  listPayments: (opts?: { count?: number; skip?: number; from?: number; to?: number }) =>
    call<RazorpayCollection<RazorpayPayment>>('list_payments', opts),

  getPayment: (paymentId: string) =>
    call<RazorpayPayment>('get_payment', { paymentId }),

  refundPayment: (paymentId: string, amount: number, notes?: Record<string, string>) =>
    call<RazorpayRefund>('refund_payment', { paymentId, amount, notes }),

  listOrders: (opts?: { count?: number; skip?: number }) =>
    call<RazorpayCollection<RazorpayOrder>>('list_orders', opts),

  listPayouts: (opts?: { count?: number; skip?: number; accountNumber?: string }) =>
    call<RazorpayCollection<RazorpayPayout>>('list_payouts', opts),

  listSettlements: (opts?: { count?: number; skip?: number }) =>
    call<{ items: unknown[]; count: number }>('list_settlements', opts),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert paise → ₹ formatted string */
export function paiseToRupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Unix timestamp → readable date */
export function rzDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
