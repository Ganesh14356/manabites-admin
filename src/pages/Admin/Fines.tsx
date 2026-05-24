import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  query, orderBy, getDocs, where, increment, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  AlertTriangle, X, Plus, Search, CheckCircle, XCircle,
  DollarSign, Bike, Store, Filter, FileText,
} from 'lucide-react';

interface Fine {
  id: string;
  targetType: 'rider' | 'restaurant';
  targetId: string;
  targetName: string;
  amount: number;
  reason: string;
  status: 'pending' | 'deducted' | 'waived';
  orderId?: string;
  issuedAt: any;
  deductedAt?: any;
  notes?: string;
}

const FINE_REASONS = {
  rider: [
    'Fake customer unavailable claim',
    'Food not delivered but marked delivered',
    'Rude behaviour to customer',
    'Late delivery without reason',
    'No-show after accepting order',
    'Damaged food during delivery',
    'Other',
  ],
  restaurant: [
    'Wrong order prepared',
    'Extremely late food preparation',
    'Poor hygiene/food quality complaint',
    'Closed during operating hours',
    'Repeated order cancellations',
    'False menu items listed',
    'Other',
  ],
};

export default function Fines() {
  const [fines, setFines]             = useState<Fine[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [filterType, setFilterType]   = useState<'all' | 'rider' | 'restaurant'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'deducted' | 'waived'>('all');
  const [searchText, setSearchText]   = useState('');
  const [processing, setProcessing]   = useState<string | null>(null);

  // Issue fine form
  const [form, setForm] = useState({
    targetType: 'rider' as 'rider' | 'restaurant',
    targetSearch: '',
    targetId: '',
    targetName: '',
    amount: '',
    reason: '',
    customReason: '',
    orderId: '',
    notes: '',
  });
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone?: string }[]>([]);
  const [searching, setSearching]         = useState(false);
  const [submitting, setSubmitting]       = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'fines'), orderBy('issuedAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setFines(snap.docs.map(d => ({ id: d.id, ...d.data() } as Fine)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const searchTarget = async (text: string) => {
    if (!text.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const col   = form.targetType === 'rider' ? 'riders' : 'restaurants';
      const field = form.targetType === 'rider' ? 'name' : 'name';
      const snap  = await getDocs(query(collection(db, col), orderBy(field)));
      const lower = text.toLowerCase();
      const results = snap.docs
        .map(d => ({ id: d.id, name: (d.data().name as string) || d.id, phone: d.data().phone as string }))
        .filter(r => r.name.toLowerCase().includes(lower) || r.id.includes(lower))
        .slice(0, 6);
      setSearchResults(results);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleIssueFine = async () => {
    if (!form.targetId || !form.amount || !form.reason) {
      toast.error('Fill in target, amount and reason');
      return;
    }
    const finalReason = form.reason === 'Other' ? form.customReason.trim() : form.reason;
    if (!finalReason) { toast.error('Enter custom reason'); return; }

    setSubmitting(true);
    try {
      const id = `fine_${Date.now()}_${form.targetId.slice(0, 6)}`;
      await setDoc(doc(db, 'fines', id), {
        targetType: form.targetType,
        targetId:   form.targetId,
        targetName: form.targetName,
        amount:     Number(form.amount),
        reason:     finalReason,
        status:     'pending',
        orderId:    form.orderId || null,
        notes:      form.notes || null,
        issuedAt:   serverTimestamp(),
        deductedAt: null,
      });
      toast.success(`Fine of â‚¹${form.amount} issued to ${form.targetName}`);
      setShowModal(false);
      setForm({ targetType: 'rider', targetSearch: '', targetId: '', targetName: '', amount: '', reason: '', customReason: '', orderId: '', notes: '' });
      setSearchResults([]);
    } catch {
      toast.error('Failed to issue fine');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeduct = async (fine: Fine) => {
    setProcessing(fine.id);
    try {
      // Deduct from rider earnings or restaurant outstanding
      if (fine.targetType === 'rider') {
        await updateDoc(doc(db, 'riders', fine.targetId), {
          earnings:      increment(-fine.amount),
          totalEarnings: increment(-fine.amount),
        });
      } else {
        await setDoc(doc(db, 'restaurants', fine.targetId), {
          outstandingFines: increment(fine.amount),
        }, { merge: true });
      }
      await updateDoc(doc(db, 'fines', fine.id), {
        status:     'deducted',
        deductedAt: serverTimestamp(),
      });
      toast.success(`â‚¹${fine.amount} deducted from ${fine.targetName}`);
    } catch {
      toast.error('Deduction failed');
    } finally {
      setProcessing(null);
    }
  };

  const handleWaive = async (fine: Fine) => {
    setProcessing(fine.id);
    try {
      await updateDoc(doc(db, 'fines', fine.id), { status: 'waived' });
      toast.success('Fine waived');
    } catch {
      toast.error('Failed to waive fine');
    } finally {
      setProcessing(null);
    }
  };

  const filtered = fines.filter(f => {
    if (filterType !== 'all' && f.targetType !== filterType) return false;
    if (filterStatus !== 'all' && f.status !== filterStatus) return false;
    if (searchText && !f.targetName.toLowerCase().includes(searchText.toLowerCase()) &&
        !f.reason.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const totalPending  = fines.filter(f => f.status === 'pending').reduce((s, f) => s + f.amount, 0);
  const totalDeducted = fines.filter(f => f.status === 'deducted').reduce((s, f) => s + f.amount, 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Fines & Penalties</h1>
          <p className="text-gray-500 text-sm mt-0.5">Issue and manage fines for riders and restaurants</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-red-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-red-600 transition-colors"
        >
          <Plus size={16} /> Issue Fine
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Pending Fines', value: fines.filter(f => f.status === 'pending').length, sub: `â‚¹${totalPending.toLocaleString()} pending`, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Deducted', value: fines.filter(f => f.status === 'deducted').length, sub: `â‚¹${totalDeducted.toLocaleString()} recovered`, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Waived', value: fines.filter(f => f.status === 'waived').length, sub: 'Forgiven fines', color: 'text-gray-500', bg: 'bg-gray-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs font-bold text-gray-700 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search by name or reasonâ€¦"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'rider', 'restaurant'] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${filterType === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {t === 'all' ? 'All' : t === 'rider' ? 'ðŸ›µ Riders' : 'ðŸ½ï¸ Restaurants'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['all', 'pending', 'deducted', 'waived'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors capitalize ${filterStatus === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Fines List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loadingâ€¦</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <AlertTriangle size={32} className="mx-auto mb-2 opacity-30" />
          <p className="font-semibold">No fines found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((fine, i) => (
            <motion.div
              key={fine.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-4"
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                fine.targetType === 'rider' ? 'bg-blue-100' : 'bg-orange-100'
              }`}>
                {fine.targetType === 'rider'
                  ? <Bike size={18} className="text-blue-600" />
                  : <Store size={18} className="text-orange-600" />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-gray-800 text-sm">{fine.targetName}</p>
                    <p className="text-xs text-gray-500 capitalize">{fine.targetType}</p>
                  </div>
                  <p className="font-black text-lg text-red-500 flex-shrink-0">âˆ’â‚¹{fine.amount}</p>
                </div>
                <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                  <FileText size={11} /> {fine.reason}
                </p>
                {fine.orderId && (
                  <p className="text-[10px] text-gray-400 mt-0.5">Order: {fine.orderId}</p>
                )}
                {fine.notes && (
                  <p className="text-[10px] text-gray-400 mt-0.5 italic">{fine.notes}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  {fine.issuedAt?.toDate ? fine.issuedAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Just now'}
                </p>
              </div>

              {/* Status + Actions */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                  fine.status === 'pending'  ? 'bg-amber-100 text-amber-700' :
                  fine.status === 'deducted' ? 'bg-green-100 text-green-700' :
                                               'bg-gray-100 text-gray-500'
                }`}>
                  {fine.status.toUpperCase()}
                </span>

                {fine.status === 'pending' && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleDeduct(fine)}
                      disabled={processing === fine.id}
                      className="flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      <DollarSign size={11} /> Deduct
                    </button>
                    <button
                      onClick={() => handleWaive(fine)}
                      disabled={processing === fine.id}
                      className="flex items-center gap-1 bg-gray-100 text-gray-600 text-xs font-bold px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      <XCircle size={11} /> Waive
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Issue Fine Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-black text-gray-900">Issue Fine</h2>
                <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Target type */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Fine for</label>
                  <div className="flex gap-2">
                    {(['rider', 'restaurant'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => { setForm(f => ({ ...f, targetType: t, targetId: '', targetName: '', targetSearch: '', reason: '' })); setSearchResults([]); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                          form.targetType === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {t === 'rider' ? <><Bike size={14} /> Rider</> : <><Store size={14} /> Restaurant</>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Search target */}
                <div className="relative">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">
                    Search {form.targetType}
                  </label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={form.targetSearch}
                      onChange={e => { setForm(f => ({ ...f, targetSearch: e.target.value, targetId: '', targetName: '' })); searchTarget(e.target.value); }}
                      placeholder={`Type ${form.targetType} nameâ€¦`}
                      className="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                    />
                  </div>
                  {form.targetId && (
                    <p className="text-xs text-green-600 font-bold mt-1">âœ“ {form.targetName} selected</p>
                  )}
                  {searchResults.length > 0 && !form.targetId && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 mt-1 overflow-hidden">
                      {searchResults.map(r => (
                        <button
                          key={r.id}
                          onClick={() => { setForm(f => ({ ...f, targetId: r.id, targetName: r.name, targetSearch: r.name })); setSearchResults([]); }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          <p className="font-semibold text-gray-800">{r.name}</p>
                          {r.phone && <p className="text-xs text-gray-400">{r.phone}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Fine Amount (â‚¹)</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="e.g. 100"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Reason</label>
                  <select
                    value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                  >
                    <option value="">Select reasonâ€¦</option>
                    {FINE_REASONS[form.targetType].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {form.reason === 'Other' && (
                    <input
                      value={form.customReason}
                      onChange={e => setForm(f => ({ ...f, customReason: e.target.value }))}
                      placeholder="Describe the reasonâ€¦"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mt-2"
                    />
                  )}
                </div>

                {/* Order ID (optional) */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Order ID (optional)</label>
                  <input
                    value={form.orderId}
                    onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))}
                    placeholder="Linked order ID"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                  />
                </div>

                {/* Notes (optional) */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Notes (optional)</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Additional detailsâ€¦"
                    rows={2}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm resize-none"
                  />
                </div>

                <button
                  onClick={handleIssueFine}
                  disabled={submitting}
                  className="w-full bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Issuingâ€¦' : `Issue â‚¹${form.amount || 'â€”'} Fine`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
