import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, getDocs, where, increment, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Gift, Plus, X, Target, Zap, Trophy, CheckCircle, Clock, Search } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface IncentivePlan {
  id: string;
  title: string;
  description: string;
  type: 'delivery_count' | 'earnings_target' | 'acceptance_rate' | 'daily_streak';
  target: number;            // e.g. 10 deliveries
  bonusAmount: number;       // ₹ credit on achieving
  period: 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
  totalClaimed: number;
  totalBonusPaid: number;
  createdAt: Timestamp;
}

interface IncentiveClaim {
  id: string;
  planId: string;
  planTitle: string;
  riderId: string;
  riderName: string;
  bonusAmount: number;
  status: 'pending' | 'credited' | 'rejected';
  achievedAt: Timestamp;
  creditedAt?: Timestamp;
}

interface Rider {
  id: string;
  name: string;
  phone: string;
  deliveriesThisWeek?: number;
  earningsThisWeek?: number;
}

const PERIOD_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const TYPE_ICONS: Record<string, string> = {
  delivery_count:  '🛵',
  earnings_target: '💰',
  acceptance_rate: '✅',
  daily_streak:    '🔥',
};
const TYPE_LABELS: Record<string, string> = {
  delivery_count:  'Delivery Count',
  earnings_target: 'Earnings Target (₹)',
  acceptance_rate: 'Acceptance Rate (%)',
  daily_streak:    'Daily Streak (days)',
};

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RiderIncentives() {
  const [plans,   setPlans]   = useState<IncentivePlan[]>([]);
  const [claims,  setClaims]  = useState<IncentiveClaim[]>([]);
  const [riders,  setRiders]  = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<'plans' | 'claims' | 'manual'>('plans');
  const [search,  setSearch]  = useState('');

  // Create plan modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', type: 'delivery_count' as IncentivePlan['type'],
    target: '', bonusAmount: '', period: 'weekly' as IncentivePlan['period'],
  });
  const [saving, setSaving] = useState(false);

  // Manual bonus modal
  const [showManual, setShowManual] = useState(false);
  const [manualRider, setManualRider] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [creditingManual, setCreditingManual] = useState(false);

  useEffect(() => {
    const unsubPlans  = onSnapshot(query(collection(db, 'riderIncentivePlans'), orderBy('createdAt', 'desc')), snap => {
      setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as IncentivePlan)));
      setLoading(false);
    });
    const unsubClaims = onSnapshot(query(collection(db, 'riderIncentiveClaims'), orderBy('achievedAt', 'desc')), snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as IncentiveClaim)));
    });
    getDocs(query(collection(db, 'riders'), where('approvalStatus', '==', 'approved'))).then(snap => {
      setRiders(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name || '—',
        phone: d.data().phone || d.id,
      })));
    });
    return () => { unsubPlans(); unsubClaims(); };
  }, []);

  const createPlan = async () => {
    const target = parseFloat(form.target);
    const bonus  = parseFloat(form.bonusAmount);
    if (!form.title || isNaN(target) || isNaN(bonus) || bonus <= 0) {
      toast.error('Fill all fields with valid values'); return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'riderIncentivePlans'), {
        title:          form.title.trim(),
        description:    form.description.trim(),
        type:           form.type,
        target,
        bonusAmount:    bonus,
        period:         form.period,
        isActive:       true,
        totalClaimed:   0,
        totalBonusPaid: 0,
        createdAt:      serverTimestamp(),
      });
      toast.success('Incentive plan created!');
      setShowCreate(false);
      setForm({ title: '', description: '', type: 'delivery_count', target: '', bonusAmount: '', period: 'weekly' });
    } catch { toast.error('Failed to create plan'); }
    finally { setSaving(false); }
  };

  const togglePlan = async (plan: IncentivePlan) => {
    await updateDoc(doc(db, 'riderIncentivePlans', plan.id), { isActive: !plan.isActive });
    toast.success(plan.isActive ? 'Plan paused' : 'Plan activated');
  };

  const creditClaim = async (claim: IncentiveClaim) => {
    try {
      // Credit rider wallet
      await updateDoc(doc(db, 'riders', claim.riderId), {
        walletBalance: increment(claim.bonusAmount),
      }).catch(() => {});
      // Add wallet transaction
      await addDoc(collection(db, 'riderWalletTransactions'), {
        riderId:     claim.riderId,
        riderName:   claim.riderName,
        type:        'bonus',
        amount:      claim.bonusAmount,
        reason:      `Incentive: ${claim.planTitle}`,
        claimId:     claim.id,
        createdAt:   serverTimestamp(),
      });
      // Mark claim credited
      await updateDoc(doc(db, 'riderIncentiveClaims', claim.id), {
        status:     'credited',
        creditedAt: serverTimestamp(),
      });
      // Update plan stats
      await updateDoc(doc(db, 'riderIncentivePlans', claim.planId), {
        totalBonusPaid: increment(claim.bonusAmount),
      });
      toast.success(`₹${claim.bonusAmount} credited to ${claim.riderName}`);
    } catch { toast.error('Credit failed'); }
  };

  const creditManual = async () => {
    const rider  = riders.find(r => r.id === manualRider);
    const amount = parseFloat(manualAmount);
    if (!rider || isNaN(amount) || amount <= 0 || !manualReason) {
      toast.error('Select rider, enter amount and reason'); return;
    }
    setCreditingManual(true);
    try {
      await updateDoc(doc(db, 'riders', rider.id), {
        walletBalance: increment(amount),
      }).catch(() => {});
      await addDoc(collection(db, 'riderWalletTransactions'), {
        riderId:   rider.id,
        riderName: rider.name,
        type:      'manual_bonus',
        amount,
        reason:    manualReason,
        createdAt: serverTimestamp(),
      });
      toast.success(`₹${amount} manual bonus credited to ${rider.name}`);
      setShowManual(false);
      setManualRider(''); setManualAmount(''); setManualReason('');
    } catch { toast.error('Failed to credit bonus'); }
    finally { setCreditingManual(false); }
  };

  const pendingClaims = useMemo(() => claims.filter(c => c.status === 'pending'), [claims]);
  const totalBonusPaid = useMemo(() => plans.reduce((s, p) => s + p.totalBonusPaid, 0), [plans]);

  const filteredClaims = useMemo(() => {
    if (!search) return claims;
    return claims.filter(c => c.riderName.toLowerCase().includes(search.toLowerCase()) || c.planTitle.toLowerCase().includes(search.toLowerCase()));
  }, [claims, search]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Gift className="w-7 h-7 text-brand" /> Rider Incentives & Bonuses
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Create targets, reward top performers, credit bonuses</p>
        </div>
        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => setShowManual(true)}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-50 text-yellow-700 border-2 border-yellow-200 rounded-xl text-sm font-bold hover:bg-yellow-100">
            <Zap className="w-4 h-4" /> Manual Bonus
          </motion.button>
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl text-sm font-bold hover:bg-brand/90 shadow-md shadow-brand/20">
            <Plus className="w-4 h-4" /> New Plan
          </motion.button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Plans',      value: plans.filter(p => p.isActive).length,   icon: Target,     color: 'text-blue-600 bg-blue-50' },
          { label: 'Pending Claims',    value: pendingClaims.length,                   icon: Clock,      color: 'text-amber-600 bg-amber-50' },
          { label: 'Total Credited',    value: `₹${totalBonusPaid.toLocaleString()}`,  icon: Trophy,     color: 'text-green-600 bg-green-50' },
          { label: 'Total Plans',       value: plans.length,                            icon: Gift,       color: 'text-purple-600 bg-purple-50' },
        ].map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-black text-gray-800">{c.value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{c.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 p-1 rounded-xl gap-1 w-fit">
        {(['plans', 'claims'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-bold capitalize transition-all ${tab === t ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}>
            {t} {t === 'claims' && pendingClaims.length > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{pendingClaims.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Plans Tab */}
      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading ? (
            <div className="col-span-2 flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
            </div>
          ) : plans.length === 0 ? (
            <div className="col-span-2 bg-white rounded-2xl p-12 text-center border border-gray-100">
              <Gift className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="font-black text-gray-400">No incentive plans yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first plan to motivate riders</p>
            </div>
          ) : plans.map((plan, i) => (
            <motion.div key={plan.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all ${plan.isActive ? 'border-brand/20' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{TYPE_ICONS[plan.type]}</span>
                  <div>
                    <p className="font-black text-gray-800">{plan.title}</p>
                    <p className="text-xs text-gray-400">{PERIOD_LABELS[plan.period]} · {TYPE_LABELS[plan.type]}</p>
                  </div>
                </div>
                <button onClick={() => togglePlan(plan)}
                  className={`px-3 py-1 rounded-full text-xs font-black transition-all ${plan.isActive ? 'bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-700'}`}>
                  {plan.isActive ? 'Active ✓' : 'Paused'}
                </button>
              </div>
              {plan.description && <p className="text-sm text-gray-500 mb-3">{plan.description}</p>}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-gray-400 font-bold">Target</p>
                  <p className="font-black text-gray-800">{plan.target} {plan.type === 'delivery_count' ? 'deliveries' : plan.type === 'earnings_target' ? '₹ earned' : plan.type === 'acceptance_rate' ? '%' : 'days'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-bold">Bonus</p>
                  <p className="font-black text-brand text-lg">₹{plan.bonusAmount}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-bold">Paid out</p>
                  <p className="font-black text-green-700">₹{plan.totalBonusPaid.toLocaleString()}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Claims Tab */}
      {tab === 'claims' && (
        <div className="space-y-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rider or plan…"
              className="w-full pl-9 pr-4 py-2.5 border-2 border-gray-100 focus:border-brand rounded-xl text-sm font-bold outline-none" />
          </div>
          {filteredClaims.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
              <CheckCircle className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="font-black text-gray-400">No claims yet</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Rider', 'Plan', 'Bonus', 'Achieved', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredClaims.map(claim => (
                    <tr key={claim.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-bold text-gray-800">{claim.riderName}</td>
                      <td className="px-4 py-3 text-gray-600">{claim.planTitle}</td>
                      <td className="px-4 py-3 font-black text-brand">₹{claim.bonusAmount}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(claim.achievedAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                          claim.status === 'credited'  ? 'bg-green-100 text-green-700' :
                          claim.status === 'rejected'  ? 'bg-red-100 text-red-600'    :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {claim.status === 'credited' ? '✓ Credited' : claim.status === 'rejected' ? 'Rejected' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {claim.status === 'pending' && (
                          <button onClick={() => creditClaim(claim)}
                            className="px-3 py-1.5 bg-brand text-white text-xs font-black rounded-lg hover:bg-brand/90">
                            Credit ₹{claim.bonusAmount}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Plan Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreate(false)}>
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-gray-900 text-lg">New Incentive Plan</h3>
                <button onClick={() => setShowCreate(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Plan title (e.g. Weekend Warrior)" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-4 py-2.5 text-sm font-bold outline-none" />
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short description (optional)" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-4 py-2.5 text-sm outline-none" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Type</label>
                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none">
                      {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Period</label>
                    <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value as any }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none">
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Target</label>
                    <input type="number" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                      placeholder="e.g. 10" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Bonus (₹)</label>
                    <input type="number" value={form.bonusAmount} onChange={e => setForm(f => ({ ...f, bonusAmount: e.target.value }))}
                      placeholder="e.g. 100" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-3 border-2 border-gray-100 rounded-xl text-gray-600 font-bold text-sm">Cancel</button>
                <button onClick={createPlan} disabled={saving}
                  className="flex-1 py-3 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 disabled:opacity-60">
                  {saving ? 'Creating…' : 'Create Plan'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Bonus Modal */}
      <AnimatePresence>
        {showManual && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowManual(false)}>
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-gray-900 text-lg">Manual Bonus</h3>
                <button onClick={() => setShowManual(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Rider</label>
                  <select value={manualRider} onChange={e => setManualRider(e.target.value)}
                    className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none">
                    <option value="">Select rider…</option>
                    {riders.map(r => <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Bonus Amount (₹)</label>
                  <input type="number" value={manualAmount} onChange={e => setManualAmount(e.target.value)}
                    placeholder="e.g. 200" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Reason</label>
                  <input value={manualReason} onChange={e => setManualReason(e.target.value)}
                    placeholder="e.g. Festival bonus, Performance reward…" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowManual(false)} className="flex-1 py-3 border-2 border-gray-100 rounded-xl text-gray-600 font-bold text-sm">Cancel</button>
                <button onClick={creditManual} disabled={creditingManual}
                  className="flex-1 py-3 bg-yellow-500 text-white rounded-xl font-black text-sm hover:bg-yellow-600 disabled:opacity-60">
                  {creditingManual ? 'Crediting…' : '⚡ Credit Bonus'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
