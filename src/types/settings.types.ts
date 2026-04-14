export interface DeliveryFeeSettings {
  baseFee: number;
  perKmRate: number;
  freeAbove: number;
  maxFee: number;
  minFee: number;
  maxDistanceKm: number;
  surgeMultiplier: number;
  platformFee: number;
  taxPercent: number;
  referralBonus: number;
  referralMilestoneBonus: number;
  updatedAt: any;
  updatedBy: string;
}

export const DEFAULT_DELIVERY_SETTINGS: Omit<DeliveryFeeSettings, 'updatedAt' | 'updatedBy'> = {
  baseFee: 10,
  perKmRate: 12,
  freeAbove: 300,
  maxFee: 150,
  minFee: 10,
  maxDistanceKm: 15,
  surgeMultiplier: 1.0,
  platformFee: 5,
  taxPercent: 5,
  referralBonus: 10,
  referralMilestoneBonus: 50,
};

export interface DeliveryFeeFormData {
  baseFee: string;
  perKmRate: string;
  freeAbove: string;
  maxFee: string;
  minFee: string;
  maxDistanceKm: string;
  surgeMultiplier: string;
  platformFee: string;
  taxPercent: string;
  referralBonus: string;
  referralMilestoneBonus: string;
}
