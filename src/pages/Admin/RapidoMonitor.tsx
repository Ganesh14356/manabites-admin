import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Clock, AlertTriangle, CheckCircle, XCircle, RefreshCw, TrendingUp, IndianRupee } from 'lucide-react';
import toast from 'react-hot-toast';

interface RapidoOrder {
  id: string;
  restaurantName?: string;
  customerName?: string;
  rapidoStatus?: string;
  rapidoTaskId?: string;
  rapidoRider?: { name?: string; phone?: string; vehicleNumber?: string };
  total?: number;
  createdAt?: any;
  rapidoCreatedAt?: any;
  status?: string;
}

const STATUS_COLOR: Record<string, string> = {
  created:    'bg-yellow-100 text-yellow-700',
  pending:    'bg-yellow-100 text-yellow-700',
  searching:  'bg-blue-100 text-blue-700',
  assigned:   'bg-purple-100 text-purple-700',
  accepted:   'bg-purple-100 text-purple-700',
  arrived:    'bg-indigo-100 text-indigo-700',
  picked_up:  'bg-orange-100 text-orange-700',
  delivered:  'bg-green-100 text-green-700',
  cancelled:  'bg-red-100 text-red-600',
  failed:     'bg-red-100 text-red-600',
};

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const RAPIDO_COST = 55;

function msAgo(val: any): number {
  if (!val) return 0;
  const ts = val?.toMillis ? val.toMillis() : (typeof val === 'number' ? val : 0);
  return Date.now() - ts;
}

function timeAgo(val: any): string {
  const ms = msAgo(val);
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export default function RapidoMonitor() {
  const [activeOrders, setActiveOrders] = useState<RapidoOrder[]>([]);
  const [todayOrders, setTodayOrders] = useState<RapidoOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Live active Rapido orders
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('deliverySource', '==', 'rapido'),
      where('rapidoStatus', 'in', ['created', 'pending', 'searching', 'assigned', 'accepted', 'arrived', 'picked_up']),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(q, snap => {
      setActiveOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as RapidoOrder)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  // Today's completed Rapido orders
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'orders'),
      where('deliverySource', '==', 'rapido'),
      where('createdAt', '>=', start),
      orderBy('createdAt', 'desc'),
      limit(200),
    );
    return onSnapshot(q, snap => {
      setTodayOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as RapidoOrder)));
    });
  }, []);

  const handleCancel = async (orderId: string) => {
    if (!window.confirm('Rapido order cancel cheyyanaa? Refund issue avutundi.')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        rapidoStatus: 'cancelled',
        rapidoCancelledAt: Date.now(),
        cancelledBy: 'admin',
      });
      toast.success('Order cancelled — refund processing');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const delivered = todayOrders.filter(o => o.rapidoStatus === 'delivered' || o.status === 'delivered');
  const cancelled = todayOrders.filter(o => o.rapidoStatus === 'cancelled' || o.status === 'cancelled');
  const todayCost = todayOrders.length * RAPIDO_COST;
  const timedOut  = activeOrders.filter(o =>
    ['created', 'pending', 'searching'].includes(o.rapidoStatus || '') && msAgo(o.rapidoCreatedAt || o.createdAt) > 8 * 60 * 1000
  );

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <Zap size={22} className="text-yellow-500" /> Rapido Monitor
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Live Rapido deliveries — real time tracking</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Live
        </div>
      </div>

      {/* Today summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Now',      value: activeOrders.length,  color: 'text-blue-600',   bg: 'bg-blue-50',   icon: <Zap size={16} className="text-blue-400" /> },
          { label: 'Delivered Today', value: delivered.length,     color: 'text-green-600',  bg: 'bg-green-50',  icon: <CheckCircle size={16} className="text-green-400" /> },
          { label: 'Cancelled Today', value: cancelled.length,     color: 'text-red-600',    bg: 'bg-red-50',    icon: <XCircle size={16} className="text-red-400" /> },
          { label: "Today's Cost",    value: fmt(todayCost),       color: 'text-orange-600', bg: 'bg-orange-50', icon: <IndianRupee size={16} className="text-orange-400" /> },
        ].map(c => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className={`${c.bg} rounded-2xl p-4`}>
            <div className="flex items-center gap-1.5 mb-2">{c.icon}<p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{c.label}</p></div>
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Timeout warning */}
      <AnimatePresence>
        {timedOut.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
            <div>
              <p className="font-black text-red-800">⚠️ {timedOut.length} order(s) — Captain 8+ min lo kanapadaledu</p>
              <p className="text-sm text-red-600 mt-0.5">10 min timeout lo auto-cancel avutayi. Manual ga cancel cheyyadaniki kinda list chudandi.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active orders list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={16} className="text-gray-500" />
          <h2 className="font-black text-gray-800 text-sm uppercase tracking-wider">
            Active Rapido Orders ({activeOrders.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : activeOrders.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-gray-400">No active Rapido orders</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeOrders.map(order => {
              const waitMs  = msAgo(order.rapidoCreatedAt || order.createdAt);
              const waitMin = Math.floor(waitMs / 60000);
              const isWarning = ['created', 'pending', 'searching'].includes(order.rapidoStatus || '') && waitMin >= 8;
              return (
                <div key={order.id} className={`p-4 ${isWarning ? 'bg-red-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-gray-900 text-sm">#{order.id.slice(-6).toUpperCase()}</p>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_COLOR[order.rapidoStatus || ''] ?? 'bg-gray-100 text-gray-500'}`}>
                          {order.rapidoStatus || '—'}
                        </span>
                        {isWarning && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1">
                            <AlertTriangle size={10} /> {waitMin}m waiting
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {order.restaurantName || '—'} → {order.customerName || '—'}
                      </p>
                      {order.rapidoRider?.name && (
                        <p className="text-xs text-purple-600 font-bold mt-1">
                          🛵 {order.rapidoRider.name} · {order.rapidoRider.vehicleNumber || '—'}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1">
                        {timeAgo(order.rapidoCreatedAt || order.createdAt)} · {fmt(order.total || 0)}
                      </p>
                      {order.rapidoTaskId && (
                        <p className="text-[10px] font-mono text-gray-300 mt-0.5">Task: {order.rapidoTaskId}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleCancel(order.id)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl text-xs font-black transition-colors"
                    >
                      <XCircle size={13} /> Cancel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Today's Rapido history */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp size={16} className="text-gray-500" />
          <h2 className="font-black text-gray-800 text-sm uppercase tracking-wider">
            Today's Rapido Orders ({todayOrders.length}) · Cost: {fmt(todayCost)}
          </h2>
        </div>
        {todayOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No Rapido orders today</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Order', 'Restaurant', 'Customer', 'Status', 'Captain', 'Amount', 'Time'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {todayOrders.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-500">#{o.id.slice(-6).toUpperCase()}</td>
                    <td className="px-4 py-3 font-bold text-gray-800 max-w-[120px] truncate">{o.restaurantName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[100px] truncate">{o.customerName || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_COLOR[o.rapidoStatus || ''] ?? 'bg-gray-100 text-gray-500'}`}>
                        {o.rapidoStatus || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{o.rapidoRider?.name || '—'}</td>
                    <td className="px-4 py-3 font-bold text-gray-800">{fmt(o.total || 0)}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{timeAgo(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
