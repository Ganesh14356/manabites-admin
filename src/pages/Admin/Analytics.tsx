import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, where, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import { TrendingUp, DollarSign, ShoppingBag, Users, Store, Bike, Award, RefreshCw, Download, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── CSV helper ────────────────────────────────────────────────────────────────
function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';

interface KPIs {
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  totalRestaurants: number;
  totalRiders: number;
  platformFees: number;
  deliveryFees: number;
  taxes: number;
}

interface TopRestaurant { id: string; name: string; orders: number; earnings: number; rating: number; }
interface TopRider { uid: string; name: string; deliveries: number; earnings: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSalesChart(orders: any[], period: Period) {
  const now = new Date();
  if (period === 'daily') {
    // Last 7 days
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return { label: d.toLocaleDateString('en-IN', { weekday: 'short' }), date: d.toDateString() };
    });
    return days.map(({ label, date }) => ({
      name: label,
      sales: orders
        .filter(o => o.status === 'delivered' && o.createdAt?.toDate?.()?.toDateString() === date)
        .reduce((s, o) => s + (o.totalAmount || 0), 0),
      orders: orders.filter(o => o.createdAt?.toDate?.()?.toDateString() === date).length,
    }));
  }

  if (period === 'weekly') {
    // Last 8 weeks
    return Array.from({ length: 8 }, (_, i) => {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() - (7 - i) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const label = `W${8 - i}`;
      return {
        name: label,
        sales: orders
          .filter(o => {
            const d = o.createdAt?.toDate?.();
            return d && o.status === 'delivered' && d >= weekStart && d <= weekEnd;
          })
          .reduce((s, o) => s + (o.totalAmount || 0), 0),
        orders: orders.filter(o => {
          const d = o.createdAt?.toDate?.();
          return d && d >= weekStart && d <= weekEnd;
        }).length,
      };
    });
  }

  // Monthly — last 12 months
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return {
      name: d.toLocaleDateString('en-IN', { month: 'short' }),
      sales: orders
        .filter(o => {
          const od = o.createdAt?.toDate?.();
          return od && o.status === 'delivered' && od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
        })
        .reduce((s, o) => s + (o.totalAmount || 0), 0),
      orders: orders.filter(o => {
        const od = o.createdAt?.toDate?.();
        return od && od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
      }).length,
    };
  });
}

const COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#f59e0b'];

const RADIAN = Math.PI / 180;
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [period, setPeriod] = useState<Period>('weekly');
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [kpis, setKpis] = useState<KPIs>({
    totalRevenue: 0, totalOrders: 0, totalCustomers: 0,
    totalRestaurants: 0, totalRiders: 0, platformFees: 0, deliveryFees: 0, taxes: 0,
  });
  const [topRestaurants, setTopRestaurants] = useState<TopRestaurant[]>([]);
  const [topRiders, setTopRiders] = useState<TopRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersSnap, usersSnap, restSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'restaurants')),
      ]);

      const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllOrders(orders);

      const delivered = orders.filter(o => (o as any).status === 'delivered');

      let revenue = 0, platformFees = 0, deliveryFees = 0, taxes = 0;
      delivered.forEach((o: any) => {
        revenue += o.totalAmount || 0;
        platformFees += o.platformFee || 0;
        deliveryFees += o.deliveryFee || 0;
        taxes += o.tax || 0;
      });

      let customers = 0, riders = 0;
      usersSnap.forEach(d => {
        const role = d.data().role;
        if (role === 'customer') customers++;
        if (role === 'rider') riders++;
      });

      setKpis({ totalRevenue: revenue, totalOrders: orders.length, totalCustomers: customers, totalRestaurants: restSnap.size, totalRiders: riders, platformFees, deliveryFees, taxes });

      // Top Restaurants by orders
      const restMap = new Map<string, TopRestaurant>();
      restSnap.docs.forEach(d => {
        const data = d.data();
        restMap.set(d.id, { id: d.id, name: data.name || 'Unknown', orders: 0, earnings: 0, rating: data.rating || 0 });
      });
      delivered.forEach((o: any) => {
        if (o.restaurantId && restMap.has(o.restaurantId)) {
          const r = restMap.get(o.restaurantId)!;
          r.orders++;
          r.earnings += o.totalAmount || 0;
        }
      });
      const sortedRests = Array.from(restMap.values()).sort((a, b) => b.orders - a.orders).slice(0, 5);
      setTopRestaurants(sortedRests);

      // Top Riders by deliveries
      const riderMap = new Map<string, TopRider>();
      usersSnap.docs.filter(d => d.data().role === 'rider').forEach(d => {
        riderMap.set(d.id, { uid: d.id, name: d.data().name || 'Unknown', deliveries: 0, earnings: 0 });
      });
      delivered.forEach((o: any) => {
        if (o.riderId && riderMap.has(o.riderId)) {
          const r = riderMap.get(o.riderId)!;
          r.deliveries++;
          r.earnings += o.deliveryFee || 0;
        }
      });
      const sortedRiders = Array.from(riderMap.values()).filter(r => r.deliveries > 0).sort((a, b) => b.deliveries - a.deliveries).slice(0, 5);
      setTopRiders(sortedRiders);
    } catch (error) {
      console.error('Failed to fetch analytics', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const salesData = useMemo(() => buildSalesChart(allOrders, period), [allOrders, period]);

  // ── Download helpers ──────────────────────────────────────────────────────

  const downloadSalesReport = () => {
    const rows = [
      ['Period', 'Revenue (₹)', 'Orders'],
      ...salesData.map(d => [d.name, d.sales, d.orders]),
    ];
    downloadCSV(rows, `sales-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`);
    setShowDownloadMenu(false);
  };

  const downloadOrdersStatement = () => {
    const rows = [
      ['Order ID', 'Restaurant', 'Customer', 'Rider', 'Status', 'Amount (₹)', 'Delivery Fee (₹)', 'Platform Fee (₹)', 'Tax (₹)', 'Date'],
      ...allOrders.map((o: any) => [
        o.id?.slice(0, 8).toUpperCase() ?? '—',
        o.restaurantName ?? '—',
        o.customerName ?? '—',
        o.riderName ?? '—',
        o.status ?? '—',
        (o.totalAmount ?? 0).toFixed(2),
        (o.deliveryFee ?? 0).toFixed(2),
        (o.platformFee ?? 0).toFixed(2),
        (o.tax ?? 0).toFixed(2),
        o.createdAt?.toDate?.()?.toLocaleString('en-IN') ?? '—',
      ]),
    ];
    downloadCSV(rows, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
    setShowDownloadMenu(false);
  };

  const downloadRevenueReport = () => {
    const rows = [
      ['Category', 'Amount (₹)'],
      ['Total Revenue', kpis.totalRevenue.toFixed(2)],
      ['Food Revenue', (kpis.totalRevenue - kpis.platformFees - kpis.deliveryFees - kpis.taxes).toFixed(2)],
      ['Delivery Fees', kpis.deliveryFees.toFixed(2)],
      ['Platform Fees', kpis.platformFees.toFixed(2)],
      ['Taxes', kpis.taxes.toFixed(2)],
      ['Total Orders', kpis.totalOrders],
      ['Total Customers', kpis.totalCustomers],
      ['Restaurants', kpis.totalRestaurants],
      ['Riders', kpis.totalRiders],
    ];
    downloadCSV(rows, `revenue-report-${new Date().toISOString().slice(0, 10)}.csv`);
    setShowDownloadMenu(false);
  };

  const downloadTopRestaurants = () => {
    const rows = [
      ['Rank', 'Restaurant', 'Orders', 'Earnings (₹)', 'Rating'],
      ...topRestaurants.map((r, i) => [i + 1, r.name, r.orders, r.earnings.toFixed(2), r.rating.toFixed(1)]),
    ];
    downloadCSV(rows, `top-restaurants-${new Date().toISOString().slice(0, 10)}.csv`);
    setShowDownloadMenu(false);
  };

  const revenueBreakdown = [
    { name: 'Food Revenue', value: Math.max(0, kpis.totalRevenue - kpis.platformFees - kpis.deliveryFees - kpis.taxes) },
    { name: 'Delivery Fees', value: kpis.deliveryFees },
    { name: 'Platform Fees', value: kpis.platformFees },
    { name: 'Taxes', value: kpis.taxes },
  ].filter(d => d.value > 0);

  const statCards = [
    { label: 'Total Revenue', value: `₹${kpis.totalRevenue.toLocaleString('en-IN')}`, icon: DollarSign, color: 'brand', change: '+12%', bg: 'bg-orange-50', iconColor: 'text-brand' },
    { label: 'Total Orders', value: kpis.totalOrders, icon: ShoppingBag, color: 'blue-500', change: '+8%', bg: 'bg-blue-50', iconColor: 'text-blue-500' },
    { label: 'Customers', value: kpis.totalCustomers, icon: Users, color: 'purple-500', change: '+24%', bg: 'bg-purple-50', iconColor: 'text-purple-500' },
    { label: 'Restaurants', value: kpis.totalRestaurants, icon: Store, color: 'green-500', change: '', bg: 'bg-green-50', iconColor: 'text-green-500' },
    { label: 'Active Riders', value: kpis.totalRiders, icon: Bike, color: 'yellow-500', change: '', bg: 'bg-yellow-50', iconColor: 'text-yellow-600' },
    { label: 'Platform Fees', value: `₹${kpis.platformFees.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'red-500', change: '', bg: 'bg-red-50', iconColor: 'text-red-500' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Analytics & Reports</h1>
          <p className="text-gray-400 text-sm mt-0.5">Platform performance overview</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>

          {/* Download menu */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowDownloadMenu(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 shadow-md shadow-green-200"
            >
              <Download className="w-4 h-4" /> Download
            </motion.button>

            <AnimatePresence>
              {showDownloadMenu && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-10"
                    onClick={() => setShowDownloadMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    className="absolute right-0 top-12 z-20 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 min-w-[220px]"
                  >
                    {[
                      { label: 'Sales Report (Chart Data)', fn: downloadSalesReport },
                      { label: 'All Orders Statement', fn: downloadOrdersStatement },
                      { label: 'Revenue Breakdown', fn: downloadRevenueReport },
                      { label: 'Top Restaurants', fn: downloadTopRestaurants },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.fn}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors text-left"
                      >
                        <FileText className="w-4 h-4 text-green-500 flex-shrink-0" />
                        {item.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white p-5 rounded-2xl shadow-card"
          >
            <div className={`w-9 h-9 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
              <card.icon className={`w-5 h-5 ${card.iconColor}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{card.label}</p>
            <p className="text-xl font-black text-gray-800">{card.value}</p>
            {card.change && (
              <span className="text-xs font-bold text-green-500 bg-green-50 px-1.5 py-0.5 rounded-md mt-1 inline-block">{card.change}</span>
            )}
          </motion.div>
        ))}
      </div>

      {/* Sales Chart + Period Toggle */}
      <div className="bg-white p-6 rounded-2xl shadow-card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-800">Sales Trend</h3>
          <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
            {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${period === p ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesData}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number, name: string) => [name === 'sales' ? `₹${value.toLocaleString('en-IN')}` : value, name === 'sales' ? 'Revenue' : 'Orders']}
              />
              <Area type="monotone" dataKey="sales" stroke="#f97316" strokeWidth={3} fill="url(#salesGrad)" dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#f97316' }} activeDot={{ r: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Breakdown + Orders Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Pie */}
        <div className="bg-white p-6 rounded-2xl shadow-card">
          <h3 className="text-lg font-bold text-gray-800 mb-5">Revenue Breakdown</h3>
          {revenueBreakdown.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="h-56 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={revenueBreakdown}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomLabel}
                    >
                      {revenueBreakdown.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, '']} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 min-w-0">
                {revenueBreakdown.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i] }} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-500 truncate">{d.name}</p>
                      <p className="text-sm font-bold text-gray-800">₹{d.value.toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-56 text-gray-400 text-sm">No revenue data yet</div>
          )}
        </div>

        {/* Orders Bar */}
        <div className="bg-white p-6 rounded-2xl shadow-card">
          <h3 className="text-lg font-bold text-gray-800 mb-5">Order Volumes</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesData.slice(-8)} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(v: number) => [v, 'Orders']} />
                <Bar dataKey="orders" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Restaurants */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Award className="w-5 h-5 text-orange-400" />
            <h3 className="text-base font-bold text-gray-800">Top Restaurants</h3>
            <span className="ml-auto text-xs text-gray-400 font-medium">by orders</span>
          </div>
          {topRestaurants.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No restaurant data yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topRestaurants.map((r, i) => (
                <div key={r.id} className="flex items-center gap-4 px-6 py-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 text-sm truncate">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.orders} orders · ⭐ {r.rating.toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-gray-800 text-sm">₹{r.earnings.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-400">earned</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Riders */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Bike className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-gray-800">Top Riders</h3>
            <span className="ml-auto text-xs text-gray-400 font-medium">by deliveries</span>
          </div>
          {topRiders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No rider data yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topRiders.map((r, i) => (
                <div key={r.uid} className="flex items-center gap-4 px-6 py-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 text-sm truncate">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.deliveries} deliveries</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-gray-800 text-sm">₹{r.earnings.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-400">earned</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
