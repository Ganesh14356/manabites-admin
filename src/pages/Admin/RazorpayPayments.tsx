import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CreditCard, TrendingUp, AlertCircle, CheckCircle, RefreshCw,
  Search, X, ChevronLeft, ChevronRight, ExternalLink, Download,
  IndianRupee, ArrowUpRight, ArrowDownRight, Clock, RotateCcw,
  Smartphone, Landmark, Wallet, ShieldCheck,
} from 'lucide-react';
import { razorpay, type RazorpayPayment, paiseToRupees, rzDate } from '../../services/razorpay';

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  captured:   'bg-green-100 text-green-700',
  authorized: 'bg-blue-100 text-blue-700',
  created:    'bg-gray-100 text-gray-600',
  refunded:   'bg-purple-100 text-purple-700',
  failed:     'bg-red-100 text-red-700',
};

const METHOD_ICONS: Record<string, JSX.Element> = {
  upi:       <Smartphone className="w-3.5 h-3.5" />,
  netbanking:<Landmark className="w-3.5 h-3.5" />,
  wallet:    <Wallet className="w-3.5 h-3.5" />,
  card:      <CreditCard className="w-3.5 h-3.5" />,
  emi:       <CreditCard className="w-3.5 h-3.5" />,
};

function MethodBadge({ method }: { method: string }) {
  const icon = METHOD_ICONS[method] ?? <CreditCard className="w-3.5 h-3.5" />;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full capitalize">
      {icon} {method}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status === 'captured'   && <CheckCircle className="w-3 h-3" />}
      {status === 'failed'     && <AlertCircle className="w-3 h-3" />}
      {status === 'refunded'   && <RotateCcw className="w-3 h-3" />}
      {status === 'authorized' && <ShieldCheck className="w-3 h-3" />}
      {status === 'created'    && <Clock className="w-3 h-3" />}
      {status}
    </span>
  );
}

// ── CSV helper ─────────────────────────────────────────────────────────────────

function downloadCSV(payments: RazorpayPayment[]) {
  const rows: (string | number)[][] = [
    ['Payment ID', 'Order ID', 'Amount (₹)', 'Status', 'Method', 'Email', 'Contact', 'Date', 'Fee (₹)', 'Description'],
    ...payments.map(p => [
      p.id,
      p.order_id ?? '',
      (p.amount / 100).toFixed(2),
      p.status,
      p.method,
      p.email,
      p.contact,
      rzDate(p.created_at),
      p.fee ? (p.fee / 100).toFixed(2) : '',
      p.description ?? '',
    ]),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `razorpay-payments-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Payment Detail Modal ───────────────────────────────────────────────────────

function PaymentModal({ payment, onClose, onRefund }: {
  payment: RazorpayPayment;
  onClose: () => void;
  onRefund: (p: RazorpayPayment) => void;
}) {
  const rows = [
    { label: 'Payment ID',   value: payment.id },
    { label: 'Order ID',     value: payment.order_id ?? '—' },
    { label: 'Amount',       value: paiseToRupees(payment.amount) },
    { label: 'Fee',          value: payment.fee ? paiseToRupees(payment.fee) : '—' },
    { label: 'Tax',          value: payment.tax ? paiseToRupees(payment.tax) : '—' },
    { label: 'Net',          value: payment.fee ? paiseToRupees(payment.amount - payment.fee) : '—' },
    { label: 'Method',       value: payment.method },
    { label: 'Bank / VPA',   value: payment.bank ?? payment.vpa ?? payment.wallet ?? '—' },
    { label: 'Email',        value: payment.email },
    { label: 'Contact',      value: payment.contact },
    { label: 'Description',  value: payment.description ?? '—' },
    { label: 'Created',      value: rzDate(payment.created_at) },
    ...(payment.error_code ? [
      { label: 'Error Code',  value: payment.error_code },
      { label: 'Error',       value: payment.error_description ?? '' },
    ] : []),
  ];

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-lg mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-black text-gray-800">Payment Details</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{payment.id}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status banner */}
        <div className={`px-6 py-3 flex items-center gap-3 ${payment.status === 'captured' ? 'bg-green-50' : payment.status === 'failed' ? 'bg-red-50' : 'bg-gray-50'}`}>
          <StatusBadge status={payment.status} />
          <span className="text-xl font-black text-gray-800">{paiseToRupees(payment.amount)}</span>
          <MethodBadge method={payment.method} />
        </div>

        {/* Details */}
        <div className="px-6 py-4 max-h-80 overflow-y-auto space-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-start justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-gray-400 font-medium w-32 flex-shrink-0">{r.label}</span>
              <span className="text-gray-800 font-semibold text-right break-all">{r.value}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          {payment.status === 'captured' && payment.amount_refunded < payment.amount && (
            <button
              onClick={() => { onRefund(payment); onClose(); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Refund
            </button>
          )}
          <a
            href={`https://dashboard.razorpay.com/app/payments/${payment.id}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-bold rounded-xl hover:bg-gray-200 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Razorpay Dashboard
          </a>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm font-bold rounded-xl hover:bg-gray-200">
            Close
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ── Refund Modal ───────────────────────────────────────────────────────────────

function RefundModal({ payment, onClose, onSuccess }: {
  payment: RazorpayPayment;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const maxRefund = (payment.amount - payment.amount_refunded) / 100;
  const [amount, setAmount] = useState(String(maxRefund));
  const [processing, setProcessing] = useState(false);

  const handleRefund = async () => {
    const paise = Math.round(parseFloat(amount) * 100);
    if (!paise || paise <= 0 || paise > payment.amount - payment.amount_refunded) {
      toast.error('Invalid refund amount');
      return;
    }
    setProcessing(true);
    try {
      await razorpay.refundPayment(payment.id, paise);
      toast.success(`Refund of ₹${amount} initiated`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[60] max-w-sm mx-auto bg-white rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-black text-gray-800">Initiate Refund</h2>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="bg-purple-50 rounded-xl p-4 mb-5">
          <p className="text-xs font-bold text-purple-600 uppercase tracking-wider">Payment</p>
          <p className="font-mono text-sm text-gray-700 mt-0.5">{payment.id}</p>
          <p className="text-lg font-black text-gray-800 mt-1">{paiseToRupees(payment.amount)}</p>
          {payment.amount_refunded > 0 && (
            <p className="text-xs text-purple-600 mt-0.5">Already refunded: {paiseToRupees(payment.amount_refunded)}</p>
          )}
        </div>

        <div className="mb-5">
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Refund Amount (₹) — Max ₹{maxRefund.toFixed(2)}
          </label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            max={maxRefund}
            min={0.01}
            step={0.01}
            className="input-field"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">Cancel</button>
          <button
            onClick={handleRefund}
            disabled={processing}
            className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:opacity-60"
          >
            {processing ? 'Processing...' : 'Confirm Refund'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function RazorpayPayments() {
  const [payments, setPayments] = useState<RazorpayPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<RazorpayPayment | null>(null);
  const [refunding, setRefunding] = useState<RazorpayPayment | null>(null);

  const fetchPayments = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await razorpay.listPayments({ count: 100 });
      setPayments(data.items ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load payments';
      setError(msg);
      if (msg.includes('not configured')) {
        // Show helpful env var message
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchPayments(); }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const captured  = payments.filter(p => p.status === 'captured');
    const failed    = payments.filter(p => p.status === 'failed');
    const refunded  = payments.filter(p => p.status === 'refunded');
    return {
      totalCollected: captured.reduce((s, p) => s + p.amount, 0),
      totalFees:      captured.reduce((s, p) => s + (p.fee ?? 0), 0),
      capturedCount:  captured.length,
      failedCount:    failed.length,
      refundedAmount: refunded.reduce((s, p) => s + p.amount, 0),
      refundedCount:  refunded.length,
    };
  }, [payments]);

  // ── Filters ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payments.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (methodFilter !== 'all' && p.method !== methodFilter) return false;
      if (q && !p.id.toLowerCase().includes(q) && !p.email.toLowerCase().includes(q) && !(p.order_id ?? '').toLowerCase().includes(q) && !p.contact.includes(q)) return false;
      return true;
    });
  }, [payments, search, statusFilter, methodFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const methods = useMemo(() => [...new Set(payments.map(p => p.method))], [payments]);

  // ── Setup required state ───────────────────────────────────────────────────

  const needsSetup = error?.includes('not configured');

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <span className="w-8 h-8 bg-[#3395FF] rounded-xl flex items-center justify-center">
              <IndianRupee className="w-4 h-4 text-white" />
            </span>
            Razorpay Payments
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Live payment transactions from Razorpay</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => downloadCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => fetchPayments(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#3395FF] text-white text-sm font-bold rounded-xl hover:bg-blue-600 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Setup notice */}
      {needsSetup && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-800">Razorpay API credentials not configured</p>
              <p className="text-sm text-amber-700 mt-1">
                Add the following environment variables in your <strong>Netlify site settings → Environment variables</strong>:
              </p>
              <div className="mt-3 bg-white rounded-xl border border-amber-200 p-3 font-mono text-xs text-gray-700 space-y-1">
                <p><span className="text-amber-700">RAZORPAY_KEY_ID</span>=rzp_live_xxxxxxxxxxxx</p>
                <p><span className="text-amber-700">RAZORPAY_KEY_SECRET</span>=your_secret_key_here</p>
              </div>
              <p className="text-xs text-amber-600 mt-2">
                Find your keys at: <a href="https://dashboard.razorpay.com/app/keys" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Razorpay Dashboard → Settings → API Keys</a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {!needsSetup && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Total Collected',
              value: paiseToRupees(stats.totalCollected),
              sub: `${stats.capturedCount} payments`,
              icon: ArrowUpRight,
              color: 'border-green-500',
              iconBg: 'bg-green-50',
              iconColor: 'text-green-600',
            },
            {
              label: 'Razorpay Fees',
              value: paiseToRupees(stats.totalFees),
              sub: stats.totalCollected > 0 ? `${((stats.totalFees / stats.totalCollected) * 100).toFixed(2)}% of collected` : '',
              icon: TrendingUp,
              color: 'border-blue-400',
              iconBg: 'bg-blue-50',
              iconColor: 'text-blue-600',
            },
            {
              label: 'Failed Payments',
              value: String(stats.failedCount),
              sub: 'attempts',
              icon: ArrowDownRight,
              color: 'border-red-400',
              iconBg: 'bg-red-50',
              iconColor: 'text-red-500',
            },
            {
              label: 'Refunded',
              value: paiseToRupees(stats.refundedAmount),
              sub: `${stats.refundedCount} refunds`,
              icon: RotateCcw,
              color: 'border-purple-400',
              iconBg: 'bg-purple-50',
              iconColor: 'text-purple-600',
            },
          ].map(s => (
            <div key={s.label} className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.color}`}>
              <div className={`w-9 h-9 ${s.iconBg} rounded-xl flex items-center justify-center mb-3`}>
                <s.icon className={`w-5 h-5 ${s.iconColor}`} />
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-black text-gray-800 mt-0.5">{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search payment ID, email, order..."
            className="input-field pl-9 text-sm"
          />
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['all', 'captured', 'failed', 'refunded', 'authorized'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${statusFilter === s ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
        {methods.length > 1 && (
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={() => { setMethodFilter('all'); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${methodFilter === 'all' ? 'bg-white shadow text-brand' : 'text-gray-500'}`}>All</button>
            {methods.map(m => (
              <button key={m} onClick={() => { setMethodFilter(m); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${methodFilter === m ? 'bg-white shadow text-brand' : 'text-gray-500'}`}>{m}</button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-card py-20 flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-[#3395FF] animate-spin" />
          <p className="text-gray-400 font-semibold">Loading payments from Razorpay...</p>
        </div>
      ) : error && !needsSetup ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-bold text-red-700">Failed to load payments</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
            <button onClick={() => fetchPayments()} className="mt-3 text-sm font-bold text-red-700 underline">Retry</button>
          </div>
        </div>
      ) : !needsSetup && (
        <>
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">Payment ID</th>
                    <th className="table-header">Amount</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Method</th>
                    <th className="table-header">Customer</th>
                    <th className="table-header">Order ID</th>
                    <th className="table-header">Date</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {paginated.map(p => (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setSelected(p)}
                      >
                        <td className="table-cell">
                          <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{p.id.slice(0, 14)}…</span>
                        </td>
                        <td className="table-cell font-black text-gray-800">
                          {paiseToRupees(p.amount)}
                          {p.amount_refunded > 0 && (
                            <span className="block text-[10px] text-purple-500 font-semibold">-{paiseToRupees(p.amount_refunded)} refunded</span>
                          )}
                        </td>
                        <td className="table-cell"><StatusBadge status={p.status} /></td>
                        <td className="table-cell"><MethodBadge method={p.method} /></td>
                        <td className="table-cell">
                          <p className="font-semibold text-gray-700 text-xs">{p.email}</p>
                          <p className="text-gray-400 text-[11px]">{p.contact}</p>
                        </td>
                        <td className="table-cell">
                          {p.order_id
                            ? <span className="font-mono text-xs text-gray-500">{p.order_id.slice(0, 14)}…</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="table-cell text-xs text-gray-400">{rzDate(p.created_at)}</td>
                        <td className="table-cell" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setSelected(p)}
                              className="px-2.5 py-1.5 text-xs font-bold bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                            >View</button>
                            {p.status === 'captured' && p.amount_refunded < p.amount && (
                              <button
                                onClick={() => setRefunding(p)}
                                className="px-2.5 py-1.5 text-xs font-bold bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"
                              >Refund</button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>

              {paginated.length === 0 && (
                <div className="py-16 text-center text-gray-400">
                  <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-semibold">No payments found</p>
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-400 font-semibold">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-8 h-8 rounded-lg bg-white shadow-card flex items-center justify-center disabled:opacity-30 hover:bg-gray-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pg = page <= 3 ? i + 1 : page - 2 + i;
                  if (pg < 1 || pg > totalPages) return null;
                  return (
                    <button
                      key={pg}
                      onClick={() => setPage(pg)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${pg === page ? 'bg-brand text-white shadow' : 'bg-white shadow-card text-gray-600 hover:bg-gray-50'}`}
                    >
                      {pg}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-8 h-8 rounded-lg bg-white shadow-card flex items-center justify-center disabled:opacity-30 hover:bg-gray-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <AnimatePresence>
        {selected && (
          <PaymentModal
            payment={selected}
            onClose={() => setSelected(null)}
            onRefund={p => { setSelected(null); setRefunding(p); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {refunding && (
          <RefundModal
            payment={refunding}
            onClose={() => setRefunding(null)}
            onSuccess={() => fetchPayments(true)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
