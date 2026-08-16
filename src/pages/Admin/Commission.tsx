import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, query, orderBy, onSnapshot, Timestamp, deleteDoc,
  doc, getDoc, setDoc, getDocs, where, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendingUp, Store, DollarSign, Percent, Trash2, Settings, RefreshCw, Plus, Calculator, TrendingDown, IndianRupee } from 'lucide-react';
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
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface CommissionConfig {
  defaultRate: number;
  cityRates: Record<string, number>;
  restaurantOverrides: Record<string, { name: string; rate: number }>;
}

export default function Commission() {
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // P&L inputs
  const [showPnL,            setShowPnL]            = useState(false);
  const [subscribedRest,     setSubscribedRest]      = useState(0);
  const [subscribedRiders,   setSubscribedRiders]    = useState(0);
  const [serverCost,         setServerCost]          = useState(0);
  const [marketingCost,      setMarketingCost]       = useState(0);
  const [otherCost,          setOtherCost]           = useState(0);
  const [includeGST,         setIncludeGST]          = useState(false);

  // Commission Calculator state — declared here (top) to satisfy rules of hooks
  const [calcOrderAmt,    setCalcOrderAmt]    = useState(200);
  const [calcDelivery,    setCalcDelivery]    = useState(35);
  const [calcPlatformFee, setCalcPlatformFee] = useState(5);
  const [calcRestSub,     setCalcRestSub]     = useState(false);
  const [calcRiderSub,    setCalcRiderSub]    = useState(false);
  const [showCalc,        setShowCalc]        = useState(true);

  // Commission config state
  const [config, setConfig] = useState<CommissionConfig>({ defaultRate: 15, cityRates: {}, restaurantOverrides: {} });
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [editRate, setEditRate] = useState('15');
  const [editCity, setEditCity] = useState('');
  const [editCityRate, setEditCityRate] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'commissionConfig')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as CommissionConfig;
        setConfig(d);
        setEditRate(String(d.defaultRate ?? 15));
      }
    });
  }, []);

  const saveConfig = async () => {
    const rate = parseFloat(editRate);
    if (isNaN(rate) || rate < 0 || rate > 100) { toast.error('Enter valid rate (0-100)'); return; }
    setSavingConfig(true);
    try {
      const updated = { ...config, defaultRate: rate };
      await setDoc(doc(db, 'settings', 'commissionConfig'), updated, { merge: true });
      setConfig(updated);
      toast.success(`Default commission rate set to ${rate}%`);
      setShowConfig(false);
    } catch { toast.error('Failed to save config'); }
    finally { setSavingConfig(false); }
  };

  const addCityRate = async () => {
    const city = editCity.trim();
    const rate = parseFloat(editCityRate);
    if (!city || isNaN(rate)) { toast.error('Enter city name and rate'); return; }
    const updated = { ...config, cityRates: { ...config.cityRates, [city]: rate } };
    await setDoc(doc(db, 'settings', 'commissionConfig'), updated, { merge: true });
    setConfig(updated);
    setEditCity(''); setEditCityRate('');
    toast.success(`${city}: ${rate}% set`);
  };

  // Recalculate commission for delivered orders that have no ledger entry yet
  const recalculate = async () => {
    if (!window.confirm('Recalculate commission for all delivered orders without a ledger entry?')) return;
    setRecalculating(true);
    try {
      const [ordersSnap, ledgerSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), where('status', '==', 'delivered'))),
        getDocs(collection(db, 'commissionLedger')),
      ]);
      const processedIds = new Set(ledgerSnap.docs.map(d => d.data().orderId as string));
      const unprocessed = ordersSnap.docs.filter(d => !processedIds.has(d.id));

      let count = 0;
      for (const orderDoc of unprocessed) {
        const o = orderDoc.data() as any;
        const subtotal = o.subtotal ?? o.totalAmount ?? o.total ?? 0;
        const restaurantId = o.restaurantId || '';
        const override = config.restaurantOverrides[restaurantId];
        const cityRate = o.city ? config.cityRates[o.city] : undefined;
        const rate = override?.rate ?? cityRate ?? config.defaultRate ?? 15;
        const commissionAmount = Math.round(subtotal * rate) / 100;
        const restaurantNet    = Math.round(subtotal - commissionAmount);

        await addDoc(collection(db, 'commissionLedger'), {
          orderId:          orderDoc.id,
          restaurantId,
          restaurantName:   o.restaurantName || '—',
          orderTotal:       o.totalAmount ?? o.total ?? 0,
          subtotal,
          commissionRate:   rate,
          commissionAmount,
          restaurantNet,
          createdAt:        serverTimestamp(),
        });
        count++;
      }
      toast.success(`Recalculated: ${count} new entries created`);
    } catch (err: any) {
      toast.error('Recalculate failed: ' + err.message);
    } finally {
      setRecalculating(false);
    }
  };

  const handleDelete = async (entry: CommissionEntry) => {
    if (!window.confirm(`Delete commission entry ₹${entry.commissionAmount.toFixed(2)} for ${entry.restaurantName}?`)) return;
    setDeletingId(entry.id);
    try {
      await deleteDoc(doc(db, 'commissionLedger', entry.id));
      toast.success('Entry deleted');
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'commissionLedger'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => {
        const data = d.data();
        return {
          id:               d.id,
          orderId:          data.orderId          ?? '',
          restaurantId:     data.restaurantId     ?? '',
          restaurantName:   data.restaurantName   ?? '—',
          orderTotal:       Number(data.orderTotal      ?? 0),
          subtotal:         Number(data.subtotal         ?? 0),
          commissionRate:   Number(data.commissionRate   ?? 0),
          commissionAmount: Number(data.commissionAmount ?? 0),
          restaurantNet:    Number(data.restaurantNet    ?? 0),
          createdAt:        data.createdAt,
        } as CommissionEntry;
      }));
      setLoading(false);
    }, err => {
      console.error('Commission load error:', err);
      if (err.code === 'permission-denied') {
        toast.error('Permission denied — make sure your account is in the admins collection with role: admin');
      } else {
        toast.error('Failed to load commission data: ' + err.message);
      }
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

  // ── Commission Calculator: full GST breakdown ──
  const calcCommRate       = calcRestSub ? 5 : 10;
  const calcCommAmt        = calcOrderAmt * calcCommRate / 100;
  const calcGSTOnComm      = calcCommAmt * 0.18;           // 18% GST on ManaBites commission
  const calcFoodGST        = calcOrderAmt * 0.05;           // 5% GST on food
  const calcDeliveryGST    = calcDelivery * 0.18;           // 18% GST on delivery

  // Customer bill
  const calcCustomerTotal  = calcOrderAmt + calcFoodGST + calcDelivery + calcDeliveryGST + calcPlatformFee;

  // Restaurant settlement
  const calcRestDeduction      = calcCommAmt + calcGSTOnComm; // ManaBites deducts this
  const calcRestGets           = calcOrderAmt + calcFoodGST - calcRestDeduction;
  const calcRestNetAfterFoodGST = calcRestGets - calcFoodGST; // after restaurant remits food GST to govt

  // Rider settlement
  const calcRiderCutRate   = calcRiderSub ? 0 : 5;
  const calcRiderCut       = calcDelivery * calcRiderCutRate / 100;
  const calcRiderGets      = calcDelivery - calcRiderCut;

  // ManaBites P&L
  const calcMBCommission   = calcCommAmt;
  const calcMBRiderCut     = calcRiderCut;
  const calcMBGSTPayable   = calcGSTOnComm + calcDeliveryGST; // ManaBites remits to govt
  const calcMBNetRevenue   = calcMBCommission + calcMBRiderCut + calcPlatformFee;

  // P&L derived values (computed at component level — no IIFE in JSX)
  const pnlCommissionRevenue   = summary.totalCommission;
  const pnlSubscriptionRevenue = (subscribedRest * 999) + (subscribedRiders * 299);
  const pnlGrossRevenue        = pnlCommissionRevenue + pnlSubscriptionRevenue;
  const pnlGSTOnCommission     = includeGST ? pnlCommissionRevenue * 0.18 : 0;
  const pnlTotalExpenses       = serverCost + marketingCost + otherCost + pnlGSTOnCommission;
  const pnlNetProfit           = pnlGrossRevenue - pnlTotalExpenses;
  const pnlMargin              = pnlGrossRevenue > 0 ? (pnlNetProfit / pnlGrossRevenue) * 100 : 0;

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

      {/* Commission Config panel */}
      <div className="flex gap-2 -mt-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowConfig(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:border-brand transition-colors"
        >
          <Settings className="w-4 h-4" /> Configure Rates
          <span className="bg-brand/10 text-brand text-xs font-black px-1.5 py-0.5 rounded-md">{config.defaultRate}%</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={recalculate}
          disabled={recalculating}
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:border-blue-400 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
          {recalculating ? 'Recalculating…' : 'Recalculate All'}
        </motion.button>
      </div>

      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-2xl shadow-card p-6 border-2 border-brand/20 overflow-hidden"
          >
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest mb-4">Commission Rate Configuration</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Default Rate */}
              <div>
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">Default Rate (%)</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={editRate}
                    onChange={e => setEditRate(e.target.value)}
                    className="flex-1 border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none"
                    placeholder="15"
                  />
                  <button onClick={saveConfig} disabled={savingConfig}
                    className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-bold hover:bg-brand/90 disabled:opacity-60">
                    Save
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Applies to all restaurants unless overridden</p>
              </div>

              {/* City Rate */}
              <div>
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">City Rate Override</label>
                <div className="flex gap-2 mb-2">
                  <input value={editCity} onChange={e => setEditCity(e.target.value)} placeholder="City name"
                    className="flex-1 border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                  <input value={editCityRate} onChange={e => setEditCityRate(e.target.value)} placeholder="%" type="number"
                    className="w-16 border-2 border-gray-100 focus:border-brand rounded-xl px-2 py-2 text-sm font-bold outline-none" />
                  <button onClick={addCityRate} className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {Object.entries(config.cityRates).length > 0 && (
                  <div className="space-y-1">
                    {Object.entries(config.cityRates).map(([city, rate]) => (
                      <div key={city} className="flex justify-between text-xs font-bold text-gray-700 bg-gray-50 rounded-lg px-3 py-1.5">
                        <span>{city}</span><span className="text-brand">{rate}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Restaurant Overrides */}
              <div>
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">Restaurant Overrides</label>
                {Object.entries(config.restaurantOverrides).length === 0 ? (
                  <p className="text-xs text-gray-400">No restaurant-specific rates set. Set from Restaurant Management.</p>
                ) : (
                  <div className="space-y-1">
                    {Object.entries(config.restaurantOverrides).map(([id, { name, rate }]) => (
                      <div key={id} className="flex justify-between text-xs font-bold text-gray-700 bg-gray-50 rounded-lg px-3 py-1.5">
                        <span className="truncate">{name}</span><span className="text-brand flex-shrink-0 ml-2">{rate}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Commission', value: `₹${summary.totalCommission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'border-green-500', iconBg: 'bg-green-50', iconColor: 'text-green-600' },
          { label: 'Total Order Value', value: `₹${summary.totalOrderValue.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'border-brand', iconBg: 'bg-orange-50', iconColor: 'text-brand' },
          { label: 'Restaurant Net', value: `₹${summary.totalRestaurantNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Store, color: 'border-blue-400', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
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

      {/* ── Commission Calculator ── */}
      <div>
        <button
          onClick={() => setShowCalc(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:border-brand transition-colors mb-3"
        >
          <Calculator className="w-4 h-4 text-brand" />
          Commission Calculator — Full Tax Breakdown
          <span className={`text-xs font-black px-1.5 py-0.5 rounded-md ${showCalc ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-400'}`}>
            {showCalc ? 'Open' : 'Closed'}
          </span>
        </button>

        <AnimatePresence>
          {showCalc && (
            <motion.div
              key="calc-panel"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-2xl border-2 border-brand/10 p-5 space-y-6">

                {/* Inputs */}
                <div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Order Details</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Food Subtotal (₹)</label>
                      <input type="number" value={calcOrderAmt}
                        onChange={e => setCalcOrderAmt(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-xl font-black text-gray-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Delivery Fee (₹)</label>
                      <input type="number" value={calcDelivery}
                        onChange={e => setCalcDelivery(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-xl font-black text-gray-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Platform Fee (₹)</label>
                      <input type="number" value={calcPlatformFee}
                        onChange={e => setCalcPlatformFee(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-xl font-black text-gray-800 outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <button
                      onClick={() => setCalcRestSub(v => !v)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-bold transition-colors ${calcRestSub ? 'border-brand bg-brand/5 text-brand' : 'border-gray-100 text-gray-500'}`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${calcRestSub ? 'border-brand bg-brand' : 'border-gray-300'}`}>
                        {calcRestSub && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                      <Store className="w-3.5 h-3.5 flex-shrink-0" />
                      Restaurant Subscribed? → {calcRestSub ? '5% commission' : '10% commission'}
                    </button>
                    <button
                      onClick={() => setCalcRiderSub(v => !v)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-bold transition-colors ${calcRiderSub ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-500'}`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${calcRiderSub ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                        {calcRiderSub && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                      <span className="flex-shrink-0">🛵</span>
                      Rider Subscribed? → {calcRiderSub ? '0% cut' : '5% cut'}
                    </button>
                  </div>
                </div>

                {/* Customer Bill */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <p className="text-xs font-black text-gray-600 uppercase tracking-widest mb-3">📱 Customer Bill (What Customer Pays)</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-gray-700">
                      <span>Food Subtotal</span>
                      <span className="font-bold">₹{calcOrderAmt.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-orange-600">
                      <span>GST on Food (5%)</span>
                      <span className="font-bold">+₹{calcFoodGST.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Delivery Fee</span>
                      <span className="font-bold">₹{calcDelivery.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-orange-600">
                      <span>GST on Delivery (18%)</span>
                      <span className="font-bold">+₹{calcDeliveryGST.toFixed(2)}</span>
                    </div>
                    {calcPlatformFee > 0 && (
                      <div className="flex justify-between text-gray-700">
                        <span>Platform Fee</span>
                        <span className="font-bold">₹{calcPlatformFee.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-black text-gray-900 border-t border-gray-300 pt-2 text-base">
                      <span>Customer Pays Total</span>
                      <span>₹{calcCustomerTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* 3-column settlement */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                  {/* Restaurant */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <p className="text-xs font-black text-blue-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5" /> Restaurant
                      <span className="ml-auto bg-blue-200 text-blue-800 text-[10px] font-black px-1.5 py-0.5 rounded">
                        {calcCommRate}% comm
                      </span>
                    </p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-gray-600">
                        <span>Food collected (incl. GST)</span>
                        <span className="font-bold">₹{(calcOrderAmt + calcFoodGST).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-red-500">
                        <span>ManaBites commission ({calcCommRate}%)</span>
                        <span className="font-bold">−₹{calcCommAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-red-400">
                        <span>GST on commission (18%)</span>
                        <span className="font-bold">−₹{calcGSTOnComm.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-black text-blue-700 border-t border-blue-200 pt-1.5 mt-1">
                        <span>ManaBites pays out</span>
                        <span>₹{calcRestGets.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-orange-600">
                        <span>Food GST remit to govt</span>
                        <span className="font-bold">−₹{calcFoodGST.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-black text-blue-800 border-t border-blue-300 pt-1.5 text-sm">
                        <span>Restaurant Net</span>
                        <span>₹{calcRestNetAfterFoodGST.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Rider */}
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                    <p className="text-xs font-black text-amber-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      🛵 Rider
                      <span className="ml-auto bg-amber-200 text-amber-800 text-[10px] font-black px-1.5 py-0.5 rounded">
                        {calcRiderCutRate}% cut
                      </span>
                    </p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-gray-600">
                        <span>Delivery fee (excl. GST)</span>
                        <span className="font-bold">₹{calcDelivery.toFixed(2)}</span>
                      </div>
                      {calcRiderCut > 0 ? (
                        <div className="flex justify-between text-red-500">
                          <span>ManaBites cut ({calcRiderCutRate}%)</span>
                          <span className="font-bold">−₹{calcRiderCut.toFixed(2)}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-green-600">
                          <span>No cut (subscribed ✓)</span>
                          <span className="font-bold">−₹0.00</span>
                        </div>
                      )}
                      <div className="flex justify-between font-black text-amber-700 border-t border-amber-200 pt-1.5 mt-1 text-sm">
                        <span>Rider Earns</span>
                        <span>₹{calcRiderGets.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 leading-snug">
                        Riders earning &gt;₹20L/yr register GST (18%) independently — not deducted at source by ManaBites.
                      </p>
                    </div>
                  </div>

                  {/* ManaBites */}
                  <div className="bg-brand/5 rounded-xl p-4 border border-brand/25">
                    <p className="text-xs font-black text-brand uppercase tracking-wider mb-3">
                      ManaBites Earnings
                    </p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-green-600">
                        <span>Commission (net)</span>
                        <span className="font-bold">+₹{calcMBCommission.toFixed(2)}</span>
                      </div>
                      {calcMBRiderCut > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>Rider cut</span>
                          <span className="font-bold">+₹{calcMBRiderCut.toFixed(2)}</span>
                        </div>
                      )}
                      {calcPlatformFee > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>Platform fee</span>
                          <span className="font-bold">+₹{calcPlatformFee.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-gray-400">
                        <span>GST collected (pass-thru)</span>
                        <span className="font-bold">+₹{(calcGSTOnComm + calcDeliveryGST).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-red-500">
                        <span>GST remit to govt</span>
                        <span className="font-bold">−₹{calcMBGSTPayable.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-black text-brand border-t border-brand/20 pt-1.5 mt-1 text-sm">
                        <span>ManaBites Net</span>
                        <span>₹{calcMBNetRevenue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* GST Summary */}
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                  <p className="text-xs font-black text-orange-700 uppercase tracking-widest mb-3">
                    📋 Tax Summary — GST Flowing to Government
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-xs text-center mb-3">
                    <div className="bg-white rounded-lg p-2 border border-orange-100">
                      <p className="text-gray-500 mb-1">Food GST (5%)</p>
                      <p className="font-black text-orange-700 text-base">₹{calcFoodGST.toFixed(2)}</p>
                      <p className="text-[10px] text-gray-400 mt-1">Paid by restaurant</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-orange-100">
                      <p className="text-gray-500 mb-1">Delivery GST (18%)</p>
                      <p className="font-black text-orange-700 text-base">₹{calcDeliveryGST.toFixed(2)}</p>
                      <p className="text-[10px] text-gray-400 mt-1">ManaBites remits</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-orange-100">
                      <p className="text-gray-500 mb-1">Commission GST (18%)</p>
                      <p className="font-black text-orange-700 text-base">₹{calcGSTOnComm.toFixed(2)}</p>
                      <p className="text-[10px] text-gray-400 mt-1">ManaBites remits</p>
                    </div>
                  </div>
                  <div className="flex justify-between font-black text-orange-800 border-t border-orange-200 pt-2">
                    <span>Total GST to Government (this order)</span>
                    <span>₹{(calcFoodGST + calcDeliveryGST + calcGSTOnComm).toFixed(2)}</span>
                  </div>
                </div>

                {/* Monthly projection */}
                <div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Monthly Revenue Projection (ManaBites Net)</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[100, 500, 1000, 5000].map(n => (
                      <div key={n} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-bold uppercase">{n} orders/day</p>
                        <p className="font-black text-brand text-sm mt-0.5">₹{(calcMBNetRevenue * n * 30 / 1000).toFixed(1)}K</p>
                        <p className="text-[9px] text-gray-400">per month</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* P&L Calculator toggle */}
      <div>
        <button
          onClick={() => setShowPnL(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:border-brand transition-colors"
        >
          <Calculator className="w-4 h-4 text-brand" />
          Profit & Loss Calculator
          <span className={`text-xs font-black px-1.5 py-0.5 rounded-md ${showPnL ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-400'}`}>
            {showPnL ? 'Open' : 'Closed'}
          </span>
        </button>

        <AnimatePresence>
          {showPnL && (
            <motion.div
              key="pnl-panel"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="mt-3 bg-white rounded-2xl border-2 border-brand/10 overflow-hidden"
            >
              <div className="p-6 space-y-6">
                <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-brand" /> Profit & Loss — This Period
                </h3>

                {/* Revenue */}
                <div>
                  <p className="text-xs font-black text-green-700 uppercase tracking-widest mb-3">Revenue</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-green-50 rounded-xl p-4">
                      <p className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Commission Earned</p>
                      <p className="text-2xl font-black text-green-700">
                        ₹{pnlCommissionRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-green-600 mt-1">From {summary.totalOrders} orders</p>
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Subscribed Restaurants</label>
                      <input type="number" value={subscribedRest} onChange={e => setSubscribedRest(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" placeholder="0" />
                      <p className="text-xs text-gray-400 mt-1">× ₹999/month = <span className="font-bold text-gray-700">₹{(subscribedRest * 999).toLocaleString('en-IN')}</span></p>
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Subscribed Riders</label>
                      <input type="number" value={subscribedRiders} onChange={e => setSubscribedRiders(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" placeholder="0" />
                      <p className="text-xs text-gray-400 mt-1">× ₹299/month = <span className="font-bold text-gray-700">₹{(subscribedRiders * 299).toLocaleString('en-IN')}</span></p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-between items-center bg-green-50 rounded-xl px-4 py-3">
                    <span className="font-black text-gray-700">Total Revenue</span>
                    <span className="font-black text-green-700 text-xl">₹{pnlGrossRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Expenses */}
                <div>
                  <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-3">Expenses</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Server / Hosting (₹)</label>
                      <input type="number" value={serverCost} onChange={e => setServerCost(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Marketing / Ads (₹)</label>
                      <input type="number" value={marketingCost} onChange={e => setMarketingCost(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Other Expenses (₹)</label>
                      <input type="number" value={otherCost} onChange={e => setOtherCost(Number(e.target.value) || 0)}
                        className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2 text-sm font-bold outline-none" placeholder="0" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <button onClick={() => setIncludeGST(v => !v)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${includeGST ? 'bg-brand' : 'bg-gray-200'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${includeGST ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm font-bold text-gray-600">Include GST (18% on commission = ₹{pnlGSTOnCommission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                  </div>
                  <div className="flex justify-between items-center bg-red-50 rounded-xl px-4 py-3">
                    <span className="font-black text-gray-700">Total Expenses</span>
                    <span className="font-black text-red-600 text-xl">₹{pnlTotalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Net P&L result */}
                <div className={`rounded-2xl p-5 ${pnlNetProfit >= 0 ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gradient-to-r from-red-500 to-rose-600'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/80 text-xs font-bold uppercase tracking-wider">Net {pnlNetProfit >= 0 ? 'Profit' : 'Loss'}</p>
                      <p className="text-white font-black text-3xl mt-1">
                        {pnlNetProfit >= 0 ? '+' : ''}₹{pnlNetProfit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-white/70 text-xs mt-1">Margin: {pnlMargin.toFixed(1)}%</p>
                    </div>
                    <div className="bg-white/20 rounded-xl p-3">
                      {pnlNetProfit >= 0 ? <TrendingUp className="w-8 h-8 text-white" /> : <TrendingDown className="w-8 h-8 text-white" />}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white/15 rounded-xl py-2 px-1">
                      <p className="text-white/70 text-[10px] font-bold uppercase">Revenue</p>
                      <p className="text-white font-black text-sm">₹{(pnlGrossRevenue / 1000).toFixed(1)}K</p>
                    </div>
                    <div className="bg-white/15 rounded-xl py-2 px-1">
                      <p className="text-white/70 text-[10px] font-bold uppercase">Expenses</p>
                      <p className="text-white font-black text-sm">₹{(pnlTotalExpenses / 1000).toFixed(1)}K</p>
                    </div>
                    <div className="bg-white/15 rounded-xl py-2 px-1">
                      <p className="text-white/70 text-[10px] font-bold uppercase">Margin</p>
                      <p className="text-white font-black text-sm">{pnlMargin.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
                  <p className="text-sm font-black text-green-700">₹{r.commission.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-gray-400">net ₹{r.net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="table-cell text-xs text-gray-500">{formatDateTime(e.createdAt)}</td>
                    <td className="table-cell font-semibold text-gray-800">{e.restaurantName}</td>
                    <td className="table-cell font-mono text-xs text-gray-500">{e.orderId.slice(0, 8).toUpperCase()}</td>
                    <td className="table-cell text-gray-700">₹{e.orderTotal.toLocaleString('en-IN')}</td>
                    <td className="table-cell text-gray-700">₹{e.subtotal.toLocaleString('en-IN')}</td>
                    <td className="table-cell">
                      <span className="px-2 py-0.5 bg-orange-50 text-orange-700 text-[11px] font-bold rounded-md">{e.commissionRate}%</span>
                    </td>
                    <td className="table-cell font-black text-green-700">₹{e.commissionAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="table-cell text-gray-700">₹{e.restaurantNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="table-cell">
                      <button
                        onClick={() => handleDelete(e)}
                        disabled={deletingId === e.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Delete entry"
                      >
                        {deletingId === e.id
                          ? <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                          : <Trash2 className="w-3.5 h-3.5" />
                        }
                      </button>
                    </td>
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
