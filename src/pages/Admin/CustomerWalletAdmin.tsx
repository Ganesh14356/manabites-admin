import { useState } from 'react';
import {
  collection, getDocs, query, where, limit,
  doc, getDoc,
} from 'firebase/firestore';
import { db, auth } from '../../firebase';
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

  const handleSearchByUid = async (uid: string) => {
    if (!uid.trim()) return;
    setSearching(true);
    setSelected(null);
    setCustomers([]);
    try {
      const { getDoc, doc } = await import('firebase/firestore');
      const userSnap = await getDoc(doc(db, 'users', uid.trim()));
      const walletSnap = await getDoc(doc(db, 'wallets', uid.trim()));
      const balance = walletSnap.exists() ? (walletSnap.data()?.balance ?? 0) : 0;
      if (userSnap.exists()) {
        const data = userSnap.data();
        setSelected({ id: uid.trim(), ...data, walletBalance: balance } as Customer);
        setSearch(data.name || data.email || uid.trim());
      } else {
        setSelected({ id: uid.trim(), name: 'Unknown User', walletBalance: balance });
        setSearch(uid.trim());
        toast('User doc not found — proceeding with UID only', { icon: 'ℹ️' });
      }
    } catch (e: any) {
      toast.error('UID lookup failed: ' + e.message);
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async () => {
    const q = search.trim();
    if (!q) return;
    // If it looks like a Firebase UID (28 chars, alphanumeric), search by UID directly
    if (/^[A-Za-z0-9]{20,}$/.test(q)) { handleSearchByUid(q); return; }
    setSearching(true);
    setSelected(null);
    setCustomers([]);
    try {
      const results: Customer[] = [];
      const seen = new Set<string>();
      const lower = q.toLowerCase();
      const digits = q.replace(/\D/g, '');

      // 1. Indexed Firestore queries — fast & exact
      const indexedQueries: Promise<any>[] = [
        getDocs(query(collection(db, 'users'), where('email', '==', q))),
        getDocs(query(collection(db, 'users'), where('email', '==', q.toLowerCase()))),
      ];
      if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        indexedQueries.push(
          getDocs(query(collection(db, 'users'), where('phone', '==', last10))),
          getDocs(query(collection(db, 'users'), where('phone', '==', `+91${last10}`))),
          getDocs(query(collection(db, 'users'), where('phone', '==', `91${last10}`))),
          getDocs(query(collection(db, 'users'), where('phoneNumber', '==', `+91${last10}`))),
          getDocs(query(collection(db, 'users'), where('phoneNumber', '==', last10))),
          getDocs(query(collection(db, 'users'), where('mobile', '==', last10))),
          getDocs(query(collection(db, 'users'), where('mobile', '==', `+91${last10}`))),
        );
      }

      const snaps = await Promise.allSettled(indexedQueries);
      for (const s of snaps) {
        if (s.status === 'fulfilled') {
          for (const d of s.value.docs) {
            if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() } as Customer); }
          }
        }
      }

      // 2. Full scan of users collection
      try {
        const allSnap = await getDocs(query(collection(db, 'users'), limit(500)));
        for (const d of allSnap.docs) {
          if (seen.has(d.id)) continue;
          const data = d.data();
          // Skip restaurant/rider accounts — they're not customers
          if (data.role === 'restaurant' || data.isRestaurant || data.restaurantId) continue;
          // ownerPhone excluded — restaurant owners share admin phone but aren't customers
          const phoneFields = [
            data.phone, data.phoneNumber, data.mobile, data.contact,
            data.displayPhone,
          ].map(v => String(v || '').replace(/\D/g, ''));
          const matchPhone = digits.length >= 6 && phoneFields.some(p => p.length >= 6 && (p.includes(digits) || digits.includes(p.slice(-10))));
          const matchText  = lower.length >= 2 && (
            data.name?.toLowerCase().includes(lower) ||
            data.displayName?.toLowerCase().includes(lower) ||
            data.email?.toLowerCase().includes(lower)
          );
          if (matchPhone || matchText) {
            seen.add(d.id);
            results.push({ id: d.id, ...data } as Customer);
          }
        }
      } catch { /* security rules may block full scan */ }

      // 3. Fallback — search orders collection by phone to get customerId
      if (results.length === 0 && digits.length >= 10) {
        const last10 = digits.slice(-10);
        const orderVariants = [last10, `+91${last10}`, `91${last10}`];
        const orderQueries = orderVariants.flatMap(v => [
          getDocs(query(collection(db, 'orders'), where('phone', '==', v), limit(3))),
          getDocs(query(collection(db, 'orders'), where('customerPhone', '==', v), limit(3))),
          getDocs(query(collection(db, 'orders'), where('deliveryPhone', '==', v), limit(3))),
        ]);
        const orderSnaps = await Promise.allSettled(orderQueries);
        for (const s of orderSnaps) {
          if (s.status !== 'fulfilled') continue;
          for (const d of s.value.docs) {
            const data = d.data();
            const uid = data.customerId || data.userId;
            if (uid && !seen.has(uid)) {
              seen.add(uid);
              // Fetch user doc and wallet balance
              try {
                const [uSnap, wSnap] = await Promise.all([
                  getDoc(doc(db, 'users', uid)),
                  getDoc(doc(db, 'wallets', uid)),
                ]);
                const balance = wSnap.exists() ? (wSnap.data()?.balance ?? 0) : 0;
                const uData = uSnap.exists() ? uSnap.data() : {};
                results.push({ id: uid, name: data.customerName || (uData as any).name, phone: last10, walletBalance: balance, ...uData } as Customer);
              } catch {
                results.push({ id: uid, name: data.customerName, phone: last10 } as Customer);
              }
            }
          }
        }
      }

      setCustomers(results.slice(0, 8));
      if (results.length === 0) toast.error('Customer not found');
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

      // Use server endpoint (Admin SDK) to bypass Firestore rules
      const token = await auth.currentUser?.getIdToken(/* forceRefresh */ true);
      if (!token) throw new Error('Not authenticated — please sign out and sign in again');

      // Use relative URL so Vercel proxy forwards the request (avoids CORS issues)
      const res = await fetch('/api/admin-wallet-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customerId: selected.id,
          amount: amt,
          mode,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`[${res.status}] ${err.error || 'Wallet update failed'}`);
      }

      toast.success(`${fmt(amt)} ${mode === 'credit' ? 'credited to' : 'debited from'} ${selected.name || 'customer'}`);
      setSelected(prev => prev ? { ...prev, walletBalance: (prev.walletBalance ?? 0) + change } : null);
      setAmount('');
      setReason('');
    } catch (e: any) {
      toast.error(e.message || 'Wallet update failed');
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
              autoComplete="off"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null); setCustomers([]); }}
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
