import { useState } from 'react';
import {
  collection, getDocs, doc, setDoc, getDoc, query, where,
  updateDoc, addDoc, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Wallet, Plus, Minus, CheckCircle, AlertCircle,
  User, Bike, Store,
} from 'lucide-react';
import toast from 'react-hot-toast';

type UserType = 'customer' | 'rider' | 'restaurant';

interface Entity {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  walletBalance?: number;
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const TABS: { key: UserType; label: string; icon: typeof User; collection: string; color: string }[] = [
  { key: 'customer',    label: 'Customer',    icon: User,  collection: 'users',        color: 'bg-blue-500'   },
  { key: 'rider',       label: 'Rider',       icon: Bike,  collection: 'riders',       color: 'bg-green-500'  },
  { key: 'restaurant',  label: 'Restaurant',  icon: Store, collection: 'restaurants',  color: 'bg-orange-500' },
];

const QUICK_REASONS = [
  'Compensation', 'Promo credit', 'Refund adjustment',
  'Welcome bonus', 'Wrong deduction fix', 'Admin correction',
];

export default function WalletAdmin() {
  const [tab, setTab]             = useState<UserType>('customer');
  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState<Entity[]>([]);
  const [selected, setSelected]   = useState<Entity | null>(null);
  const [searching, setSearching] = useState(false);

  const [mode, setMode]         = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount]     = useState('');
  const [reason, setReason]     = useState('');
  const [submitting, setSubmit] = useState(false);

  const tabCfg = TABS.find(t => t.key === tab)!;

  const switchTab = (t: UserType) => {
    setTab(t);
    setSearch('');
    setResults([]);
    setSelected(null);
    setAmount('');
    setReason('');
  };

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setSelected(null);
    setResults([]);
    try {
      const hits: Entity[] = [];
      const seen = new Set<string>();
      const lower = q.toLowerCase();
      const digits = q.replace(/\D/g, '');

      // 1. Indexed queries — exact email / phone
      const indexedQ: Promise<any>[] = [
        getDocs(query(collection(db, tabCfg.collection), where('email', '==', q))),
        getDocs(query(collection(db, tabCfg.collection), where('email', '==', lower))),
      ];
      if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        indexedQ.push(
          getDocs(query(collection(db, tabCfg.collection), where('phone', '==', last10))),
          getDocs(query(collection(db, tabCfg.collection), where('phone', '==', `+91${last10}`))),
          getDocs(query(collection(db, tabCfg.collection), where('phone', '==', `91${last10}`))),
          getDocs(query(collection(db, tabCfg.collection), where('phoneNumber', '==', `+91${last10}`))),
        );
      }
      const snaps = await Promise.allSettled(indexedQ);
      for (const s of snaps) {
        if (s.status === 'fulfilled') {
          for (const d of s.value.docs) {
            if (!seen.has(d.id)) { seen.add(d.id); hits.push({ id: d.id, ...d.data() } as Entity); }
          }
        }
      }

      // 2. Full scan fallback for name / partial match
      if (hits.length === 0) {
        const allSnap = await getDocs(collection(db, tabCfg.collection));
        for (const d of allSnap.docs) {
          const data = d.data();
          const phone = String(data.phone || data.phoneNumber || '').replace(/\D/g, '');
          if (
            data.name?.toLowerCase().includes(lower) ||
            data.ownerName?.toLowerCase().includes(lower) ||
            data.displayName?.toLowerCase().includes(lower) ||
            data.email?.toLowerCase().includes(lower) ||
            phone.includes(digits)
          ) {
            if (!seen.has(d.id)) { seen.add(d.id); hits.push({ id: d.id, ...data } as Entity); }
          }
          if (hits.length >= 8) break;
        }
      }

      setResults(hits.slice(0, 8));
      if (hits.length === 0) toast.error('No results found');
    } finally {
      setSearching(false);
    }
  };

  const selectEntity = async (e: Entity) => {
    const walletSnap = await getDoc(doc(db, 'wallets', e.id));
    const balance = walletSnap.exists() ? (walletSnap.data()?.balance ?? 0) : 0;
    setSelected({ ...e, walletBalance: balance });
    setResults([]);
    setSearch(e.name || e.email || '');
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error('Valid amount enter cheyyi');
    if (!reason.trim()) return toast.error('Reason enter cheyyi');
    if (mode === 'debit' && amt > (selected.walletBalance ?? 0)) {
      return toast.error('Balance kante ekkuva deduct cheyyadam ledu');
    }
    setSubmit(true);
    try {
      const change = mode === 'credit' ? amt : -amt;
      await addDoc(collection(db, 'walletTransactions'), {
        userId:    selected.id,
        userType:  tab,
        amount:    change,
        type:      mode,
        reason:    reason.trim(),
        addedBy:   'admin',
        createdAt: Date.now(),
      });
      // upsert wallet doc (set with merge so it creates if missing)
      const walletRef = doc(db, 'wallets', selected.id);
      // setDoc with merge creates the doc if it doesn't exist yet
      await setDoc(walletRef, { balance: increment(change), userType: tab, updatedAt: Date.now() }, { merge: true });
      // For customers: mirror to users/{uid}.walletBalance so the app shows updated balance immediately
      if (tab === 'customer') {
        try { await updateDoc(doc(db, 'users', selected.id), { walletBalance: increment(change), walletUpdatedAt: Date.now() }); } catch { /* ignore */ }
      }
      await addDoc(collection(db, 'adminWalletActions'), {
        entityId:   selected.id,
        entityName: selected.name || selected.email,
        userType:   tab,
        action:     mode,
        amount:     amt,
        reason:     reason.trim(),
        createdAt:  serverTimestamp(),
      });
      toast.success(`${fmt(amt)} ${mode === 'credit' ? 'credited' : 'debited'} — ${selected.name || 'entity'}`);
      setSelected(prev => prev ? { ...prev, walletBalance: (prev.walletBalance ?? 0) + change } : null);
      setAmount('');
      setReason('');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmit(false);
    }
  };

  const afterBalance = selected
    ? (selected.walletBalance ?? 0) + (mode === 'credit' ? parseFloat(amount) || 0 : -(parseFloat(amount) || 0))
    : 0;

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Wallet size={22} className="text-brand" /> Wallet Admin
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Customer / Rider / Restaurant wallets manage cheyyi</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-black transition-all ${
              tab === t.key
                ? 'bg-white dark:bg-gray-900 text-brand shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null); setResults([]); }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              autoComplete="off"
              placeholder={`${tabCfg.label} name, email, or phone…`}
              className="w-full pl-9 pr-4 py-3 border-2 border-gray-100 dark:border-gray-700 rounded-xl text-sm font-bold outline-none focus:border-brand dark:bg-gray-800 dark:text-gray-100 transition-colors"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-5 py-3 bg-brand text-white rounded-xl font-black text-sm disabled:opacity-60"
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
              {results.map(r => (
                <button key={r.id} onClick={() => selectEntity(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand/5 border-b last:border-b-0 border-gray-50 dark:border-gray-800 text-left">
                  <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <tabCfg.icon size={14} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="font-black text-sm text-gray-900 dark:text-gray-100">{r.name || '—'}</p>
                    <p className="text-xs text-gray-400">{r.email || r.phone || r.id.slice(-8)}</p>
                  </div>
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
                <p className="font-black text-gray-900 dark:text-gray-100">{selected.name || selected.email}</p>
                <p className="text-xs text-gray-400">{selected.phone || selected.id.slice(-8)} · {tab}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-gray-400 uppercase">Wallet</p>
                <p className="font-black text-green-600">{fmt(selected.walletBalance ?? 0)}</p>
              </div>
              <button onClick={() => { setSelected(null); setSearch(''); }} className="text-xs text-gray-400 hover:text-red-500 font-bold ml-1">✕</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action form */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 space-y-5">

            <div className="flex gap-2">
              <button onClick={() => setMode('credit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${mode === 'credit' ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                <Plus size={15} /> Credit
              </button>
              <button onClick={() => setMode('debit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${mode === 'debit' ? 'bg-red-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                <Minus size={15} /> Debit
              </button>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Amount (₹)</label>
              <input
                type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-gray-100 dark:border-gray-700 rounded-xl text-2xl font-black outline-none focus:border-brand text-center dark:bg-gray-800 dark:text-gray-100"
              />
              {mode === 'debit' && parseFloat(amount) > (selected.walletBalance ?? 0) && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500 font-bold">
                  <AlertCircle size={12} /> Balance ({fmt(selected.walletBalance ?? 0)}) kante ekkuva
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Reason *</label>
              <input
                type="text" value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Compensation, Promo credit, Admin correction…"
                className="w-full px-4 py-3 border-2 border-gray-100 dark:border-gray-700 rounded-xl text-sm font-bold outline-none focus:border-brand dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map(r => (
                <button key={r} onClick={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all ${reason === r ? 'bg-brand text-white border-brand' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-brand hover:text-brand'}`}>
                  {r}
                </button>
              ))}
            </div>

            {parseFloat(amount) > 0 && reason && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Entity</span>
                  <span className="font-black text-gray-900 dark:text-gray-100">{selected.name || selected.email} ({tab})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Action</span>
                  <span className={`font-black ${mode === 'credit' ? 'text-green-600' : 'text-red-500'}`}>
                    {mode === 'credit' ? '+' : '-'}{fmt(parseFloat(amount) || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Balance after</span>
                  <span className="font-black text-gray-900 dark:text-gray-100">{fmt(afterBalance)}</span>
                </div>
              </div>
            )}

            <button onClick={handleSubmit} disabled={submitting || !amount || !reason}
              className={`w-full py-4 rounded-xl font-black text-white text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-all ${mode === 'credit' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}>
              {submitting
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : mode === 'credit' ? <Plus size={16} /> : <Minus size={16} />}
              {submitting ? 'Processing…' : `${mode === 'credit' ? 'Credit' : 'Debit'} ${fmt(parseFloat(amount) || 0)} to ${tab}`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
