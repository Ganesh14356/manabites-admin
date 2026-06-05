import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, updateDoc, addDoc,
  onSnapshot, query, orderBy, Timestamp, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { DollarSign, CheckCircle, Clock, Store, Bike, RefreshCw, Plus, X, AlertTriangle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PayoutStatus = 'pending' | 'paid' | 'rejected';
type EntityType = 'restaurant' | 'rider';

interface PayoutDoc {
  id: string;
  entityId: string;
  entityName: string;
  entityType: EntityType;
  amount: number;
  status: PayoutStatus;
  periodStart: Timestamp;
  periodEnd: Timestamp;
  transactionId?: string;
  paidAt?: any;
  createdAt: Timestamp;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Payouts() {
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'all'>('pending');
  const [entityFilter, setEntityFilter] = useState<EntityType | 'all'>('all');

  // Mark-as-paid modal
  const [markingPaid, setMarkingPaid] = useState<PayoutDoc | null>(null);
  const [txId, setTxId] = useState('');
  const [saving, setSaving] = useState(false);

  // Create payout modal (manual entry)
  const [showCreate, setShowCreate] = useState(false);
  const [newPayout, setNewPayout] = useState({ entityName: '', entityType: 'restaurant' as EntityType, entityId: '', amount: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'payouts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setPayouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as PayoutDoc)));
      setLoading(false);
    }, err => { toast.error('Failed to load payouts: ' + err.message); setLoading(false); });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => payouts.filter(p => {
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchEntity = entityFilter === 'all' || p.entityType === entityFilter;
    return matchStatus && matchEntity;
  }), [payouts, statusFilter, entityFilter]);

  // ── Summary Stats ──────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    const pending = payouts.filter(p => p.status === 'pending');
    const pendingRestaurant = pending.filter(p => p.entityType === 'restaurant');
    const pendingRider = pending.filter(p => p.entityType === 'rider');
    return {
      totalPending: pending.reduce((s, p) => s + p.amount, 0),
      totalPaid: payouts.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
      restaurantPending: pendingRestaurant.reduce((s, p) => s + p.amount, 0),
      riderPending: pendingRider.reduce((s, p) => s + p.amount, 0),
      pendingCount: pending.length,
    };
  }, [payouts]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleMarkPaid = async () => {
    if (!markingPaid) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'payouts', markingPaid.id), {
        status: 'paid',
        transactionId: txId || null,
        paidAt: serverTimestamp(),
      });
      toast.success('Payout marked as paid');
      setMarkingPaid(null);
      setTxId('');
    } catch { toast.error('Failed to update payout'); }
    finally { setSaving(false); }
  };

  const handleCreatePayout = async () => {
    if (!newPayout.entityName || !newPayout.amount) {
      toast.error('Fill in all required fields');
      return;
    }
    setCreating(true);
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      await addDoc(collection(db, 'payouts'), {
        entityId: newPayout.entityId || `manual_${Date.now()}`,
        entityName: newPayout.entityName,
        entityType: newPayout.entityType,
        amount: Number(newPayout.amount),
        status: 'pending',
        periodStart,
        periodEnd: now,
        createdAt: serverTimestamp(),
      });
      toast.success('Payout created');
      setShowCreate(false);
      setNewPayout({ entityName: '', entityType: 'restaurant', entityId: '', amount: '' });
    } catch { toast.error('Failed to create payout'); }
    finally { setCreating(false); }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800">Payouts</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage restaurant and rider settlements</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowCreate(true)}
          className="btn-primary w-auto px-5"
        >
          <Plus className="w-4 h-4" /> Create Payout
        </motion.button>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Pending Payouts', value: summary.pendingCount, sub: `₹${summary.totalPending.toLocaleString('en-IN')}`, icon: Clock, color: 'border-yellow-400', iconBg: 'bg-yellow-50', iconColor: 'text-yellow-600' },
          { label: 'Paid Out', value: '', sub: `₹${summary.totalPaid.toLocaleString('en-IN')}`, icon: CheckCircle, color: 'border-green-500', iconBg: 'bg-green-50', iconColor: 'text-green-600' },
          { label: 'Restaurant Due', value: '', sub: `₹${summary.restaurantPending.toLocaleString('en-IN')}`, icon: Store, color: 'border-orange-400', iconBg: 'bg-orange-50', iconColor: 'text-brand' },
          { label: 'Rider Due', value: '', sub: `₹${summary.riderPending.toLocaleString('en-IN')}`, icon: Bike, color: 'border-blue-400', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.color}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.35, ease: 'easeOut' }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
          >
            <div className={`w-9 h-9 ${s.iconBg} rounded-xl flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.iconColor}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
            {s.value !== '' && <p className="text-2xl font-black text-gray-800 mt-0.5">{s.value}</p>}
            <p className={`${s.value ? 'text-sm text-gray-500' : 'text-2xl font-black text-gray-800 mt-0.5'}`}>{s.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['all', 'pending', 'paid', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${statusFilter === f ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['all', 'restaurant', 'rider'] as const).map(f => (
            <button key={f} onClick={() => setEntityFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${entityFilter === f ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'all' ? 'All' : f === 'restaurant' ? '🍽 Restaurants' : '🛵 Riders'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading payouts...</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Recipient</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Period</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Transaction ID</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map(p => (
                    <motion.tr key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="table-cell font-semibold text-gray-800">{p.entityName}</td>
                      <td className="table-cell">
                        <span className={`badge ${p.entityType === 'restaurant' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                          {p.entityType === 'restaurant' ? '🍽 Restaurant' : '🛵 Rider'}
                        </span>
                      </td>
                      <td className="table-cell text-gray-500 text-xs">
                        {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                      </td>
                      <td className="table-cell font-black text-gray-800">₹{p.amount.toLocaleString('en-IN')}</td>
                      <td className="table-cell">
                        {p.status === 'paid' ? (
                          <span className="flex items-center gap-1 text-green-700 font-bold text-xs bg-green-100 px-2.5 py-1 rounded-full w-fit">
                            <CheckCircle className="w-3.5 h-3.5" /> Paid
                          </span>
                        ) : p.status === 'rejected' ? (
                          <span className="flex items-center gap-1 text-red-700 font-bold text-xs bg-red-100 px-2.5 py-1 rounded-full w-fit">
                            <AlertTriangle className="w-3.5 h-3.5" /> Rejected
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-yellow-700 font-bold text-xs bg-yellow-100 px-2.5 py-1 rounded-full w-fit">
                            <Clock className="w-3.5 h-3.5" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="table-cell text-gray-400 font-mono text-xs">
                        {p.transactionId || '—'}
                      </td>
                      <td className="table-cell">
                        {p.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => { setMarkingPaid(p); setTxId(''); }}
                              className="px-3 py-1.5 bg-brand text-white text-xs font-bold rounded-lg hover:bg-brand-dark transition-colors"
                            >
                              Mark Paid
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await updateDoc(doc(db, 'payouts', p.id), { status: 'rejected', rejectedAt: serverTimestamp() });
                                  toast.success('Payout rejected');
                                } catch { toast.error('Failed'); }
                              }}
                              className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-bold rounded-lg hover:bg-red-200 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {p.status === 'paid' && p.paidAt && (
                          <div>
                            <span className="text-xs text-gray-400">{formatDate(p.paidAt)}</span>
                            {p.transactionId && <p className="text-xs font-mono text-green-600">{p.transactionId}</p>}
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {filtered.length === 0 && <div className="py-16 text-center text-gray-400">No {statusFilter !== 'all' ? statusFilter : ''} payouts found</div>}
          </div>
        </div>
      )}

      {/* ── Mark Paid Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {markingPaid && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={() => setMarkingPaid(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-black text-gray-800">Mark as Paid</h2>
                <button onClick={() => setMarkingPaid(null)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 mb-5">
                <p className="font-bold text-gray-800">{markingPaid.entityName}</p>
                <p className="text-sm text-gray-500 mt-0.5 capitalize">{markingPaid.entityType}</p>
                <p className="text-2xl font-black text-brand mt-2">₹{markingPaid.amount.toLocaleString('en-IN')}</p>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Transaction / UTR ID (optional)</label>
                <input
                  type="text"
                  value={txId}
                  onChange={e => setTxId(e.target.value)}
                  className="input-field"
                  placeholder="e.g. UTR123456789"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={() => setMarkingPaid(null)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">Cancel</button>
                <button onClick={handleMarkPaid} disabled={saving} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-60">
                  {saving ? 'Saving...' : 'Confirm Paid'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Create Payout Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-black text-gray-800">Create Payout</h2>
                <button onClick={() => setShowCreate(false)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Recipient Name *</label>
                  <input value={newPayout.entityName} onChange={e => setNewPayout(p => ({ ...p, entityName: e.target.value }))} className="input-field" placeholder="Restaurant or rider name" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Type *</label>
                  <select value={newPayout.entityType} onChange={e => setNewPayout(p => ({ ...p, entityType: e.target.value as EntityType }))} className="input-field">
                    <option value="restaurant">Restaurant</option>
                    <option value="rider">Rider</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Amount (₹) *</label>
                  <input type="number" value={newPayout.amount} onChange={e => setNewPayout(p => ({ ...p, amount: e.target.value }))} className="input-field" placeholder="0.00" min={0} />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">Cancel</button>
                <button onClick={handleCreatePayout} disabled={creating} className="flex-1 py-3 bg-brand text-white font-bold rounded-xl hover:bg-brand-dark disabled:opacity-60">
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
