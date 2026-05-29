import { useState, useEffect, useMemo } from 'react';
import { OrderId } from '../../components/OrderId';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, where, doc, updateDoc,
  addDoc, serverTimestamp, orderBy, writeBatch, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { RefreshCw, CheckCircle, Clock, Search, X, AlertTriangle, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

interface OrderDoc {
  id: string;
  customerName?: string;
  customerId: string;
  restaurantName: string;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  status: string;
  refundStatus?: 'pending' | 'issued' | 'rejected' | 'wallet_credited';
  refundAmount?: number;
  refundNote?: string;
  refundMethod?: 'wallet' | 'original';
  razorpayRefundId?: string;
  cancellationFee?: number;
  cancelledBy?: string;
  refundAt?: any;
  createdAt: any;
  items: any[];
  deliveryAddress: any;
}

interface FraudFlag {
  orderId: string;
  riderId?: string;
  riderName?: string;
  reason: string;
}

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function RefundManagement() {
  const [orders, setOrders]           = useState<OrderDoc[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filter, setFilter]           = useState<'all' | 'pending' | 'issued' | 'rejected'>('pending');
  const [selected, setSelected]       = useState<OrderDoc | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundNote, setRefundNote]   = useState('');
  const [saving, setSaving]           = useState(false);
  const [suspendingRider, setSuspendingRider] = useState<string | null>(null);

  // Fetch cancelled orders that were paid via Razorpay (need refund)
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'cancelled'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as OrderDoc));
      // Only paid orders need refunds
      setOrders(docs.filter(o => o.paymentStatus === 'paid' || o.paymentMethod === 'razorpay'));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter !== 'all') {
      if (filter === 'issued') {
        list = list.filter(o => o.refundStatus === 'issued' || o.refundStatus === 'wallet_credited');
      } else {
        list = list.filter(o => (o.refundStatus ?? 'pending') === filter);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.restaurantName?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.razorpayPaymentId?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, filter, search]);

  // Compute auto-refund preview using the same stage rules as api/auto-refund.js
  const computeRefundPreview = (order: OrderDoc) => {
    const STAGE_RULES = [
      { statuses: ['pending', 'placed'],                                            pct: 100, label: 'Full Refund (before accept)' },
      { statuses: ['accepted'],                                                     pct: 90,  label: '90% Refund (10% deduction)' },
      { statuses: ['preparing', 'ready', 'packed'],                                 pct: 60,  label: '60% Refund (40% deduction)' },
      { statuses: ['picked_up', 'out_for_delivery', 'on_the_way', 'rider_assigned'],pct: 50,  label: '50% Refund (50% deduction)' },
      { statuses: ['delivered'],                                                     pct: 0,   label: 'No Refund (delivered)' },
    ];
    const stage = ((order as any).statusBeforeCancel || order.status || '').toLowerCase();
    const rule  = STAGE_RULES.find(r => r.statuses.includes(stage)) || STAGE_RULES[0];
    const total = order.totalAmount || 0;
    return {
      pct:       rule.pct,
      label:     rule.label,
      amount:    Math.round(total * rule.pct) / 100,
      deduction: Math.round(total * (100 - rule.pct)) / 100,
      stage,
    };
  };

  const openModal = (order: OrderDoc) => {
    setSelected(order);
    // Pre-fill with auto-calculated amount if not already set
    if (order.refundAmount) {
      setRefundAmount(String(order.refundAmount));
    } else {
      const preview = computeRefundPreview(order);
      setRefundAmount(String(preview.amount));
    }
    setRefundNote(order.refundNote ?? '');
  };

  const issueRefund = async () => {
    if (!selected) return;
    const amt = parseFloat(refundAmount);
    if (isNaN(amt) || amt <= 0) { toast.error('Enter a valid refund amount'); return; }
    setSaving(true);
    try {
      let razorpayRefundId: string | null = null;

      // Trigger real Razorpay refund for original-payment orders
      if (selected.refundMethod === 'original' && selected.razorpayPaymentId) {
        const res = await fetch('/api/refund-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ razorpayPaymentId: selected.razorpayPaymentId, amount: amt }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Razorpay refund API call failed');
        }
        razorpayRefundId = data.refundId;
        toast.success(`Razorpay refund initiated (${data.refundId})`);
      }

      await updateDoc(doc(db, 'orders', selected.id), {
        refundStatus: 'issued',
        refundAmount: amt,
        refundNote: refundNote.trim() || null,
        ...(razorpayRefundId ? { razorpayRefundId } : {}),
        refundAt: serverTimestamp(),
      });

      const isOriginal = selected.refundMethod === 'original';
      await addDoc(collection(db, 'notifications'), {
        userId:    selected.customerId,
        title:    '💰 Refund Issued',
        message:  isOriginal
          ? `₹${amt} refund for order #${selected.id.slice(-6).toUpperCase()} has been processed. It will reflect in 5–7 business days to your original payment method.`
          : `₹${amt} refund for order #${selected.id.slice(-6).toUpperCase()} has been credited to your ManaBites Wallet.`,
        type:     'refund',
        isRead:    false,
        orderId:   selected.id,
        createdAt: serverTimestamp(),
      });

      toast.success(`Refund of ₹${amt} issued successfully`);
      setSelected(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to process refund');
    } finally {
      setSaving(false);
    }
  };

  const rejectRefund = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'orders', selected.id), {
        refundStatus: 'rejected',
        refundNote: refundNote.trim() || 'Refund not applicable',
        refundAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'notifications'), {
        userId:    selected.customerId,
        title:    '❌ Refund Request Rejected',
        message:  `Your refund request for order #${selected.id.slice(-6).toUpperCase()} could not be processed. ${refundNote || 'Contact support for details.'}`,
        type:     'refund',
        isRead:    false,
        orderId:   selected.id,
        createdAt: serverTimestamp(),
      });
      toast.success('Refund rejected and customer notified');
      setSelected(null);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSuspendRider = async (order: OrderDoc, reason: string) => {
    if (!(order as any).riderId) { toast.error('No rider linked to this order'); return; }
    setSuspendingRider((order as any).riderId);
    try {
      // Find rider doc by riderId (may be a phone number or uid)
      await updateDoc(doc(db, 'riders', (order as any).riderId), {
        isSuspended: true,
        suspendedReason: reason,
        approvalStatus: 'under_review',
        suspendedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => Promise.resolve()); // rider doc may be keyed by phone
      toast.success(`Rider temporarily suspended and moved to review queue`);
    } catch (err: any) {
      toast.error('Failed to suspend rider: ' + err.message);
    } finally {
      setSuspendingRider(null);
    }
  };

  const FILTER_TABS: { id: typeof filter; label: string; color: string }[] = [
    { id: 'pending',  label: 'Pending',  color: 'text-yellow-600 bg-yellow-50' },
    { id: 'issued',   label: 'Issued',   color: 'text-green-600 bg-green-50'   },
    { id: 'rejected', label: 'Rejected', color: 'text-red-600 bg-red-50'       },
    { id: 'all',      label: 'All',      color: 'text-gray-600 bg-gray-100'    },
  ];

  const statusBadge = (s?: string) => {
    switch (s ?? 'pending') {
      case 'issued':          return 'bg-green-100 text-green-700';
      case 'wallet_credited': return 'bg-brand/10 text-brand';
      case 'rejected':        return 'bg-red-100 text-red-600';
      default:                return 'bg-yellow-100 text-yellow-700';
    }
  };

  const statusLabel = (o: OrderDoc) => {
    if (o.refundStatus === 'wallet_credited') return '💰 Wallet';
    if (o.refundStatus === 'issued') return o.refundMethod === 'original' ? '🏦 Issued' : '✓ Issued';
    if (o.refundStatus === 'rejected') return 'Rejected';
    return 'Pending';
  };

  const pendingCount = orders.filter(o => !o.refundStatus || o.refundStatus === 'pending').length;
  const needsProcessing = (o: OrderDoc) =>
    (!o.refundStatus || o.refundStatus === 'pending') && o.refundMethod !== 'wallet';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Refund Management</h1>
          <p className="text-sm text-gray-500 font-medium mt-0.5">Process refunds for cancelled paid orders</p>
        </div>
        {pendingCount > 0 && (
          <span className="px-3 py-1.5 bg-yellow-100 text-yellow-700 rounded-full text-sm font-black">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Food Tampering / Wrong Item Fraud Flags */}
      {(() => {
        const tamperOrders = orders.filter(o => {
          const reason = ((o as any).refundReason || '').toLowerCase();
          const notes  = ((o as any).refundNote || '').toLowerCase();
          return /(tamper|empty box|wrong item|seal broken|missing item)/i.test(reason + ' ' + notes);
        });
        if (tamperOrders.length === 0) return null;
        return (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h3 className="font-black text-red-800 text-sm">Food Fraud Alerts 🚨 Requires Immediate Action</h3>
            </div>
            {tamperOrders.map(o => (
              <div key={o.id} className="bg-white rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800 text-sm">Order <OrderId id={o.id} className="text-sm" /> · {o.restaurantName}</p>
                  <p className="text-xs text-red-600 mt-0.5">{(o as any).refundReason || 'Food tampering / wrong item reported'}</p>
                  {(o as any).riderName && <p className="text-xs text-gray-500">Rider: {(o as any).riderName}</p>}
                </div>
                {(o as any).riderId && (
                  <button
                    onClick={() => handleSuspendRider(o, (o as any).refundReason || 'Food tampering report')}
                    disabled={suspendingRider === (o as any).riderId}
                    className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 disabled:opacity-60 whitespace-nowrap"
                  >
                    {suspendingRider === (o as any).riderId ? (
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : '??'} Suspend Rider
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Pending', value: orders.filter(o => !o.refundStatus || o.refundStatus === 'pending').length, color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Issued',  value: orders.filter(o => o.refundStatus === 'issued' || o.refundStatus === 'wallet_credited').length, color: 'text-green-600 bg-green-50' },
          { label: 'Total Refunded', value: `₹${orders.filter(o => o.refundStatus === 'issued' || o.refundStatus === 'wallet_credited').reduce((s, o) => s + (o.refundAmount ?? o.totalAmount ?? 0), 0).toLocaleString()}`, color: 'text-brand bg-brand/10' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${c.color}`}>
              <DollarSign size={18} />
            </div>
            <p className="text-2xl font-black text-gray-900">{c.value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order, customer…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-gray-100 focus:border-brand text-sm font-bold outline-none"
          />
        </div>
        {FILTER_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              filter === t.id ? t.color : 'bg-gray-100 text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <CheckCircle size={40} className="mx-auto text-green-400 mb-3" />
          <p className="font-black text-gray-500">No {filter !== 'all' ? filter : ''} refunds</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Order', 'Customer', 'Restaurant', 'Amount', 'Refund To', 'Date', 'Status', ''].map(h => (
                    <th key={h} className="px-5 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-black text-gray-900"><OrderId id={order.id} /></td>
                    <td className="px-5 py-4 text-gray-700 font-bold">{order.customerName || '—'}</td>
                    <td className="px-5 py-4 text-gray-700 font-bold truncate max-w-[140px]">{order.restaurantName}</td>
                    <td className="px-5 py-4 font-black text-brand">₹{order.totalAmount}</td>
                    <td className="px-5 py-4">
                      {order.refundStatus === 'wallet_credited'
                        ? <span className="text-xs font-bold text-brand">💰 Wallet</span>
                        : order.refundMethod === 'original'
                          ? <span className="text-xs font-bold text-gray-500">🏦 Original</span>
                          : <span className="text-xs font-mono text-gray-400">{order.razorpayPaymentId?.slice(-8) || '—'}</span>
                      }
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">{formatDate(order.createdAt)}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${statusBadge(order.refundStatus)}`}>
                        {statusLabel(order)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {needsProcessing(order) && (
                        <button
                          onClick={() => openModal(order)}
                          className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-black"
                        >
                          Process
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Process modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-gray-900 text-lg">Process Refund</h3>
                <button onClick={() => setSelected(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>

              {/* Auto-calculated refund preview */}
              {(() => {
                const preview = computeRefundPreview(selected);
                const alreadyProcessed = selected.refundStatus === 'issued' || selected.refundStatus === 'wallet_credited';
                if (alreadyProcessed) return null;
                return (
                  <div className={`rounded-xl px-4 py-3 mb-4 border-2 ${preview.pct === 100 ? 'bg-green-50 border-green-200' : preview.pct === 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black uppercase tracking-widest text-gray-500">Auto-Refund Engine</span>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-full ${preview.pct === 100 ? 'bg-green-100 text-green-700' : preview.pct === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {preview.pct}% Refund
                      </span>
                    </div>
                    <p className="text-sm font-black text-gray-800">₹{preview.amount} refundable</p>
                    {preview.deduction > 0 && <p className="text-xs text-red-600 font-bold">₹{preview.deduction} cancellation fee</p>}
                    <p className="text-xs text-gray-500 mt-0.5">{preview.label} · Stage: <span className="font-bold">{preview.stage || '—'}</span></p>
                    <button
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const r = await fetch('/api/auto-refund', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orderId: selected.id, cancelledBy: 'admin', cancellationReason: selected.refundNote || 'Admin refund' }),
                          });
                          const d = await r.json();
                          if (d.success) { toast.success(`Auto-refund applied: ₹${d.refundAmount} (${d.refundPct}%)`); setSelected(null); }
                          else toast.error(d.error || 'Auto-refund failed');
                        } catch { toast.error('Network error'); } finally { setSaving(false); }
                      }}
                      disabled={saving || preview.pct === 0}
                      className="mt-2 w-full py-2 rounded-xl bg-brand text-white text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand/90"
                    >
                      {saving ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '⚡'}
                      Apply Auto-Refund (₹{preview.amount})
                    </button>
                  </div>
                );
              })()}

              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">Order</span>
                  <span className="font-black">#{selected.id.slice(-6).toUpperCase()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">Restaurant</span>
                  <span className="font-black truncate max-w-[180px]">{selected.restaurantName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">Order Total</span>
                  <span className="font-black text-brand">₹{selected.totalAmount}</span>
                </div>
                {selected.razorpayPaymentId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">Payment ID</span>
                    <span className="font-mono text-xs text-gray-600">{selected.razorpayPaymentId}</span>
                  </div>
                )}
                {selected.refundMethod && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">Refund To</span>
                    <span className="font-black">{selected.refundMethod === 'original' ? '🏦 Original Payment' : '💰 Wallet'}</span>
                  </div>
                )}
                {selected.cancellationFee != null && selected.cancellationFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">Cancellation Fee</span>
                    <span className="font-black text-red-500">−₹{selected.cancellationFee}</span>
                  </div>
                )}
                {selected.razorpayRefundId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">Refund ID</span>
                    <span className="font-mono text-xs text-green-600">{selected.razorpayRefundId}</span>
                  </div>
                )}
              </div>

              <div className="space-y-4 mb-5">
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5">Refund Amount (₹)</label>
                  <input
                    type="number"
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-brand px-4 py-3 text-sm font-black outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5">Note (optional)</label>
                  <textarea
                    value={refundNote}
                    onChange={e => setRefundNote(e.target.value)}
                    rows={2}
                    placeholder="Reason or transaction ID…"
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-brand px-4 py-3 text-sm font-bold outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={rejectRefund}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl border-2 border-red-100 text-red-500 font-black text-sm disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={issueRefund}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-brand text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={15} />}
                  Issue Refund
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
