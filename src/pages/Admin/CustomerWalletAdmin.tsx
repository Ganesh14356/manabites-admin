import { useState } from 'react';
import {
  collection, getDocs, query, where, limit,
  doc, getDoc, updateDoc, addDoc, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Wallet, Plus, Minus, CheckCircle, AlertCircle, User } from 'lucide-react';
import toast from 'react-hot-toast';

interface Customer {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  walletBalance?: number;
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function CustomerWalletAdmin() {
  const [search, setSearch]         = useState('');
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [selected, setSelected]     = useState<Customer | null>(null);
  const [searching, setSearching]   = useState(false);

  const [mode, setMode]             = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount]         = useState('');
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setSelected(null);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      const lower = q.toLowerCase();
      const results = all.filter(u =>
        u.name?.toLowerCase().includes(lower) ||
        u.email?.toLowerCase().includes(lower) ||
        u.phone?.includes(q)
      ).slice(0, 8);
      setCustomers(results);
    } finally {
      setSearching(false);
    }
  };

  const selectCustomer = async (c: Customer) => {
    const walletSnap = await getDoc(doc(db, 'wallets', c.id));
    const balance = walletSnap.exists() ? (walletSnap.data()?.balance ?? 0) : 0;
    setSelected({ ...c, walletBalance: balance });
    setCustomers([]);
    setSearch(c.name || c.email || '');
  };

  const handleSubmit = async () => {
    if (!selected) return toast.error('Customer select cheyyi');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error('Valid amount enter cheyyi');
    if (!reason.trim()) return toast.error('Reason enter cheyyi');
    if (mode === 'debit' && amt > (selected.walletBalance ?? 0)) {
      return toast.error('Wallet balance kante ekkuva deduct cheyyadam ledu');
    }
    setSubmitting(true);
    try {
      const change = mode === 'credit' ? amt : -amt;
      // Update wallet
      await updateDoc(doc(db, 'wallets', selected.id), { balance: increment(change), updatedAt: Date.now() });
      // Log transaction
      await addDoc(collection(db, 'walletTransactions'), {
        userId:    selected.id,
        amount:    change,
        type:      mode === 'credit' ? 'credit' : 'debit',
        reason:    reason.trim(),
        addedBy:   'admin',
        createdAt: Date.now(),
      });
      // Admin audit log
      await addDoc(collection(db, 'adminWalletActions'), {
        customerId:   selected.id,
        customerName: selected.name || selected.email,
        action:       mode,
        amount:       amt,
        reason:       reason.trim(),
        createdAt:    serverTimestamp(),
      });
      toast.success(`${fmt(amt)} ${mode === 'credit' ? 'credited to' : 'debited from'} ${selected.name || 'customer'}`);
      setSelected(prev => prev ? { ...prev, walletBalance: (prev.walletBalance ?? 0) + change } : null);
      setAmount('');
      setReason('');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <Wallet size={22} className="text-brand" /> Customer Wallet Admin
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Customer wallet ki credit / debit cheyyi</p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Name, email, or phone…"
              className="w-full pl-9 pr-4 py-3 border-2 border-gray-100 rounded-xl text-sm font-bold outline-none focus:border-brand transition-colors"
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

        {/* Results */}
        <AnimatePresence>
          {customers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-gray-100 rounded-xl overflow-hidden">
              {customers.map(c => (
                <button key={c.id} onClick={() => selectCustomer(c)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand/5 border-b last:border-b-0 border-gray-50 text-left">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <User size={14} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="font-black text-sm text-gray-900">{c.name || '—'}</p>
                    <p className="text-xs text-gray-400">{c.email || c.phone || c.id.slice(-8)}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected customer */}
        <AnimatePresence>
          {selected && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-brand/5 border-2 border-brand/20 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle size={20} className="text-brand flex-shrink-0" />
              <div className="flex-1">
                <p className="font-black text-gray-900">{selected.name || selected.email}</p>
                <p className="text-xs text-gray-400">{selected.phone || selected.id.slice(-8)}</p>
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
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">

            {/* Credit / Debit toggle */}
            <div className="flex gap-2">
              <button onClick={() => setMode('credit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${mode === 'credit' ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
                <Plus size={15} /> Credit
              </button>
              <button onClick={() => setMode('debit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-all ${mode === 'debit' ? 'bg-red-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
                <Minus size={15} /> Debit
              </button>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Amount (₹)</label>
              <input
                type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl text-2xl font-black outline-none focus:border-brand text-center"
              />
              {mode === 'debit' && parseFloat(amount) > (selected.walletBalance ?? 0) && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500 font-bold">
                  <AlertCircle size={12} /> Balance ({fmt(selected.walletBalance ?? 0)}) kante ekkuva
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Reason *</label>
              <input
                type="text" value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Compensation, Promo credit, Wrong charge refund…"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl text-sm font-bold outline-none focus:border-brand"
              />
            </div>

            {/* Quick reasons */}
            <div className="flex flex-wrap gap-2">
              {['Compensation', 'Promo credit', 'Refund adjustment', 'Welcome bonus', 'Wrong deduction fix'].map(r => (
                <button key={r} onClick={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all ${reason === r ? 'bg-brand text-white border-brand' : 'border-gray-200 text-gray-500 hover:border-brand hover:text-brand'}`}>
                  {r}
                </button>
              ))}
            </div>

            {/* Preview */}
            {parseFloat(amount) > 0 && reason && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Customer</span>
                  <span className="font-black text-gray-900">{selected.name || selected.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Action</span>
                  <span className={`font-black ${mode === 'credit' ? 'text-green-600' : 'text-red-500'}`}>
                    {mode === 'credit' ? '+' : '-'}{fmt(parseFloat(amount) || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-bold">Balance after</span>
                  <span className="font-black text-gray-900">
                    {fmt((selected.walletBalance ?? 0) + (mode === 'credit' ? parseFloat(amount) : -parseFloat(amount)))}
                  </span>
                </div>
              </div>
            )}

            <button onClick={handleSubmit} disabled={submitting || !amount || !reason}
              className={`w-full py-4 rounded-xl font-black text-white text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-all ${mode === 'credit' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}>
              {submitting
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : mode === 'credit' ? <Plus size={16} /> : <Minus size={16} />}
              {submitting ? 'Processing…' : `${mode === 'credit' ? 'Credit' : 'Debit'} ${fmt(parseFloat(amount) || 0)}`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
