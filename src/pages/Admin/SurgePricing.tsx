import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, orderBy,
  updateDoc, setDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Zap, CloudRain, Clock, Star, ToggleLeft, ToggleRight,
  Percent, Store, Edit2, Check, X, ChevronDown, TrendingUp,
  DollarSign, AlertTriangle, Info,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SurgeConfig {
  active: boolean;
  reason: 'bad_weather' | 'peak_hours' | 'festival' | 'manual';
  multiplier: number;
  flatFee: number;
  note: string;
  activatedAt?: Timestamp;
  activatedBy?: string;
}

interface RestaurantDoc {
  id: string;
  name: string;
  email?: string;
  commissionRate?: number;
  commissionTier?: 'standard' | 'premium' | 'exclusive';
  isActive?: boolean;
  approved?: boolean;
}

const DEFAULT_SURGE: SurgeConfig = {
  active: false,
  reason: 'peak_hours',
  multiplier: 1.5,
  flatFee: 0,
  note: '',
};

const REASON_LABELS: Record<SurgeConfig['reason'], { label: string; icon: React.ReactNode; color: string }> = {
  bad_weather: { label: 'Bad Weather', icon: <CloudRain className="w-4 h-4" />, color: 'text-blue-600 bg-blue-50' },
  peak_hours:  { label: 'Peak Hours',  icon: <Clock className="w-4 h-4" />,     color: 'text-orange-600 bg-orange-50' },
  festival:    { label: 'Festival',    icon: <Star className="w-4 h-4" />,      color: 'text-purple-600 bg-purple-50' },
  manual:      { label: 'Manual',      icon: <Zap className="w-4 h-4" />,       color: 'text-red-600 bg-red-50' },
};

const TIER_INFO: Record<'standard' | 'premium' | 'exclusive', { label: string; defaultRate: number; color: string; desc: string }> = {
  standard:  { label: 'Standard',  defaultRate: 15, color: 'text-gray-600 bg-gray-100',    desc: 'Default commission rate' },
  premium:   { label: 'Premium',   defaultRate: 12, color: 'text-blue-700 bg-blue-100',    desc: 'Partner restaurants' },
  exclusive: { label: 'Exclusive', defaultRate: 8,  color: 'text-purple-700 bg-purple-100', desc: 'Top-tier / exclusive deals' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function SurgePricing() {
  const { user } = useAuth();

  const [surge, setSurge] = useState<SurgeConfig>(DEFAULT_SURGE);
  const [savingSurge, setSavingSurge] = useState(false);

  const [restaurants, setRestaurants] = useState<RestaurantDoc[]>([]);
  const [loadingRest, setLoadingRest] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editTier, setEditTier] = useState<'standard' | 'premium' | 'exclusive'>('standard');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchRest, setSearchRest] = useState('');

  // Load surge config
  useEffect(() => {
    const ref = doc(db, 'appSettings', 'surgeConfig');
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) setSurge({ ...DEFAULT_SURGE, ...(snap.data() as SurgeConfig) });
    });
    return () => unsub();
  }, []);

  // Load restaurants
  useEffect(() => {
    const q = query(collection(db, 'restaurants'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setRestaurants(snap.docs.map(d => ({ id: d.id, ...d.data() } as RestaurantDoc)));
      setLoadingRest(false);
    }, () => setLoadingRest(false));
    return () => unsub();
  }, []);

  const filteredRest = useMemo(() => {
    if (!searchRest.trim()) return restaurants;
    const q = searchRest.toLowerCase();
    return restaurants.filter(r => (r.name || '').toLowerCase().includes(q));
  }, [restaurants, searchRest]);

  // Stats
  const stats = useMemo(() => {
    const customCount = restaurants.filter(r => r.commissionRate !== undefined).length;
    const avgRate = restaurants.length
      ? restaurants.reduce((s, r) => {
          const tier = r.commissionTier || 'standard';
          return s + (r.commissionRate ?? TIER_INFO[tier].defaultRate);
        }, 0) / restaurants.length
      : 0;
    return { customCount, avgRate };
  }, [restaurants]);

  async function saveSurgeConfig(patch: Partial<SurgeConfig>) {
    setSavingSurge(true);
    try {
      const next = { ...surge, ...patch };
      await setDoc(doc(db, 'appSettings', 'surgeConfig'), {
        ...next,
        activatedAt: serverTimestamp(),
        activatedBy: user?.email ?? 'admin',
      });
      toast.success(next.active ? `Surge activated (${next.multiplier}x)` : 'Surge deactivated');
    } catch (e: any) {
      toast.error('Failed to save: ' + e.message);
    } finally {
      setSavingSurge(false);
    }
  }

  function startEdit(r: RestaurantDoc) {
    const tier = r.commissionTier || 'standard';
    setEditingId(r.id);
    setEditRate(String(r.commissionRate ?? TIER_INFO[tier].defaultRate));
    setEditTier(tier);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRate('');
  }

  async function saveCommission(r: RestaurantDoc) {
    const rate = parseFloat(editRate);
    if (isNaN(rate) || rate < 0 || rate > 50) {
      toast.error('Rate must be between 0 and 50');
      return;
    }
    setSavingId(r.id);
    try {
      await updateDoc(doc(db, 'restaurants', r.id), {
        commissionRate: rate,
        commissionTier: editTier,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Commission updated for ${r.name}`);
      setEditingId(null);
    } catch (e: any) {
      toast.error('Failed to save: ' + e.message);
    } finally {
      setSavingId(null);
    }
  }

  const surgeReason = REASON_LABELS[surge.reason];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Zap className="w-7 h-7 text-brand" />
          Surge Pricing & Commissions
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Control surge delivery fees and per-restaurant commission tiers
        </p>
      </motion.div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Surge Status',
            value: surge.active ? 'ACTIVE' : 'OFF',
            icon: Zap,
            color: surge.active ? 'border-red-400' : 'border-gray-300',
            iconBg: surge.active ? 'bg-red-50' : 'bg-gray-100',
            iconColor: surge.active ? 'text-red-500' : 'text-gray-400',
            textColor: surge.active ? 'text-red-600' : 'text-gray-500',
          },
          {
            label: 'Surge Multiplier',
            value: `${surge.multiplier}×`,
            icon: TrendingUp,
            color: 'border-orange-400',
            iconBg: 'bg-orange-50',
            iconColor: 'text-brand',
            textColor: 'text-gray-800',
          },
          {
            label: 'Flat Surge Fee',
            value: surge.flatFee > 0 ? `+₹${surge.flatFee}` : 'None',
            icon: DollarSign,
            color: 'border-green-400',
            iconBg: 'bg-green-50',
            iconColor: 'text-green-600',
            textColor: 'text-gray-800',
          },
          {
            label: 'Custom Commissions',
            value: `${stats.customCount} restaurants`,
            icon: Percent,
            color: 'border-purple-400',
            iconBg: 'bg-purple-50',
            iconColor: 'text-purple-600',
            textColor: 'text-gray-800',
          },
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
            <p className={`text-xl font-black mt-1 ${s.textColor}`}>{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Surge Pricing Panel ── */}
      <motion.div
        className={`bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden border-2 transition-colors ${surge.active ? 'border-red-300' : 'border-gray-100'}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        {/* Panel header */}
        <div className={`px-5 py-4 flex items-center justify-between ${surge.active ? 'bg-red-50 dark:bg-red-950/30' : 'bg-gray-50 dark:bg-gray-800'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${surge.active ? 'bg-red-100' : 'bg-gray-200'}`}>
              <Zap className={`w-5 h-5 ${surge.active ? 'text-red-500' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="font-black text-gray-800 dark:text-gray-100">Surge Pricing</p>
              <p className="text-xs text-gray-400">
                {surge.active
                  ? `Active — ${surge.multiplier}× multiplier${surge.flatFee > 0 ? ` + ₹${surge.flatFee} flat` : ''}`
                  : 'Off — normal delivery fees apply'}
              </p>
            </div>
          </div>
          <button
            onClick={() => saveSurgeConfig({ active: !surge.active })}
            disabled={savingSurge}
            className="relative inline-flex h-7 w-12 cursor-pointer items-center rounded-full transition-colors focus:outline-none disabled:opacity-60"
            style={{ backgroundColor: surge.active ? '#ef4444' : '#d1d5db' }}
          >
            <motion.span
              layout
              className="inline-block h-5 w-5 rounded-full bg-white shadow"
              animate={{ x: surge.active ? 24 : 4 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>

        {/* Config grid */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Reason */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Reason</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(REASON_LABELS) as [SurgeConfig['reason'], typeof REASON_LABELS[keyof typeof REASON_LABELS]][]).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => saveSurgeConfig({ reason: key })}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                    surge.reason === key
                      ? 'border-brand bg-orange-50 text-brand dark:bg-orange-950/30'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {info.icon}
                  {info.label}
                </button>
              ))}
            </div>
          </div>

          {/* Multiplier */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
              Delivery Fee Multiplier — <span className="text-brand">{surge.multiplier}×</span>
            </label>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.1"
              value={surge.multiplier}
              onChange={e => setSurge(s => ({ ...s, multiplier: parseFloat(e.target.value) }))}
              onMouseUp={() => saveSurgeConfig({ multiplier: surge.multiplier })}
              onTouchEnd={() => saveSurgeConfig({ multiplier: surge.multiplier })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>1.0×</span><span>1.5×</span><span>2.0×</span><span>2.5×</span><span>3.0×</span>
            </div>
            <div className="mt-3 flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-xl text-xs text-orange-700 dark:text-orange-300">
              <Info className="w-4 h-4 flex-shrink-0" />
              A ₹40 delivery fee becomes <strong className="mx-1">₹{(40 * surge.multiplier).toFixed(0)}</strong> at {surge.multiplier}×
            </div>
          </div>

          {/* Flat surge fee */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
              Flat Surge Fee (₹ added on top)
            </label>
            <div className="flex gap-2">
              {[0, 10, 20, 30, 50].map(v => (
                <button
                  key={v}
                  onClick={() => saveSurgeConfig({ flatFee: v })}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border-2 ${
                    surge.flatFee === v
                      ? 'border-brand bg-orange-50 text-brand dark:bg-orange-950/30'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {v === 0 ? 'None' : `+₹${v}`}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
              Surge Note (shown to customers)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={surge.note}
                onChange={e => setSurge(s => ({ ...s, note: e.target.value }))}
                placeholder="e.g. High demand in your area"
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <button
                onClick={() => saveSurgeConfig({ note: surge.note })}
                disabled={savingSurge}
                className="px-4 py-2.5 bg-brand text-white rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Active indicator */}
        <AnimatePresence>
          {surge.active && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mx-5 mb-5 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 animate-pulse" />
                <div>
                  <p className="text-sm font-black text-red-700 dark:text-red-400">Surge is LIVE</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    Reason: {surgeReason.label} · {surge.multiplier}× multiplier
                    {surge.flatFee > 0 ? ` · +₹${surge.flatFee} flat fee` : ''}
                  </p>
                </div>
                <button
                  onClick={() => saveSurgeConfig({ active: false })}
                  className="ml-auto px-4 py-1.5 bg-red-600 text-white text-xs font-black rounded-lg hover:bg-red-700 transition-colors"
                >
                  Deactivate
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Tier Info ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.entries(TIER_INFO) as [string, typeof TIER_INFO[keyof typeof TIER_INFO]][]).map(([key, t], i) => (
          <motion.div
            key={key}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.07, duration: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${t.color}`}>{t.label}</span>
            </div>
            <p className="text-2xl font-black text-gray-800 dark:text-gray-100">{t.defaultRate}%</p>
            <p className="text-xs text-gray-400 mt-1">{t.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Per-Restaurant Commission Tiers ── */}
      <motion.div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.3 }}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <h2 className="font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Store className="w-5 h-5 text-brand" />
              Per-Restaurant Commission
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Override default rates with custom tiers or specific percentages</p>
          </div>
          <input
            type="text"
            value={searchRest}
            onChange={e => setSearchRest(e.target.value)}
            placeholder="Search restaurants..."
            className="w-full md:w-64 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {loadingRest ? (
          <div className="py-16 text-center text-gray-400">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
            />
            Loading restaurants...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="table-header">Restaurant</th>
                  <th className="table-header">Tier</th>
                  <th className="table-header">Commission Rate</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRest.map(r => {
                  const tier = r.commissionTier || 'standard';
                  const rate = r.commissionRate ?? TIER_INFO[tier].defaultRate;
                  const tierInfo = TIER_INFO[tier];
                  const isEditing = editingId === r.id;
                  const isSaving = savingId === r.id;

                  return (
                    <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-sm font-black text-brand flex-shrink-0">
                            {(r.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800 dark:text-gray-100">{r.name}</p>
                            <p className="text-xs text-gray-400">{r.email || '—'}</p>
                          </div>
                        </div>
                      </td>

                      <td className="table-cell">
                        {isEditing ? (
                          <select
                            value={editTier}
                            onChange={e => setEditTier(e.target.value as typeof editTier)}
                            className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                          >
                            <option value="standard">Standard (15%)</option>
                            <option value="premium">Premium (12%)</option>
                            <option value="exclusive">Exclusive (8%)</option>
                          </select>
                        ) : (
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${tierInfo.color}`}>
                            {tierInfo.label}
                          </span>
                        )}
                      </td>

                      <td className="table-cell">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={editRate}
                              onChange={e => setEditRate(e.target.value)}
                              min="0"
                              max="50"
                              step="0.5"
                              className="w-20 px-2 py-1 border border-brand rounded-lg text-sm font-bold text-gray-800 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30"
                            />
                            <span className="text-gray-500 text-xs">%</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-black text-gray-800 dark:text-gray-100">{rate}%</span>
                            {r.commissionRate !== undefined && r.commissionRate !== TIER_INFO[tier].defaultRate && (
                              <span className="px-1.5 py-0.5 bg-brand/10 text-brand text-[10px] font-black rounded">Custom</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {r.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td className="table-cell text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => saveCommission(r)}
                              disabled={isSaving}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                            >
                              {isSaving ? (
                                <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(r)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-lg hover:bg-orange-50 hover:text-brand transition-colors ml-auto"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredRest.length === 0 && !loadingRest && (
              <div className="py-16 text-center">
                <Store className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-semibold">No restaurants found</p>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
