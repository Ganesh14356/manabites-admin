import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Plus, Trash2, Edit2, Server, Globe, MessageSquare,
  CreditCard, Megaphone, Wrench, X, Check, IndianRupee,
  TrendingDown, Calendar, Filter,
} from 'lucide-react';

const CATEGORIES = [
  { id: 'hosting',    label: 'Hosting / Server',   icon: Server,        color: 'bg-blue-50 text-blue-600' },
  { id: 'domain',     label: 'Domain / SSL',        icon: Globe,         color: 'bg-purple-50 text-purple-600' },
  { id: 'sms',        label: 'SMS / OTP (MSG91)',   icon: MessageSquare, color: 'bg-green-50 text-green-600' },
  { id: 'payment',    label: 'Payment Gateway',     icon: CreditCard,    color: 'bg-orange-50 text-orange-600' },
  { id: 'marketing',  label: 'Marketing / Ads',     icon: Megaphone,     color: 'bg-pink-50 text-pink-600' },
  { id: 'maintenance',label: 'App Maintenance',     icon: Wrench,        color: 'bg-yellow-50 text-yellow-600' },
  { id: 'other',      label: 'Other',               icon: IndianRupee,   color: 'bg-gray-50 text-gray-600' },
];

const RECURRENCE = ['one-time', 'monthly', 'yearly'];

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  recurrence: string;
  date: any;
  addedBy: string;
  createdAt: any;
}

function getCategoryMeta(id: string) {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

function formatDate(ts: any) {
  if (!ts) return 'â€”';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function thisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

export default function Expenses() {
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('all');

  // Form state
  const [category,    setCategory]    = useState('hosting');
  const [description, setDescription] = useState('');
  const [amount,      setAmount]      = useState('');
  const [recurrence,  setRecurrence]  = useState('monthly');
  const [date,        setDate]        = useState(new Date().toISOString().slice(0, 10));
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() =>
    filterCat === 'all' ? expenses : expenses.filter(e => e.category === filterCat),
    [expenses, filterCat],
  );

  // Monthly total (one-time expenses in this month + monthly/yearly prorated)
  const monthlyTotal = useMemo(() => {
    const { start, end } = thisMonthRange();
    return expenses.reduce((sum, e) => {
      const d = e.date?.toDate ? e.date.toDate() : new Date(e.date ?? e.createdAt?.toDate?.() ?? Date.now());
      if (e.recurrence === 'one-time') {
        return d >= start && d <= end ? sum + e.amount : sum;
      }
      if (e.recurrence === 'monthly') return sum + e.amount;
      if (e.recurrence === 'yearly')  return sum + Math.round(e.amount / 12);
      return sum;
    }, 0);
  }, [expenses]);

  const totalByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach(e => {
      const monthly = e.recurrence === 'yearly' ? Math.round(e.amount / 12) : e.recurrence === 'one-time' ? 0 : e.amount;
      map[e.category] = (map[e.category] || 0) + monthly;
    });
    return map;
  }, [expenses]);

  const resetForm = () => {
    setCategory('hosting'); setDescription(''); setAmount('');
    setRecurrence('monthly'); setDate(new Date().toISOString().slice(0, 10));
    setEditId(null);
  };

  const openEdit = (e: Expense) => {
    setCategory(e.category);
    setDescription(e.description);
    setAmount(String(e.amount));
    setRecurrence(e.recurrence);
    const d = e.date?.toDate ? e.date.toDate() : new Date(e.date ?? Date.now());
    setDate(d.toISOString().slice(0, 10));
    setEditId(e.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!description.trim()) { toast.error('Enter a description'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const payload = {
        category,
        description: description.trim(),
        amount: amt,
        recurrence,
        date: new Date(date),
        addedBy: profile?.name || 'Admin',
        updatedAt: serverTimestamp(),
      };
      if (editId) {
        await updateDoc(doc(db, 'expenses', editId), payload);
        toast.success('Expense updated');
      } else {
        await addDoc(collection(db, 'expenses'), { ...payload, createdAt: serverTimestamp() });
        toast.success('Expense added');
      }
      setShowForm(false);
      resetForm();
    } catch {
      toast.error('Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteDoc(doc(db, 'expenses', id));
      toast.success('Deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">App Expenses</h1>
          <p className="text-sm text-gray-400 mt-0.5">Server, domain, SMS, maintenance & other costs</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl font-bold text-sm shadow-md"
        >
          <Plus className="w-4 h-4" /> Add Expense
        </motion.button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 md:col-span-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">This Month's Expenses</p>
              <p className="text-2xl font-black text-red-600">â‚¹{monthlyTotal.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>
        {CATEGORIES.slice(0, 2).map(cat => (
          <div key={cat.id} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${cat.color.split(' ')[0]}`}>
              <cat.icon className={`w-4 h-4 ${cat.color.split(' ')[1]}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 truncate">{cat.label}</p>
            <p className="text-lg font-black text-gray-800">â‚¹{(totalByCategory[cat.id] || 0).toLocaleString('en-IN')}<span className="text-xs text-gray-400 font-medium">/mo</span></p>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Monthly Breakdown by Category</p>
        <div className="space-y-3">
          {CATEGORIES.map(cat => {
            const amt = totalByCategory[cat.id] || 0;
            const pct = monthlyTotal > 0 ? (amt / monthlyTotal) * 100 : 0;
            if (amt === 0) return null;
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.color.split(' ')[0]}`}>
                  <cat.icon className={`w-3.5 h-3.5 ${cat.color.split(' ')[1]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-bold text-gray-700">{cat.label}</span>
                    <span className="text-xs font-black text-gray-800">â‚¹{amt.toLocaleString('en-IN')}/mo</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div className={`h-1.5 rounded-full ${cat.color.split(' ')[0].replace('50', '400')}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
          {monthlyTotal === 0 && (
            <p className="text-center text-gray-400 text-sm py-4">No recurring expenses added yet</p>
          )}
        </div>
      </div>

      {/* Filter + List */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          {[{ id: 'all', label: 'All' }, ...CATEGORIES].map(c => (
            <button
              key={c.id}
              onClick={() => setFilterCat(c.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                filterCat === c.id
                  ? 'bg-brand text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
            <TrendingDown className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="font-bold text-gray-400">No expenses recorded yet</p>
            <p className="text-xs text-gray-300 mt-1">Click "Add Expense" to track your costs</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(e => {
              const cat = getCategoryMeta(e.category);
              const CatIcon = cat.icon;
              return (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cat.color.split(' ')[0]}`}>
                    <CatIcon className={`w-5 h-5 ${cat.color.split(' ')[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{e.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold text-gray-400 capitalize">{cat.label}</span>
                      <span className="text-[10px] text-gray-300">Â·</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        e.recurrence === 'monthly' ? 'bg-blue-50 text-blue-600' :
                        e.recurrence === 'yearly'  ? 'bg-purple-50 text-purple-600' :
                        'bg-gray-50 text-gray-500'
                      }`}>{e.recurrence}</span>
                      <span className="text-[10px] text-gray-300">Â·</span>
                      <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                        <Calendar className="w-2.5 h-2.5" />{formatDate(e.date ?? e.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-black text-red-600 text-base">â‚¹{e.amount.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-gray-400">
                      {e.recurrence === 'yearly' ? `â‚¹${Math.round(e.amount / 12)}/mo` : `/${e.recurrence.replace('one-time', 'once')}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 ml-2">
                    <button
                      onClick={() => openEdit(e)}
                      className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                    <button
                      onClick={() => remove(e.id)}
                      className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="bg-white rounded-[28px] w-full max-w-md p-6 space-y-5 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-black text-gray-900 text-lg">{editId ? 'Edit Expense' : 'Add Expense'}</h3>
                <button onClick={() => { setShowForm(false); resetForm(); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Category */}
              <div>
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Category</p>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(cat => {
                    const CatIcon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategory(cat.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all text-left ${
                          category === cat.id
                            ? 'border-brand bg-brand/5 text-brand'
                            : 'border-gray-100 text-gray-600 hover:border-gray-200'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${cat.color.split(' ')[0]}`}>
                          <CatIcon className={`w-3 h-3 ${cat.color.split(' ')[1]}`} />
                        </div>
                        <span className="leading-tight text-xs">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Description */}
              <div>
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Description</p>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Vercel Pro Plan, MSG91 credits..."
                  className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none focus:border-brand"
                />
              </div>

              {/* Amount + Recurrence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Amount (â‚¹)</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">â‚¹</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border-2 border-gray-100 pl-8 pr-4 py-3 text-sm font-bold text-gray-800 focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Recurrence</p>
                  <select
                    value={recurrence}
                    onChange={e => setRecurrence(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-100 px-3 py-3 text-sm font-bold text-gray-800 focus:outline-none focus:border-brand"
                  >
                    {RECURRENCE.map(r => (
                      <option key={r} value={r} className="capitalize">{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Date */}
              <div>
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Date</p>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none focus:border-brand"
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={save}
                disabled={saving}
                className="w-full py-4 rounded-2xl bg-brand text-white font-black text-base flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving
                  ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><Check className="w-5 h-5" /> {editId ? 'Update Expense' : 'Save Expense'}</>
                }
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
