import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, getDocs, query, where, Timestamp,
  writeBatch, doc, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Calculator, Store, Bike, CheckCircle, AlertTriangle,
  ChevronDown, ChevronUp, Download, Banknote, CreditCard, FileText,
} from 'lucide-react';

// ── CSV helper ─────────────────────────────────────────────────────
function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────
interface RestaurantSettlement {
  restaurantId: string;
  restaurantName: string;
  ordersCount: number;
  orderIds: string[];
  grossAmount: number;
  commission: number;
  gstOnCommission: number;
  netAmount: number;
}

interface RiderSettlement {
  riderId: string;
  riderName: string;
  deliveriesCount: number;
  orderIds: string[];
  payPerDelivery: number;
  totalEarnings: number;
}

interface Preview {
  date: string;
  commissionRate: number;
  riderPayPerDelivery: number;
  restaurants: RestaurantSettlement[];
  riders: RiderSettlement[];
  totalOrders: number;
  totalGross: number;
  totalCommission: number;
  totalNetToRestaurants: number;
  totalRiderPay: number;
}

// ── Helpers ───────────────────────────────────────────────────────
const toINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────
export default function DailySettlements() {
  const [date, setDate] = useState(todayISO());
  const [calculating, setCalculating] = useState(false);
  const [generating, setGenerating] = useState<'manual' | 'online' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [expandedRest, setExpandedRest] = useState<string | null>(null);

  // ── Calculate settlement from orders ────────────────────────────
  const handleCalculate = async () => {
    setCalculating(true);
    setPreview(null);
    try {
      // Load settings
      const settingsSnap = await getDoc(doc(db, 'settings', 'deliveryFees'));
      const s = settingsSnap.data() ?? {};
      const commissionRate: number = s.commissionRate ?? 20;
      const riderPayPerDelivery: number = s.riderPayPerDelivery ?? 35;

      // Date range for the selected day
      const [y, m, d2] = date.split('-').map(Number);
      const startOfDay = new Date(y, m - 1, d2, 0, 0, 0, 0);
      const endOfDay   = new Date(y, m - 1, d2, 23, 59, 59, 999);

      const ordersQ = query(
        collection(db, 'orders'),
        where('createdAt', '>=', Timestamp.fromDate(startOfDay)),
        where('createdAt', '<=', Timestamp.fromDate(endOfDay)),
      );
      const snap = await getDocs(ordersQ);
      const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const delivered = allOrders.filter(o => o.status === 'delivered' && !o.settled);

      if (delivered.length === 0) {
        toast('No unsettled delivered orders on this date', { icon: 'ℹ️' });
        setCalculating(false);
        return;
      }

      // Group by restaurant
      const restMap = new Map<string, RestaurantSettlement>();
      for (const order of delivered) {
        const rid = order.restaurantId || 'unknown';
        const name = order.restaurantName || 'Unknown Restaurant';
        if (!restMap.has(rid)) {
          restMap.set(rid, {
            restaurantId: rid, restaurantName: name,
            ordersCount: 0, orderIds: [],
            grossAmount: 0, commission: 0, gstOnCommission: 0, netAmount: 0,
          });
        }
        const r = restMap.get(rid)!;
        const gross = order.total ?? order.totalAmount ?? 0;
        r.ordersCount++;
        r.orderIds.push(order.id);
        r.grossAmount += gross;
      }
      // Compute commission
      for (const r of restMap.values()) {
        r.commission      = +(r.grossAmount * commissionRate / 100).toFixed(2);
        r.gstOnCommission = +(r.commission * 0.18).toFixed(2);
        r.netAmount       = +(r.grossAmount - r.commission - r.gstOnCommission).toFixed(2);
      }

      // Group by rider
      const riderMap = new Map<string, RiderSettlement>();
      for (const order of delivered) {
        if (!order.riderId) continue;
        const rid = order.riderId;
        const name = order.riderName || 'Unknown Rider';
        if (!riderMap.has(rid)) {
          riderMap.set(rid, {
            riderId: rid, riderName: name,
            deliveriesCount: 0, orderIds: [],
            payPerDelivery: riderPayPerDelivery,
            totalEarnings: 0,
          });
        }
        const r = riderMap.get(rid)!;
        r.deliveriesCount++;
        r.orderIds.push(order.id);
      }
      for (const r of riderMap.values()) {
        r.totalEarnings = +(r.deliveriesCount * riderPayPerDelivery).toFixed(2);
      }

      const restaurants = [...restMap.values()];
      const riders      = [...riderMap.values()];

      setPreview({
        date,
        commissionRate,
        riderPayPerDelivery,
        restaurants,
        riders,
        totalOrders: delivered.length,
        totalGross: +restaurants.reduce((s, r) => s + r.grossAmount, 0).toFixed(2),
        totalCommission: +restaurants.reduce((s, r) => s + r.commission + r.gstOnCommission, 0).toFixed(2),
        totalNetToRestaurants: +restaurants.reduce((s, r) => s + r.netAmount, 0).toFixed(2),
        totalRiderPay: +riders.reduce((s, r) => s + r.totalEarnings, 0).toFixed(2),
      });
    } catch (err: any) {
      toast.error(err.message || 'Failed to calculate settlement');
    } finally {
      setCalculating(false);
    }
  };

  // ── Generate payout records ──────────────────────────────────────
  const handleGenerate = async (method: 'manual' | 'online') => {
    if (!preview) return;
    setGenerating(method);
    try {
      const batch = writeBatch(db);
      const isManual = method === 'manual';
      const now = serverTimestamp();

      // Mark all orders as settled
      const allOrderIds = preview.restaurants.flatMap(r => r.orderIds);
      for (const oid of allOrderIds) {
        batch.update(doc(db, 'orders', oid), { settled: true, settledDate: preview.date });
      }

      // Create payout docs for restaurants
      for (const r of preview.restaurants) {
        const payoutRef = doc(collection(db, 'payouts'));
        batch.set(payoutRef, {
          entityId: r.restaurantId,
          entityName: r.restaurantName,
          entityType: 'restaurant',
          amount: r.netAmount,
          grossAmount: r.grossAmount,
          commission: r.commission,
          gstOnCommission: r.gstOnCommission,
          commissionRate: preview.commissionRate,
          ordersCount: r.ordersCount,
          orderIds: r.orderIds,
          settlementDate: preview.date,
          paymentMethod: method,
          status: isManual ? 'completed' : 'pending',
          ...(isManual ? { paidAt: now, paidVia: 'manual_offline' } : {}),
          periodStart: Timestamp.fromDate(new Date(preview.date + 'T00:00:00')),
          periodEnd:   Timestamp.fromDate(new Date(preview.date + 'T23:59:59')),
          createdAt: now,
        });
      }

      // Create payout docs for riders
      for (const r of preview.riders) {
        const payoutRef = doc(collection(db, 'payouts'));
        batch.set(payoutRef, {
          entityId: r.riderId,
          entityName: r.riderName,
          entityType: 'rider',
          amount: r.totalEarnings,
          deliveriesCount: r.deliveriesCount,
          payPerDelivery: r.payPerDelivery,
          orderIds: r.orderIds,
          settlementDate: preview.date,
          paymentMethod: method,
          status: isManual ? 'completed' : 'pending',
          ...(isManual ? { paidAt: now, paidVia: 'manual_offline' } : {}),
          periodStart: Timestamp.fromDate(new Date(preview.date + 'T00:00:00')),
          periodEnd:   Timestamp.fromDate(new Date(preview.date + 'T23:59:59')),
          createdAt: now,
        });
      }

      await batch.commit();
      const total = preview.restaurants.length + preview.riders.length;
      toast.success(
        isManual
          ? `${total} payouts marked as completed (manual / offline)`
          : `${total} payouts created — pending online transfer`
      );
      setPreview(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate settlement');
    } finally {
      setGenerating(null);
    }
  };

  // ── GST Report ───────────────────────────────────────────────────
  const [gstMonth, setGstMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [gstLoading, setGstLoading] = useState(false);

  const downloadGSTReport = async () => {
    setGstLoading(true);
    try {
      const [y, m] = gstMonth.split('-').map(Number);
      const start  = new Date(y, m - 1, 1);
      const end    = new Date(y, m, 0, 23, 59, 59, 999);
      const snap   = await getDocs(query(
        collection(db, 'orders'),
        where('status', '==', 'delivered'),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<=', Timestamp.fromDate(end)),
      ));
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      if (orders.length === 0) { toast('No delivered orders in this month', { icon: 'ℹ️' }); setGstLoading(false); return; }

      const GST_RATE    = 0.05; // 5% GST on food (CGST 2.5% + SGST 2.5%)
      const COMM_GST    = 0.18; // 18% GST on platform commission (service)

      const rows: (string | number)[][] = [
        [
          'Order ID', 'Date', 'Restaurant Name', 'Customer Name',
          'Taxable Value (₹)', 'CGST (2.5%) ₹', 'SGST (2.5%) ₹', 'Total GST ₹', 'Grand Total ₹',
          'Platform Commission ₹', 'GST on Commission (18%) ₹', 'Payment Method',
        ],
      ];

      let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalComm = 0, totalCommGST = 0;

      for (const o of orders) {
        const gross       = o.total ?? o.totalAmount ?? 0;
        const subtotal    = o.subtotal ?? gross;
        const taxable     = +(subtotal / (1 + GST_RATE)).toFixed(2);
        const cgst        = +((taxable * GST_RATE) / 2).toFixed(2);
        const sgst        = cgst;
        const commission  = +(subtotal * ((o.platformFee ? o.platformFee / subtotal : 0.15))).toFixed(2);
        const commGST     = +(commission * COMM_GST).toFixed(2);
        const date        = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : '—';

        totalTaxable += taxable; totalCGST += cgst; totalSGST += sgst;
        totalComm += commission; totalCommGST += commGST;

        rows.push([
          o.id?.slice(-8).toUpperCase() ?? '—', date,
          o.restaurantName ?? '—', o.customerName ?? '—',
          taxable, cgst, sgst, +(cgst + sgst).toFixed(2), gross,
          commission, commGST, o.paymentMethod ?? '—',
        ]);
      }

      // Summary row
      rows.push(['', '', '', 'TOTAL',
        +totalTaxable.toFixed(2), +totalCGST.toFixed(2), +totalSGST.toFixed(2),
        +(totalCGST + totalSGST).toFixed(2), '',
        +totalComm.toFixed(2), +totalCommGST.toFixed(2), '',
      ]);

      downloadCSV(rows, `GST-Report-${gstMonth}.csv`);
      toast.success(`GST Report downloaded for ${gstMonth} (${orders.length} orders)`);
    } catch (err: any) {
      toast.error('Failed to generate GST report: ' + err.message);
    } finally {
      setGstLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <Calculator size={24} className="text-brand" /> Daily Settlements
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Calculate and generate payouts for delivered orders by date
        </p>
      </div>

      {/* ── GST Report ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <div>
          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">GST Report — Month</label>
          <input type="month" value={gstMonth} onChange={e => setGstMonth(e.target.value)}
            className="border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-brand" />
        </div>
        <div className="flex-1" />
        <button onClick={downloadGSTReport} disabled={gstLoading}
          className="flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl font-black text-sm hover:bg-green-700 disabled:opacity-60 shadow-sm">
          {gstLoading
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <FileText size={16} />}
          {gstLoading ? 'Generating…' : 'Download GST Report (CSV)'}
        </button>
      </div>

      {/* Date picker + Calculate */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
            Settlement Date
          </label>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={e => { setDate(e.target.value); setPreview(null); }}
            className="border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-brand transition-colors"
          />
        </div>
        <button
          onClick={handleCalculate}
          disabled={calculating}
          className="flex items-center gap-2 px-6 py-3 bg-brand text-white rounded-xl font-black text-sm disabled:opacity-60 hover:bg-brand/90 transition-colors"
        >
          {calculating ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Calculator size={16} />
          )}
          {calculating ? 'Calculating…' : 'Calculate'}
        </button>
      </div>

      {/* Preview */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-5"
          >
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Orders', value: preview.totalOrders, sub: 'delivered & unsettled', color: 'border-blue-400' },
                { label: 'Gross Revenue', value: toINR(preview.totalGross), sub: 'total from customers', color: 'border-gray-300' },
                { label: 'Net to Restaurants', value: toINR(preview.totalNetToRestaurants), sub: `after ${preview.commissionRate}% commission`, color: 'border-orange-400' },
                { label: 'Rider Payouts', value: toINR(preview.totalRiderPay), sub: `₹${preview.riderPayPerDelivery}/delivery`, color: 'border-blue-400' },
              ].map(c => (
                <div key={c.label} className={`bg-white rounded-2xl border-l-4 ${c.color} border border-gray-100 shadow-sm p-4`}>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{c.label}</p>
                  <p className="text-xl font-black text-gray-900">{c.value}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{c.sub}</p>
                </div>
              ))}
            </div>

            {/* Commission summary */}
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-start gap-3">
              <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-orange-700">
                <span className="font-black">ManaBites earns:</span>{' '}
                {toINR(preview.totalCommission)} (commission {preview.commissionRate}% + 18% GST) from {preview.totalOrders} orders.
                Total outflow: {toINR(preview.totalNetToRestaurants + preview.totalRiderPay)}.
              </div>
            </div>

            {/* Restaurant table */}
            {preview.restaurants.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <Store size={16} className="text-orange-500" />
                  <h2 className="font-black text-gray-900">Restaurant Payouts ({preview.restaurants.length})</h2>
                </div>
                <div className="divide-y divide-gray-50">
                  {preview.restaurants.map(r => (
                    <div key={r.restaurantId}>
                      <button
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                        onClick={() => setExpandedRest(expandedRest === r.restaurantId ? null : r.restaurantId)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-gray-900 truncate">{r.restaurantName}</p>
                          <p className="text-xs text-gray-400 font-medium">{r.ordersCount} orders</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-gray-900">{toINR(r.netAmount)}</p>
                          <p className="text-[10px] text-gray-400">net payout</p>
                        </div>
                        {expandedRest === r.restaurantId
                          ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
                          : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
                      </button>
                      <AnimatePresence>
                        {expandedRest === r.restaurantId && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-5 pb-4 bg-gray-50 grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Gross</p>
                                <p className="font-black text-gray-900">{toINR(r.grossAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Commission + GST</p>
                                <p className="font-black text-red-500">−{toINR(r.commission + r.gstOnCommission)}</p>
                                <p className="text-[10px] text-gray-400">{toINR(r.commission)} + {toINR(r.gstOnCommission)} GST</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Net to Pay</p>
                                <p className="font-black text-brand">{toINR(r.netAmount)}</p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rider table */}
            {preview.riders.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <Bike size={16} className="text-blue-500" />
                  <h2 className="font-black text-gray-900">Rider Payouts ({preview.riders.length})</h2>
                </div>
                <div className="divide-y divide-gray-50">
                  {preview.riders.map(r => (
                    <div key={r.riderId} className="flex items-center gap-4 px-5 py-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-gray-900 truncate">{r.riderName}</p>
                        <p className="text-xs text-gray-400 font-medium">
                          {r.deliveriesCount} deliveries × {toINR(r.payPerDelivery)}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-blue-600">{toINR(r.totalEarnings)}</p>
                        <p className="text-[10px] text-gray-400">earnings</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generate button — two options */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                Choose Payment Method
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* Manual Pay */}
                <button
                  onClick={() => handleGenerate('manual')}
                  disabled={generating !== null}
                  className="flex flex-col items-center gap-2 py-5 px-4 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-black transition-colors disabled:opacity-60 shadow-sm"
                >
                  {generating === 'manual' ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Banknote size={26} />
                  )}
                  <div className="text-center">
                    <p className="text-base">{generating === 'manual' ? 'Processing…' : 'Manual Pay'}</p>
                    <p className="text-[11px] text-green-100 font-medium mt-0.5">Offline · marks completed</p>
                  </div>
                </button>

                {/* Online Pay */}
                <button
                  onClick={() => handleGenerate('online')}
                  disabled={generating !== null}
                  className="flex flex-col items-center gap-2 py-5 px-4 bg-brand hover:bg-brand/90 text-white rounded-2xl font-black transition-colors disabled:opacity-60 shadow-sm"
                >
                  {generating === 'online' ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <CreditCard size={26} />
                  )}
                  <div className="text-center">
                    <p className="text-base">{generating === 'online' ? 'Processing…' : 'Online Pay'}</p>
                    <p className="text-[11px] text-white/70 font-medium mt-0.5">Digital transfer · pending</p>
                  </div>
                </button>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-gray-400">
                  Marks {preview.totalOrders} orders settled · {preview.restaurants.length + preview.riders.length} payouts
                </p>
                <button
                  onClick={() => setPreview(null)}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!preview && !calculating && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Calculator size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="font-black text-gray-400 text-lg">Select a date and calculate</p>
          <p className="text-sm text-gray-400 mt-1">All unsettled delivered orders will be grouped by restaurant and rider</p>
        </div>
      )}
    </div>
  );
}
