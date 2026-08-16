import { useState, useEffect } from 'react';
import {
  collection, getDocs, doc, getDoc, updateDoc,
  addDoc, serverTimestamp, query, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Crown, CheckCircle, X, AlertCircle,
  Plus, RotateCcw, Ban, Bike, CalendarDays,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Rider {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  subscription?: {
    status: 'trial' | 'active' | 'expired' | 'cancelled';
    plan?: 'monthly' | 'quarterly' | 'yearly';
    expiresAt?: any;
    startedAt?: any;
    razorpaySubId?: string;
  };
}

const PLAN_DAYS: Record<string, number> = {
  monthly: 30, quarterly: 90, yearly: 365,
};

const STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  trial:     'bg-blue-100  text-blue-700',
  expired:   'bg-red-100   text-red-700',
  cancelled: 'bg-gray-100  text-gray-600',
};

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysLeft(ts: any): number {
  if (!ts) return 0;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

export default function RiderSubscriptionAdmin() {
  const [view, setView]           = useState<'search' | 'list'>('list');
  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState<Rider[]>([]);
  const [selected, setSelected]   = useState<Rider | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmit]   = useState(false);
  const [extendPlan, setExtend]   = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

  const [activeSubs, setActiveSubs]   = useState<Rider[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'riders'), where('subscription.status', 'in', ['active', 'trial']));
    const unsub = onSnapshot(q, snap => {
      setActiveSubs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Rider)));
      setLoadingList(false);
    }, () => setLoadingList(false));
    return () => unsub();
  }, []);

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setSelected(null);
    try {
      const snap = await getDocs(collection(db, 'riders'));
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as Rider));
      const lower = q.toLowerCase();
      const hits  = all.filter(r =>
        r.name?.toLowerCase().includes(lower) ||
        r.email?.toLowerCase().includes(lower) ||
        r.phone?.includes(q)
      ).slice(0, 8);
      setResults(hits);
      if (hits.length === 0) toast.error('Rider not found');
    } finally {
      setSearching(false);
    }
  };

  const selectRider = async (r: Rider) => {
    const snap = await getDoc(doc(db, 'riders', r.id));
    setSelected({ id: r.id, ...snap.data() } as Rider);
    setResults([]);
    setSearch(r.name || r.phone || '');
    setView('search');
  };

  const logAction = async (rider: Rider, action: string, notes: string) => {
    await addDoc(collection(db, 'adminSubscriptionActions'), {
      entityId:   rider.id,
      entityName: rider.name || rider.phone,
      entityType: 'rider',
      action,
      notes,
      createdAt: serverTimestamp(),
    });
  };

  const activate = async () => {
    if (!selected) return;
    const days    = PLAN_DAYS[extendPlan];
    const expiry  = new Date(Date.now() + days * 86400000);
    setSubmit(true);
    try {
      await updateDoc(doc(db, 'riders', selected.id), {
        subscription: {
          status:    'active',
          plan:      extendPlan,
          expiresAt: expiry,
          startedAt: new Date(),
          grantedBy: 'admin',
        },
      });
      await logAction(selected, 'activate', `${extendPlan} — manual admin grant, expires ${expiry.toDateString()}`);
      toast.success(`Subscription activated (${extendPlan})`);
      setSelected(prev => prev ? { ...prev, subscription: { status: 'active', plan: extendPlan, expiresAt: expiry } } : null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmit(false);
    }
  };

  const extend = async () => {
    if (!selected) return;
    const days   = PLAN_DAYS[extendPlan];
    const base   = selected.subscription?.expiresAt?.toDate
      ? selected.subscription.expiresAt.toDate()
      : new Date();
    const newExp = new Date(Math.max(base.getTime(), Date.now()) + days * 86400000);
    setSubmit(true);
    try {
      await updateDoc(doc(db, 'riders', selected.id), {
        'subscription.expiresAt': newExp,
        'subscription.status':    'active',
        'subscription.plan':      extendPlan,
      });
      await logAction(selected, 'extend', `+${days} days (${extendPlan}), new expiry ${newExp.toDateString()}`);
      toast.success(`Extended by ${days} days`);
      setSelected(prev => prev ? { ...prev, subscription: { ...prev.subscription, status: 'active', expiresAt: newExp } } : null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmit(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    setSubmit(true);
    try {
      await updateDoc(doc(db, 'riders', selected.id), {
        'subscription.status': 'cancelled',
        'subscription.cancelledAt': new Date(),
      });
      await logAction(selected, 'deactivate', 'Admin cancelled subscription');
      toast.success('Subscription cancelled');
      setSelected(prev => prev ? { ...prev, subscription: { ...prev.subscription, status: 'cancelled' } } : null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmit(false);
    }
  };

  const sub   = selected?.subscription;
  const isActive = sub?.status === 'active' || sub?.status === 'trial';

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Crown size={22} className="text-yellow-500" /> Rider Subscription Admin
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Rider subscriptions activate / extend / cancel cheyyi (₹299/month)</p>
      </div>

      {/* View toggle */}
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {(['list', 'search'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-black transition-all ${
              view === v ? 'bg-white dark:bg-gray-900 text-brand shadow-sm' : 'text-gray-500 dark:text-gray-400'
            }`}>
            {v === 'list' ? 'Active Subscribers' : 'Manage Rider'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── Active Subscribers List ── */}
        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Bike size={16} className="text-brand" /> Active Rider Subscriptions
                <span className="ml-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-black rounded-full">{activeSubs.length}</span>
              </h2>
            </div>
            {loadingList ? (
              <div className="py-16 text-center text-gray-400">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3" />
                Loading…
              </div>
            ) : activeSubs.length === 0 ? (
              <div className="py-16 text-center">
                <Crown className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-semibold">No active subscribers yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="table-header">Rider</th>
                      <th className="table-header">Status</th>
                      <th className="table-header">Plan</th>
                      <th className="table-header">Expires</th>
                      <th className="table-header">Days Left</th>
                      <th className="table-header text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSubs.map(r => {
                      const s = r.subscription;
                      const dl = daysLeft(s?.expiresAt);
                      return (
                        <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <td className="table-cell">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-xs font-black text-orange-700 flex-shrink-0">
                                {(r.name || r.phone || '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-gray-800 dark:text-gray-100">{r.name || '—'}</p>
                                <p className="text-[11px] text-gray-400">{r.phone || r.email || r.id.slice(-6)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="table-cell">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${STATUS_COLOR[s?.status ?? 'expired']}`}>
                              {s?.status ?? 'none'}
                            </span>
                          </td>
                          <td className="table-cell font-bold text-gray-600 dark:text-gray-300 capitalize">{s?.plan || '—'}</td>
                          <td className="table-cell text-gray-500 text-xs">{formatDate(s?.expiresAt)}</td>
                          <td className="table-cell">
                            <span className={`font-black text-sm ${dl <= 5 ? 'text-red-500' : dl <= 10 ? 'text-amber-500' : 'text-green-600'}`}>
                              {dl}d
                            </span>
                          </td>
                          <td className="table-cell text-right">
                            <button onClick={() => selectRider(r)}
                              className="px-3 py-1.5 bg-brand/10 text-brand text-xs font-black rounded-lg hover:bg-brand/20 transition-colors">
                              Manage
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Manage Individual Rider ── */}
        {view === 'search' && (
          <motion.div key="search" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-5">

            {/* Search box */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text" value={search}
                    onChange={e => { setSearch(e.target.value); setSelected(null); setResults([]); }}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    placeholder="Rider name, phone, or email…"
                    className="w-full pl-9 pr-4 py-3 border-2 border-gray-100 dark:border-gray-700 rounded-xl text-sm font-bold outline-none focus:border-brand dark:bg-gray-800 dark:text-gray-100 transition-colors"
                  />
                </div>
                <button onClick={handleSearch} disabled={searching}
                  className="px-5 py-3 bg-brand text-white rounded-xl font-black text-sm disabled:opacity-60">
                  {searching ? '…' : 'Search'}
                </button>
              </div>

              <AnimatePresence>
                {results.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                    {results.map(r => (
                      <button key={r.id} onClick={() => selectRider(r)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand/5 border-b last:border-b-0 border-gray-50 dark:border-gray-800 text-left">
                        <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black text-orange-700">
                          {(r.name || r.phone || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-black text-sm text-gray-900 dark:text-gray-100">{r.name || '—'}</p>
                          <p className="text-xs text-gray-400">{r.phone || r.email}</p>
                        </div>
                        {r.subscription?.status && (
                          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_COLOR[r.subscription.status]}`}>
                            {r.subscription.status}
                          </span>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {selected && (
                  <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                    className="bg-brand/5 border-2 border-brand/20 rounded-xl p-4 flex items-center gap-3">
                    <CheckCircle size={20} className="text-brand flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-black text-gray-900 dark:text-gray-100">{selected.name || selected.phone}</p>
                      <p className="text-xs text-gray-400">{selected.phone || selected.id.slice(-8)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-black text-gray-400 uppercase">Sub Status</p>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${STATUS_COLOR[sub?.status ?? 'expired']}`}>
                        {sub?.status ?? 'none'}
                      </span>
                    </div>
                    <button onClick={() => { setSelected(null); setSearch(''); }} className="text-xs text-gray-400 hover:text-red-500 font-bold ml-1">✕</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Subscription action panel */}
            <AnimatePresence>
              {selected && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 space-y-5">

                  {/* Current sub info */}
                  {sub && (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Status',   value: sub.status   ?? '—', highlight: STATUS_COLOR[sub.status ?? 'expired'] },
                        { label: 'Plan',     value: sub.plan     ?? '—', highlight: '' },
                        { label: 'Expires',  value: formatDate(sub.expiresAt), highlight: daysLeft(sub.expiresAt) <= 5 ? 'bg-red-50 text-red-600' : '' },
                      ].map(s => (
                        <div key={s.label} className="text-center bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                          <p className="text-[10px] font-black text-gray-400 uppercase mb-1">{s.label}</p>
                          <span className={`text-xs font-black px-2 py-0.5 rounded-full capitalize ${s.highlight || 'text-gray-800 dark:text-gray-100'}`}>
                            {s.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Plan selector */}
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Plan to Activate / Extend</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['monthly', 'quarterly', 'yearly'] as const).map(p => (
                        <button key={p} onClick={() => setExtend(p)}
                          className={`py-3 rounded-xl text-xs font-black border-2 transition-all ${
                            extendPlan === p ? 'border-brand bg-brand/5 text-brand' : 'border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-brand/40'
                          }`}>
                          <CalendarDays size={14} className="mx-auto mb-1" />
                          {p === 'monthly' ? '30 days' : p === 'quarterly' ? '90 days' : '365 days'}
                          <p className="text-[10px] font-normal capitalize mt-0.5 text-gray-400">{p}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-3 gap-3">
                    <button onClick={activate} disabled={submitting}
                      className="flex flex-col items-center gap-1.5 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-black text-xs disabled:opacity-50 transition-all">
                      <Plus size={16} />
                      Activate
                    </button>
                    <button onClick={extend} disabled={submitting}
                      className="flex flex-col items-center gap-1.5 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-black text-xs disabled:opacity-50 transition-all">
                      <RotateCcw size={16} />
                      Extend
                    </button>
                    <button onClick={deactivate} disabled={submitting || !isActive}
                      className="flex flex-col items-center gap-1.5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-xs disabled:opacity-50 transition-all">
                      <Ban size={16} />
                      Cancel
                    </button>
                  </div>

                  {submitting && (
                    <div className="text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                      Processing…
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
