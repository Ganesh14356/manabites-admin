import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  DollarSign as FiDollarSign,
  Navigation as FiNavigation,
  Gift as FiGift,
  Shield as FiShield,
  AlertTriangle as FiAlertTriangle,
  CheckCircle as FiCheckCircle,
  Info as FiInfo,
  Save as FiSave,
  RefreshCw as FiRefreshCw,
  TrendingUp as FiTrendingUp,
  Clock as FiClock,
} from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { useDeliverySettings } from '../../hooks/useDeliverySettings';
import { calculateDeliveryFee } from '../../services/deliveryFeeCalculator';
import { DeliveryFeeFormData } from '../../types/settings.types';

const schema = z.object({
  baseFee: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more')
    .refine(v => Number(v) <= 100, 'Base fee seems too high (max ₹100)'),

  perKmRate: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more')
    .refine(v => Number(v) <= 50, 'Per-km rate seems too high (max ₹50)'),

  freeAbove: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more')
    .refine(v => Number(v) <= 10000, 'Threshold too high'),

  maxFee: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) > 0, 'Must be greater than 0'),

  minFee: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more'),

  maxDistanceKm: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) > 0, 'Must be greater than 0')
    .refine(v => Number(v) <= 50, 'Max 50 km'),

  surgeMultiplier: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 1, 'Must be 1.0 or more')
    .refine(v => Number(v) <= 3, 'Max 3.0x surge'),

  platformFee: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more'),

  taxPercent: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more')
    .refine(v => Number(v) <= 100, 'Max 100%'),

  referralBonus: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more'),

  referralMilestoneBonus: z.string()
    .refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more'),
});

const PREVIEW_DISTANCES = [1, 3, 5, 8, 12, 15];
const PREVIEW_SUBTOTALS = [100, 200, 300, 500];

export default function DeliveryFeeSettings() {
  const { user } = useAuth();
  const {
    settings, loading, saving, error,
    lastSaved, saveSettings, clearError,
  } = useDeliverySettings();

  const [previewDist, setPreviewDist] = useState(3);
  const [previewSubtotal, setPreviewSubtotal] = useState(200);
  const [showPreview, setShowPreview] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<DeliveryFeeFormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (settings) {
      reset({
        baseFee: (settings.baseFee ?? 10).toString(),
        perKmRate: (settings.perKmRate ?? 12).toString(),
        freeAbove: (settings.freeAbove ?? 300).toString(),
        maxFee: (settings.maxFee ?? 150).toString(),
        minFee: (settings.minFee ?? 10).toString(),
        maxDistanceKm: (settings.maxDistanceKm ?? 15).toString(),
        surgeMultiplier: (settings.surgeMultiplier ?? 1).toString(),
        platformFee: (settings.platformFee ?? 5).toString(),
        taxPercent: (settings.taxPercent ?? 5).toString(),
        referralBonus: (settings.referralBonus ?? 10).toString(),
        referralMilestoneBonus: (settings.referralMilestoneBonus ?? 50).toString(),
      });
    }
  }, [settings, reset]);

  const watchedValues = watch();
  const previewSettings = {
    baseFee: Number(watchedValues.baseFee) || 0,
    perKmRate: Number(watchedValues.perKmRate) || 0,
    freeAbove: Number(watchedValues.freeAbove) || 300,
    maxFee: Number(watchedValues.maxFee) || 150,
    minFee: Number(watchedValues.minFee) || 10,
    maxDistanceKm: Number(watchedValues.maxDistanceKm) || 15,
    surgeMultiplier: Number(watchedValues.surgeMultiplier) || 1,
  };

  const onSubmit = async (data: DeliveryFeeFormData) => {
    if (!user) return;
    const ok = await saveSettings(
      {
        baseFee: Number(data.baseFee),
        perKmRate: Number(data.perKmRate),
        freeAbove: Number(data.freeAbove),
        maxFee: Number(data.maxFee),
        minFee: Number(data.minFee),
        maxDistanceKm: Number(data.maxDistanceKm),
        surgeMultiplier: Number(data.surgeMultiplier),
        platformFee: Number(data.platformFee),
        taxPercent: Number(data.taxPercent),
        referralBonus: Number(data.referralBonus),
        referralMilestoneBonus: Number(data.referralMilestoneBonus),
      },
      user.uid
    );
    if (ok) {
      toast.success('✅ Delivery settings saved successfully!');
      reset(data);
    } else {
      toast.error('❌ Failed to save settings. Please try again.');
    }
  };

  const previewFee = calculateDeliveryFee(previewDist, previewSubtotal, previewSettings);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="h-8 w-64 bg-gray-200 rounded-xl animate-pulse" />
        <div className="bg-white rounded-2xl p-6 space-y-4 shadow-card">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-1/3 bg-gray-100 rounded animate-pulse" />
              <div className="h-10 flex-1 bg-gray-100 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            🛵 Delivery Fee Settings
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure pricing shown to customers at checkout
          </p>
          {lastSaved && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <FiClock className="w-3 h-3" />
              Last saved {formatDistanceToNow(lastSaved, { addSuffix: true })}
            </p>
          )}
        </div>

        <AnimatePresence>
          {isDirty && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 flex items-center gap-2"
            >
              <FiAlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-xs font-semibold text-yellow-700">Unsaved changes</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <FiAlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
            <button onClick={clearError} className="text-red-400 hover:text-red-600 text-sm ml-4">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-white rounded-2xl shadow-card p-5"
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center">
                  <FiDollarSign className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm">Core Pricing</h2>
                  <p className="text-xs text-gray-400">Base charges applied to every delivery</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Base Fee (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      {...register('baseFee')}
                      className={`input-field pl-8 ${errors.baseFee ? 'border-red-400' : ''}`}
                      placeholder="10"
                    />
                  </div>
                  {errors.baseFee && (
                    <p className="text-red-500 text-xs mt-1">{errors.baseFee?.message}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-1">
                    Flat charge added to every order regardless of distance
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Per-km Rate (₹/km)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      {...register('perKmRate')}
                      className={`input-field pl-8 ${errors.perKmRate ? 'border-red-400' : ''}`}
                      placeholder="12"
                    />
                  </div>
                  {errors.perKmRate && (
                    <p className="text-red-500 text-xs mt-1">{errors.perKmRate?.message}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-1">
                    Charged per km of actual road distance (via OpenRouteService)
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl shadow-card p-5"
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
                  <FiShield className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm">Limits & Thresholds</h2>
                  <p className="text-xs text-gray-400">Caps and constraints on delivery charges</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Minimum Fee (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register('minFee')}
                      className={`input-field pl-8 ${errors.minFee ? 'border-red-400' : ''}`}
                      placeholder="10"
                    />
                  </div>
                  {errors.minFee && <p className="text-red-500 text-xs mt-1">{errors.minFee?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Minimum fee even for very short distances</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Maximum Fee Cap (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register('maxFee')}
                      className={`input-field pl-8 ${errors.maxFee ? 'border-red-400' : ''}`}
                      placeholder="150"
                    />
                  </div>
                  {errors.maxFee && <p className="text-red-500 text-xs mt-1">{errors.maxFee?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Fee never exceeds this amount regardless of distance</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Max Delivery Distance (km)
                  </label>
                  <div className="relative">
                    <FiNavigation className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="50"
                      {...register('maxDistanceKm')}
                      className={`input-field pl-10 ${errors.maxDistanceKm ? 'border-red-400' : ''}`}
                      placeholder="15"
                    />
                  </div>
                  {errors.maxDistanceKm && <p className="text-red-500 text-xs mt-1">{errors.maxDistanceKm?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Orders beyond this distance are declined</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Surge Multiplier
                    <span className="ml-2 bg-orange-100 text-orange-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                      PEAK HOURS
                    </span>
                  </label>
                  <div className="relative">
                    <FiTrendingUp className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="3"
                      {...register('surgeMultiplier')}
                      className={`input-field pl-10 ${errors.surgeMultiplier ? 'border-red-400' : ''}`}
                      placeholder="1.0"
                    />
                  </div>
                  {errors.surgeMultiplier && <p className="text-red-500 text-xs mt-1">{errors.surgeMultiplier?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">1.0 = normal · 1.5 = 50% extra · 2.0 = double</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-white rounded-2xl shadow-card p-5"
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 bg-purple-100 rounded-xl flex items-center justify-center">
                  <FiGift className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm">Free Delivery Threshold</h2>
                  <p className="text-xs text-gray-400">Encourage larger orders</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Free Delivery Above (₹)
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                  <input
                    type="number"
                    step="10"
                    min="0"
                    {...register('freeAbove')}
                    className={`input-field pl-8 ${errors.freeAbove ? 'border-red-400' : ''}`}
                    placeholder="300"
                  />
                </div>
                {errors.freeAbove && <p className="text-red-500 text-xs mt-1">{errors.freeAbove?.message}</p>}
                <p className="text-gray-400 text-xs mt-1">
                  Orders above this amount get free delivery (shown in cart as progress bar)
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="bg-white rounded-2xl shadow-card p-5"
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
                  <FiDollarSign className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm">Platform Fees & Taxes</h2>
                  <p className="text-xs text-gray-400">Additional charges on orders</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Platform Fee (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register('platformFee')}
                      className={`input-field pl-8 ${errors.platformFee ? 'border-red-400' : ''}`}
                      placeholder="5"
                    />
                  </div>
                  {errors.platformFee && <p className="text-red-500 text-xs mt-1">{errors.platformFee?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Flat fee charged to customers</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Tax (%)
                  </label>
                  <div className="relative">
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      {...register('taxPercent')}
                      className={`input-field pr-8 ${errors.taxPercent ? 'border-red-400' : ''}`}
                      placeholder="5"
                    />
                  </div>
                  {errors.taxPercent && <p className="text-red-500 text-xs mt-1">{errors.taxPercent?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">GST applied to order total</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.19 }}
              className="bg-white rounded-2xl shadow-card p-5"
            >
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 bg-pink-100 rounded-xl flex items-center justify-center">
                  <FiGift className="w-4 h-4 text-pink-600" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm">Referral Program</h2>
                  <p className="text-xs text-gray-400">Manage customer referral bonuses</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Per Referral Bonus (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register('referralBonus')}
                      className={`input-field pl-8 ${errors.referralBonus ? 'border-red-400' : ''}`}
                      placeholder="10"
                    />
                  </div>
                  {errors.referralBonus && <p className="text-red-500 text-xs mt-1">{errors.referralBonus?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Reward for each successful referral</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Milestone Bonus (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register('referralMilestoneBonus')}
                      className={`input-field pl-8 ${errors.referralMilestoneBonus ? 'border-red-400' : ''}`}
                      placeholder="50"
                    />
                  </div>
                  {errors.referralMilestoneBonus && <p className="text-red-500 text-xs mt-1">{errors.referralMilestoneBonus?.message}</p>}
                  <p className="text-gray-400 text-xs mt-1">Extra bonus after 5 referrals</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-3"
            >
              <motion.button
                type="submit"
                disabled={saving || !isDirty}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 bg-brand text-white font-bold
                           px-6 py-3 rounded-2xl shadow-card hover:bg-brand-dark
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-200"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <><FiSave className="w-4 h-4" /> Save Settings</>
                )}
              </motion.button>

              {isDirty && (
                <button
                  type="button"
                  onClick={() => settings && reset({
                    baseFee: settings.baseFee.toString(),
                    perKmRate: settings.perKmRate.toString(),
                    freeAbove: settings.freeAbove.toString(),
                    maxFee: settings.maxFee.toString(),
                    minFee: settings.minFee.toString(),
                    maxDistanceKm: settings.maxDistanceKm.toString(),
                    surgeMultiplier: settings.surgeMultiplier.toString(),
                  })}
                  className="flex items-center gap-2 text-gray-500 hover:text-gray-700
                             font-semibold text-sm transition-colors"
                >
                  <FiRefreshCw className="w-4 h-4" /> Discard changes
                </button>
              )}
            </motion.div>
          </form>
        </div>

        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl shadow-card p-5 sticky top-4"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                🧮 Live Preview
              </h3>
              <button
                onClick={() => setShowPreview(p => !p)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {showPreview ? 'Hide' : 'Show'}
              </button>
            </div>

            <AnimatePresence>
              {showPreview && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="text-xs text-gray-500 font-semibold block mb-1">
                        Distance: <span className="text-brand font-bold">{previewDist} km</span>
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="15"
                        step="0.5"
                        value={previewDist}
                        onChange={e => setPreviewDist(Number(e.target.value))}
                        className="w-full accent-brand"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-semibold block mb-1">
                        Order total: <span className="text-brand font-bold">₹{previewSubtotal}</span>
                      </label>
                      <input
                        type="range"
                        min="50"
                        max="600"
                        step="10"
                        value={previewSubtotal}
                        onChange={e => setPreviewSubtotal(Number(e.target.value))}
                        className="w-full accent-brand"
                      />
                    </div>
                  </div>

                  <div className={`rounded-xl p-4 mb-4 ${
                    !previewFee.isWithinRange ? 'bg-red-50 border border-red-200' :
                    previewFee.isFree ? 'bg-green-50 border border-green-200' :
                    'bg-blue-50 border border-blue-200'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">Delivery Fee</span>
                      <motion.span
                        key={previewFee.totalFee}
                        initial={{ scale: 1.2 }}
                        animate={{ scale: 1 }}
                        className={`text-xl font-black ${
                          !previewFee.isWithinRange ? 'text-red-600' :
                          previewFee.isFree ? 'text-green-600' :
                          'text-blue-700'
                        }`}
                      >
                        {!previewFee.isWithinRange ? '❌ Out of range' :
                         previewFee.isFree ? 'FREE 🎉' :
                         `₹${previewFee.totalFee}`}
                      </motion.span>
                    </div>
                    <p className="text-xs text-gray-500">{previewFee.breakdown}</p>
                    {!previewFee.isFree && previewFee.freeIn > 0 && previewFee.isWithinRange && (
                      <p className="text-xs text-green-600 mt-1.5 font-medium">
                        🚀 Add ₹{previewFee.freeIn} more for free delivery
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                      Fee Table — ₹{previewSubtotal} order
                    </p>
                    <div className="space-y-1">
                      {PREVIEW_DISTANCES.map(dist => {
                        const f = calculateDeliveryFee(dist, previewSubtotal, previewSettings);
                        return (
                          <div
                            key={dist}
                            onClick={() => setPreviewDist(dist)}
                            className={`flex justify-between text-xs px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                              previewDist === dist
                                ? 'bg-brand text-white font-bold'
                                : 'hover:bg-gray-50 text-gray-600'
                            }`}
                          >
                            <span>{dist} km</span>
                            <span className="font-semibold">
                              {!f.isWithinRange ? '—' : f.isFree ? 'FREE' : `₹${f.totalFee}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-blue-50 border border-blue-200 rounded-2xl p-4"
          >
            <div className="flex gap-2">
              <FiInfo className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-blue-800 mb-1">Customer App Integration</p>
                <p className="text-xs text-blue-700 leading-relaxed">
                  These settings are read by the customer app in real-time.
                  Changes take effect immediately on the next order.
                </p>
                <code className="block mt-2 text-[10px] bg-blue-100 text-blue-800 px-2 py-1.5 rounded-lg font-mono">
                  fetchDeliverySettings()
                </code>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
