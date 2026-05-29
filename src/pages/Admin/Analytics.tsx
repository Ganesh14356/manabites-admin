import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, where, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import { TrendingUp, DollarSign, ShoppingBag, Users, Store, Bike, Award, RefreshCw, Download, FileText, Clock, Repeat2, Tag, UtensilsCrossed } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
interface PeriodRevenue { today: number; thisWeek: number; thisMonth: number; thisYear: number; }
interface OrderStatusCounts { active: number; pending: number; preparing: number; completed: number; cancelled: number; failed: number; }
interface TopItem { name: string; count: number; revenue: number; }
interface PeakHour { hour: string; orders: number; }

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
  const [periodRevenue, setPeriodRevenue] = useState<PeriodRevenue>({ today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0 });
  const [statusCounts, setStatusCounts] = useState<OrderStatusCounts>({ active: 0, pending: 0, preparing: 0, completed: 0, cancelled: 0, failed: 0 });
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [topCategories, setTopCategories] = useState<TopItem[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [repeatCustomerRate, setRepeatCustomerRate] = useState(0);
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

      // ── Period Revenue ──────────────────────────────────────────────────────
      const now2 = new Date();
      const startOfToday = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
      const startOfWeek  = new Date(now2); startOfWeek.setDate(now2.getDate() - now2.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const startOfMonth = new Date(now2.getFullYear(), now2.getMonth(), 1);
      const startOfYear  = new Date(now2.getFullYear(), 0, 1);
      const pr: PeriodRevenue = { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0 };
      delivered.forEach((o: any) => {
        const d = o.createdAt?.toDate?.();
        if (!d) return;
        const amt = o.totalAmount || 0;
        if (d >= startOfToday) pr.today    += amt;
        if (d >= startOfWeek)  pr.thisWeek += amt;
        if (d >= startOfMonth) pr.thisMonth += amt;
        if (d >= startOfYear)  pr.thisYear  += amt;
      });
      setPeriodRevenue(pr);

      // ── Order Status Counts ─────────────────────────────────────────────────
      const sc: OrderStatusCounts = { active: 0, pending: 0, preparing: 0, completed: 0, cancelled: 0, failed: 0 };
      orders.forEach((o: any) => {
        const s = (o.status || '').toLowerCase();
        if (['out_for_delivery', 'rider_assigned', 'picked_up', 'on_the_way'].includes(s)) sc.active++;
        else if (s === 'pending' || s === 'placed') sc.pending++;
        else if (['accepted', 'preparing', 'ready'].includes(s)) sc.preparing++;
        else if (s === 'delivered') sc.completed++;
        else if (s === 'cancelled') sc.cancelled++;
        else if (s === 'failed') sc.failed++;
      });
      setStatusCounts(sc);

      // ── Peak Hours ──────────────────────────────────────────────────────────
      const hourMap = new Array(24).fill(0);
      orders.forEach((o: any) => {
        const d = o.createdAt?.toDate?.();
        if (d) hourMap[d.getHours()]++;
      });
      setPeakHours(hourMap.map((count, h) => ({
        hour: `${h.toString().padStart(2, '0')}:00`,
        orders: count,
      })));

      // ── Most Ordered Items + Categories ────────────────────────────────────
      const itemMap  = new Map<string, TopItem>();
      const catMap   = new Map<string, TopItem>();
      orders.forEach((o: any) => {
        (o.items || []).forEach((item: any) => {
          const qty  = item.quantity ?? item.qty ?? 1;
          const rev  = (item.price ?? 0) * qty;
          const name = item.name || 'Unknown';
          const cat  = item.category || 'Other';
          if (!itemMap.has(name)) itemMap.set(name, { name, count: 0, revenue: 0 });
          const im = itemMap.get(name)!; im.count += qty; im.revenue += rev;
          if (!catMap.has(cat)) catMap.set(cat, { name: cat, count: 0, revenue: 0 });
          const cm = catMap.get(cat)!; cm.count += qty; cm.revenue += rev;
        });
      });
      setTopItems(Array.from(itemMap.values()).sort((a, b) => b.count - a.count).slice(0, 8));
      setTopCategories(Array.from(catMap.values()).sort((a, b) => b.count - a.count).slice(0, 6));

      // ── Repeat Customer Rate ────────────────────────────────────────────────
      const customerOrderCount = new Map<string, number>();
      orders.forEach((o: any) => {
        if (o.customerId) customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) || 0) + 1);
      });
      const totalC   = customerOrderCount.size;
      const repeatC  = Array.from(customerOrderCount.values()).filter(c => c > 1).length;
      setRepeatCustomerRate(totalC > 0 ? Math.round((repeatC / totalC) * 100) : 0);

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
      <motion.div
        className="flex items-start justify-between"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
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
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.07, duration: 0.35, ease: 'easeOut' }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
            className="bg-white p-5 rounded-2xl shadow-card cursor-default"
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
      <motion.div
        className="bg-white p-6 rounded-2xl shadow-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.35 }}
      >
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
          <ResponsiveContainer width="100%" height={288}>
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
      </motion.div>

      {/* Revenue Breakdown + Orders Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Pie */}
        <motion.div
          className="bg-white p-6 rounded-2xl shadow-card"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.55, duration: 0.35 }}
        >
          <h3 className="text-lg font-bold text-gray-800 mb-5">Revenue Breakdown</h3>
          {revenueBreakdown.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="h-56 flex-1">
                <ResponsiveContainer width="100%" height={224}>
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
        </motion.div>

        {/* Orders Bar */}
        <motion.div
          className="bg-white p-6 rounded-2xl shadow-card"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6, duration: 0.35 }}
        >
          <h3 className="text-lg font-bold text-gray-800 mb-5">Order Volumes</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height={224}>
              <BarChart data={salesData.slice(-8)} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(v: number) => [v, 'Orders']} />
                <Bar dataKey="orders" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* ── Period Revenue ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Today's Revenue",   value: periodRevenue.today,     icon: '🌅', color: 'bg-amber-50 text-amber-700' },
          { label: 'This Week',         value: periodRevenue.thisWeek,  icon: '📅', color: 'bg-blue-50 text-blue-700' },
          { label: 'This Month',        value: periodRevenue.thisMonth, icon: '📆', color: 'bg-purple-50 text-purple-700' },
          { label: 'This Year',         value: periodRevenue.thisYear,  icon: '🏆', color: 'bg-green-50 text-green-700' },
        ].map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 + 0.2 }}
            className="bg-white rounded-2xl p-5 shadow-card"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{c.icon}</span>
              <span className={`text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${c.color}`}>{c.label}</span>
            </div>
            <p className="text-2xl font-black text-gray-800">₹{c.value.toLocaleString('en-IN')}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Order Status Breakdown ──────────────────────────────────────────── */}
      <motion.div
        className="bg-white rounded-2xl shadow-card p-6"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-4">Order Status Breakdown</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Active',     count: statusCounts.active,    emoji: '🚴', bg: 'bg-blue-50',   text: 'text-blue-700' },
            { label: 'Pending',    count: statusCounts.pending,   emoji: '⏳', bg: 'bg-amber-50',  text: 'text-amber-700' },
            { label: 'Preparing',  count: statusCounts.preparing, emoji: '👨‍🍳', bg: 'bg-orange-50', text: 'text-orange-700' },
            { label: 'Completed',  count: statusCounts.completed, emoji: '✅', bg: 'bg-green-50',  text: 'text-green-700' },
            { label: 'Cancelled',  count: statusCounts.cancelled, emoji: '❌', bg: 'bg-red-50',    text: 'text-red-700' },
            { label: 'Failed',     count: statusCounts.failed,    emoji: '⚠️', bg: 'bg-gray-50',   text: 'text-gray-700' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-4 text-center`}>
              <div className="text-2xl mb-1">{s.emoji}</div>
              <p className={`text-2xl font-black ${s.text}`}>{s.count.toLocaleString()}</p>
              <p className="text-xs font-bold text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Peak Hours ─────────────────────────────────────────────────────── */}
      <motion.div
        className="bg-white p-6 rounded-2xl shadow-card"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
      >
        <div className="flex items-center gap-2 mb-5">
          <Clock className="w-5 h-5 text-brand" />
          <h3 className="text-lg font-bold text-gray-800">Peak Order Hours</h3>
          <span className="ml-auto text-xs text-gray-400 font-medium">All time · by hour of day</span>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height={192}>
            <BarChart data={peakHours} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 10 }}
                tickFormatter={v => {
                  const h = parseInt(v);
                  if ([0, 6, 9, 12, 15, 18, 21].includes(h)) return h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
                  return '';
                }}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(v: number) => [v, 'Orders']}
                labelFormatter={(l) => {
                  const h = parseInt(l);
                  return h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
                }}
              />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}
                fill="#f97316"
                label={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* ── Most Ordered Foods + Top Categories ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          className="bg-white rounded-2xl shadow-card overflow-hidden"
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
        >
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-orange-400" />
            <h3 className="text-base font-bold text-gray-800">Most Ordered Foods</h3>
            <span className="ml-auto text-xs text-gray-400">by quantity</span>
          </div>
          {topItems.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No item data yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topItems.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3 px-6 py-2.5">
                  <span className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 text-xs font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.round((item.count / (topItems[0]?.count || 1)) * 100)}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 font-medium shrink-0">{item.count.toLocaleString()} sold</span>
                    </div>
                  </div>
                  <span className="text-xs font-black text-gray-700 shrink-0">₹{item.revenue.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          className="bg-white rounded-2xl shadow-card overflow-hidden"
          initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45 }}
        >
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Tag className="w-5 h-5 text-purple-400" />
            <h3 className="text-base font-bold text-gray-800">Top Categories</h3>
            <span className="ml-auto text-xs text-gray-400">by quantity</span>
          </div>
          {topCategories.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No category data yet</div>
          ) : (
            <div className="p-5 space-y-3">
              {topCategories.map((cat, i) => {
                const pct = Math.round((cat.count / (topCategories[0]?.count || 1)) * 100);
                const colors = ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#f59e0b'];
                return (
                  <div key={cat.name}>
                    <div className="flex justify-between text-sm font-bold text-gray-700 mb-1">
                      <span>{cat.name}</span>
                      <span className="text-gray-400">{cat.count.toLocaleString()} items · ₹{cat.revenue.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.5 + i * 0.08, duration: 0.5, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: colors[i % colors.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Repeat Customer Rate ────────────────────────────────────────────── */}
      <motion.div
        className="bg-white rounded-2xl shadow-card p-6 flex items-center gap-6"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
      >
        <div className="w-20 h-20 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0">
          <Repeat2 className="w-9 h-9 text-brand" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Repeat Customer Rate</p>
          <p className="text-4xl font-black text-brand">{repeatCustomerRate}%</p>
          <p className="text-sm text-gray-500 mt-1">of customers have placed more than one order — loyalty indicator</p>
        </div>
        <div className="hidden md:block">
          <div className="w-32 h-32 relative">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f97316" strokeWidth="3"
                strokeDasharray={`${repeatCustomerRate} ${100 - repeatCustomerRate}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-black text-brand">{repeatCustomerRate}%</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Restaurants */}
        <motion.div
          className="bg-white rounded-2xl shadow-card overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.35 }}
        >
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
                <motion.div
                  key={r.id}
                  className="flex items-center gap-4 px-6 py-3"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + i * 0.06, duration: 0.28 }}
                >
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
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Top Riders */}
        <motion.div
          className="bg-white rounded-2xl shadow-card overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.35 }}
        >
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
                <motion.div
                  key={r.uid}
                  className="flex items-center gap-4 px-6 py-3"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.75 + i * 0.06, duration: 0.28 }}
                >
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
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
