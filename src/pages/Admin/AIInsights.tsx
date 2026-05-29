import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { Brain, TrendingUp, Zap, Target, BarChart2, RefreshCw, Lightbulb, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';

// ── Linear Regression Forecast ────────────────────────────────────────────────

function linearForecast(values: number[], days: number): number[] {
  const n = values.length;
  if (n === 0) return Array(days).fill(0);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  const denom = values.reduce((s, _, x) => s + (x - xMean) ** 2, 0);
  if (denom === 0) return Array(days).fill(Math.round(yMean));
  const slope = values.reduce((s, y, x) => s + (x - xMean) * (y - yMean), 0) / denom;
  const intercept = yMean - slope * xMean;
  return Array.from({ length: days }, (_, i) =>
    Math.max(0, Math.round(intercept + slope * (n + i)))
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayBucket {
  date: string;      // YYYY-MM-DD
  revenue: number;
  orders: number;
}

interface Recommendation {
  icon: string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

interface ComputedInsights {
  last30Days: DayBucket[];
  forecastData: { date: string; revenue: number; type: 'actual' | 'forecast' }[];
  peakHours: string;
  peakDay: string;
  topRestaurants: { name: string; orders: number }[];
  avgOrderValue: number;
  repeatCustomerRate: number;
  monthlyVolume: { month: string; orders: number; revenue: number; isPeak: boolean }[];
  totalRevenue30d: number;
  totalOrders30d: number;
  recommendations: Recommendation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function fmtFutureLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
}

function computeInsights(orders: any[]): ComputedInsights {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const delivered = orders.filter((o) => o.status === 'delivered');

  // ── Last 30 days buckets ────────────────────────────────────────────────────
  const bucketMap = new Map<string, DayBucket>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = formatDate(d);
    bucketMap.set(key, { date: key, revenue: 0, orders: 0 });
  }

  delivered.forEach((o: any) => {
    const ts = o.createdAt?.toDate?.();
    if (!ts || ts < thirtyDaysAgo) return;
    const key = formatDate(ts);
    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.revenue += o.totalAmount || 0;
      bucket.orders += 1;
    }
  });

  const last30Days = Array.from(bucketMap.values());

  // ── 7-day forecast ─────────────────────────────────────────────────────────
  const revenueValues = last30Days.map((b) => b.revenue);
  const forecasted = linearForecast(revenueValues, 7);

  const forecastData: ComputedInsights['forecastData'] = [
    ...last30Days.slice(-7).map((b) => ({ date: fmtDayLabel(b.date), revenue: Math.round(b.revenue), type: 'actual' as const })),
    ...forecasted.map((rev, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() + i + 1);
      return { date: fmtFutureLabel(formatDate(d)), revenue: rev, type: 'forecast' as const };
    }),
  ];

  // ── Peak hours (all delivered orders) ──────────────────────────────────────
  const hourMap = new Array(24).fill(0);
  delivered.forEach((o: any) => {
    const ts = o.createdAt?.toDate?.();
    if (ts) hourMap[ts.getHours()]++;
  });

  // Top 2 hour clusters
  const topHourIdxs = hourMap
    .map((count, h) => ({ h, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .sort((a, b) => a.h - b.h);

  function fmtHour(h: number): string {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
  }

  const peakHours =
    topHourIdxs.length >= 2
      ? `${fmtHour(topHourIdxs[0].h)}–${fmtHour(topHourIdxs[0].h + 2)}, ${fmtHour(topHourIdxs[1].h)}–${fmtHour(topHourIdxs[1].h + 2)}`
      : topHourIdxs.length === 1
      ? `${fmtHour(topHourIdxs[0].h)}–${fmtHour(topHourIdxs[0].h + 2)}`
      : 'N/A';

  // ── Peak day of week ────────────────────────────────────────────────────────
  const dayMap = new Array(7).fill(0);
  delivered.forEach((o: any) => {
    const ts = o.createdAt?.toDate?.();
    if (ts) dayMap[ts.getDay()]++;
  });
  const peakDayIdx = dayMap.indexOf(Math.max(...dayMap));
  const peakDay = delivered.length > 0 ? DAY_NAMES[peakDayIdx] : 'N/A';

  // ── Top 5 restaurants ──────────────────────────────────────────────────────
  const restMap = new Map<string, { name: string; orders: number }>();
  delivered.forEach((o: any) => {
    const id = o.restaurantId || o.restaurantName || 'unknown';
    const name = o.restaurantName || id;
    if (!restMap.has(id)) restMap.set(id, { name, orders: 0 });
    restMap.get(id)!.orders++;
  });
  const topRestaurants = Array.from(restMap.values())
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);

  // ── AOV & repeat rate ──────────────────────────────────────────────────────
  const totalRevenue30d = last30Days.reduce((s, b) => s + b.revenue, 0);
  const totalOrders30d = last30Days.reduce((s, b) => s + b.orders, 0);
  const avgOrderValue = totalOrders30d > 0 ? Math.round(totalRevenue30d / totalOrders30d) : 0;

  const customerOrderCount = new Map<string, number>();
  orders.forEach((o: any) => {
    if (o.customerId) customerOrderCount.set(o.customerId, (customerOrderCount.get(o.customerId) || 0) + 1);
  });
  const totalC = customerOrderCount.size;
  const repeatC = Array.from(customerOrderCount.values()).filter((c) => c > 1).length;
  const repeatCustomerRate = totalC > 0 ? Math.round((repeatC / totalC) * 100) : 0;

  // ── Monthly volume (12 months) ─────────────────────────────────────────────
  const monthlyVolume = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    const bucket = delivered.filter((o: any) => {
      const ts = o.createdAt?.toDate?.();
      return ts && ts.getMonth() === m && ts.getFullYear() === y;
    });
    return {
      month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      orders: bucket.length,
      revenue: Math.round(bucket.reduce((s, o: any) => s + (o.totalAmount || 0), 0)),
      isPeak: false,
    };
  });

  // Mark the top 2 months as peak
  const sortedByOrders = [...monthlyVolume].sort((a, b) => b.orders - a.orders);
  const peakMonths = new Set(sortedByOrders.slice(0, 2).map((m) => m.month));
  monthlyVolume.forEach((m) => { m.isPeak = peakMonths.has(m.month); });

  // ── AI Recommendations ─────────────────────────────────────────────────────
  const recommendations: Recommendation[] = [];

  if (repeatCustomerRate < 40) {
    recommendations.push({
      icon: '🎁',
      title: 'Loyalty Gap Detected',
      description: `Only ${repeatCustomerRate}% of customers are repeat buyers. Launch a cashback or points campaign to boost retention — target customers who ordered only once.`,
      severity: 'high',
    });
  }

  if (avgOrderValue < 200 && avgOrderValue > 0) {
    recommendations.push({
      icon: '📦',
      title: 'Low Average Order Value',
      description: `Your 30-day AOV is ₹${avgOrderValue}. Introduce combo meals, bundle offers, or a "add ₹X more to save ₹Y" nudge at checkout to lift this metric.`,
      severity: 'high',
    });
  }

  if (topHourIdxs.length > 0) {
    recommendations.push({
      icon: '⚡',
      title: 'Surge Pricing Opportunity',
      description: `Orders spike around ${peakHours}. Enable dynamic surge pricing during these hours to increase revenue per order without increasing volume.`,
      severity: 'medium',
    });
  }

  if (topRestaurants.length > 0 && topRestaurants[0].orders > 0) {
    const topRest = topRestaurants[0].name;
    recommendations.push({
      icon: '🌟',
      title: 'Feature Your Star Restaurant',
      description: `"${topRest}" is your top-performing restaurant. Promote it via push notifications, homepage banners, and exclusive limited-time offers to drive even more orders.`,
      severity: 'low',
    });
  }

  if (recommendations.length < 3) {
    recommendations.push({
      icon: '📣',
      title: 'Re-engage Inactive Customers',
      description: 'Send personalised push notifications or WhatsApp messages to customers who haven\'t ordered in 14+ days with a discount coupon to win them back.',
      severity: 'low',
    });
  }

  return {
    last30Days,
    forecastData,
    peakHours,
    peakDay,
    topRestaurants,
    avgOrderValue,
    repeatCustomerRate,
    monthlyVolume,
    totalRevenue30d,
    totalOrders30d,
    recommendations,
  };
}

// ── Severity badge helper ─────────────────────────────────────────────────────

function severityClasses(s: Recommendation['severity']): string {
  if (s === 'high') return 'bg-red-50 border-red-200 text-red-700';
  if (s === 'medium') return 'bg-amber-50 border-amber-200 text-amber-700';
  return 'bg-blue-50 border-blue-200 text-blue-700';
}

function severityLabel(s: Recommendation['severity']): string {
  if (s === 'high') return 'High Priority';
  if (s === 'medium') return 'Medium Priority';
  return 'Suggestion';
}

// ── Custom Bar shape for forecast (different color per type) ──────────────────

function ForecastBar(props: any) {
  const { x, y, width, height, type } = props;
  if (!height || height <= 0) return null;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={5}
      ry={5}
      fill={type === 'forecast' ? '#fb923c' : '#f97316'}
      opacity={type === 'forecast' ? 0.65 : 1}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AIInsights() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      );
      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllOrders(orders);
      setLastRefreshed(new Date());
      toast.success('Insights refreshed');
    } catch (err) {
      console.error('AIInsights fetch error', err);
      toast.error('Failed to fetch order data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insights = useMemo<ComputedInsights | null>(() => {
    if (allOrders.length === 0 && !loading) return null;
    if (allOrders.length === 0) return null;
    return computeInsights(allOrders);
  }, [allOrders, loading]);

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-orange-100 border-t-brand rounded-full animate-spin" />
          <Brain className="absolute inset-0 m-auto w-7 h-7 text-brand" />
        </div>
        <p className="text-gray-500 font-semibold">Analysing your business data…</p>
        <p className="text-gray-400 text-sm">Running AI computations on order history</p>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!insights) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertCircle className="w-12 h-12 text-gray-300" />
        <p className="text-gray-600 font-bold text-lg">No order data found</p>
        <p className="text-gray-400 text-sm max-w-xs">
          Deliver a few orders first. AI insights will appear once there is enough data to analyse.
        </p>
        <button
          onClick={fetchOrders}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-dark transition-colors mt-2"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  const {
    forecastData,
    peakHours,
    peakDay,
    topRestaurants,
    avgOrderValue,
    repeatCustomerRate,
    monthlyVolume,
    totalRevenue30d,
    totalOrders30d,
    recommendations,
  } = insights;

  const forecastedRevenue = forecastData.filter((d) => d.type === 'forecast').reduce((s, d) => s + d.revenue, 0);
  const actualRevenue7d = forecastData.filter((d) => d.type === 'actual').reduce((s, d) => s + d.revenue, 0);
  const growthPct = actualRevenue7d > 0 ? Math.round(((forecastedRevenue - actualRevenue7d) / actualRevenue7d) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-8">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <motion.div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-800">AI Business Insights</h1>
            <p className="text-gray-400 text-sm">
              Powered by real-time Firestore data
              {lastRefreshed && (
                <span className="ml-2 text-gray-300">
                  · Last updated {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={fetchOrders}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </motion.div>

      {/* ── Summary KPI strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '30-Day Revenue', value: `₹${totalRevenue30d.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'text-brand', bg: 'bg-orange-50' },
          { label: '30-Day Orders', value: totalOrders30d.toLocaleString(), icon: BarChart2, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Avg Order Value', value: `₹${avgOrderValue.toLocaleString('en-IN')}`, icon: Target, color: 'text-purple-500', bg: 'bg-purple-50' },
          { label: 'Repeat Rate', value: `${repeatCustomerRate}%`, icon: Zap, color: 'text-green-500', bg: 'bg-green-50' },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
            className="bg-white rounded-2xl p-5 shadow-card"
          >
            <div className={`w-9 h-9 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{card.label}</p>
            <p className="text-xl font-black text-gray-800">{card.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Section 1: Revenue Forecast ──────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-brand" />
          <h2 className="text-lg font-black text-gray-800">AI Revenue Forecast</h2>
          <span className="ml-auto text-xs bg-orange-100 text-orange-700 font-bold px-2.5 py-1 rounded-full">Linear Regression</span>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-6">
          {/* AI insight banner */}
          <div className="flex items-start gap-3 mb-5 p-4 bg-orange-50 border border-orange-100 rounded-xl">
            <Brain className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-gray-800">
                Forecast: Next 7 days projected revenue is{' '}
                <span className="text-brand">₹{forecastedRevenue.toLocaleString('en-IN')}</span>
                {growthPct !== 0 && (
                  <span className={`ml-1 ${growthPct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    ({growthPct >= 0 ? '+' : ''}{growthPct}% vs last 7 days)
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Based on the last 30 days of delivered orders using linear trend analysis.
                Lighter bars indicate forecasted values.
              </p>
            </div>
          </div>

          {/* Forecast bar chart */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={forecastData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickFormatter={(v) => v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number, _name: string, entry: any) => [
                    `₹${value.toLocaleString('en-IN')}`,
                    entry.payload.type === 'forecast' ? 'Forecasted Revenue' : 'Actual Revenue',
                  ]}
                />
                <Bar
                  dataKey="revenue"
                  shape={(props: any) => <ForecastBar {...props} type={props.type ?? props.payload?.type} />}
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-3 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-brand" />
              <span className="text-xs text-gray-500 font-medium">Actual (last 7 days)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-orange-300" />
              <span className="text-xs text-gray-500 font-medium">Forecast (next 7 days)</span>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── Section 2: Demand Prediction ─────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-black text-gray-800">Demand Prediction</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Peak Hours */}
          <motion.div
            className="bg-white rounded-2xl shadow-card p-5 flex items-start gap-4"
            whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.09)' }}
          >
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl">
              📈
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Peak Hours</p>
              <p className="text-base font-black text-gray-800">{peakHours}</p>
              <p className="text-xs text-gray-500 mt-1">Highest order volume windows</p>
            </div>
          </motion.div>

          {/* Busiest Day */}
          <motion.div
            className="bg-white rounded-2xl shadow-card p-5 flex items-start gap-4"
            whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.09)' }}
          >
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl">
              📅
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Busiest Day</p>
              <p className="text-base font-black text-gray-800">{peakDay}</p>
              <p className="text-xs text-gray-500 mt-1">Most orders placed on this day</p>
            </div>
          </motion.div>

          {/* Top Restaurants */}
          <motion.div
            className="bg-white rounded-2xl shadow-card p-5 sm:col-span-2 lg:col-span-1"
            whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.09)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🍕</span>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Top Restaurants</p>
            </div>
            <div className="space-y-2">
              {topRestaurants.slice(0, 3).map((r, i) => (
                <div key={r.name} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                    {i + 1}
                  </span>
                  <span className="text-sm font-bold text-gray-700 truncate flex-1">{r.name}</span>
                  <span className="text-xs text-gray-400 font-medium flex-shrink-0">{r.orders} orders</span>
                </div>
              ))}
              {topRestaurants.length === 0 && (
                <p className="text-sm text-gray-400">No data yet</p>
              )}
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* ── Section 3: AI Recommendations ────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-black text-gray-800">AI Recommendations</h2>
          <span className="ml-auto text-xs text-gray-400">{recommendations.length} actionable insights</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recommendations.map((rec, i) => (
            <motion.div
              key={rec.title}
              className={`rounded-2xl border p-5 ${severityClasses(rec.severity)}`}
              initial={{ opacity: 0, x: i % 2 === 0 ? -16 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.08, duration: 0.35 }}
              whileHover={{ scale: 1.01 }}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl flex-shrink-0">{rec.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-sm font-black text-gray-800">{rec.title}</h3>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${severityClasses(rec.severity)}`}>
                      {severityLabel(rec.severity)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{rec.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ── Section 4: Seasonal Trends ────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65, duration: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-black text-gray-800">Seasonal Trends</h2>
          <span className="ml-auto text-xs bg-purple-100 text-purple-700 font-bold px-2.5 py-1 rounded-full">12-Month View</span>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-6">
          {/* Peak month labels */}
          <div className="flex flex-wrap gap-2 mb-5">
            {monthlyVolume.filter((m) => m.isPeak).map((m) => (
              <span key={m.month} className="text-xs bg-orange-100 text-orange-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                🔥 {m.month} — Peak month ({m.orders} orders)
              </span>
            ))}
            {monthlyVolume.every((m) => !m.isPeak) && (
              <span className="text-xs text-gray-400">No monthly data available yet</span>
            )}
          </div>

          {/* Order volume bar chart */}
          <div className="h-64 mb-6">
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={monthlyVolume} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number, name: string) => [
                    name === 'orders' ? value : `₹${value.toLocaleString('en-IN')}`,
                    name === 'orders' ? 'Orders' : 'Revenue',
                  ]}
                />
                <Bar
                  dataKey="orders"
                  radius={[5, 5, 0, 0]}
                  fill="#8b5cf6"
                  label={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue area chart */}
          <p className="text-sm font-bold text-gray-500 mb-3">Monthly Revenue Trend</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height={176}>
              <AreaChart data={monthlyVolume}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickFormatter={(v) => v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Revenue']}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  fill="url(#revenueGrad)"
                  dot={{ r: 3.5, strokeWidth: 2, fill: '#fff', stroke: '#f97316' }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
