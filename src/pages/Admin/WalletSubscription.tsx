import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, orderBy, where,
  updateDoc, setDoc, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  Wallet, Crown, TrendingUp, Users, DollarSign, Percent,
  Check, X, ChevronDown, Info, RefreshCw, Gift,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletConfig {
  cashbackPercent: number;       // default 1
  maxCashbackPerOrder: number;   // cap per order
  minOrderForCashback: number;   // min order value to earn
  redeemMinBalance: number;      // min wallet balance to redeem
}

interface GoldConfig {
  monthlyPrice: number;          // ₹99
  freeDeliveryUpToKm: number;    // free delivery within X km
  freeDeliveryMonthlyLimit: number; // max free deliveries per month
  extraCashbackPercent: number;  // extra cashback for gold members
  active: boolean;
}

interface WalletTransaction {
  id: string;
  userId: string;
  userName?: string;
  type: 'credit' | 'debit';
  amount: number;
  reason: string;
  orderId?: string;
  createdAt: Timestamp;
}

interface GoldSubscriber {
  id: string;
  name?: string;
  email?: string;
  goldExpiry?: Timestamp;
  goldActive?: boolean;
  walletBalance?: number;
}

const DEFAULT_WALLET: WalletConfig = {
  cashbackPercent: 1,
  maxCashbackPerOrder: 50,
  minOrderForCashback: 100,
  redeemMinBalance: 20,
};

const DEFAULT_GOLD: GoldConfig = {
  monthlyPrice: 99,
  freeDeliveryUpToKm: 5,
  freeDeliveryMonthlyLimit: 10,
  extraCashbackPercent: 2,
  active: true,
};

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WalletSubscription() {
  const [walletCfg, setWalletCfg] = useState<WalletConfig>(DEFAULT_WALLET);
  const [goldCfg, setGoldCfg] = useState<GoldConfig>(DEFAULT_GOLD);
  const [savingWallet, setSavingWallet] = useState(false);
  const [savingGold, setSavingGold] = useState(false);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);

  const [subscribers, setSubscribers] = useState<GoldSubscriber[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);

  const [activeTab, setActiveTab] = useState<'wallet' | 'gold' | 'transactions' | 'subscribers'>('wallet');

  // Load wallet config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'appSettings', 'walletConfig'), snap => {
      if (snap.exists()) setWalletCfg({ ...DEFAULT_WALLET, ...(snap.data() as WalletConfig) });
    });
    return () => unsub();
  }, []);

  // Load gold config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'appSettings', 'goldConfig'), snap => {
      if (snap.exists()) setGoldCfg({ ...DEFAULT_GOLD, ...(snap.data() as GoldConfig) });
    });
    return () => unsub();
  }, []);

  // Load recent wallet transactions
  useEffect(() => {
    const q = query(collection(db, 'walletTransactions'), orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as WalletTransaction)));
      setLoadingTx(false);
    }, () => setLoadingTx(false));
    return () => unsub();
  }, []);

  // Load gold subscribers
  useEffect(() => {
    const q = query(collection(db, 'users'), where('goldActive', '==', true));
    const unsub = onSnapshot(q, snap => {
      setSubscribers(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoldSubscriber)));
      setLoadingSubs(false);
    }, () => setLoadingSubs(false));
    return () => unsub();
  }, []);

  // Stats
  const stats = useMemo(() => {
    const totalCashback = transactions
      .filter(t => t.type === 'credit' && t.reason === 'cashback')
      .reduce((s, t) => s + t.amount, 0);
    const totalRedeemed = transactions
      .filter(t => t.type === 'debit' && t.reason === 'redeem')
      .reduce((s, t) => s + t.amount, 0);
    const activeGold = subscribers.length;
    const goldRevenue = activeGold * goldCfg.monthlyPrice;
    return { totalCashback, totalRedeemed, activeGold, goldRevenue };
  }, [transactions, subscribers, goldCfg]);

  async function saveWalletConfig() {
    setSavingWallet(true);
    try {
      await setDoc(doc(db, 'appSettings', 'walletConfig'), { ...walletCfg, updatedAt: serverTimestamp() });
      toast.success('Wallet settings saved');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSavingWallet(false);
    }
  }

  async function saveGoldConfig() {
    setSavingGold(true);
    try {
      await setDoc(doc(db, 'appSettings', 'goldConfig'), { ...goldCfg, updatedAt: serverTimestamp() });
      toast.success('Gold settings saved');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSavingGold(false);
    }
  }

  async function revokeGold(sub: GoldSubscriber) {
    try {
      await updateDoc(doc(db, 'users', sub.id), { goldActive: false, goldExpiry: null });
      toast.success(`Gold revoked for ${sub.name || sub.email}`);
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Wallet className="w-7 h-7 text-brand" />
          Wallet & Gold Subscription
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Manage loyalty cashback wallet and Manabites Gold subscription
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Cashback Given', value: `₹${stats.totalCashback.toLocaleString('en-IN')}`, icon: Gift, color: 'border-green-400', iconBg: 'bg-green-50', iconColor: 'text-green-600' },
          { label: 'Wallet Redeemed', value: `₹${stats.totalRedeemed.toLocaleString('en-IN')}`, icon: Wallet, color: 'border-blue-400', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Gold Subscribers', value: stats.activeGold.toString(), icon: Crown, color: 'border-yellow-400', iconBg: 'bg-yellow-50', iconColor: 'text-yellow-600' },
          { label: 'Gold MRR', value: `₹${stats.goldRevenue.toLocaleString('en-IN')}/mo`, icon: DollarSign, color: 'border-purple-400', iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className={`bg-white dark:bg-gray-900 rounded-2xl shadow-card p-5 border-l-4 ${s.color}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
            whileHover={{ y: -3 }}
          >
            <div className={`w-9 h-9 ${s.iconBg} rounded-xl flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.iconColor}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-black text-gray-800 dark:text-gray-100 mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {(['wallet', 'gold', 'transactions', 'subscribers'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all capitalize ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-900 text-brand shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'subscribers' ? 'Gold Members' : tab === 'transactions' ? 'Tx History' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Wallet Settings ── */}
        {activeTab === 'wallet' && (
          <motion.div
            key="wallet"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-6 space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                <Wallet className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="font-black text-gray-800 dark:text-gray-100">Wallet Cashback Settings</h2>
                <p className="text-xs text-gray-400">Customers earn cashback on every order, redeemable at checkout</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: 'Cashback %', field: 'cashbackPercent', suffix: '%', min: 0, max: 20, step: 0.5, help: 'Percentage of order subtotal credited to wallet' },
                { label: 'Max Cashback per Order', field: 'maxCashbackPerOrder', suffix: '₹', min: 0, max: 500, step: 5, help: 'Cap to prevent abuse on large orders' },
                { label: 'Min Order for Cashback', field: 'minOrderForCashback', suffix: '₹', min: 0, max: 1000, step: 10, help: 'Orders below this don\'t earn cashback' },
                { label: 'Min Balance to Redeem', field: 'redeemMinBalance', suffix: '₹', min: 0, max: 500, step: 5, help: 'Minimum wallet balance before customer can redeem' },
              ].map(field => (
                <div key={field.field}>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                    {field.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">{field.suffix}</span>
                    <input
                      type="number"
                      value={(walletCfg as any)[field.field]}
                      onChange={e => setWalletCfg(c => ({ ...c, [field.field]: parseFloat(e.target.value) || 0 }))}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{field.help}</p>
                </div>
              ))}
            </div>

            <div className="p-4 bg-orange-50 dark:bg-orange-950/30 rounded-xl flex items-start gap-3 text-sm">
              <Info className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
              <div className="text-gray-700 dark:text-gray-300">
                Example: ₹500 order → <strong>₹{Math.min(500 * walletCfg.cashbackPercent / 100, walletCfg.maxCashbackPerOrder).toFixed(2)}</strong> cashback
                {500 < walletCfg.minOrderForCashback
                  ? ' — but min order not met'
                  : ` (capped at ₹${walletCfg.maxCashbackPerOrder})`}
              </div>
            </div>

            <button
              onClick={saveWalletConfig}
              disabled={savingWallet}
              className="flex items-center gap-2 px-6 py-3 bg-brand text-white rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-60 transition-colors"
            >
              {savingWallet ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save Wallet Settings
            </button>
          </motion.div>
        )}

        {/* ── Gold Settings ── */}
        {activeTab === 'gold' && (
          <motion.div
            key="gold"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-6 space-y-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <Crown className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <h2 className="font-black text-gray-800 dark:text-gray-100">Manabites Gold</h2>
                  <p className="text-xs text-gray-400">Premium subscription with free delivery & extra cashback</p>
                </div>
              </div>
              <button
                onClick={() => { const next = !goldCfg.active; setGoldCfg(c => ({ ...c, active: next })); saveGoldConfig(); }}
                className="relative inline-flex h-7 w-12 cursor-pointer items-center rounded-full transition-colors"
                style={{ backgroundColor: goldCfg.active ? '#eab308' : '#d1d5db' }}
              >
                <motion.span
                  layout
                  className="inline-block h-5 w-5 rounded-full bg-white shadow"
                  animate={{ x: goldCfg.active ? 24 : 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: 'Monthly Price', field: 'monthlyPrice', suffix: '₹', min: 0, max: 999, step: 1, help: 'Charged monthly per subscriber' },
                { label: 'Free Delivery Up To', field: 'freeDeliveryUpToKm', suffix: 'km', min: 1, max: 20, step: 1, help: 'Orders within this radius get free delivery' },
                { label: 'Free Deliveries / Month', field: 'freeDeliveryMonthlyLimit', suffix: '', min: 0, max: 100, step: 1, help: 'Cap on free deliveries per month (0 = unlimited)' },
                { label: 'Extra Cashback %', field: 'extraCashbackPercent', suffix: '%', min: 0, max: 10, step: 0.5, help: 'Additional cashback on top of base rate for Gold members' },
              ].map(field => (
                <div key={field.field}>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                    {field.label}
                  </label>
                  <div className="flex items-center gap-2">
                    {field.suffix && <span className="text-gray-400 text-sm">{field.suffix}</span>}
                    <input
                      type="number"
                      value={(goldCfg as any)[field.field]}
                      onChange={e => setGoldCfg(c => ({ ...c, [field.field]: parseFloat(e.target.value) || 0 }))}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{field.help}</p>
                </div>
              ))}
            </div>

            {/* Benefits preview */}
            <div className="p-4 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-xl">
              <p className="text-sm font-black text-yellow-800 dark:text-yellow-300 mb-3 flex items-center gap-2">
                <Crown className="w-4 h-4" /> Gold Member Benefits Preview
              </p>
              <ul className="space-y-1.5 text-sm text-yellow-700 dark:text-yellow-400">
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> Free delivery on orders within {goldCfg.freeDeliveryUpToKm}km</li>
                {goldCfg.freeDeliveryMonthlyLimit > 0 && (
                  <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> Up to {goldCfg.freeDeliveryMonthlyLimit} free deliveries per month</li>
                )}
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> {walletCfg.cashbackPercent + goldCfg.extraCashbackPercent}% total cashback ({goldCfg.extraCashbackPercent}% extra vs {walletCfg.cashbackPercent}% standard)</li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> Gold badge on profile</li>
              </ul>
              <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-3 font-semibold">₹{goldCfg.monthlyPrice}/month · cancellable any time</p>
            </div>

            <button
              onClick={saveGoldConfig}
              disabled={savingGold}
              className="flex items-center gap-2 px-6 py-3 bg-yellow-500 text-white rounded-xl font-bold text-sm hover:bg-yellow-600 disabled:opacity-60 transition-colors"
            >
              {savingGold ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Crown className="w-4 h-4" />
              )}
              Save Gold Settings
            </button>
          </motion.div>
        )}

        {/* ── Transaction History ── */}
        {activeTab === 'transactions' && (
          <motion.div
            key="transactions"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-black text-gray-800 dark:text-gray-100">Recent Wallet Transactions</h2>
              <p className="text-xs text-gray-400 mt-0.5">Last 100 wallet credits and debits</p>
            </div>
            {loadingTx ? (
              <div className="py-16 text-center text-gray-400">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3" />
                Loading...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="table-header">User</th>
                      <th className="table-header">Type</th>
                      <th className="table-header">Amount</th>
                      <th className="table-header">Reason</th>
                      <th className="table-header">Order</th>
                      <th className="table-header">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="table-cell font-semibold text-gray-800 dark:text-gray-100">{tx.userName || tx.userId.slice(0, 8)}</td>
                        <td className="table-cell">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${tx.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className={`table-cell font-black ${tx.type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                          {tx.type === 'credit' ? '+' : '−'}₹{tx.amount}
                        </td>
                        <td className="table-cell text-gray-500 capitalize">{tx.reason.replace(/_/g, ' ')}</td>
                        <td className="table-cell font-mono text-xs text-gray-400">{tx.orderId ? tx.orderId.slice(0, 8).toUpperCase() : '—'}</td>
                        <td className="table-cell text-xs text-gray-400">{formatDateTime(tx.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {transactions.length === 0 && (
                  <div className="py-16 text-center">
                    <Wallet className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-400 font-semibold">No wallet transactions yet</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Gold Subscribers ── */}
        {activeTab === 'subscribers' && (
          <motion.div
            key="subscribers"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-500" />
                Active Gold Members
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{subscribers.length} active Gold subscribers</p>
            </div>
            {loadingSubs ? (
              <div className="py-16 text-center text-gray-400">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full mx-auto mb-3" />
                Loading...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="table-header">Member</th>
                      <th className="table-header">Email</th>
                      <th className="table-header">Wallet Balance</th>
                      <th className="table-header">Expires</th>
                      <th className="table-header text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map(s => (
                      <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-xs font-black text-yellow-700 flex-shrink-0">
                              {(s.name || s.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <span className="font-semibold text-gray-800 dark:text-gray-100">{s.name || '—'}</span>
                          </div>
                        </td>
                        <td className="table-cell text-gray-500">{s.email || '—'}</td>
                        <td className="table-cell font-bold text-green-700">₹{(s.walletBalance || 0).toLocaleString('en-IN')}</td>
                        <td className="table-cell text-gray-500">{formatDate(s.goldExpiry)}</td>
                        <td className="table-cell text-right">
                          <button
                            onClick={() => revokeGold(s)}
                            className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition-colors"
                          >
                            Revoke Gold
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {subscribers.length === 0 && (
                  <div className="py-16 text-center">
                    <Crown className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-400 font-semibold">No active Gold members yet</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
