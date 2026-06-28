import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { motion } from 'motion/react';

interface PnLRecord {
  orderId: string;
  date: string;
  subtotal: number;
  deliveryFee: number;
  commission: number;
  platformFee: number;
  totalRevenue: number;
  riderCost: number;
  isRapido: boolean;
  totalCost: number;
  profit: number;
  margin: number;
  calculatedAt: number;
}

const fmt = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];

export default function PnLDashboard() {
  const [date, setDate]     = useState(today());
  const [records, setRecords] = useState<PnLRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getDocs(query(collection(db, 'pnl'), where('date', '==', date), orderBy('calculatedAt', 'desc'), limit(200)))
      .then(snap => setRecords(snap.docs.map(d => d.data() as PnLRecord)))
      .finally(() => setLoading(false));
  }, [date]);

  const totalOrders   = records.length;
  const rapidoOrders  = records.filter(r => r.isRapido).length;
  const rapidoPct     = totalOrders ? Math.round((rapidoOrders / totalOrders) * 100) : 0;
  const totalRevenue  = records.reduce((s, r) => s + r.totalRevenue, 0);
  const totalCost     = records.reduce((s, r) => s + r.totalCost,    0);
  const totalProfit   = records.reduce((s, r) => s + r.profit,       0);
  const margin        = totalRevenue ? Math.round((totalProfit / totalRevenue) * 100) : 0;
  const rapidoAlert   = rapidoPct > 30;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">📊 P&L Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Profit & loss per order — revenue, costs, margins</p>
        </div>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-200 rounded-2xl px-4 py-2 text-sm font-bold text-gray-700"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue',  value: fmt(totalRevenue),  color: 'text-blue-600',  bg: 'bg-blue-50'  },
          { label: 'Total Cost',     value: fmt(totalCost),     color: 'text-red-600',   bg: 'bg-red-50'   },
          { label: 'Net Profit',     value: fmt(totalProfit),   color: totalProfit >= 0 ? 'text-green-600' : 'text-red-600', bg: totalProfit >= 0 ? 'bg-green-50' : 'bg-red-50' },
          { label: 'Margin',         value: `${margin}%`,       color: margin >= 20 ? 'text-green-600' : 'text-orange-500', bg: 'bg-gray-50' },
        ].map(c => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            className={`${c.bg} rounded-2xl p-4`}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{c.label}</p>
            <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Rapido alert */}
      {rapidoAlert && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-black text-yellow-800">Rapido Overuse Alert</p>
            <p className="text-sm text-yellow-700">
              {rapidoPct}% orders via Rapido today ({rapidoOrders}/{totalOrders}) — above 30% threshold.
              Rider shortage fix cheyali.
            </p>
          </div>
        </motion.div>
      )}

      {/* Rapido vs ManaBites split */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-black text-gray-800 mb-3 text-sm uppercase tracking-wider">Delivery Split</h2>
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <div className="flex justify-between text-xs font-bold mb-1">
              <span className="text-brand">ManaBites Riders</span>
              <span>{totalOrders - rapidoOrders} orders ({100 - rapidoPct}%)</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full" style={{ width: `${100 - rapidoPct}%` }} />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex justify-between text-xs font-bold mb-1">
              <span className="text-yellow-600">Rapido</span>
              <span>{rapidoOrders} orders ({rapidoPct}%)</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${rapidoPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Order-level P&L table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-black text-gray-800 text-sm uppercase tracking-wider">
            Order P&L — {totalOrders} orders
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No P&L data for {date}. Data appears after orders are delivered.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Order', 'Delivery', 'Revenue', 'Cost', 'Profit', 'Margin'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {records.map(r => (
                  <tr key={r.orderId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-500">{r.orderId.slice(-6).toUpperCase()}</td>
                    <td className="px-4 py-3">
                      {r.isRapido
                        ? <span className="bg-yellow-100 text-yellow-700 font-black px-2 py-0.5 rounded-full">Rapido</span>
                        : <span className="bg-green-100 text-green-700 font-black px-2 py-0.5 rounded-full">ManaBites</span>}
                    </td>
                    <td className="px-4 py-3 font-bold text-blue-600">{fmt(r.totalRevenue)}</td>
                    <td className="px-4 py-3 font-bold text-red-500">{fmt(r.totalCost)}</td>
                    <td className={`px-4 py-3 font-black ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {r.profit >= 0 ? '+' : '-'}{fmt(r.profit)}
                    </td>
                    <td className={`px-4 py-3 font-black ${r.margin >= 20 ? 'text-green-600' : r.margin >= 0 ? 'text-orange-500' : 'text-red-600'}`}>
                      {r.margin}%
                    </td>
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
