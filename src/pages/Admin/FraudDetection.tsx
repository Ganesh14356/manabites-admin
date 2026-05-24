import { useState, useEffect } from 'react';
import { OrderId } from '../../components/OrderId';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, where, orderBy, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { AlertTriangle, ShieldAlert, Ban, CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface FlaggedOrder {
  id: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  customerPhone?: string;
  customerName?: string;
  restaurantName?: string;
  total?: number;
  paymentMode?: string;
  createdAt?: any;
  fraudStatus?: string;
  fraudNote?: string;
  status?: string;
}

const RULES = [
  { key: 'cod_high_value',       label: 'COD > ₹1500',             severity: 'high'   as const, desc: 'Cash on delivery order above ₹1500 — risk of non-payment' },
  { key: 'many_cancels',         label: 'Multiple cancellations',   severity: 'medium' as const, desc: 'Customer cancelled 3+ orders in last 30 days' },
  { key: 'new_user_bulk',        label: 'New user bulk order',      severity: 'medium' as const, desc: 'Account < 7 days placing order > ₹1000' },
  { key: 'duplicate_address',    label: 'Same COD address (3+)',    severity: 'high'   as const, desc: '3+ different accounts ordering COD to the same address' },
  { key: 'rapid_orders',         label: 'Rapid repeat orders',      severity: 'medium' as const, desc: '3+ orders within 10 minutes from same account' },
  { key: 'promo_abuse',          label: 'Promo code abuse',         severity: 'low'    as const, desc: 'Multiple promo codes used within 24 hours' },
];

function severityBadge(s: string) {
  if (s === 'high')   return 'bg-red-100 text-red-700 border-red-200';
  if (s === 'medium') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-blue-100 text-blue-600 border-blue-200';
}

function FlagCard({ order }: { order: FlaggedOrder }) {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction]     = useState<'resolve' | 'ban' | null>(null);
  const [note, setNote]         = useState('');
  const [saving, setSaving]     = useState(false);

  const handleAction = async (type: 'resolve' | 'ban') => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        fraudStatus: type === 'ban' ? 'banned' : 'cleared',
        fraudNote: note || null,
        fraudReviewedAt: Date.now(),
      });
      if (type === 'ban' && order.customerPhone) {
        await updateDoc(doc(db, 'users', order.customerPhone), {
          isBanned: true,
          banReason: note || 'Fraud detection',
          bannedAt: Date.now(),
        }).catch(() => {});
      }
      toast.success(type === 'ban' ? 'User banned and order flagged' : 'Flag cleared — order marked safe');
      setAction(null);
      setExpanded(false);
    } catch {
      toast.error('Action failed');
    } finally {
      setSaving(false);
    }
  };

  const date = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Unknown time';

  const isResolved = order.fraudStatus === 'cleared' || order.fraudStatus === 'banned';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
        isResolved ? 'border-gray-200 opacity-60' : 'border-red-100'
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              order.severity === 'high' ? 'bg-red-100' : order.severity === 'medium' ? 'bg-yellow-100' : 'bg-blue-100'
            }`}>
              <ShieldAlert size={18} className={
                order.severity === 'high' ? 'text-red-600' : order.severity === 'medium' ? 'text-yellow-600' : 'text-blue-500'
              } />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-900 text-sm">
                  {order.customerName || 'Unknown Customer'}
                </span>
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${severityBadge(order.severity)}`}>
                  {order.severity}
                </span>
                {isResolved && (
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    {order.fraudStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-red-600 font-semibold mt-0.5">{order.reason}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                <span>Order <OrderId id={order.id} /></span>
                <span>₹{order.total ?? '—'}</span>
                <span className="uppercase">{order.paymentMode ?? '—'}</span>
                <span>{date}</span>
              </div>
            </div>
          </div>

          {!isResolved && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && !isResolved && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-100 bg-gray-50 overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                <span className="font-semibold">Restaurant:</span> {order.restaurantName ?? '—'}
              </p>

              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Add an internal note (optional)…"
                className="w-full border border-gray-200 rounded-xl p-3 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand/30 bg-white"
              />

              {action === null ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setAction('resolve')}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-50 text-green-700 border border-green-200 text-xs font-bold py-2.5 rounded-xl hover:bg-green-100 transition-colors"
                  >
                    <CheckCircle2 size={13} /> Mark Safe
                  </button>
                  <button
                    onClick={() => setAction('ban')}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 text-red-700 border border-red-200 text-xs font-bold py-2.5 rounded-xl hover:bg-red-100 transition-colors"
                  >
                    <Ban size={13} /> Ban User
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(action)}
                    disabled={saving}
                    className={`flex-1 text-white text-xs font-bold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                      action === 'ban' ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand/90'
                    }`}
                  >
                    {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {action === 'ban' ? 'Confirm Ban' : 'Confirm Safe'}
                  </button>
                  <button
                    onClick={() => setAction(null)}
                    className="px-4 bg-gray-100 text-gray-600 text-xs font-bold rounded-xl"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FraudDetection() {
  const [orders, setOrders]         = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    // Load recent orders to evaluate fraud rules
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      // Apply fraud rules client-side
      const flagged: FlaggedOrder[] = [];

      // Track: phone → orders[]
      const byPhone: Record<string, any[]> = {};
      const byAddress: Record<string, any[]> = {};

      for (const o of all) {
        const phone = String(o.customerPhone || o.phone || '');
        const addr  = String(o.customerAddress || o.address || '').toLowerCase().trim();
        if (phone) (byPhone[phone] = byPhone[phone] || []).push(o);
        if (addr && o.paymentMode === 'cod') (byAddress[addr] = byAddress[addr] || []).push(o);
      }

      for (const o of all) {
        const phone = String(o.customerPhone || o.phone || '');
        const addr  = String(o.customerAddress || o.address || '').toLowerCase().trim();
        const total = Number(o.total || o.orderAmount || 0);
        const createdMs = o.createdAt?.toMillis?.() ?? (typeof o.createdAt === 'number' ? o.createdAt : 0);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const tenMinAgo    = Date.now() - 10 * 60 * 1000;

        let reason = '';
        let severity: FlaggedOrder['severity'] = 'low';

        if (o.paymentMode === 'cod' && total > 1500) {
          reason = `COD order ₹${total} exceeds ₹1500 threshold`;
          severity = 'high';
        } else if (phone && byPhone[phone]) {
          const recentOrders = byPhone[phone].filter(r =>
            (r.createdAt?.toMillis?.() ?? r.createdAt ?? 0) > tenMinAgo
          );
          if (recentOrders.length >= 3) {
            reason = `${recentOrders.length} orders placed in under 10 minutes`;
            severity = 'medium';
          }
        }

        if (!reason && addr && o.paymentMode === 'cod') {
          const sameAddr = byAddress[addr] || [];
          const uniquePhones = new Set(sameAddr.map(r => r.customerPhone || r.phone));
          if (uniquePhones.size >= 3) {
            reason = `${uniquePhones.size} different accounts sent COD to same address`;
            severity = 'high';
          }
        }

        if (!reason && createdMs > sevenDaysAgo && total > 1000) {
          // New user check: no way to know from order alone, flag for review
          reason = `Large order (₹${total}) — new user flag for manual review`;
          severity = 'medium';
        }

        if (reason) {
          flagged.push({
            id: o.id,
            reason,
            severity,
            customerName: o.customerName,
            customerPhone: phone,
            restaurantName: o.restaurantName,
            total,
            paymentMode: o.paymentMode,
            createdAt: o.createdAt,
            fraudStatus: o.fraudStatus,
            fraudNote: o.fraudNote,
            status: o.status,
          });
        }
      }

      setOrders(flagged);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const active   = orders.filter(o => !o.fraudStatus || o.fraudStatus === 'pending');
  const resolved = orders.filter(o => o.fraudStatus === 'cleared' || o.fraudStatus === 'banned');

  const displayed = (showResolved ? orders : active).filter(o =>
    severityFilter === 'all' || o.severity === severityFilter
  );

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Fraud Detection</h1>
          <p className="text-sm text-gray-400 mt-0.5">Real-time order risk analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResolved(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={13} />
            {showResolved ? 'Hide Resolved' : 'Show Resolved'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Flagged',  value: orders.length, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-100 dark:border-red-800' },
          { label: 'High Risk',      value: orders.filter(o => o.severity === 'high').length,   color: 'text-red-600',   bg: 'bg-white dark:bg-gray-900', border: 'border-gray-100 dark:border-gray-800' },
          { label: 'Medium Risk',    value: orders.filter(o => o.severity === 'medium').length, color: 'text-yellow-600', bg: 'bg-white dark:bg-gray-900', border: 'border-gray-100 dark:border-gray-800' },
          { label: 'Resolved',       value: resolved.length, color: 'text-green-600', bg: 'bg-white dark:bg-gray-900', border: 'border-gray-100 dark:border-gray-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border ${s.bg} ${s.border} p-4`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Active rules */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-yellow-500" /> Detection Rules Active
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {RULES.map(r => (
            <div key={r.key} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                r.severity === 'high' ? 'bg-red-500' : r.severity === 'medium' ? 'bg-yellow-400' : 'bg-blue-400'
              }`} />
              {r.label}
            </div>
          ))}
        </div>
      </div>

      {/* Severity filter */}
      <div className="flex gap-2">
        {(['all', 'high', 'medium', 'low'] as const).map(v => (
          <button
            key={v}
            onClick={() => setSeverityFilter(v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors capitalize ${
              severityFilter === v
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Flagged orders */}
      {loading ? (
        <div className="space-y-3">
          {[0,1,2].map(i => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl h-24 animate-pulse border border-gray-100 dark:border-gray-800" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
          <div className="text-5xl mb-3">🛡️</div>
          <h3 className="text-lg font-black text-gray-800 dark:text-gray-200">No {showResolved ? '' : 'active '}flags</h3>
          <p className="text-sm text-gray-400 mt-1">All orders look clean under current detection rules</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {displayed.map(o => <FlagCard key={o.id} order={o} />)}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
