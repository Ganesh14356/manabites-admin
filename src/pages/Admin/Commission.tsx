import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendingUp, Store, DollarSign, Percent } from 'lucide-react';
import toast from 'react-hot-toast';

interface CommissionEntry {
  id: string;
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  orderTotal: number;
  subtotal: number;
  commissionRate: number;
  commissionAmount: number;
  restaurantNet: number;
  createdAt: Timestamp;
}

function formatDate(ts: any): string {
  if (!ts) return 'â€”';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts: any): string {
  if (!ts) return 'â€”';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Commission() {
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'commissionLedger'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommissionEntry)));
      setLoading(false);
    }, err => {
      toast.error('Failed to load commission data: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const summary = useMemo(() => {
    const totalCommission = entries.reduce((s, e) => s + e.commissionAmount, 0);
    const totalOrderValue = entries.reduce((s, e) => s + e.orderTotal, 0);
    const totalRestaurantNet = entries.reduce((s, e) => s + e.restaurantNet, 0);

    const byRestaurant: Record<string, { name: string; commission: number; orders: number; net: number }> = {};
    entries.forEach(e => {
      if (!byRestaurant[e.restaurantId]) {
        byRestaurant[e.restaurantId] = { name: e.restaurantName, commission: 0, orders: 0, net: 0 };
      }
      byRestaurant[e.restaurantId].commission += e.commissionAmount;
      byRestaurant[e.restaurantId].orders += 1;
      byRestaurant[e.restaurantId].net += e.restaurantNet;
    });

    const topRestaurants = Object.values(byRestaurant)
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 5);

    return { totalCommission, totalOrderValue, totalRestaurantNet, topRestaurants, totalOrders: entries.length };
  }, [entries]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(e =>
      e.restaurantName.toLowerCase().includes(q) ||
      e.orderId.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
          <Percent className="w-7 h-7 text-brand" />
          Commission Ledger
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          ManaBites platform commission collected from delivered orders
        </p>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Commission', value: `â‚¹${summary.totalCommission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'border-green-500', iconBg: 'bg-green-50', iconColor: 'text-green-600' },
          { label: 'Total Order Value', value: `â‚¹${summary.totalOrderValue.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'border-brand', iconBg: 'bg-orange-50', iconColor: 'text-brand' },
          { label: 'Restaurant Net', value: `â‚¹${summary.totalRestaurantNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Store, color: 'border-blue-400', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Orders Tracked', value: summary.totalOrders.toString(), icon: Percent, color: 'border-purple-400', iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.color}`}
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

      {/* Top Restaurants */}
      {summary.topRestaurants.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h2 className="text-sm font-black text-gray-700 uppercase tracking-wider mb-4">Top Restaurants by Commission</h2>
          <div className="space-y-3">
            {summary.topRestaurants.map((r, i) => (
              <div key={r.name} className="flex items-center gap-4">
                <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center text-xs font-black text-brand flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{r.name}</p>
                  <p className="text-xs text-gray-400">{r.orders} orders</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-green-700">â‚¹{r.commission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-gray-400">net â‚¹{r.net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${(r.commission / (summary.topRestaurants[0].commission || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by restaurant name or order ID..."
          className="input-field pl-4"
        />
      </div>

      {/* Ledger Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
          />
          Loading commission data...
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Date</th>
                  <th className="table-header">Restaurant</th>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Order Total</th>
                  <th className="table-header">Subtotal</th>
                  <th className="table-header">Rate</th>
                  <th className="table-header">Commission</th>
                  <th className="table-header">Restaurant Net</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="table-cell text-xs text-gray-500">{formatDateTime(e.createdAt)}</td>
                    <td className="table-cell font-semibold text-gray-800">{e.restaurantName}</td>
                    <td className="table-cell font-mono text-xs text-gray-500">{e.orderId.slice(0, 8).toUpperCase()}</td>
                    <td className="table-cell text-gray-700">â‚¹{e.orderTotal.toLocaleString('en-IN')}</td>
                    <td className="table-cell text-gray-700">â‚¹{e.subtotal.toLocaleString('en-IN')}</td>
                    <td className="table-cell">
                      <span className="px-2 py-0.5 bg-orange-50 text-orange-700 text-[11px] font-bold rounded-md">{e.commissionRate}%</span>
                    </td>
                    <td className="table-cell font-black text-green-700">â‚¹{e.commissionAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="table-cell text-gray-700">â‚¹{e.restaurantNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !loading && (
              <div className="py-16 text-center">
                <Percent className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-semibold">No commission entries yet</p>
                <p className="text-gray-300 text-sm mt-1">Commission is recorded when restaurants mark orders as delivered</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
