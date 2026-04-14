import { DeliveryFeeSettings, DEFAULT_DELIVERY_SETTINGS } from '../types/settings.types';

export interface FeeCalculationResult {
  baseFee: number;
  distanceFee: number;
  surgeAmount: number;
  totalFee: number;
  isFree: boolean;
  isWithinRange: boolean;
  breakdown: string;
  freeIn: number;
}

export function calculateDeliveryFee(
  distanceKm: number,
  orderSubtotal: number,
  settings: Partial<DeliveryFeeSettings> = {}
): FeeCalculationResult {
  const s = { ...DEFAULT_DELIVERY_SETTINGS, ...settings };

  const isWithinRange = distanceKm <= s.maxDistanceKm;
  const isFree = orderSubtotal >= s.freeAbove;

  if (!isWithinRange) {
    return {
      baseFee: 0,
      distanceFee: 0,
      surgeAmount: 0,
      totalFee: 0,
      isFree: false,
      isWithinRange: false,
      breakdown: `Out of delivery range (>${s.maxDistanceKm} km)`,
      freeIn: 0,
    };
  }

  if (isFree) {
    return {
      baseFee: 0,
      distanceFee: 0,
      surgeAmount: 0,
      totalFee: 0,
      isFree: true,
      isWithinRange: true,
      breakdown: `FREE delivery (order above ₹${s.freeAbove})`,
      freeIn: 0,
    };
  }

  const distanceFee = Math.round(distanceKm * s.perKmRate);
  const rawFee = s.baseFee + distanceFee;

  const surgeAmount = s.surgeMultiplier > 1
    ? Math.round(rawFee * (s.surgeMultiplier - 1))
    : 0;
  const feeWithSurge = rawFee + surgeAmount;

  const totalFee = Math.min(
    Math.max(feeWithSurge, s.minFee),
    s.maxFee
  );

  const freeIn = Math.max(0, s.freeAbove - orderSubtotal);

  const parts: string[] = [`₹${s.baseFee} base`];
  if (distanceFee > 0) parts.push(`₹${distanceFee} (${distanceKm} km)`);
  if (surgeAmount > 0) parts.push(`₹${surgeAmount} surge`);
  const breakdown = parts.join(' + ');

  return {
    baseFee: s.baseFee,
    distanceFee,
    surgeAmount,
    totalFee,
    isFree: false,
    isWithinRange: true,
    breakdown,
    freeIn,
  };
}

export function getDeliveryFeeAmount(
  distanceKm: number,
  orderSubtotal: number,
  settings?: Partial<DeliveryFeeSettings>
): number {
  return calculateDeliveryFee(distanceKm, orderSubtotal, settings).totalFee;
}

export function formatDeliveryFee(
  distanceKm: number,
  orderSubtotal: number,
  settings?: Partial<DeliveryFeeSettings>
): string {
  const result = calculateDeliveryFee(distanceKm, orderSubtotal, settings);
  if (!result.isWithinRange) return 'Not deliverable';
  if (result.isFree) return 'FREE';
  return `₹${result.totalFee}`;
}
