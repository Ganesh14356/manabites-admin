import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
// toggleFlag now calls /api/update-flags (Admin SDK) to bypass Firestore security rules
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Rocket,
  Globe,
  TrendingUp,
  Package,
  Truck,
  ChefHat,
  Factory,
  ShoppingCart,
  Pill,
  X,
  Settings,
  CheckCircle,
  Clock,
  Zap,
  ToggleLeft,
  ToggleRight,
  Shield,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type VerticalStatus = 'live' | 'beta' | 'coming_soon' | 'planning';

interface Vertical {
  id: string;
  emoji: string;
  name: string;
  tagline: string;
  status: VerticalStatus;
  progress: number;
  phase: string;
  metrics: { label: string; value: string }[];
  icon: React.ReactNode;
  accentColor: string;
  bgColor: string;
}

interface VerticalConfig {
  launchCity: string;
  targetLaunchDate: string;
  partnerCount: string;
  notes: string;
}

interface RoadmapPhase {
  phase: string;
  period: string;
  items: { name: string; emoji: string; done: boolean }[];
  color: string;
  dotColor: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<VerticalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  live:        { label: 'Live',        color: 'bg-green-100 text-green-700 border-green-200',   icon: <CheckCircle className="w-3 h-3" /> },
  beta:        { label: 'Beta',        color: 'bg-blue-100 text-blue-700 border-blue-200',      icon: <Zap className="w-3 h-3" /> },
  coming_soon: { label: 'Coming Soon', color: 'bg-amber-100 text-amber-700 border-amber-200',   icon: <Clock className="w-3 h-3" /> },
  planning:    { label: 'Planning',    color: 'bg-gray-100 text-gray-600 border-gray-200',      icon: <Settings className="w-3 h-3" /> },
};

const VERTICALS: Vertical[] = [
  {
    id: 'food_delivery',
    emoji: '🍔',
    name: 'ManaBites Food',
    tagline: 'Hyderabad\'s favourite food delivery',
    status: 'live',
    progress: 100,
    phase: 'Phase 1',
    metrics: [
      { label: 'Restaurants', value: '120+' },
      { label: 'Daily Orders', value: '850+' },
    ],
    icon: <ChefHat className="w-5 h-5" />,
    accentColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  {
    id: 'cloud_kitchens',
    emoji: '☁️',
    name: 'ManaBites Cloud Kitchens',
    tagline: 'Ghost kitchen network',
    status: 'beta',
    progress: 60,
    phase: 'Phase 2',
    metrics: [
      { label: 'Kitchens', value: '3' },
      { label: 'Brands', value: '9' },
    ],
    icon: <Factory className="w-5 h-5" />,
    accentColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    id: 'grocery',
    emoji: '🛒',
    name: 'ManaBites Grocery',
    tagline: 'Quick grocery delivery',
    status: 'coming_soon',
    progress: 30,
    phase: 'Phase 2',
    metrics: [
      { label: 'Partners', value: '0' },
      { label: 'SKUs', value: '0' },
    ],
    icon: <ShoppingCart className="w-5 h-5" />,
    accentColor: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  {
    id: 'courier',
    emoji: '📦',
    name: 'ManaBites Courier',
    tagline: 'Package delivery service',
    status: 'coming_soon',
    progress: 40,
    phase: 'Phase 2',
    metrics: [
      { label: 'Riders', value: '0' },
      { label: 'Orders', value: '0' },
    ],
    icon: <Package className="w-5 h-5" />,
    accentColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  {
    id: 'pharmacy',
    emoji: '💊',
    name: 'ManaBites Pharmacy',
    tagline: 'Medicine & health products',
    status: 'planning',
    progress: 10,
    phase: 'Phase 3',
    metrics: [
      { label: 'Partners', value: '0' },
      { label: 'Products', value: '0' },
    ],
    icon: <Pill className="w-5 h-5" />,
    accentColor: 'text-red-600',
    bgColor: 'bg-red-50',
  },
  {
    id: 'logistics',
    emoji: '🚚',
    name: 'ManaBites Logistics',
    tagline: 'B2B logistics & freight',
    status: 'planning',
    progress: 5,
    phase: 'Phase 3',
    metrics: [
      { label: 'Clients', value: '0' },
      { label: 'Vehicles', value: '0' },
    ],
    icon: <Truck className="w-5 h-5" />,
    accentColor: 'text-slate-600',
    bgColor: 'bg-slate-50',
  },
  {
    id: 'b2b_supply',
    emoji: '🏭',
    name: 'ManaBites B2B Supply',
    tagline: 'Restaurant supply chain',
    status: 'planning',
    progress: 20,
    phase: 'Phase 3',
    metrics: [
      { label: 'Vendors', value: '0' },
      { label: 'Clients', value: '0' },
    ],
    icon: <Globe className="w-5 h-5" />,
    accentColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
  },
  {
    id: 'catering',
    emoji: '🍽️',
    name: 'ManaBites Catering',
    tagline: 'Event & corporate catering',
    status: 'planning',
    progress: 0,
    phase: 'Phase 4',
    metrics: [
      { label: 'Events', value: '0' },
      { label: 'Clients', value: '0' },
    ],
    icon: <ChefHat className="w-5 h-5" />,
    accentColor: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
  },
];

const ROADMAP: RoadmapPhase[] = [
  {
    phase: 'Phase 1',
    period: '2024 – 25',
    items: [
      { name: 'Food Delivery', emoji: '🍔', done: true },
      { name: 'Rider Network',  emoji: '🏍️', done: true },
      { name: 'Admin Dashboard', emoji: '🖥️', done: true },
    ],
    color: 'border-green-400',
    dotColor: 'bg-green-500',
  },
  {
    phase: 'Phase 2',
    period: '2025 – 26',
    items: [
      { name: 'Cloud Kitchens', emoji: '☁️', done: false },
      { name: 'Grocery',        emoji: '🛒', done: false },
      { name: 'Courier',        emoji: '📦', done: false },
    ],
    color: 'border-blue-400',
    dotColor: 'bg-blue-500',
  },
  {
    phase: 'Phase 3',
    period: '2026 – 27',
    items: [
      { name: 'Pharmacy',    emoji: '💊', done: false },
      { name: 'Logistics',   emoji: '🚚', done: false },
      { name: 'B2B Supply',  emoji: '🏭', done: false },
    ],
    color: 'border-purple-400',
    dotColor: 'bg-purple-500',
  },
  {
    phase: 'Phase 4',
    period: '2027+',
    items: [
      { name: 'Catering',          emoji: '🍽️', done: false },
      { name: 'Franchise Network', emoji: '🌐', done: false },
      { name: 'IPO Ready',         emoji: '📈', done: false },
    ],
    color: 'border-amber-400',
    dotColor: 'bg-amber-500',
  },
];

const EMPTY_CONFIG: VerticalConfig = {
  launchCity: '',
  targetLaunchDate: '',
  partnerCount: '',
  notes: '',
};

// ── Progress bar helper ────────────────────────────────────────────────────────

function ProgressBar({ value, color = 'bg-orange-500' }: { value: number; color?: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

function progressColor(status: VerticalStatus): string {
  switch (status) {
    case 'live':        return 'bg-green-500';
    case 'beta':        return 'bg-blue-500';
    case 'coming_soon': return 'bg-amber-500';
    case 'planning':    return 'bg-gray-400';
  }
}

// ── Overall Vision progress ───────────────────────────────────────────────────

function overallProgress(verticals: Vertical[]): number {
  const total = verticals.reduce((sum, v) => sum + v.progress, 0);
  return Math.round(total / verticals.length);
}

// ── Feature Flag definitions ──────────────────────────────────────────────────

interface FlagDef {
  key:     string;
  label:   string;
  emoji:   string;
  desc:    string;
}

const FLAG_DEFS: FlagDef[] = [
  { key: 'food',          label: 'Food Delivery',  emoji: '🍔', desc: 'Restaurant orders & delivery' },
  { key: 'grocery',       label: 'Grocery',        emoji: '🛒', desc: '10-minute grocery delivery'   },
  { key: 'pharmacy',      label: 'Pharmacy',       emoji: '💊', desc: 'Medicines & health products'  },
  { key: 'courier',       label: 'Courier',        emoji: '📦', desc: 'Parcel & document delivery'   },
  { key: 'catering',      label: 'Catering',       emoji: '🎉', desc: 'Events & corporate catering'  },
  { key: 'home-services', label: 'Home Services',  emoji: '🏠', desc: 'Plumbing, cleaning, repairs'  },
  { key: 'bike-taxi',     label: 'Bike Taxi',      emoji: '🛵', desc: '2-wheeler ride booking'       },
  { key: 'auto',          label: 'Auto',           emoji: '🚕', desc: 'Auto-rickshaw booking'        },
  { key: 'cab',           label: 'Cab',            emoji: '🚗', desc: '4-wheeler cab rides'          },
  { key: 'car-rental',    label: 'Car Rental',     emoji: '🚘', desc: 'Self-drive & chauffeur'       },
  { key: 'b2b',           label: 'B2B Supply',     emoji: '🏢', desc: 'Restaurant supply chain'     },
  { key: 'store',         label: 'Store',          emoji: '🛍', desc: 'Fashion & electronics'       },
];

const DEFAULT_FLAGS: Record<string, boolean> = Object.fromEntries(
  FLAG_DEFS.map(f => [f.key, f.key === 'food'])
);

// ── Main Component ────────────────────────────────────────────────────────────

export default function VerticalsHub() {
  const { user } = useAuth();
  const [selectedVertical, setSelectedVertical] = useState<Vertical | null>(null);
  const [config, setConfig] = useState<VerticalConfig>(EMPTY_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // ── Feature flags state ──
  const [flags, setFlags]         = useState<Record<string, boolean>>(DEFAULT_FLAGS);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [flagsSaving, setFlagsSaving]   = useState(false);

  useEffect(() => {
    const ref = doc(db, 'config', 'verticals');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setFlags({ ...DEFAULT_FLAGS, ...snap.data() as Record<string, boolean> });
      setFlagsLoading(false);
    }, () => setFlagsLoading(false));
    return unsub;
  }, []);

  async function toggleFlag(key: string) {
    const next = !flags[key];
    setFlags(prev => ({ ...prev, [key]: next }));
    setFlagsSaving(true);
    try {
      const res = await fetch('/api/update-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`${FLAG_DEFS.find(f => f.key === key)?.label} ${next ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      setFlags(prev => ({ ...prev, [key]: !next }));
      console.error('[VerticalsHub] toggleFlag error:', e);
      toast.error(`Failed: ${e.message || 'unknown'}`);
    } finally {
      setFlagsSaving(false);
    }
  }

  const overall = overallProgress(VERTICALS);

  // Load existing config from Firestore when modal opens
  useEffect(() => {
    if (!selectedVertical) return;
    setLoadingConfig(true);
    setConfig(EMPTY_CONFIG);

    const ref = doc(db, 'verticals', selectedVertical.id);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setConfig({
            launchCity:        data.launchCity        ?? '',
            targetLaunchDate:  data.targetLaunchDate  ?? '',
            partnerCount:      String(data.partnerCount ?? ''),
            notes:             data.notes             ?? '',
          });
        }
      })
      .catch(() => toast.error('Failed to load config'))
      .finally(() => setLoadingConfig(false));
  }, [selectedVertical]);

  async function handleSave() {
    if (!selectedVertical) return;
    setSaving(true);
    try {
      const ref = doc(db, 'verticals', selectedVertical.id);
      await setDoc(
        ref,
        {
          ...config,
          partnerCount: config.partnerCount ? parseInt(config.partnerCount, 10) : 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast.success(`${selectedVertical.name} config saved!`);
      setSelectedVertical(null);
    } catch {
      toast.error('Failed to save config');
    } finally {
      setSaving(false);
    }
  }

  function openModal(v: Vertical) {
    setSelectedVertical(v);
  }

  function closeModal() {
    setSelectedVertical(null);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-orange-100 rounded-xl">
            <Rocket className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Future Verticals</h1>
            <p className="text-sm text-gray-500">Expand ManaBites beyond food delivery</p>
          </div>
        </div>
      </motion.div>

      {/* ── Feature Flags ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orange-100 rounded-lg">
              <Shield className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-sm">Customer App — Live Feature Flags</h2>
              <p className="text-xs text-gray-500">Toggle which verticals customers can see</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              {Object.values(flags).filter(Boolean).length} active
            </div>
            {user?.email && (
              <span className="text-[10px] text-gray-400 font-mono">{user.email}</span>
            )}
          </div>
        </div>

        {flagsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {FLAG_DEFS.map(f => (
              <div key={f.key} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {FLAG_DEFS.map(f => {
              const on = flags[f.key] ?? false;
              return (
                <button
                  key={f.key}
                  onClick={() => toggleFlag(f.key)}
                  disabled={flagsSaving}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all
                    ${on
                      ? 'bg-orange-50 border-orange-200 text-orange-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    } ${flagsSaving ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="text-lg leading-none">{f.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-tight truncate ${on ? 'text-orange-800' : 'text-gray-700'}`}>
                      {f.label}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">{f.desc}</p>
                  </div>
                  {on
                    ? <ToggleRight className="w-5 h-5 text-orange-500 shrink-0" />
                    : <ToggleLeft  className="w-5 h-5 text-gray-300  shrink-0" />
                  }
                </button>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* ── Vision 2030 Overview ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-gradient-to-br from-orange-600 to-orange-500 rounded-2xl p-6 mb-8 text-white shadow-lg"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-orange-100 text-sm font-medium uppercase tracking-wide">Vision 2030</p>
            <h2 className="text-xl font-bold">ManaBites Ecosystem Progress</h2>
          </div>
          <div className="text-right">
            <p className="text-4xl font-extrabold">{overall}%</p>
            <p className="text-orange-200 text-xs">overall complete</p>
          </div>
        </div>

        <div className="w-full bg-orange-700/40 rounded-full h-3 overflow-hidden">
          <motion.div
            className="h-full bg-white rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${overall}%` }}
            transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Live',        count: VERTICALS.filter(v => v.status === 'live').length,        color: 'bg-green-400/20 text-white' },
            { label: 'Beta',        count: VERTICALS.filter(v => v.status === 'beta').length,        color: 'bg-blue-400/20 text-white' },
            { label: 'Coming Soon', count: VERTICALS.filter(v => v.status === 'coming_soon').length, color: 'bg-amber-400/20 text-white' },
            { label: 'Planning',    count: VERTICALS.filter(v => v.status === 'planning').length,    color: 'bg-white/10 text-white' },
          ].map((item) => (
            <div key={item.label} className={`rounded-xl px-3 py-2 text-center ${item.color}`}>
              <p className="text-2xl font-bold">{item.count}</p>
              <p className="text-xs opacity-80">{item.label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Vertical Cards Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
        {VERTICALS.map((v, i) => {
          const statusMeta = STATUS_META[v.status];
          return (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * i }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
            >
              {/* Card top accent bar */}
              <div className={`h-1 ${progressColor(v.status)}`} />

              <div className="p-5">
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-3xl leading-none`}>{v.emoji}</div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm leading-tight">{v.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{v.tagline}</p>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${statusMeta.color}`}>
                    {statusMeta.icon}
                    {statusMeta.label}
                  </span>
                </div>

                {/* Phase tag */}
                <div className="mb-3">
                  <span className="inline-block text-xs font-medium bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    {v.phase}
                  </span>
                </div>

                {/* Progress */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Setup Progress</span>
                    <span className="font-semibold text-gray-700">{v.progress}%</span>
                  </div>
                  <ProgressBar value={v.progress} color={progressColor(v.status)} />
                </div>

                {/* Metrics */}
                <div className="flex gap-3 mb-4">
                  {v.metrics.map((m) => (
                    <div key={m.label} className={`flex-1 rounded-xl px-3 py-2 ${v.bgColor} text-center`}>
                      <p className={`text-lg font-bold ${v.accentColor}`}>{m.value}</p>
                      <p className="text-xs text-gray-500">{m.label}</p>
                    </div>
                  ))}
                </div>

                {/* Action button */}
                <button
                  onClick={() => openModal(v)}
                  className={`w-full flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-xl transition-colors ${
                    v.status === 'live'
                      ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200'
                  }`}
                >
                  {v.status === 'live' ? (
                    <>
                      <TrendingUp className="w-4 h-4" />
                      View Details
                    </>
                  ) : (
                    <>
                      <Settings className="w-4 h-4" />
                      Configure
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Roadmap Timeline ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6"
      >
        <div className="flex items-center gap-2 mb-6">
          <Rocket className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-bold text-gray-900">Vision 2030 Roadmap</h2>
        </div>

        <div className="relative">
          {/* Vertical connecting line */}
          <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-200" />

          <div className="space-y-8">
            {ROADMAP.map((phase, idx) => (
              <motion.div
                key={phase.phase}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 + idx * 0.08 }}
                className="relative flex gap-5"
              >
                {/* Dot */}
                <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full ${phase.dotColor} flex items-center justify-center shadow-sm`}>
                  {idx === 0 ? (
                    <CheckCircle className="w-5 h-5 text-white" />
                  ) : (
                    <Clock className="w-5 h-5 text-white" />
                  )}
                </div>

                {/* Content */}
                <div className={`flex-1 border-l-4 ${phase.color} pl-4 pb-1`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-gray-800">{phase.phase}</span>
                    <span className="text-xs text-gray-400 font-medium bg-gray-100 rounded-full px-2 py-0.5">{phase.period}</span>
                    {idx === 0 && (
                      <span className="text-xs font-semibold bg-green-100 text-green-700 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Done
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {phase.items.map((item) => (
                      <span
                        key={item.name}
                        className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 border ${
                          item.done
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-50 text-gray-600 border-gray-200'
                        }`}
                      >
                        {item.emoji} {item.name}
                        {item.done && <CheckCircle className="w-3 h-3 text-green-500" />}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Configure Modal ── */}
      <AnimatePresence>
        {selectedVertical && (
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          >
            <motion.div
              key="modal-panel"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selectedVertical.emoji}</span>
                  <div>
                    <h3 className="font-bold text-gray-900">{selectedVertical.name}</h3>
                    <p className="text-xs text-gray-500">Configure launch settings</p>
                  </div>
                </div>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-xl hover:bg-gray-200 transition-colors text-gray-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal body */}
              <div className="px-6 py-5 space-y-4">
                {loadingConfig ? (
                  <div className="flex justify-center py-8">
                    <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Status badge */}
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full border ${STATUS_META[selectedVertical.status].color}`}>
                        {STATUS_META[selectedVertical.status].icon}
                        {STATUS_META[selectedVertical.status].label}
                      </span>
                      <span className="text-xs text-gray-500">{selectedVertical.progress}% setup complete</span>
                    </div>

                    {/* Launch City */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Launch City
                      </label>
                      <input
                        type="text"
                        value={config.launchCity}
                        onChange={(e) => setConfig((c) => ({ ...c, launchCity: e.target.value }))}
                        placeholder="e.g. Hyderabad, Bangalore"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                      />
                    </div>

                    {/* Target Launch Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Target Launch Date
                      </label>
                      <input
                        type="date"
                        value={config.targetLaunchDate}
                        onChange={(e) => setConfig((c) => ({ ...c, targetLaunchDate: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                      />
                    </div>

                    {/* Partner Count */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Initial Partner Count
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={config.partnerCount}
                        onChange={(e) => setConfig((c) => ({ ...c, partnerCount: e.target.value }))}
                        placeholder="e.g. 10"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                      />
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notes
                      </label>
                      <textarea
                        rows={3}
                        value={config.notes}
                        onChange={(e) => setConfig((c) => ({ ...c, notes: e.target.value }))}
                        placeholder="Any setup notes or blockers..."
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Modal footer */}
              {!loadingConfig && (
                <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                  <button
                    onClick={closeModal}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Rocket className="w-4 h-4" />
                        Save Config
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
