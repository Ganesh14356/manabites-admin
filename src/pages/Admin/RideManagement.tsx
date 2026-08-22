/**
 * RideManagement — Enterprise-grade Ride Management Module for ManaBites Admin
 *
 * Tabs: Dashboard · Live Rides · Cancellations · No-Show · Fare Config · Reports
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, where, orderBy,
  limit as fsLimit, updateDoc, getDocs, Timestamp, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../firebase';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Activity, AlertTriangle, Ban, Car, CheckCircle, Clock,
  DollarSign, Download, Eye, MapPin, Phone, RefreshCw,
  TrendingUp, Users, Zap, XCircle, Shield, Package, Bike,
  X, ChevronDown, Printer,
} from 'lucide-react';

function fmtDate(ts: any): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : (ts?.toDate ? ts.toDate() : new Date(ts));
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const RIDE_STATUSES = ['pending', 'accepted', 'at_restaurant', 'picked_up', 'at_customer', 'delivered', 'completed', 'cancelled', 'customer_unavailable'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideOrder {
  id: string;
  type: string;
  subType?: string;
  status: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  assignedRiderId?: string;
  riderName?: string;
  riderPhone?: string;
  vehicleType?: string;
  pickupAddress?: any;
  dropAddress?: any;
  fare?: number;
  distance?: number;
  distanceKm?: number;
  createdAt?: number;
  acceptedAt?: number;
  arrivedAtPickup?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;
  cancellationFee?: number;
  riderLocation?: { lat: number; lng: number };
}

interface CancellationRecord {
  id: string;
  orderId: string;
  orderType: string;
  cancelledBy: string;
  cancelReason: string;
  fee: number;
  feeType: string;
  chargedTo: string | null;
  riderId: string | null;
  customerId: string | null;
  cancelledAt: number;
  fare: number;
}

interface DashboardStats {
  totalToday: number;
  active: number;
  completed: number;
  cancelled: number;
  noShow: number;
  totalRevenue: number;
  riderEarnings: number;
  companyEarnings: number;
  ridersOnline: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard',     label: 'Dashboard',     icon: <Activity size={16} /> },
  { id: 'live',          label: 'Live Rides',    icon: <Zap size={16} /> },
  { id: 'cancellations', label: 'Cancellations', icon: <XCircle size={16} /> },
  { id: 'noshow',        label: 'No-Show',       icon: <AlertTriangle size={16} /> },
  { id: 'fare',          label: 'Fare Config',   icon: <DollarSign size={16} /> },
  { id: 'reports',       label: 'Reports',       icon: <Download size={16} /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

const STATUS_COLORS: Record<string, string> = {
  pending:           'bg-gray-100 text-gray-700',
  searching:         'bg-yellow-100 text-yellow-700',
  accepted:          'bg-blue-100 text-blue-700',
  at_restaurant:     'bg-blue-200 text-blue-800',
  picked_up:         'bg-orange-100 text-orange-700',
  at_customer:       'bg-orange-200 text-orange-800',
  delivered:         'bg-green-100 text-green-700',
  completed:         'bg-green-100 text-green-700',
  cancelled:         'bg-red-100 text-red-700',
  customer_unavailable: 'bg-red-200 text-red-800',
  out_for_delivery:  'bg-blue-100 text-blue-700',
};

const CHART_COLORS = ['#22C55E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const VEHICLE_ICONS: Record<string, React.ReactNode> = {
  Bike: <Bike size={14} />,
  Cab:  <Car size={14} />,
  Auto: <Zap size={14} />,
  parcel: <Package size={14} />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return `₹${n.toLocaleString('en-IN')}`; }
function fmtAddr(a: any): string {
  if (!a) return '—';
  if (typeof a === 'string') return a;
  return a.address || a.name || '—';
}
function minutesAgo(ts: number | undefined): string {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
const startOfDay = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-black text-gray-900 font-mono">{value}</p>
      <p className="text-sm font-bold text-gray-700 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats>({
    totalToday: 0, active: 0, completed: 0, cancelled: 0,
    noShow: 0, totalRevenue: 0, riderEarnings: 0, companyEarnings: 0, ridersOnline: 0,
  });
  const [hourlyData, setHourlyData] = useState<{ hour: string; rides: number; revenue: number }[]>([]);
  const [typeData,   setTypeData]   = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    const todayStart = startOfDay();

    // Watch today's ride orders
    const q = query(
      collection(db, 'orders'),
      where('type', 'in', ['ride', 'courier']),
      where('createdAt', '>=', todayStart),
    );

    const unsub = onSnapshot(q, snap => {
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() } as RideOrder));
      const active    = orders.filter(o => !['delivered','cancelled','completed'].includes(o.status)).length;
      const completed = orders.filter(o => ['delivered','completed'].includes(o.status)).length;
      const cancelled = orders.filter(o => o.status === 'cancelled').length;
      const noShow    = orders.filter(o => o.status === 'customer_unavailable').length;
      const revenue   = orders.filter(o => ['delivered','completed'].includes(o.status))
                              .reduce((s, o) => s + (o.fare || 0), 0);
      const rEarnings = Math.round(revenue * 0.8);
      const cEarnings = revenue - rEarnings;

      // Hourly breakdown
      const hours: Record<string, { rides: number; revenue: number }> = {};
      for (let h = 0; h < 24; h++) hours[String(h).padStart(2, '0')] = { rides: 0, revenue: 0 };
      orders.forEach(o => {
        if (!o.createdAt) return;
        const h = String(new Date(o.createdAt).getHours()).padStart(2, '0');
        if (hours[h]) {
          hours[h].rides++;
          if (['delivered','completed'].includes(o.status)) hours[h].revenue += o.fare || 0;
        }
      });
      setHourlyData(Object.entries(hours).map(([hour, d]) => ({ hour: `${hour}:00`, ...d })));

      // Vehicle type breakdown
      const typeCounts: Record<string, number> = { Bike: 0, Auto: 0, Cab: 0, Parcel: 0 };
      orders.forEach(o => {
        const t = o.vehicleType || (o.type === 'courier' ? 'Parcel' : 'Bike');
        if (typeCounts[t] !== undefined) typeCounts[t]++;
        else typeCounts['Bike']++;
      });
      setTypeData(Object.entries(typeCounts).map(([name, value]) => ({ name, value })));

      setStats({ totalToday: orders.length, active, completed, cancelled, noShow, totalRevenue: revenue, riderEarnings: rEarnings, companyEarnings: cEarnings, ridersOnline: 0 });
      setLoading(false);
    }, () => setLoading(false));

    // Watch online riders
    const riderQ = query(collection(db, 'riders'), where('isOnline', '==', true));
    const unsub2 = onSnapshot(riderQ, snap => {
      setStats(s => ({ ...s, ridersOnline: snap.size }));
    }, () => {});

    return () => { unsub(); unsub2(); };
  }, []);

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Rides Today" value={stats.totalToday} icon={<Activity size={18} />} color="bg-green-100 text-green-700" />
        <StatCard label="Active Rides"       value={stats.active}    icon={<Zap size={18} />}      color="bg-blue-100 text-blue-700" />
        <StatCard label="Completed"          value={stats.completed} icon={<CheckCircle size={18} />} color="bg-emerald-100 text-emerald-700" />
        <StatCard label="Cancelled"          value={stats.cancelled} icon={<XCircle size={18} />}  color="bg-red-100 text-red-700" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Revenue"    value={fmt(stats.totalRevenue)}   icon={<TrendingUp size={18} />} color="bg-green-100 text-green-700" />
        <StatCard label="Rider Earnings"   value={fmt(stats.riderEarnings)}  icon={<Users size={18} />}      color="bg-indigo-100 text-indigo-700" />
        <StatCard label="Company Earnings" value={fmt(stats.companyEarnings)} icon={<DollarSign size={18} />} color="bg-amber-100 text-amber-700" />
        <StatCard label="Riders Online"    value={stats.ridersOnline}        icon={<Activity size={18} />}   color="bg-teal-100 text-teal-700" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Hourly rides */}
        <div className="md:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="font-bold text-gray-800 mb-4">Rides by Hour (Today)</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="rides" stroke="#22C55E" fill="#DCFCE7" strokeWidth={2} dot={false} name="Rides" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Vehicle type pie */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="font-bold text-gray-800 mb-4">By Vehicle Type</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => value > 0 ? `${name} ${value}` : ''} labelLine={false}>
                {typeData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Live Rides Tab ────────────────────────────────────────────────────────────

function LiveRidesTab() {
  const [rides, setRides] = useState<RideOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');

  useEffect(() => {
    const ACTIVE = ['pending','accepted','at_restaurant','picked_up','at_customer','out_for_delivery','customer_unavailable','searching'];
    const q = query(
      collection(db, 'orders'),
      where('type', 'in', ['ride', 'courier']),
    );
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as RideOrder));
      setRides(all.filter(o => ACTIVE.includes(o.status)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const handleCancelRide = async (ride: RideOrder) => {
    if (!confirm(`Cancel ride ${ride.id.slice(-6).toUpperCase()}? This will notify both parties.`)) return;
    setCancelling(ride.id);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      await fetch('/api/ride-cancellation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ orderId: ride.id, cancelledBy: 'admin', reason: 'admin_cancel' }),
      });
      toast.success('Ride cancelled');
    } catch { toast.error('Failed to cancel'); }
    finally { setCancelling(null); }
  };

  const handleManualStatusOverride = async (ride: RideOrder, newStatus: string) => {
    if (!newStatus) return;
    if (!confirm(`Force ride ${ride.id.slice(-6).toUpperCase()} status to "${newStatus.replace(/_/g, ' ')}"? This bypasses the normal ride flow.`)) return;
    try {
      const now = Date.now();
      const stageField: Record<string, string> = {
        accepted: 'acceptedAt', at_restaurant: 'arrivedAtPickup', picked_up: 'pickedUpAt',
        at_customer: 'arrivedAtDrop', delivered: 'deliveredAt', completed: 'deliveredAt',
      };
      const tsField = stageField[newStatus];
      await updateDoc(doc(db, 'orders', ride.id), {
        status: newStatus,
        updatedAt: now,
        adminOverride: true,
        adminOverrideAt: now,
        adminOverrideTo: newStatus,
        ...(tsField ? { [tsField]: now } : {}),
      });
      toast.success(`Ride status set to "${newStatus.replace(/_/g, ' ')}"`);
      setOverrideStatus('');
    } catch { toast.error('Failed to override status'); }
  };

  const handlePrintRideInvoice = (ride: RideOrder) => {
    const html = `<!doctype html><html><head><title>Ride Invoice ${ride.id}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th,td{padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:left}
        .muted{color:#666;font-size:12px}
      </style></head>
      <body>
        <h1>ManaBites / Berooz — Ride Invoice</h1>
        <p class="muted">Ride ID: ${ride.id}</p>
        <p class="muted">Date: ${fmtDate(ride.createdAt)}</p>
        <table>
          <tr><th>Customer</th><td>${ride.customerName || '-'} ${ride.customerPhone ? `(${ride.customerPhone})` : ''}</td></tr>
          <tr><th>Rider</th><td>${ride.riderName || 'Unassigned'} ${ride.riderPhone ? `(${ride.riderPhone})` : ''}</td></tr>
          <tr><th>Vehicle</th><td>${ride.vehicleType || '-'}</td></tr>
          <tr><th>Pickup</th><td>${fmtAddr(ride.pickupAddress)}</td></tr>
          <tr><th>Drop</th><td>${fmtAddr(ride.dropAddress)}</td></tr>
          <tr><th>Distance</th><td>${(ride.distanceKm || ride.distance || 0).toFixed(1)} km</td></tr>
          <tr><th>Fare</th><td><strong>${fmt(ride.fare || 0)}</strong></td></tr>
        </table>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Popup blocked — allow popups to print the invoice'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  };

  const selectedRide = selectedRideId ? rides.find(r => r.id === selectedRideId) ?? null : null;

  const filtered = rides.filter(r =>
    !search ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    r.customerName?.toLowerCase().includes(search.toLowerCase()) ||
    r.riderName?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          placeholder="Search by ID, customer, or rider..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-sm font-bold text-green-700">
          {filtered.length} live
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Activity size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No active rides right now</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ride => (
            <motion.div
              key={ride.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="font-black text-sm text-gray-800 font-mono">#{ride.id.slice(-6).toUpperCase()}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[ride.status] || 'bg-gray-100 text-gray-600'}`}>
                    {ride.status.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    {VEHICLE_ICONS[ride.vehicleType || 'Bike']}
                    {ride.vehicleType || 'Bike'}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock size={11} />
                  {minutesAgo(ride.createdAt)}
                </div>
              </div>

              {/* Body */}
              <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Customer</p>
                  <p className="font-semibold text-gray-800">{ride.customerName || '—'}</p>
                  {ride.customerPhone && (
                    <a href={`tel:${ride.customerPhone}`} className="flex items-center gap-1 text-xs text-blue-500 mt-0.5">
                      <Phone size={10} /> {ride.customerPhone}
                    </a>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Rider</p>
                  <p className="font-semibold text-gray-800">{ride.riderName || 'Unassigned'}</p>
                  {ride.riderPhone && (
                    <a href={`tel:${ride.riderPhone}`} className="flex items-center gap-1 text-xs text-blue-500 mt-0.5">
                      <Phone size={10} /> {ride.riderPhone}
                    </a>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Pickup</p>
                  <p className="text-xs text-gray-600 truncate">{fmtAddr(ride.pickupAddress)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Drop</p>
                  <p className="text-xs text-gray-600 truncate">{fmtAddr(ride.dropAddress)}</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="font-bold text-green-700">{fmt(ride.fare || 0)}</span>
                  {(ride.distance || ride.distanceKm) && (
                    <span>{(ride.distanceKm || ride.distance || 0).toFixed(1)} km</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {ride.riderLocation && (
                    <button
                      onClick={() => window.open(`https://www.google.com/maps?q=${ride.riderLocation!.lat},${ride.riderLocation!.lng}`, '_blank')}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-600 text-xs font-bold"
                    >
                      <MapPin size={11} /> Track
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedRideId(ride.id); setOverrideStatus(''); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold"
                  >
                    <Eye size={11} /> Details
                  </button>
                  <button
                    onClick={() => handleCancelRide(ride)}
                    disabled={cancelling === ride.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 text-red-600 text-xs font-bold disabled:opacity-50"
                  >
                    <Ban size={11} /> Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Ride Details Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedRide && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedRideId(null)}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-gray-800">Ride Details</h2>
                  <p className="text-xs text-gray-500 font-mono mt-1">#{selectedRide.id.slice(-6).toUpperCase()}</p>
                </div>
                <button onClick={() => setSelectedRideId(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Status */}
                <div className="bg-gray-50 p-4 rounded-xl flex items-center justify-between">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${STATUS_COLORS[selectedRide.status] || 'bg-gray-100 text-gray-600'}`}>
                    {selectedRide.status.replace(/_/g, ' ')}
                  </span>
                  <span className="font-black text-lg text-gray-800">{fmt(selectedRide.fare || 0)}</span>
                </div>

                {/* People */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Customer</p>
                      <p className="font-semibold text-gray-800">{selectedRide.customerName || '—'}</p>
                    </div>
                    {selectedRide.customerPhone && (
                      <a href={`tel:${selectedRide.customerPhone}`} className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-lg">
                        <Phone size={14} />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Rider</p>
                      <p className="font-semibold text-gray-800">{selectedRide.riderName || 'Unassigned'}</p>
                    </div>
                    {selectedRide.riderPhone && (
                      <a href={`tel:${selectedRide.riderPhone}`} className="w-8 h-8 flex items-center justify-center bg-green-50 text-green-600 rounded-lg">
                        <Phone size={14} />
                      </a>
                    )}
                  </div>
                </div>

                {/* Trip details */}
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Pickup</p>
                    <p className="text-gray-700">{fmtAddr(selectedRide.pickupAddress)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Drop</p>
                    <p className="text-gray-700">{fmtAddr(selectedRide.dropAddress)}</p>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-xs text-gray-500">{(selectedRide.distanceKm || selectedRide.distance || 0).toFixed(1)} km</span>
                    <span className="text-xs text-gray-500">{selectedRide.vehicleType || 'Bike'}</span>
                  </div>
                </div>

                {/* Timeline */}
                {(() => {
                  const r = selectedRide as any;
                  const TIMELINE = [
                    { label: 'Requested',       ts: r.createdAt,       emoji: '📝' },
                    { label: 'Rider Accepted',  ts: r.acceptedAt,      emoji: '✅' },
                    { label: 'Rider Arrived',   ts: r.arrivedAtPickup, emoji: '📍' },
                    { label: 'Picked Up',       ts: r.pickedUpAt,      emoji: '⬆️' },
                    { label: 'Reached Drop',    ts: r.arrivedAtDrop,   emoji: '🏁' },
                    { label: 'Completed',       ts: r.deliveredAt,     emoji: '🏠' },
                    { label: 'Cancelled',       ts: r.cancelledAt,     emoji: '❌' },
                  ];
                  const steps = TIMELINE.filter(s => s.ts);
                  if (!steps.length) return null;
                  return (
                    <div>
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Timeline</p>
                      <div className="relative">
                        <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-100" />
                        <div className="space-y-3">
                          {steps.map((s, i) => (
                            <div key={i} className="flex items-start gap-3 relative">
                              <div className="w-7 h-7 rounded-full bg-white border-2 border-green-500 flex items-center justify-center text-sm z-10 flex-shrink-0">
                                {s.emoji}
                              </div>
                              <div className="pt-0.5">
                                <p className="text-sm font-bold text-gray-800">{s.label}</p>
                                <p className="text-xs text-gray-400">{fmtDate(s.ts)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {r.cancelReason && (
                        <div className="mt-3 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-700 font-bold">
                          ❌ Cancelled: {r.cancelReason} {r.cancelledBy ? `(by ${r.cancelledBy})` : ''}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Actions footer */}
              <div className="p-6 border-t border-gray-100 bg-gray-50 space-y-2">
                <button
                  onClick={() => handlePrintRideInvoice(selectedRide)}
                  className="w-full py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-gray-200"
                >
                  <Printer className="w-4 h-4" /> Print / Export Invoice
                </button>

                <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Manual Status Override</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        value={overrideStatus}
                        onChange={e => setOverrideStatus(e.target.value)}
                        className="w-full appearance-none border border-gray-200 rounded-lg pl-2.5 pr-7 py-2 text-xs"
                      >
                        <option value="">Choose status…</option>
                        {RIDE_STATUSES.filter(s => s !== selectedRide.status).map(s => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => handleManualStatusOverride(selectedRide, overrideStatus)}
                      disabled={!overrideStatus}
                      className="px-4 py-2 bg-gray-800 text-white font-bold rounded-lg text-xs hover:bg-gray-900 disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => handleCancelRide(selectedRide)}
                  disabled={cancelling === selectedRide.id}
                  className="w-full py-2.5 bg-red-100 text-red-700 font-bold rounded-xl text-sm hover:bg-red-200 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Ban className="w-4 h-4" /> Cancel Ride
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Cancellations Tab ─────────────────────────────────────────────────────────

function CancellationsTab() {
  const [records, setRecords] = useState<CancellationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all'|'customer'|'rider'|'admin'>('all');

  useEffect(() => {
    const q = query(collection(db, 'cancellations'), orderBy('cancelledAt', 'desc'), fsLimit(100));
    const unsub = onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CancellationRecord)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const filtered = filter === 'all' ? records : records.filter(r => r.cancelledBy === filter);

  const totalFees  = filtered.reduce((s, r) => s + (r.fee || 0), 0);
  const byCustomer = records.filter(r => r.cancelledBy === 'customer').length;
  const byRider    = records.filter(r => r.cancelledBy === 'rider').length;
  const byAdmin    = records.filter(r => r.cancelledBy === 'admin').length;

  const chartData = [
    { name: 'Customer', value: byCustomer, color: '#F59E0B' },
    { name: 'Rider',    value: byRider,    color: '#3B82F6' },
    { name: 'Admin',    value: byAdmin,    color: '#EF4444' },
  ].filter(d => d.value > 0);

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
          <p className="text-2xl font-black text-amber-800">{byCustomer}</p>
          <p className="text-sm font-bold text-amber-700">By Customer</p>
        </div>
        <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
          <p className="text-2xl font-black text-blue-800">{byRider}</p>
          <p className="text-sm font-bold text-blue-700">By Rider</p>
        </div>
        <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
          <p className="text-2xl font-black text-red-800">{byAdmin}</p>
          <p className="text-sm font-bold text-red-700">By Admin</p>
        </div>
        <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
          <p className="text-2xl font-black text-green-800">{fmt(totalFees)}</p>
          <p className="text-sm font-bold text-green-700">Total Fees Collected</p>
        </div>
      </div>

      {/* Chart + filter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="font-bold text-gray-800 mb-3">Cancellation Split</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({name, value}) => `${name} ${value}`} labelLine={false} fontSize={11}>
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="md:col-span-2">
          {/* Filter buttons */}
          <div className="flex gap-2 mb-3">
            {(['all','customer','rider','admin'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${filter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Order</th>
                    <th className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Cancelled By</th>
                    <th className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Reason</th>
                    <th className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Fee</th>
                    <th className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.slice(0, 20).map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700">#{r.orderId?.slice(-6).toUpperCase() || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          r.cancelledBy === 'customer' ? 'bg-amber-100 text-amber-700' :
                          r.cancelledBy === 'rider'    ? 'bg-blue-100 text-blue-700'   :
                          'bg-red-100 text-red-700'
                        }`}>{r.cancelledBy}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.cancelReason || '—'}</td>
                      <td className="px-4 py-3 font-bold text-green-700">{r.fee > 0 ? fmt(r.fee) : <span className="text-gray-400">Free</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{minutesAgo(r.cancelledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">No cancellations found</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── No-Show Tab ───────────────────────────────────────────────────────────────

function NoShowTab() {
  const [noShows, setNoShows]   = useState<RideOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'customer_unavailable'),
      orderBy('customerUnavailableAt', 'desc'),
      fsLimit(50),
    );
    const unsub = onSnapshot(q, snap => {
      setNoShows(snap.docs.map(d => ({ id: d.id, ...d.data() } as RideOrder)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const applyNoShowFee = async (ride: RideOrder) => {
    setApplying(ride.id);
    try {
      await updateDoc(doc(db, 'orders', ride.id), {
        status:         'cancelled',
        cancelledBy:    'system',
        cancelReason:   'customer_no_show',
        cancellationFee: 30,
        cancellationFeeType: 'no_show_fee',
        cancellationChargedTo: 'customer',
        cancelledAt:    Date.now(),
      });
      toast.success('No-show fee applied and order cancelled');
    } catch { toast.error('Failed to apply fee'); }
    finally { setApplying(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Policy summary */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-bold text-amber-800 mb-1">No-Show Policy</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-amber-700">
              <span>• Rider waits &gt;5 min at pickup → ₹30 no-show fee</span>
              <span>• Customer flagged in system</span>
              <span>• Rider receives full delivery fee</span>
              <span>• 3 no-shows → temporary restriction</span>
            </div>
          </div>
        </div>
      </div>

      {noShows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle size={40} className="mx-auto mb-3 opacity-30 text-green-400" />
          <p className="font-medium">No active no-show cases</p>
        </div>
      ) : (
        <div className="space-y-3">
          {noShows.map(ride => (
            <div key={ride.id} className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
                <span className="font-black text-sm font-mono text-red-800">#{ride.id.slice(-6).toUpperCase()}</span>
                <span className="text-xs text-red-600 font-bold">Customer Unavailable</span>
              </div>
              <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Customer</p>
                  <p className="font-semibold">{ride.customerName || '—'}</p>
                  {ride.customerPhone && (
                    <a href={`tel:${ride.customerPhone}`} className="text-xs text-blue-500">{ride.customerPhone}</a>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-400">Rider</p>
                  <p className="font-semibold">{ride.riderName || '—'}</p>
                  {ride.riderPhone && (
                    <a href={`tel:${ride.riderPhone}`} className="text-xs text-blue-500">{ride.riderPhone}</a>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">Waiting since {minutesAgo((ride as any).customerUnavailableAt)}</span>
                <button
                  onClick={() => applyNoShowFee(ride)}
                  disabled={applying === ride.id}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {applying === ride.id ? 'Applying…' : 'Apply ₹30 No-Show Fee'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fare Config Tab ───────────────────────────────────────────────────────────

function FareConfigTab() {
  const [config, setConfig] = useState({
    cancellationFeeCustomer: 10,
    riderNearbyFee:          10,
    riderAtPickupFee:        20,
    noShowFee:               30,
    parcelCancelFee:         15,
    gracePeriodMinutes:      2,
    riderCancelFreeSecs:     30,
    riderSuspendAt:          20,
    riderLogoutAt:           10,
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'cancellationPolicy'), snap => {
      if (snap.exists()) setConfig(c => ({ ...c, ...snap.data() }));
      setLoaded(true);
    }, () => setLoaded(true));
    return unsub;
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'cancellationPolicy'), { ...config, updatedAt: serverTimestamp() });
      toast.success('Cancellation policy saved');
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const row = (label: string, field: keyof typeof config, prefix = '₹', suffix = '') => (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-sm text-gray-400">{prefix}</span>}
        <input
          type="number"
          value={config[field]}
          onChange={e => setConfig(c => ({ ...c, [field]: Number(e.target.value) }))}
          className="w-20 border border-gray-200 rounded-xl px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        {suffix && <span className="text-sm text-gray-400">{suffix}</span>}
      </div>
    </div>
  );

  if (!loaded) return <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Customer fees */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="font-bold text-gray-800 mb-4">Customer Cancellation Fees</p>
        {row('Grace period (free cancel window)', 'gracePeriodMinutes', '', 'min')}
        {row('Late cancel fee', 'cancellationFeeCustomer')}
        {row('Rider within 500m fee', 'riderNearbyFee')}
        {row('Rider at pickup fee', 'riderAtPickupFee')}
        {row('No-show fee (5+ min wait)', 'noShowFee')}
        {row('Parcel cancellation fee', 'parcelCancelFee')}
      </div>

      {/* Rider penalties */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="font-bold text-gray-800 mb-4">Rider Cancellation Penalties</p>
        {row('Free cancel window', 'riderCancelFreeSecs', '', 'sec')}
        {row('Auto-logout at (cancellations)', 'riderLogoutAt', '', 'cancels')}
        {row('Suspension at (cancellations)', 'riderSuspendAt', '', 'cancels')}

        <div className="mt-4 bg-blue-50 rounded-xl p-3">
          <p className="text-xs font-bold text-blue-800 mb-1">Penalty Tiers</p>
          <div className="space-y-1 text-xs text-blue-700">
            <div className="flex justify-between"><span>1–3 cancellations</span><span className="font-bold">Warning</span></div>
            <div className="flex justify-between"><span>4–10 cancellations</span><span className="font-bold">−2 acceptance score/cancel</span></div>
            <div className="flex justify-between"><span>&gt;10 cancellations</span><span className="font-bold">30-min auto-logout</span></div>
            <div className="flex justify-between"><span>&gt;20 cancellations</span><span className="font-bold">Temporary suspension</span></div>
          </div>
        </div>
      </div>

      <div className="md:col-span-2 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-green-600 text-white font-bold rounded-2xl flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? <RefreshCw size={16} className="animate-spin" /> : null}
          Save Cancellation Policy
        </button>
      </div>
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [dateTo,   setDateTo]   = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);

  const exportCSV = async () => {
    setExporting(true);
    try {
      const from = new Date(dateFrom).getTime();
      const to   = new Date(dateTo).getTime() + 86400000;
      const snap = await getDocs(query(
        collection(db, 'cancellations'),
        where('cancelledAt', '>=', from),
        where('cancelledAt', '<=', to),
        orderBy('cancelledAt', 'desc'),
      ));
      const rows = [['Order ID','Type','Cancelled By','Reason','Fee','Charged To','Date']];
      snap.docs.forEach(d => {
        const r = d.data();
        rows.push([
          r.orderId || d.id,
          r.orderType || 'ride',
          r.cancelledBy || '',
          r.cancelReason || '',
          String(r.fee || 0),
          r.chargedTo || 'none',
          new Date(r.cancelledAt).toLocaleString(),
        ]);
      });
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `cancellations_${dateFrom}_to_${dateTo}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch { toast.error('Export failed'); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="font-bold text-gray-800 mb-4">Export Cancellation Report</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
          <button
            onClick={exportCSV}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-bold rounded-xl text-sm disabled:opacity-60"
          >
            <Download size={15} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Ride Revenue Report',      desc: 'Total fares, company earnings, rider payouts',  icon: <TrendingUp size={20} /> },
          { title: 'Rider Performance Report', desc: 'Acceptance rate, cancellation rate, ratings',   icon: <Users size={20} /> },
          { title: 'No-Show Report',           desc: 'Customer no-shows, fees collected, history',   icon: <AlertTriangle size={20} /> },
        ].map(r => (
          <div key={r.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600 mb-3">
              {r.icon}
            </div>
            <p className="font-bold text-gray-800 mb-1">{r.title}</p>
            <p className="text-xs text-gray-400 mb-4">{r.desc}</p>
            <button
              onClick={() => toast('Select date range above and click Export CSV', { icon: 'ℹ️' })}
              className="flex items-center gap-1.5 text-xs font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-xl"
            >
              <Download size={12} /> Export
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function RideManagement() {
  const [tab, setTab] = useState<TabId>('dashboard');

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Ride Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor, manage, and analyse all ride operations</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-xl text-xs font-bold text-green-700">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Live
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-white text-green-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'dashboard'     && <DashboardTab />}
          {tab === 'live'         && <LiveRidesTab />}
          {tab === 'cancellations' && <CancellationsTab />}
          {tab === 'noshow'        && <NoShowTab />}
          {tab === 'fare'          && <FareConfigTab />}
          {tab === 'reports'       && <ReportsTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
