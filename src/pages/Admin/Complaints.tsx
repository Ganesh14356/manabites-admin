import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  AlertTriangle, Search, CheckCircle, Clock, XCircle,
  Filter, MessageSquare, Store, Bike, User, ChevronDown,
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
  status: 'open' | 'in_progress' | 'resolved';
  isLive: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: any;
  resolvedAt?: any;
  resolution?: string;
  resolvedBy?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  wrong_items: 'Wrong Items',
  missing_items: 'Missing Items',
  food_quality: 'Poor Food Quality',
  not_preparing: 'Not Preparing',
  restaurant_rude: 'Rude Restaurant',
  other_restaurant: 'Other (Restaurant)',
  rider_not_responding: 'Rider Not Responding',
  late_delivery: 'Very Late Delivery',
  wrong_location: 'Wrong Location',
  rider_rude: 'Rude Rider',
  delivery_issue: 'Delivery Issue',
  other_rider: 'Other (Rider)',
  cold_food: 'Food Was Cold',
  damaged_packaging: 'Damaged Packaging',
  other: 'Other',
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-orange-100 text-orange-700 border-orange-200',
  low:    'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-red-50 text-red-700 border-red-200',
  in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  resolved:    'bg-green-50 text-green-700 border-green-200',
};

function timeAgo(ts: any) {
  if (!ts) return 'â€”';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
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

  useEffect(() => {
    const q = query(collection(db, 'complaints'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setComplaints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Complaint)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = complaints;
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (filterType !== 'all') list = list.filter(c => c.type === filterType);
    if (filterPriority !== 'all') list = list.filter(c => c.priority === filterPriority);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.customerName.toLowerCase().includes(q) ||
        c.targetName.toLowerCase().includes(q) ||
        c.orderId.toLowerCase().includes(q) ||
        (CATEGORY_LABELS[c.category] || c.category).toLowerCase().includes(q)
      );
    }
    return list;
  }, [complaints, filterStatus, filterType, filterPriority, search]);

  const stats = useMemo(() => ({
    open:        complaints.filter(c => c.status === 'open').length,
    in_progress: complaints.filter(c => c.status === 'in_progress').length,
    resolved:    complaints.filter(c => c.status === 'resolved').length,
    high:        complaints.filter(c => c.priority === 'high' && c.status !== 'resolved').length,
  }), [complaints]);

  const updateStatus = async (id: string, status: Complaint['status']) => {
    try {
      await updateDoc(doc(db, 'complaints', id), {
        status,
        updatedAt: serverTimestamp(),
        ...(status === 'resolved' ? { resolvedAt: serverTimestamp(), resolvedBy: profile?.name || 'Admin' } : {}),
      });
      if (selected?.id === id) setSelected(prev => prev ? { ...prev, status } : null);
      toast.success(`Complaint marked as ${status.replace('_', ' ')}`);
    } catch {
      toast.error('Failed to update status');
    }
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
      toast.success('Resolution saved and complaint resolved');
      setResolution('');
    } catch {
      toast.error('Failed to save resolution');
    } finally {
      setSaving(false);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Complaints</h1>
          <p className="text-sm text-gray-500 mt-0.5">Customer complaints about orders, restaurants & riders</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open', value: stats.open, color: 'text-red-600', bg: 'bg-red-50', icon: XCircle },
          { label: 'In Progress', value: stats.in_progress, color: 'text-yellow-600', bg: 'bg-yellow-50', icon: Clock },
          { label: 'Resolved', value: stats.resolved, color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle },
          { label: 'High Priority', value: stats.high, color: 'text-orange-600', bg: 'bg-orange-50', icon: AlertTriangle },
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
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search complaints..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 outline-none"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 outline-none"
        >
          <option value="all">All Types</option>
          <option value="restaurant">Restaurant</option>
          <option value="rider">Rider</option>
          <option value="general">General</option>
        </select>
        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 outline-none"
        >
          <option value="all">All Priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Main layout */}
      <div className={`grid gap-4 ${selected ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
        {/* Complaint list */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <AlertTriangle className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="font-bold text-gray-400">No complaints found</p>
            </div>
          )}
          {filtered.map(complaint => (
            <motion.div
              key={complaint.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => { setSelected(complaint); setResolution(complaint.resolution || ''); }}
              className={`bg-white rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                selected?.id === complaint.id ? 'border-brand shadow-md' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Type icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    complaint.type === 'rider' ? 'bg-blue-50' : 'bg-orange-50'
                  }`}>
                    {complaint.type === 'rider'
                      ? <Bike className="w-4 h-4 text-blue-600" />
                      : <Store className="w-4 h-4 text-orange-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-gray-900 text-sm truncate">{complaint.customerName}</span>
                      {complaint.isLive && (
                        <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wide animate-pulse">
                          Live
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 font-bold mt-0.5">
                      {CATEGORY_LABELS[complaint.category] || complaint.category} Â· {complaint.targetName}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{complaint.description}</p>
                    <p className="text-[10px] text-gray-300 mt-1">#{complaint.orderId.slice(-8).toUpperCase()} Â· {timeAgo(complaint.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 items-end flex-shrink-0">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${STATUS_COLORS[complaint.status]}`}>
                    {complaint.status.replace('_', ' ')}
                  </span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${PRIORITY_COLORS[complaint.priority]}`}>
                    {complaint.priority}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-white rounded-2xl border-2 border-gray-100 p-5 space-y-5 h-fit sticky top-20"
            >
              {/* Detail header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-black text-gray-900">Complaint Detail</h3>
                  <p className="text-xs text-gray-400 mt-0.5">#{selected.orderId.slice(-8).toUpperCase()}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">
                  <XCircle className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Info rows */}
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                  <User className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="font-black text-gray-800">{selected.customerName}</p>
                    {selected.customerPhone && <p className="text-xs text-gray-400">{selected.customerPhone}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                  {selected.type === 'rider'
                    ? <Bike className="w-4 h-4 text-blue-500 shrink-0" />
                    : <Store className="w-4 h-4 text-orange-500 shrink-0" />
                  }
                  <div>
                    <p className="font-black text-gray-800">{selected.targetName}</p>
                    <p className="text-xs text-gray-400 capitalize">{selected.type} complaint</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Category</p>
                  <p className="font-bold text-gray-800">{CATEGORY_LABELS[selected.category] || selected.category}</p>
                </div>

                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Description</p>
                  <p className="text-gray-700 leading-relaxed">{selected.description}</p>
                </div>

                <div className="flex gap-2">
                  <span className={`text-xs font-black px-3 py-1 rounded-full border ${STATUS_COLORS[selected.status]}`}>
                    {selected.status.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className={`text-xs font-black px-3 py-1 rounded-full border ${PRIORITY_COLORS[selected.priority]}`}>
                    {selected.priority.toUpperCase()} PRIORITY
                  </span>
                  {selected.isLive && (
                    <span className="text-xs font-black px-3 py-1 rounded-full bg-red-100 text-red-600 border border-red-200">
                      LIVE ORDER
                    </span>
                  )}
                </div>
              </div>

              {/* Resolution */}
              {selected.status === 'resolved' && selected.resolution ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-1">Resolution</p>
                  <p className="text-sm text-green-800">{selected.resolution}</p>
                  {selected.resolvedBy && (
                    <p className="text-xs text-green-500 mt-1">Resolved by {selected.resolvedBy}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={resolution}
                    onChange={e => setResolution(e.target.value)}
                    placeholder="Add resolution notes..."
                    rows={3}
                    className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 p-3 text-sm resize-none focus:outline-none focus:border-brand"
                  />
                  <div className="flex gap-2">
                    {selected.status !== 'in_progress' && (
                      <button
                        onClick={() => updateStatus(selected.id, 'in_progress')}
                        className="flex-1 py-2.5 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-700 font-bold text-xs"
                      >
                        Mark In Progress
                      </button>
                    )}
                    <button
                      onClick={saveResolution}
                      disabled={saving || !resolution.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-brand text-white font-bold text-xs disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Resolve'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
