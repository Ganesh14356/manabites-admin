import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendingUp, Star, Clock, Package, CheckCircle, Award, Timer } from 'lucide-react';

interface RiderStat {
  id: string;
  name: string;
  phone?: string;
  totalDeliveries: number;
  totalEarnings: number;
  avgRating: number;
  onTimePercent: number;
  acceptanceRate: number;
  avgPickupMins: number;
  avgDropMins: number;
  cancelledOrders: number;
  isOnline: boolean;
  performanceScore: number;
}

type SortKey = 'score' | 'deliveries' | 'earnings' | 'rating' | 'ontime' | 'acceptance';

const MEDAL = ['🥇', '🥈', '🥉'];

function MetricBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-600 w-9 text-right">{value}%</span>
    </div>
  );
}

export default function RiderPerformance() {
  const [riders, setRiders] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'riders'), snap =>
      setRiders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsub2 = onSnapshot(collection(db, 'orders'), snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const stats = useMemo<RiderStat[]>(() => {
    return riders.map(rider => {
      const assignedOrders = orders.filter(o =>
        o.riderId === rider.id || o.assignedRiderId === rider.id
      );
      const acceptedOrders = orders.filter(o => o.riderId === rider.id);
      const delivered = acceptedOrders.filter(o => o.status === 'delivered');
      const cancelled = acceptedOrders.filter(o => o.status === 'cancelled');

      // Acceptance rate
      const acceptanceRate = assignedOrders.length > 0
        ? Math.round((acceptedOrders.length / assignedOrders.length) * 100)
        : 100;

      // On-time rate
      const onTime = delivered.filter(o => {
        if (!o.createdAt || !o.deliveredAt) return true;
        const createdMs = o.createdAt?.toMillis?.() ?? o.createdAt ?? 0;
        const deliveredMs = o.deliveredAt?.toMillis?.() ?? o.deliveredAt ?? 0;
        const actualMins = (deliveredMs - createdMs) / 60000;
        return actualMins <= (o.estimatedMinutes ?? 45) + 10;
      });
      const onTimePercent = delivered.length > 0
        ? Math.round((onTime.length / delivered.length) * 100)
        : 0;

      // Avg pickup time (accepted → picked_up)
      const pickupTimes = delivered
        .map(o => {
          const a = o.acceptedAt?.toMillis?.() ?? o.acceptedAt ?? 0;
          const p = o.pickedUpAt?.toMillis?.() ?? o.pickedUpAt ?? 0;
          return a && p ? (p - a) / 60000 : null;
        })
        .filter((v): v is number => v !== null && v > 0 && v < 120);
      const avgPickupMins = pickupTimes.length > 0
        ? Math.round(pickupTimes.reduce((s, v) => s + v, 0) / pickupTimes.length)
        : 0;

      // Avg drop time (picked_up → delivered)
      const dropTimes = delivered
        .map(o => {
          const p = o.pickedUpAt?.toMillis?.() ?? o.pickedUpAt ?? 0;
          const d = o.deliveredAt?.toMillis?.() ?? o.deliveredAt ?? 0;
          return p && d ? (d - p) / 60000 : null;
        })
        .filter((v): v is number => v !== null && v > 0 && v < 120);
      const avgDropMins = dropTimes.length > 0
        ? Math.round(dropTimes.reduce((s, v) => s + v, 0) / dropTimes.length)
        : 0;

      // Avg rating
      const avgRating = rider.rating ??
        (delivered.length > 0
          ? delivered.reduce((s: number, o: any) => s + (o.riderRating ?? 0), 0) / delivered.length
          : 0);

      // Weighted performance score: 35% on-time, 30% acceptance, 35% rating
      const ratingScore = Math.round((avgRating / 5) * 100);
      const performanceScore = delivered.length === 0 ? 0
        : Math.round(0.35 * onTimePercent + 0.30 * acceptanceRate + 0.35 * ratingScore);

      const totalDeliveries = rider.totalDeliveries ?? delivered.length;
      const totalEarnings = rider.totalEarnings ?? delivered.reduce((s: number, o: any) => s + (o.deliveryFee ?? 0), 0);

      return {
        id: rider.id,
        name: rider.name || 'Unknown',
        phone: rider.phone,
        totalDeliveries,
        totalEarnings,
        avgRating: Math.round((avgRating || 0) * 10) / 10,
        onTimePercent,
        acceptanceRate,
        avgPickupMins,
        avgDropMins,
        cancelledOrders: cancelled.length,
        isOnline: rider.isOnline ?? false,
        performanceScore,
      };
    });
  }, [riders, orders]);

  const sorted = useMemo(() => [...stats].sort((a, b) => {
    switch (sortBy) {
      case 'score':      return b.performanceScore - a.performanceScore;
      case 'deliveries': return b.totalDeliveries - a.totalDeliveries;
      case 'earnings':   return b.totalEarnings - a.totalEarnings;
      case 'rating':     return b.avgRating - a.avgRating;
      case 'ontime':     return b.onTimePercent - a.onTimePercent;
      case 'acceptance': return b.acceptanceRate - a.acceptanceRate;
      default: return 0;
    }
  }), [stats, sortBy]);

  const top3 = sorted.slice(0, 3);
  const totalDeliveries = stats.reduce((s, r) => s + r.totalDeliveries, 0);
  const onlineCount = stats.filter(r => r.isOnline).length;
  const avgRating = stats.length > 0
    ? (stats.reduce((s, r) => s + r.avgRating, 0) / stats.length).toFixed(1)
    : '0.0';
  const avgScore = stats.length > 0
    ? Math.round(stats.reduce((s, r) => s + r.performanceScore, 0) / stats.length)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Rider Performance</h1>
        <p className="text-sm text-gray-500 font-medium mt-0.5">Track delivery performance, ratings, and earnings</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Package, label: 'Total Deliveries', value: totalDeliveries, color: 'text-brand bg-brand/10' },
          { icon: Star, label: 'Avg Rating', value: avgRating + ' ★', color: 'text-yellow-600 bg-yellow-50' },
          { icon: CheckCircle, label: 'Online Now', value: onlineCount, color: 'text-green-600 bg-green-50' },
          { icon: Award, label: 'Avg Score', value: avgScore + '%', color: 'text-purple-600 bg-purple-50' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
              <Icon size={20} />
            </div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Top 3 Leaderboard */}
      {top3.length > 0 && (
        <div className="bg-gradient-to-r from-brand/5 to-orange-50 dark:from-gray-800 dark:to-gray-800 rounded-2xl p-5 border border-brand/20">
          <div className="flex items-center gap-2 mb-4">
            <Award size={18} className="text-brand" />
            <h2 className="font-black text-gray-800 dark:text-white">Top Performers</h2>
            <span className="text-xs text-gray-400 font-medium">— eligible for incentives</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {top3.map((rider, i) => (
              <div key={rider.id} className={`bg-white dark:bg-gray-700 rounded-xl p-4 text-center shadow-sm ${i === 0 ? 'ring-2 ring-yellow-400' : ''}`}>
                <div className="text-2xl mb-1">{MEDAL[i]}</div>
                <p className="font-black text-gray-800 dark:text-white text-sm truncate">{rider.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{rider.totalDeliveries} deliveries</p>
                <div className="mt-2 px-2.5 py-1 bg-brand/10 rounded-full inline-block">
                  <span className="text-xs font-black text-brand">{rider.performanceScore}% score</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sort Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Sort by:</span>
        {([
          { key: 'score', label: 'Score' },
          { key: 'deliveries', label: 'Deliveries' },
          { key: 'earnings', label: 'Earnings' },
          { key: 'rating', label: 'Rating' },
          { key: 'ontime', label: 'On-Time' },
          { key: 'acceptance', label: 'Acceptance' },
        ] as { key: SortKey; label: string }[]).map(s => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              sortBy === s.key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Rider Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <Package size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="font-black text-gray-400">No rider data yet</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {['#', 'Rider', 'Score', 'Deliveries', 'Acceptance', 'On-Time', 'Pickup Time', 'Drop Time', 'Rating', 'Status'].map(h => (
                    <th key={h} className="px-4 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {sorted.map((rider, i) => (
                  <>
                    <tr
                      key={rider.id}
                      onClick={() => setExpandedId(expandedId === rider.id ? null : rider.id)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                      {/* Rank */}
                      <td className="px-4 py-4">
                        <span className="text-base">{i < 3 ? MEDAL[i] : `#${i + 1}`}</span>
                      </td>

                      {/* Rider */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-sm font-black text-brand flex-shrink-0">
                            {rider.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-black text-gray-900 dark:text-white">{rider.name}</p>
                            {rider.phone && <p className="text-xs text-gray-400">{rider.phone}</p>}
                          </div>
                        </div>
                      </td>

                      {/* Score */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black ${
                            rider.performanceScore >= 80 ? 'bg-green-100 text-green-700' :
                            rider.performanceScore >= 60 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-600'
                          }`}>
                            {rider.performanceScore}
                          </div>
                          <TrendingUp size={14} className={
                            rider.performanceScore >= 80 ? 'text-green-500' :
                            rider.performanceScore >= 60 ? 'text-yellow-500' : 'text-red-500'
                          } />
                        </div>
                      </td>

                      {/* Deliveries */}
                      <td className="px-4 py-4">
                        <span className="font-black text-gray-900 dark:text-white">{rider.totalDeliveries}</span>
                        {rider.cancelledOrders > 0 && (
                          <span className="ml-1 text-xs text-red-400">({rider.cancelledOrders} ✕)</span>
                        )}
                      </td>

                      {/* Acceptance Rate */}
                      <td className="px-4 py-4">
                        <MetricBar
                          value={rider.acceptanceRate}
                          color={rider.acceptanceRate >= 80 ? 'bg-green-500' : rider.acceptanceRate >= 60 ? 'bg-yellow-400' : 'bg-red-500'}
                        />
                      </td>

                      {/* On-Time */}
                      <td className="px-4 py-4">
                        <MetricBar
                          value={rider.onTimePercent}
                          color={rider.onTimePercent >= 80 ? 'bg-green-500' : rider.onTimePercent >= 60 ? 'bg-yellow-400' : 'bg-red-500'}
                        />
                      </td>

                      {/* Pickup Time */}
                      <td className="px-4 py-4">
                        {rider.avgPickupMins > 0 ? (
                          <div className="flex items-center gap-1">
                            <Clock size={12} className="text-gray-400" />
                            <span className={`font-bold text-sm ${rider.avgPickupMins <= 15 ? 'text-green-600' : rider.avgPickupMins <= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {rider.avgPickupMins}m
                            </span>
                          </div>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {/* Drop Time */}
                      <td className="px-4 py-4">
                        {rider.avgDropMins > 0 ? (
                          <div className="flex items-center gap-1">
                            <Timer size={12} className="text-gray-400" />
                            <span className={`font-bold text-sm ${rider.avgDropMins <= 20 ? 'text-green-600' : rider.avgDropMins <= 35 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {rider.avgDropMins}m
                            </span>
                          </div>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {/* Rating */}
                      <td className="px-4 py-4">
                        <span className={`font-black ${rider.avgRating >= 4 ? 'text-green-600' : rider.avgRating >= 3 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {rider.avgRating > 0 ? `${rider.avgRating} ★` : '—'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${
                          rider.isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {rider.isOnline ? '● Online' : 'Offline'}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded row — breakdown */}
                    {expandedId === rider.id && (
                      <tr key={`${rider.id}-exp`} className="bg-orange-50/40 dark:bg-gray-750">
                        <td colSpan={10} className="px-8 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                              { label: 'Total Earnings', value: `₹${rider.totalEarnings.toLocaleString()}`, icon: '💰' },
                              { label: 'Acceptance Rate', value: `${rider.acceptanceRate}%`, icon: '✅' },
                              { label: 'Avg Pickup Time', value: rider.avgPickupMins > 0 ? `${rider.avgPickupMins} min` : '—', icon: '🏍️' },
                              { label: 'Avg Drop Time', value: rider.avgDropMins > 0 ? `${rider.avgDropMins} min` : '—', icon: '📦' },
                            ].map(item => (
                              <div key={item.label} className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm">
                                <span className="text-base">{item.icon}</span>
                                <p className="font-black text-gray-900 dark:text-white mt-1">{item.value}</p>
                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{item.label}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 text-xs text-gray-400">
                            Score formula: 35% On-Time + 30% Acceptance Rate + 35% Customer Rating
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
