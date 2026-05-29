import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Building2,
  Plus,
  X,
  MapPin,
  Phone,
  Mail,
  DollarSign,
  TrendingUp,
  Users,
  Bike,
  Store,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  Edit2,
  Banknote,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Franchise {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  commissionRate: number;
  status: 'active' | 'pending' | 'suspended';
  startDate: string;
  grossRevenue: number;
  totalOrders: number;
  activeRiders: number;
  activeRestaurants: number;
  avgRating: number;
  settlementStatus: 'pending' | 'settled';
  createdAt: Timestamp;
}

interface FranchiseFormData {
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  commissionRate: string;
  startDate: string;
}

type Tab = 'overview' | 'revenue' | 'performance';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-IN');
}

const STATUS_META: Record<Franchise['status'], { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  active: { label: 'Active', bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
  pending: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <AlertTriangle className="w-3 h-3" /> },
  suspended: { label: 'Suspended', bg: 'bg-red-100', text: 'text-red-700', icon: <X className="w-3 h-3" /> },
};

const EMPTY_FORM: FranchiseFormData = {
  name: '',
  ownerName: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  commissionRate: '10',
  startDate: new Date().toISOString().slice(0, 10),
};

// ─── Add Modal ────────────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void;
}

function AddModal({ onClose }: AddModalProps) {
  const [form, setForm] = useState<FranchiseFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FranchiseFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(form.commissionRate);
    if (!form.name.trim() || !form.ownerName.trim() || !form.city.trim() || !form.state.trim()) {
      toast.error('Please fill all required fields');
      return;
    }
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'franchises'), {
        name: form.name.trim(),
        ownerName: form.ownerName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        commissionRate: rate,
        status: 'pending',
        startDate: form.startDate,
        grossRevenue: 0,
        totalOrders: 0,
        activeRiders: 0,
        activeRestaurants: 0,
        avgRating: 0,
        settlementStatus: 'pending',
        createdAt: serverTimestamp(),
      });
      toast.success('Franchise added successfully');
      onClose();
    } catch (err: any) {
      toast.error('Failed to add franchise: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const fields: Array<{ key: keyof FranchiseFormData; label: string; type?: string; placeholder?: string; required?: boolean }> = [
    { key: 'name', label: 'Franchise Name', placeholder: 'e.g. ManaBites Hyderabad', required: true },
    { key: 'ownerName', label: 'Owner Name', placeholder: 'Full name', required: true },
    { key: 'phone', label: 'Phone Number', placeholder: '+91 9999999999', type: 'tel' },
    { key: 'email', label: 'Email Address', placeholder: 'owner@email.com', type: 'email' },
    { key: 'city', label: 'City', placeholder: 'City', required: true },
    { key: 'state', label: 'State', placeholder: 'State', required: true },
    { key: 'commissionRate', label: 'Commission Rate (%)', placeholder: '10', type: 'number' },
    { key: 'startDate', label: 'Start Date', type: 'date', required: true },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-800">Add New Franchise</h2>
              <p className="text-xs text-gray-400">Fill in the franchise partner details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map(f => (
              <div key={f.key} className={f.key === 'name' ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5">
                  {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type={f.type ?? 'text'}
                  value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  min={f.type === 'number' ? '0' : undefined}
                  max={f.type === 'number' ? '100' : undefined}
                  step={f.type === 'number' ? '0.5' : undefined}
                  className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none transition-colors placeholder:font-normal placeholder:text-gray-300"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border-2 border-gray-100 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <motion.button
              type="submit"
              disabled={saving}
              whileTap={{ scale: 0.97 }}
              className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-black hover:bg-brand/90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {saving ? 'Adding...' : 'Add Franchise'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Franchise['status'] }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black ${m.bg} ${m.text}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

// ─── Franchise Card ───────────────────────────────────────────────────────────

interface FranchiseCardProps {
  franchise: Franchise;
  onStatusChange: (id: string, status: Franchise['status']) => void;
  onSettle: (id: string) => void;
  onDelete: (franchise: Franchise) => void;
  actionLoadingId: string | null;
}

function FranchiseCard({ franchise: f, onStatusChange, onSettle, onDelete, actionLoadingId }: FranchiseCardProps) {
  const [showActions, setShowActions] = useState(false);
  const commissionEarned = (f.grossRevenue * f.commissionRate) / 100;
  const isLoading = actionLoadingId === f.id;

  const nextStatus: Record<Franchise['status'], { label: string; next: Franchise['status']; color: string }> = {
    active: { label: 'Suspend', next: 'suspended', color: 'text-red-600 hover:bg-red-50' },
    pending: { label: 'Activate', next: 'active', color: 'text-green-600 hover:bg-green-50' },
    suspended: { label: 'Activate', next: 'active', color: 'text-green-600 hover:bg-green-50' },
  };

  const action = nextStatus[f.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -3, boxShadow: '0 12px 40px rgba(0,0,0,0.10)' }}
      transition={{ duration: 0.25 }}
      className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden"
    >
      {/* Card Header */}
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-brand" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black text-gray-800 truncate">{f.name}</h3>
              <p className="text-xs text-gray-400 font-semibold">{f.ownerName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={f.status} />
            <div className="relative">
              <button
                onClick={() => setShowActions(v => !v)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showActions ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showActions && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: -4 }}
                    className="absolute right-0 top-8 bg-white border border-gray-100 rounded-xl shadow-lg z-20 py-1 w-36 overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setShowActions(false);
                        if (window.confirm(`${action.label} "${f.name}"?`)) onStatusChange(f.id, action.next);
                      }}
                      disabled={isLoading}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold transition-colors ${action.color}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {action.label}
                    </button>
                    {f.settlementStatus === 'pending' && (
                      <button
                        onClick={() => {
                          setShowActions(false);
                          if (window.confirm(`Settle commission for "${f.name}"?`)) onSettle(f.id);
                        }}
                        disabled={isLoading}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        Settle
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowActions(false);
                        onDelete(f);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <MapPin className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
            <span className="font-semibold truncate">{f.city}, {f.state}</span>
          </div>
          {f.phone && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Phone className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              <span className="truncate">{f.phone}</span>
            </div>
          )}
          {f.email && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Mail className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              <span className="truncate">{f.email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-100 border-t border-gray-100">
        {[
          { label: 'Orders', value: fmtInt(f.totalOrders), icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-brand' },
          { label: 'Revenue', value: `₹${fmtInt(f.grossRevenue)}`, icon: <DollarSign className="w-3.5 h-3.5" />, color: 'text-green-600' },
          { label: 'Riders', value: fmtInt(f.activeRiders), icon: <Bike className="w-3.5 h-3.5" />, color: 'text-blue-600' },
          { label: 'Restaurants', value: fmtInt(f.activeRestaurants), icon: <Store className="w-3.5 h-3.5" />, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white px-4 py-3">
            <div className={`flex items-center gap-1.5 ${s.color} mb-0.5`}>
              {s.icon}
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">{s.label}</span>
            </div>
            <p className="text-sm font-black text-gray-800">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Commission</span>
          <span className="bg-orange-50 text-brand text-xs font-black px-2 py-0.5 rounded-lg">{f.commissionRate}%</span>
          <span className="text-xs text-gray-500 font-semibold">= ₹{fmt(commissionEarned)}</span>
        </div>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${f.settlementStatus === 'settled' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
          {f.settlementStatus === 'settled' ? 'Settled' : 'Unsettled'}
        </span>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-2xl">
          <span className="w-6 h-6 border-3 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </motion.div>
  );
}

// ─── Revenue Table ─────────────────────────────────────────────────────────────

interface RevenueTableProps {
  franchises: Franchise[];
  onSettle: (id: string) => void;
  actionLoadingId: string | null;
}

function RevenueTable({ franchises, onSettle, actionLoadingId }: RevenueTableProps) {
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Franchise', 'City', 'Gross Revenue', 'Commission Earned', 'Net Payout', 'Settlement', 'Action'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-black text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {franchises.map(f => {
                const commission = (f.grossRevenue * f.commissionRate) / 100;
                const netPayout = f.grossRevenue - commission;
                const isLoading = actionLoadingId === f.id;
                return (
                  <motion.tr
                    key={f.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-800 whitespace-nowrap">{f.name}</p>
                      <p className="text-[10px] text-gray-400">{f.commissionRate}% rate</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{f.city}</td>
                    <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">₹{fmt(f.grossRevenue)}</td>
                    <td className="px-4 py-3 font-black text-green-700 whitespace-nowrap">₹{fmt(commission)}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">₹{fmt(netPayout)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-black whitespace-nowrap ${f.settlementStatus === 'settled' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {f.settlementStatus === 'settled' ? 'Settled' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {f.settlementStatus === 'pending' ? (
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            if (window.confirm(`Settle commission for "${f.name}"?`)) onSettle(f.id);
                          }}
                          disabled={isLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-black rounded-lg hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap transition-colors"
                        >
                          {isLoading
                            ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <Banknote className="w-3.5 h-3.5" />
                          }
                          Settle
                        </motion.button>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-bold">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Done
                        </span>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
        {franchises.length === 0 && (
          <div className="py-16 text-center">
            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 font-semibold">No franchises yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Performance Table ────────────────────────────────────────────────────────

function PerformanceTable({ franchises }: { franchises: Franchise[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Franchise', 'City', 'Status', 'Orders (Total)', 'Avg Rating', 'Active Riders', 'Restaurants'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-black text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {franchises.map(f => (
                <motion.tr
                  key={f.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="font-bold text-gray-800 whitespace-nowrap">{f.name}</p>
                    <p className="text-[10px] text-gray-400">{f.ownerName}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{f.city}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={f.status} />
                  </td>
                  <td className="px-4 py-3 font-bold text-gray-800">{fmtInt(f.totalOrders)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-800">{f.avgRating > 0 ? f.avgRating.toFixed(1) : '—'}</span>
                      {f.avgRating > 0 && (
                        <div className="flex-1 max-w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-yellow-400 rounded-full"
                            style={{ width: `${(f.avgRating / 5) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-blue-600 font-bold">
                      <Bike className="w-3.5 h-3.5" />
                      {fmtInt(f.activeRiders)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-purple-600 font-bold">
                      <Store className="w-3.5 h-3.5" />
                      {fmtInt(f.activeRestaurants)}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {franchises.length === 0 && (
          <div className="py-16 text-center">
            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 font-semibold">No franchises yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FranchiseManager() {
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Franchise['status']>('all');

  // Real-time listener
  useEffect(() => {
    const q = query(collection(db, 'franchises'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setFranchises(snap.docs.map(d => ({ id: d.id, ...d.data() } as Franchise)));
        setLoading(false);
      },
      err => {
        toast.error('Failed to load franchises: ' + err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Summary metrics
  const summary = useMemo(() => {
    const total = franchises.length;
    const active = franchises.filter(f => f.status === 'active').length;
    const totalRevenue = franchises.reduce((s, f) => s + f.grossRevenue, 0);
    const totalCommission = franchises.reduce((s, f) => s + (f.grossRevenue * f.commissionRate) / 100, 0);
    return { total, active, totalRevenue, totalCommission };
  }, [franchises]);

  // Filtered list for overview cards
  const filtered = useMemo(() => {
    let list = franchises;
    if (statusFilter !== 'all') list = list.filter(f => f.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        f =>
          f.name.toLowerCase().includes(q) ||
          f.city.toLowerCase().includes(q) ||
          f.ownerName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [franchises, statusFilter, searchQuery]);

  // Status change
  const handleStatusChange = async (id: string, status: Franchise['status']) => {
    setActionLoadingId(id);
    try {
      await updateDoc(doc(db, 'franchises', id), { status });
      toast.success(`Franchise ${status === 'active' ? 'activated' : 'suspended'}`);
    } catch (err: any) {
      toast.error('Status update failed: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Settle commission
  const handleSettle = async (id: string) => {
    setActionLoadingId(id);
    try {
      await updateDoc(doc(db, 'franchises', id), { settlementStatus: 'settled' });
      toast.success('Commission settled');
    } catch (err: any) {
      toast.error('Settlement failed: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete franchise
  const handleDelete = async (franchise: Franchise) => {
    if (!window.confirm(`Delete franchise "${franchise.name}"? This cannot be undone.`)) return;
    setActionLoadingId(franchise.id);
    try {
      await deleteDoc(doc(db, 'franchises', franchise.id));
      toast.success('Franchise deleted');
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'performance', label: 'Performance' },
  ];

  const summaryCards = [
    {
      label: 'Total Franchises',
      value: summary.total.toString(),
      icon: Building2,
      border: 'border-brand',
      iconBg: 'bg-orange-50',
      iconColor: 'text-brand',
    },
    {
      label: 'Active Franchises',
      value: summary.active.toString(),
      icon: CheckCircle,
      border: 'border-green-500',
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600',
    },
    {
      label: 'Total Revenue',
      value: `₹${fmtInt(Math.round(summary.totalRevenue))}`,
      icon: TrendingUp,
      border: 'border-blue-400',
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Commission Earned',
      value: `₹${fmt(summary.totalCommission)}`,
      icon: DollarSign,
      border: 'border-purple-400',
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-600',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-brand" />
            Franchise Management
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Manage ManaBites franchise partners across cities and regions
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl text-sm font-black hover:bg-brand/90 shadow-lg shadow-orange-200 transition-colors self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Franchise
        </motion.button>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((s, i) => (
          <motion.div
            key={s.label}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.border}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
          >
            <div className={`w-9 h-9 ${s.iconBg} rounded-xl flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.iconColor}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-black text-gray-800 mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <motion.button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            whileTap={{ scale: 0.96 }}
            className={`relative px-5 py-2 rounded-lg text-sm font-black transition-colors ${activeTab === t.key ? 'text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {activeTab === t.key && (
              <motion.div
                layoutId="tabBg"
                className="absolute inset-0 bg-white rounded-lg shadow-sm"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Overview Tab */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, city, owner..."
                className="flex-1 border-2 border-gray-100 focus:border-brand rounded-xl px-4 py-2.5 text-sm font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-gray-300"
              />
              <div className="flex gap-2 flex-wrap">
                {(['all', 'active', 'pending', 'suspended'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-4 py-2 rounded-xl text-xs font-black capitalize transition-colors ${statusFilter === s ? 'bg-brand text-white' : 'bg-white border-2 border-gray-100 text-gray-500 hover:border-brand hover:text-brand'}`}
                  >
                    {s === 'all' ? 'All' : STATUS_META[s as Franchise['status']].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cards */}
            {loading ? (
              <div className="text-center py-20 text-gray-400">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
                />
                Loading franchises...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <Building2 className="w-14 h-14 text-gray-200 mx-auto mb-4" />
                <p className="text-gray-400 font-bold text-lg">
                  {searchQuery || statusFilter !== 'all' ? 'No franchises match your filter' : 'No franchises yet'}
                </p>
                {!searchQuery && statusFilter === 'all' && (
                  <p className="text-gray-300 text-sm mt-1">Click "Add Franchise" to onboard your first franchise partner</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <AnimatePresence>
                  {filtered.map(f => (
                    <FranchiseCard
                      key={f.id}
                      franchise={f}
                      onStatusChange={handleStatusChange}
                      onSettle={handleSettle}
                      onDelete={handleDelete}
                      actionLoadingId={actionLoadingId}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}

        {/* Revenue Tab */}
        {activeTab === 'revenue' && (
          <motion.div
            key="revenue"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {loading ? (
              <div className="text-center py-20 text-gray-400">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
                />
                Loading revenue data...
              </div>
            ) : (
              <RevenueTable
                franchises={franchises}
                onSettle={handleSettle}
                actionLoadingId={actionLoadingId}
              />
            )}
          </motion.div>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {loading ? (
              <div className="text-center py-20 text-gray-400">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
                />
                Loading performance data...
              </div>
            ) : (
              <PerformanceTable franchises={franchises} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Modal */}
      <AnimatePresence>
        {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      </AnimatePresence>
    </div>
  );
}
