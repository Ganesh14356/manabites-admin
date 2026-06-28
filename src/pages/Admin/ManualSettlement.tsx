import { useState, useEffect } from 'react';
import {
  collection, getDocs, query, where, orderBy, limit,
  addDoc, updateDoc, doc, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet, Store, Bike, Search, CheckCircle,
  FileText, IndianRupee, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

type EntityType = 'restaurant' | 'rider';
type PayMode = 'cash' | 'upi' | 'bank_transfer' | 'other';

interface Entity {
  id: string;
  name: string;
  phone?: string;
  upiId?: string;
  bankAccount?: string;
  walletBalance?: number;
}

interface RecentPayout {
  id: string;
  entityName: string;
  entityType: EntityType;
  amount: number;
  paymentMethod: PayMode;
  note?: string;
  paidAt: any;
  status: string;
  utrNumber?: string;
}

const PAY_MODE_LABELS: Record<PayMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

const fmt = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ManualSettlement() {
  const [entityType, setEntityType] = useState<EntityType>('restaurant');
  const [search, setSearch] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);

  const [amount, setAmount] = useState('');
  const [payMode, setPayMode] = useState<PayMode>('upi');
  const [utrNumber, setUtrNumber] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [recent, setRecent] = useState<RecentPayout[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Load recent manual payouts
  useEffect(() => {
    getDocs(query(
      collection(db, 'payouts'),
      where('paymentMethod', 'in', ['cash', 'upi', 'bank_transfer', 'other', 'manual_offline']),
      orderBy('createdAt', 'desc'),
      limit(20),
    ))
      .then(snap => setRecent(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecentPayout))))
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, [submitting]);

  // Search entities
  useEffect(() => {
    if (!search.trim()) { setEntities([]); return; }
    const col = entityType === 'restaurant' ? 'restaurants' : 'riders';
    setLoadingEntities(true);
    getDocs(collection(db, col))
      .then(snap => {
        const all = snap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || data.restaurantName || data.riderName || '—',
            phone: data.phone || data.ownerPhone,
            upiId: data.upiId,
            bankAccount: data.bankAccount,
            walletBalance: data.walletBalance,
          } as Entity;
        });
        const q = search.toLowerCase();
        setEntities(all.filter(e => e.name.toLowerCase().includes(q) || e.phone?.includes(q)));
      })
      .finally(() => setLoadingEntities(false));
  }, [search, entityType]);

  // Fetch wallet balance when entity selected
  useEffect(() => {
    if (!selected) return;
    getDoc(doc(db, 'wallets', selected.id)).then(snap => {
      if (snap.exists()) {
        const bal = snap.data()?.balance ?? 0;
        setSelected(prev => prev ? { ...prev, walletBalance: bal } : prev);
      }
    }).catch(() => {});
  }, [selected?.id]);

  const handleSubmit = async () => {
    if (!selected) return toast.error('Entity select cheyyi');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error('Valid amount enter cheyyi');
    if (payMode === 'upi' && !utrNumber.trim()) return toast.error('UPI UTR number enter cheyyi');

    setSubmitting(true);
    try {
      const now = Date.now();

      // Create payout record
      await addDoc(collection(db, 'payouts'), {
        entityId:     selected.id,
        entityName:   selected.name,
        entityType,
        amount:       amt,
        paymentMethod: payMode,
        utrNumber:    utrNumber.trim() || null,
        note:         note.trim() || null,
        status:       'completed',
        paidAt:       serverTimestamp(),
        paidVia:      `manual_${payMode}`,
        isManualSettlement: true,
        createdAt:    serverTimestamp(),
      });

      // Deduct from wallet balance
      const walletRef = doc(db, 'wallets', selected.id);
      const walletSnap = await getDoc(walletRef);
      if (walletSnap.exists()) {
        const currentBal = walletSnap.data()?.balance ?? 0;
        await updateDoc(walletRef, {
          balance: Math.max(0, currentBal - amt),
          lastWithdrawnAt: now,
          lastWithdrawnAmount: amt,
        });
      }

      // Wallet transaction log
      await addDoc(collection(db, 'walletTransactions'), {
        [entityType === 'restaurant' ? 'restaurantId' : 'riderId']: selected.id,
        type:       'manual_payout',
        amount:     -amt,
        payMode,
        utrNumber:  utrNumber.trim() || null,
        note:       note.trim() || null,
        status:     'completed',
        description: `Manual settlement — ${PAY_MODE_LABELS[payMode]}${utrNumber ? ` (UTR: ${utrNumber})` : ''}`,
        createdAt:  now,
      });

      toast.success(`${fmt(amt)} paid to ${selected.name}`);
      setSelected(null);
      setAmount('');
      setUtrNumber('');
      setNote('');
      setSearch('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <Wallet size={24} className="text-brand" /> Manual Settlement
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Individual restaurant or rider ki manual ga payment record cheyyi
        </p>
      </div>

      {/* Entity type selector */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex gap-3">
          {(['restaurant', 'rider'] as EntityType[]).map(t => (
            <button
              key={t}
              onClick={() => { setEntityType(t); setSelected(null); setSearch(''); setEntities([]); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm transition-all ${
                entityType === t
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t === 'restaurant' ? <Store size={15} /> : <Bike size={15} />}
              {t === 'restaurant' ? 'Restaurant' : 'Rider'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null); }}
            placeholder={`Search ${entityType} name or phone…`}
            className="w-full pl-9 pr-4 py-3 border-2 border-gray-100 rounded-xl text-sm font-bold outline-none focus:border-brand transition-colors"
          />
        </div>

        {/* Search results */}
        <AnimatePresence>
          {entities.length > 0 && !selected && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="border border-gray-100 rounded-xl overflow-hidden"
            >
              {loadingEntities ? (
                <div className="p-4 text-center text-gray-400 text-sm">Searching…</div>
              ) : (
                entities.slice(0, 8).map(e => (
                  <button
                    key={e.id}
                    onClick={() => { setSelected(e); setSearch(e.name); setEntities([]); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand/5 border-b last:border-b-0 border-gray-50 text-left transition-colors"
                  >
                    <div className="w-8 h-8 bg-brand/10 rounded-full flex items-center justify-center flex-shrink-0">
                      {entityType === 'restaurant' ? <Store size={14} className="text-brand" /> : <Bike size={14} className="text-brand" />}
                    </div>
                    <div>
                      <p className="font-black text-gray-900 text-sm">{e.name}</p>
                      {e.phone && <p className="text-xs text-gray-400">{e.phone}</p>}
                    </div>
                    {e.walletBalance !== undefined && (
                      <div className="ml-auto text-right">
                        <p className="text-xs text-gray-400">Wallet</p>
                        <p className="font-black text-sm text-green-600">{fmt(e.walletBalance)}</p>
                      </div>
                    )}
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected entity card */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="bg-brand/5 border-2 border-brand/20 rounded-xl p-4 flex items-center gap-3"
            >
              <CheckCircle size={20} className="text-brand flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-black text-gray-900">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.id.slice(-8)}</p>
              </div>
              {selected.walletBalance !== undefined && (
                <div className="text-right">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Wallet Balance</p>
                  <p className="font-black text-green-600">{fmt(selected.walletBalance)}</p>
                </div>
              )}
              <button
                onClick={() => { setSelected(null); setSearch(''); }}
                className="text-gray-400 hover:text-red-500 text-xs font-bold ml-2"
              >
                Change
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Payment form */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5"
          >
            <h2 className="font-black text-gray-800 text-sm uppercase tracking-wider">Payment Details</h2>

            {/* Amount */}
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">
                Amount (₹)
              </label>
              <div className="relative">
                <IndianRupee size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-9 pr-4 py-3 border-2 border-gray-100 rounded-xl text-lg font-black outline-none focus:border-brand transition-colors"
                />
              </div>
              {selected.walletBalance !== undefined && parseFloat(amount) > selected.walletBalance && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-orange-600 font-bold">
                  <AlertCircle size={12} />
                  Amount wallet balance ({fmt(selected.walletBalance)}) kante ekkuva — confirm chesukో
                </p>
              )}
            </div>

            {/* Payment mode */}
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">
                Payment Mode
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.entries(PAY_MODE_LABELS) as [PayMode, string][]).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setPayMode(k)}
                    className={`py-2.5 rounded-xl text-xs font-black transition-all ${
                      payMode === k
                        ? 'bg-brand text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* UTR / Reference number for UPI / bank transfer */}
            {(payMode === 'upi' || payMode === 'bank_transfer') && (
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">
                  {payMode === 'upi' ? 'UTR / Transaction ID' : 'UTR / NEFT Ref Number'}
                  {payMode === 'upi' && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={utrNumber}
                  onChange={e => setUtrNumber(e.target.value)}
                  placeholder={payMode === 'upi' ? 'UPI transaction ID enter cheyyi' : 'NEFT / IMPS UTR enter cheyyi'}
                  className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl text-sm font-bold outline-none focus:border-brand transition-colors"
                />
              </div>
            )}

            {/* Note */}
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Week 1 settlement, bonus payment…"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl text-sm font-bold outline-none focus:border-brand transition-colors"
              />
            </div>

            {/* Summary + Submit */}
            {parseFloat(amount) > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">To</span>
                  <span className="font-black text-gray-900">{selected.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">Amount</span>
                  <span className="font-black text-green-600">{fmt(parseFloat(amount) || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-bold">Mode</span>
                  <span className="font-black text-gray-900">{PAY_MODE_LABELS[payMode]}</span>
                </div>
                {utrNumber && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">UTR</span>
                    <span className="font-mono text-gray-900 font-bold">{utrNumber}</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || !amount || parseFloat(amount) <= 0}
              className="w-full py-4 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <CheckCircle size={16} />
              )}
              {submitting ? 'Recording…' : `Record Payment — ${fmt(parseFloat(amount) || 0)}`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent manual payouts */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <FileText size={16} className="text-gray-500" />
          <h2 className="font-black text-gray-800 text-sm uppercase tracking-wider">Recent Manual Payouts</h2>
        </div>
        {loadingRecent ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No manual payouts yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recent.map(p => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  p.entityType === 'restaurant' ? 'bg-orange-100' : 'bg-blue-100'
                }`}>
                  {p.entityType === 'restaurant'
                    ? <Store size={14} className="text-orange-500" />
                    : <Bike size={14} className="text-blue-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-sm truncate">{p.entityName}</p>
                  <p className="text-xs text-gray-400">
                    {PAY_MODE_LABELS[p.paymentMethod as PayMode] ?? p.paymentMethod}
                    {p.utrNumber ? ` · ${p.utrNumber}` : ''}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-green-600">{fmt(p.amount)}</p>
                  <p className="text-[10px] text-gray-400">
                    {p.paidAt?.toDate?.()?.toLocaleDateString('en-IN') ?? '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
