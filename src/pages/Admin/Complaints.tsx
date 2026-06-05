import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp,
  getDoc, addDoc, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  AlertTriangle, Search, CheckCircle, Clock, XCircle,
  MessageSquare, Store, Bike, User, IndianRupee, RefreshCw,
  Shield, History,
} from 'lucide-react';

interface Complaint {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  type: 'restaurant' | 'rider' | 'general';
  targetId: string;
  targetName: string;
  restaurantId: string;
  restaurantName: string;
  riderId?: string;
  riderName?: string;
  category: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  isLive: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: any;
  resolvedAt?: any;
  resolution?: string;
  resolvedBy?: string;
  refundStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  refundAmount?: number;
  refundPct?: number;
  orderAmount?: number;
}

// ── Refund Engine ──────────────────────────────────────────────────────────
const REFUND_RULES: Record<string, { pct: number; action: 'approve' | 'escalate' | 'reject'; label: string }> = {
  food_not_delivered:  { pct: 100, action: 'approve',  label: 'Food Not Delivered' },
  not_preparing:       { pct: 100, action: 'approve',  label: 'Order Not Prepared' },
  wrong_items:         { pct: 100, action: 'approve',  label: 'Wrong Item Delivered' },
  missing_items:       { pct: 100, action: 'approve',  label: 'Missing Item' },
  damaged_food:        { pct: 100, action: 'approve',  label: 'Damaged Food' },
  spoiled_food:        { pct: 100, action: 'approve',  label: 'Spoiled Food' },
  expired_food:        { pct: 100, action: 'approve',  label: 'Expired Food' },
  restaurant_closed:   { pct: 100, action: 'approve',  label: 'Restaurant Closed After Order' },
  duplicate_payment:   { pct: 100, action: 'approve',  label: 'Duplicate Payment' },
  spilled_delivery:    { pct: 100, action: 'approve',  label: 'Spilled During Delivery' },
  wrong_quantity:      { pct: 100, action: 'approve',  label: 'Wrong Quantity' },
  different_order:     { pct: 100, action: 'approve',  label: 'Different Order Received' },
  missing_addons:      { pct: 100, action: 'approve',  label: 'Missing Add-ons' },
  cold_food:           { pct: 30,  action: 'approve',  label: 'Cold Food Received' },
  damaged_packaging:   { pct: 20,  action: 'approve',  label: 'Packaging Issue' },
  late_delivery:       { pct: 20,  action: 'approve',  label: 'Late Delivery (>30 min)' },
  late_60min:          { pct: 30,  action: 'approve',  label: 'Late Delivery (>60 min)' },
  rider_rude:          { pct: 0,   action: 'escalate', label: 'Rider Misbehavior' },
  restaurant_rude:     { pct: 0,   action: 'escalate', label: 'Restaurant Rude Behavior' },
  fake_complaint:      { pct: 0,   action: 'reject',   label: 'Fake Complaint' },
  other_restaurant:    { pct: 0,   action: 'escalate', label: 'Other (Restaurant)' },
  other_rider:         { pct: 0,   action: 'escalate', label: 'Other (Rider)' },
  other:               { pct: 0,   action: 'escalate', label: 'Other' },
};

function calcRefund(category: string, orderAmount: number) {
  const rule = REFUND_RULES[category] ?? { pct: 0, action: 'escalate', label: category };
  const amount = Math.min(Math.round(orderAmount * rule.pct / 100), orderAmount);
  return { pct: rule.pct, amount, action: rule.action, label: rule.label };
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(REFUND_RULES).map(([k, v]) => [k, v.label])
);

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-orange-100 text-orange-700 border-orange-200',
  low:    'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_COLORS: Record<string, string> = {
  open:         'bg-red-50 text-red-700 border-red-200',
  investigating:'bg-purple-50 text-purple-700 border-purple-200',
  resolved:     'bg-green-50 text-green-700 border-green-200',
  closed:       'bg-gray-50 text-gray-500 border-gray-200',
};

function timeAgo(ts: any) {
  if (!ts) return '—';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function fmtDate(ts: any) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Complaints() {
  const { profile } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [manualRefundAmt, setManualRefundAmt] = useState('');
  const [useManualRefund, setUseManualRefund] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'complaints'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setComplaints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Complaint)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selected || !showHistory) return;
    const q = query(
      collection(db, 'refundHistory'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((h: any) => h.complaintId === selected.id));
    });
    return () => unsub();
  }, [selected, showHistory]);

  const filtered = useMemo(() => {
    let list = complaints;
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (filterType !== 'all') list = list.filter(c => c.type === filterType);
    if (filterPriority !== 'all') list = list.filter(c => c.priority === filterPriority);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.customerName?.toLowerCase().includes(q) ||
        c.targetName?.toLowerCase().includes(q) ||
        c.orderId?.toLowerCase().includes(q) ||
        (CATEGORY_LABELS[c.category] || c.category).toLowerCase().includes(q)
      );
    }
    return list;
  }, [complaints, filterStatus, filterType, filterPriority, search]);

  const stats = useMemo(() => ({
    open:         complaints.filter(c => c.status === 'open').length,
    investigating:complaints.filter(c => c.status === 'investigating').length,
    resolved:     complaints.filter(c => c.status === 'resolved').length,
    closed:       complaints.filter(c => c.status === 'closed').length,
  }), [complaints]);

  const updateStatus = async (id: string, status: Complaint['status']) => {
    try {
      await updateDoc(doc(db, 'complaints', id), {
        status,
        updatedAt: serverTimestamp(),
        ...(['resolved', 'closed'].includes(status) ? { resolvedAt: serverTimestamp(), resolvedBy: profile?.name || 'Admin' } : {}),
      });
      if (selected?.id === id) setSelected(prev => prev ? { ...prev, status } : null);
      toast.success(`Status: ${status}`);
    } catch { toast.error('Update failed'); }
  };

  const saveResolution = async () => {
    if (!selected || !resolution.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'complaints', selected.id), {
        status: 'resolved',
        resolution: resolution.trim(),
        resolvedAt: serverTimestamp(),
        resolvedBy: profile?.name || 'Admin',
        updatedAt: serverTimestamp(),
      });
      setSelected(prev => prev ? { ...prev, status: 'resolved', resolution: resolution.trim() } : null);
      toast.success('Resolution saved');
      setResolution('');
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  const processRefund = async () => {
    if (!selected?.customerId || !selected?.orderId) {
      toast.error('Missing customer or order info');
      return;
    }
    setRefunding(true);
    try {
      const orderSnap = await getDoc(doc(db, 'orders', selected.orderId)).catch(() => null);
      const orderAmt = orderSnap?.data()?.total ?? orderSnap?.data()?.totalAmount ?? selected.orderAmount ?? 0;
      const { pct, amount: autoAmount, action } = calcRefund(selected.category, orderAmt);

      if (action === 'reject') {
        await updateDoc(doc(db, 'complaints', selected.id), { refundStatus: 'rejected', updatedAt: serverTimestamp() });
        toast.error('Fake complaint — Refund rejected');
        setSelected(prev => prev ? { ...prev, refundStatus: 'rejected' } : null);
        return;
      }

      const finalAmount = useManualRefund && manualRefundAmt
        ? Math.min(Number(manualRefundAmt), orderAmt)
        : autoAmount;

      if (finalAmount <= 0) { toast.error('No refund applicable'); return; }

      // Credit wallet
      const walletRef = doc(db, 'wallets', selected.customerId);
      const walletSnap = await getDoc(walletRef).catch(() => null);
      if (walletSnap?.exists()) {
        await updateDoc(walletRef, { balance: (walletSnap.data().balance ?? 0) + finalAmount, updatedAt: Timestamp.now() });
      } else {
        const { setDoc } = await import('firebase/firestore');
        await setDoc(walletRef, { walletType: 'customer', ownerId: selected.customerId, balance: finalAmount, updatedAt: Timestamp.now() });
      }

      // Log refund history
      await addDoc(collection(db, 'refundHistory'), {
        complaintId:  selected.id,
        orderId:      selected.orderId,
        customerId:   selected.customerId,
        customerName: selected.customerName,
        category:     selected.category,
        orderAmount:  orderAmt,
        refundAmount: finalAmount,
        refundPct:    useManualRefund ? Math.round((finalAmount / orderAmt) * 100) : pct,
        refundMethod: 'ManaBites Wallet',
        status:       'approved',
        isManual:     useManualRefund,
        processedBy:  profile?.name || 'Admin',
        createdAt:    Timestamp.now(),
      });

      // Update complaint
      await updateDoc(doc(db, 'complaints', selected.id), {
        status:       'resolved',
        refundStatus: 'approved',
        refundAmount: finalAmount,
        refundPct:    pct,
        orderAmount:  orderAmt,
        resolvedAt:   serverTimestamp(),
        resolvedBy:   profile?.name || 'Admin',
        updatedAt:    serverTimestamp(),
      });

      setSelected(prev => prev ? { ...prev, status: 'resolved', refundStatus: 'approved', refundAmount: finalAmount } : null);
      toast.success(`₹${finalAmount} refunded to ${selected.customerName}'s wallet!`);
      setManualRefundAmt('');
      setUseManualRefund(false);
    } catch (e: any) {
      toast.error('Refund failed: ' + e.message);
    } finally {
      setRefunding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <div className="w-10 h-10 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Complaints Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage complaints with refund engine & full history</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open',         value: stats.open,          color: 'text-red-600',    bg: 'bg-red-50',    icon: XCircle },
          { label: 'Investigating',value: stats.investigating,  color: 'text-purple-600', bg: 'bg-purple-50', icon: Shield },
          { label: 'Resolved',     value: stats.resolved,       color: 'text-green-600',  bg: 'bg-green-50',  icon: CheckCircle },
          { label: 'Closed',       value: stats.closed,         color: 'text-gray-500',   bg: 'bg-gray-50',   icon: MessageSquare },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-black text-gray-900">{value}</p>
              <p className="text-xs font-bold text-gray-400">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-48">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, order, category..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400" />
        </div>
        {[
          { value: filterStatus, onChange: setFilterStatus, options: [['all','All Status'],['open','Open'],['investigating','Investigating'],['resolved','Resolved'],['closed','Closed']] },
          { value: filterType, onChange: setFilterType, options: [['all','All Types'],['restaurant','Restaurant'],['rider','Rider'],['general','General']] },
          { value: filterPriority, onChange: setFilterPriority, options: [['all','All Priority'],['high','High'],['medium','Medium'],['low','Low']] },
        ].map((sel, i) => (
          <select key={i} value={sel.value} onChange={e => sel.onChange(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 outline-none">
            {sel.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
      </div>

      {/* Main layout */}
      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[1fr_420px]' : ''}`}>
        {/* List */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <AlertTriangle className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="font-bold text-gray-400">No complaints found</p>
            </div>
          )}
          {filtered.map(c => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => { setSelected(c); setResolution(c.resolution || ''); setShowHistory(false); setUseManualRefund(false); setManualRefundAmt(''); }}
              className={`bg-white rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${selected?.id === c.id ? 'border-brand shadow-md' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.type === 'rider' ? 'bg-blue-50' : 'bg-orange-50'}`}>
                    {c.type === 'rider' ? <Bike className="w-4 h-4 text-blue-600" /> : <Store className="w-4 h-4 text-orange-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-gray-900 text-sm">{c.customerName}</span>
                      {c.isLive && <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>}
                      {c.refundStatus === 'approved' && <span className="text-[10px] font-black bg-green-100 text-green-600 px-2 py-0.5 rounded-full">REFUNDED ₹{c.refundAmount}</span>}
                    </div>
                    <p className="text-xs text-gray-500 font-bold mt-0.5">{CATEGORY_LABELS[c.category] || c.category} · {c.targetName}</p>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1">{c.description}</p>
                    <p className="text-[10px] text-gray-300 mt-1">#{c.orderId?.slice(-8).toUpperCase()} · {timeAgo(c.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 items-end shrink-0">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${STATUS_COLORS[c.status] || STATUS_COLORS.open}`}>{c.status.replace('_', ' ')}</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${PRIORITY_COLORS[c.priority]}`}>{c.priority}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selected && (
            <motion.div key={selected.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="bg-white rounded-2xl border-2 border-gray-100 p-5 space-y-4 h-fit sticky top-20">

              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-black text-gray-900">Complaint Detail</h3>
                  <p className="text-xs text-gray-400 mt-0.5">#{selected.orderId?.slice(-8).toUpperCase()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowHistory(h => !h)}
                    className={`p-1.5 rounded-lg ${showHistory ? 'bg-brand text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                    <History className="w-4 h-4" />
                  </button>
                  <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">
                    <XCircle className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* History panel */}
              {showHistory && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Refund History</p>
                  {history.length === 0
                    ? <p className="text-xs text-gray-400">No refund history</p>
                    : history.map(h => (
                        <div key={h.id} className="bg-white rounded-lg p-2 text-xs border border-gray-100">
                          <div className="flex justify-between">
                            <span className="font-bold text-green-700">₹{h.refundAmount}</span>
                            <span className="text-gray-400">{fmtDate(h.createdAt)}</span>
                          </div>
                          <p className="text-gray-500">{h.refundPct}% · {h.refundMethod} · by {h.processedBy}</p>
                        </div>
                      ))
                  }
                </div>
              )}

              {/* Info */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                  <User className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="font-black text-gray-800">{selected.customerName}</p>
                    {selected.customerPhone && <p className="text-xs text-gray-400">{selected.customerPhone}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                  {selected.type === 'rider' ? <Bike className="w-4 h-4 text-blue-500 shrink-0" /> : <Store className="w-4 h-4 text-orange-500 shrink-0" />}
                  <div>
                    <p className="font-black text-gray-800">{selected.targetName}</p>
                    <p className="text-xs text-gray-400 capitalize">{selected.type} complaint</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Category</p>
                  <p className="font-bold text-gray-800">{CATEGORY_LABELS[selected.category] || selected.category}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Description</p>
                  <p className="text-gray-700 text-sm leading-relaxed">{selected.description}</p>
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap gap-1.5">
                  {['open','investigating','resolved','closed'].map(s => (
                    <button key={s} onClick={() => updateStatus(selected.id, s as any)}
                      className={`text-[10px] font-black px-2.5 py-1 rounded-full border uppercase transition-all ${
                        selected.status === s ? STATUS_COLORS[s] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Refund Engine */}
              {selected.refundStatus !== 'approved' && (
                <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-black text-orange-700 uppercase tracking-wide">🤖 Refund Engine</p>
                  {(() => {
                    const orderAmt = selected.orderAmount ?? 0;
                    const { pct, amount, action } = calcRefund(selected.category, orderAmt);
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {[
                            ['Customer',      selected.customerName],
                            ['Order ID',      selected.orderId?.slice(-8).toUpperCase()],
                            ['Complaint',     CATEGORY_LABELS[selected.category] || selected.category],
                            ['Order Amount',  `₹${orderAmt || '—'}`],
                            ['Refund %',      `${pct}%`],
                            ['Auto Amount',   `₹${amount}`],
                          ].map(([k, v]) => (
                            <div key={k} className="bg-white rounded-lg p-2">
                              <p className="text-gray-400 font-bold text-[10px]">{k}</p>
                              <p className="font-black text-gray-800 text-xs truncate">{v}</p>
                            </div>
                          ))}
                        </div>

                        {/* Manual refund toggle */}
                        <label className="flex items-center gap-2 cursor-pointer">
                          <div onClick={() => setUseManualRefund(p => !p)}
                            className={`w-8 h-5 rounded-full transition-colors relative ${useManualRefund ? 'bg-brand' : 'bg-gray-200'}`}>
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useManualRefund ? 'translate-x-3' : 'translate-x-0.5'}`} />
                          </div>
                          <span className="text-xs font-semibold text-gray-600">Manual refund amount</span>
                        </label>

                        {useManualRefund && (
                          <div className="flex items-center gap-2 bg-white border border-orange-200 rounded-xl px-3 py-2">
                            <IndianRupee className="w-4 h-4 text-orange-500 shrink-0" />
                            <input type="number" value={manualRefundAmt} onChange={e => setManualRefundAmt(e.target.value)}
                              placeholder="Enter amount" min={1}
                              className="flex-1 text-sm font-bold outline-none text-orange-800 placeholder-orange-300 bg-transparent" />
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-black px-2 py-1 rounded-lg ${
                            action === 'approve' ? 'bg-green-100 text-green-700' :
                            action === 'escalate' ? 'bg-purple-100 text-purple-700' :
                            'bg-red-100 text-red-600'}`}>
                            {action === 'approve' ? '✅ Auto Approve' : action === 'escalate' ? '⚠️ Escalate' : '❌ Reject'}
                          </span>
                          <button onClick={processRefund} disabled={refunding}
                            className="flex items-center gap-1.5 text-xs font-black px-4 py-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 disabled:opacity-50 transition-colors">
                            {refunding ? <><RefreshCw className="w-3 h-3 animate-spin" /> Processing…</> : <><IndianRupee className="w-3 h-3" /> Process Refund</>}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Approved refund receipt */}
              {selected.refundStatus === 'approved' && selected.refundAmount && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 font-mono text-xs space-y-1">
                  <div className="flex justify-between mb-2">
                    <span className="font-black text-green-700">✅ Refund Approved</span>
                    <span className="text-green-600">Wallet</span>
                  </div>
                  {[
                    ['Customer',   selected.customerName],
                    ['Order ID',   selected.orderId?.slice(-8).toUpperCase()],
                    ['Category',   CATEGORY_LABELS[selected.category] || selected.category],
                    ['Refund %',   `${selected.refundPct ?? '—'}%`],
                    ['Amount',     `₹${selected.refundAmount}`],
                    ['Date',       fmtDate(selected.resolvedAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-gray-400">{k}:</span>
                      <span className={`font-bold ${k === 'Amount' ? 'text-green-700' : 'text-gray-700'}`}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Resolution */}
              {!['resolved', 'closed'].includes(selected.status) && (
                <div className="space-y-2">
                  <textarea value={resolution} onChange={e => setResolution(e.target.value)}
                    placeholder="Add resolution notes..."
                    rows={3}
                    className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 p-3 text-sm resize-none focus:outline-none focus:border-brand" />
                  <button onClick={saveResolution} disabled={saving || !resolution.trim()}
                    className="w-full py-2.5 rounded-xl bg-brand text-white font-bold text-sm disabled:opacity-50">
                    {saving ? 'Saving...' : '✓ Resolve with Notes'}
                  </button>
                </div>
              )}

              {selected.resolution && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-1">Resolution</p>
                  <p className="text-sm text-green-800">{selected.resolution}</p>
                  {selected.resolvedBy && <p className="text-xs text-green-500 mt-1">by {selected.resolvedBy} · {fmtDate(selected.resolvedAt)}</p>}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
