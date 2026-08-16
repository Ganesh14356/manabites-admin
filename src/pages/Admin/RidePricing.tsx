import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Bike, Car, Package, IndianRupee, Zap, Save,
  TrendingUp, ToggleLeft, ToggleRight, Info,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VehiclePricing {
  baseFare: number;
  perKm: number;
  perMin: number;
  surgeMultiplier: number;
  enabled: boolean;
}

interface RidePricingDoc {
  bike: VehiclePricing;
  auto: VehiclePricing;
  cab: VehiclePricing;
  parcel: VehiclePricing;
  updatedAt?: any;
  updatedBy?: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: RidePricingDoc = {
  bike:   { baseFare: 30, perKm: 12, perMin: 0.5, surgeMultiplier: 1.0, enabled: true },
  auto:   { baseFare: 40, perKm: 14, perMin: 0.8, surgeMultiplier: 1.0, enabled: true },
  cab:    { baseFare: 60, perKm: 18, perMin: 1.2, surgeMultiplier: 1.0, enabled: true },
  parcel: { baseFare: 35, perKm: 10, perMin: 0,   surgeMultiplier: 1.0, enabled: true },
};

type VehicleKey = 'bike' | 'auto' | 'cab' | 'parcel';

const VEHICLES: { key: VehicleKey; label: string; emoji: string; icon: React.ReactNode; accent: string; bg: string }[] = [
  { key: 'bike',   label: 'Bike Taxi', emoji: '🛵', icon: <Bike className="w-5 h-5" />,    accent: 'text-red-600',    bg: 'bg-red-50 border-red-200'    },
  { key: 'auto',   label: 'Auto',      emoji: '🛺', icon: <Zap className="w-5 h-5" />,      accent: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200' },
  { key: 'cab',    label: 'Cab',       emoji: '🚗', icon: <Car className="w-5 h-5" />,      accent: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200'   },
  { key: 'parcel', label: 'Parcel',    emoji: '📦', icon: <Package className="w-5 h-5" />,  accent: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function RidePricing() {
  const { user } = useAuth();
  const [pricing, setPricing] = useState<RidePricingDoc>(DEFAULTS);
  const [draft, setDraft] = useState<RidePricingDoc>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  // Live Firestore listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'ridePricing'), snap => {
      if (snap.exists()) {
        const data = { ...DEFAULTS, ...snap.data() } as RidePricingDoc;
        // merge nested vehicle objects to preserve defaults for missing fields
        (Object.keys(DEFAULTS) as VehicleKey[]).forEach(k => {
          data[k] = { ...DEFAULTS[k], ...(snap.data()![k] || {}) } as VehiclePricing;
        });
        setPricing(data);
        setDraft(data);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const updateField = (vehicle: VehicleKey, field: keyof VehiclePricing, raw: string | boolean) => {
    const value = typeof raw === 'boolean' ? raw : (raw === '' ? 0 : parseFloat(raw) || 0);
    setDraft(prev => ({ ...prev, [vehicle]: { ...prev[vehicle], [field]: value } }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'ridePricing'), {
        ...draft,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || 'unknown',
      });
      setPricing(draft);
      setDirty(false);
      toast.success('Ride pricing saved!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save. Check Firestore permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(pricing);
    setDirty(false);
  };

  const exampleFare = (v: VehiclePricing, km = 5) =>
    Math.ceil((v.baseFare + v.perKm * km + v.perMin * 2) * v.surgeMultiplier);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <IndianRupee className="w-6 h-6 text-brand" />
            Ride Pricing
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Set base fare, per-km rate, and surge for each vehicle type
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-5 py-2 bg-brand text-white text-sm font-semibold rounded-xl hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Fare = (<strong>Base</strong> + <strong>Per-km × distance</strong> + <strong>Per-min × wait</strong>) × <strong>Surge</strong>.
          Changes apply live to the customer app immediately.
        </span>
      </div>

      {/* Vehicle cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {VEHICLES.map(v => {
          const d = draft[v.key];
          return (
            <motion.div
              key={v.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`border-2 rounded-2xl p-5 space-y-4 transition-all ${d.enabled ? v.bg : 'bg-gray-50 border-gray-200 opacity-60'}`}
            >
              {/* Card header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{v.emoji}</span>
                  <div>
                    <p className={`font-black text-lg ${v.accent}`}>{v.label}</p>
                    <p className="text-xs text-gray-400">
                      Example fare (5 km): <strong className="text-gray-700">₹{exampleFare(d)}</strong>
                    </p>
                  </div>
                </div>
                {/* Enable/disable toggle */}
                <button
                  onClick={() => updateField(v.key, 'enabled', !d.enabled)}
                  className="flex items-center gap-1.5 text-sm font-semibold"
                >
                  {d.enabled
                    ? <ToggleRight className={`w-7 h-7 ${v.accent}`} />
                    : <ToggleLeft className="w-7 h-7 text-gray-400" />}
                  <span className={d.enabled ? v.accent : 'text-gray-400'}>
                    {d.enabled ? 'Active' : 'Off'}
                  </span>
                </button>
              </div>

              {/* Price fields */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Base Fare (₹)"
                  value={d.baseFare}
                  onChange={val => updateField(v.key, 'baseFare', val)}
                  min={0}
                  step={5}
                />
                <Field
                  label="Per Km (₹)"
                  value={d.perKm}
                  onChange={val => updateField(v.key, 'perKm', val)}
                  min={0}
                  step={1}
                />
                <Field
                  label="Per Min (₹)"
                  value={d.perMin}
                  onChange={val => updateField(v.key, 'perMin', val)}
                  min={0}
                  step={0.5}
                />
                <Field
                  label="Surge ×"
                  value={d.surgeMultiplier}
                  onChange={val => updateField(v.key, 'surgeMultiplier', val)}
                  min={1}
                  max={5}
                  step={0.1}
                  highlight={d.surgeMultiplier > 1}
                />
              </div>

              {/* Fare preview bar */}
              <FarePreview vehicle={d} accent={v.accent} />
            </motion.div>
          );
        })}
      </div>

      {/* Summary table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          <span className="font-bold text-gray-700 text-sm">Fare Preview by Distance</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Vehicle</th>
                {[2, 5, 10, 15].map(km => (
                  <th key={km} className="px-4 py-3 text-right font-semibold">{km} km</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {VEHICLES.map(v => {
                const d = draft[v.key];
                return (
                  <tr key={v.key} className={!d.enabled ? 'opacity-40' : ''}>
                    <td className="px-4 py-3 font-semibold flex items-center gap-2">
                      <span>{v.emoji}</span>
                      <span>{v.label}</span>
                      {!d.enabled && <span className="text-xs text-gray-400">(off)</span>}
                    </td>
                    {[2, 5, 10, 15].map(km => (
                      <td key={km} className="px-4 py-3 text-right font-bold text-gray-800 tabular-nums">
                        ₹{exampleFare(d, km)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, min = 0, max, step = 1, highlight = false,
}: {
  label: string;
  value: number;
  onChange: (val: string) => void;
  min?: number;
  max?: number;
  step?: number;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-500">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm font-bold rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand transition ${
          highlight
            ? 'border-orange-300 bg-orange-50 text-orange-700'
            : 'border-gray-200 bg-white text-gray-900'
        }`}
      />
    </div>
  );
}

function FarePreview({ vehicle, accent }: { vehicle: VehiclePricing; accent: string }) {
  const distances = [2, 5, 10];
  const fares = distances.map(km =>
    Math.ceil((vehicle.baseFare + vehicle.perKm * km + vehicle.perMin * 2) * vehicle.surgeMultiplier)
  );
  const max = Math.max(...fares);
  return (
    <div className="space-y-1.5 pt-1">
      {distances.map((km, i) => (
        <div key={km} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8 text-right">{km}km</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${accent.replace('text-', 'bg-')}`}
              style={{ width: `${(fares[i] / max) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-gray-700 w-12 text-right tabular-nums">₹{fares[i]}</span>
        </div>
      ))}
    </div>
  );
}
