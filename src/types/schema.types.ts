/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MANABITES ADMIN  –  Firestore Schema & TypeScript Types
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Collections overview:
 *
 *  /admins/{uid}
 *  /users/{uid}                    – customers, riders, restaurant owners
 *  /restaurants/{id}
 *    /menuItems/{itemId}
 *  /orders/{id}
 *  /payouts/{id}
 *  /promocodes/{id}
 *  /settings/deliveryFees
 *  /settings/referral
 *  /riderLocations/{riderId}       – live GPS; written by rider app
 *  /riderEarnings/{riderId}
 *    /history/{entryId}
 *  /restaurantEarnings/{restaurantId}
 *    /history/{entryId}
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Timestamp, FieldValue } from 'firebase/firestore';

// ── Shared ────────────────────────────────────────────────────────────────────

export type FirestoreDate = Timestamp | FieldValue | null;

// ── /admins/{uid} ─────────────────────────────────────────────────────────────

export interface AdminDoc {
  uid: string;
  email: string;
  name?: string;
  createdAt: FirestoreDate;
}

// ── /users/{uid} ─────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'restaurant' | 'rider' | 'customer';

export interface UserDoc {
  uid: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;

  // Customer-specific
  referralCode?: string;
  referredBy?: string;
  referralCount?: number;
  referralBonusEarned?: number;

  // Rider-specific
  vehicleType?: 'Bike' | 'Scooter' | 'Bicycle';
  vehicleNumber?: string;
  licenseNumber?: string;
  licenseDocUrl?: string;
  licenseApproved?: boolean;
  bankAccountNumber?: string;
  bankIFSC?: string;
  bankDocUrl?: string;
  bankApproved?: boolean;

  // Restaurant owner-specific
  restaurantId?: string;

  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// ── /restaurants/{id} ────────────────────────────────────────────────────────

export type RestaurantStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface RestaurantDoc {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  lat?: number;
  lng?: number;
  cuisineTypes: string[];
  openingTime: string;   // e.g. "09:00"
  closingTime: string;   // e.g. "22:00"
  isOpen: boolean;
  status: RestaurantStatus;
  fssaiNumber?: string;
  bankAccountNumber?: string;
  bankIFSC?: string;
  logoUrl?: string;
  rating: number;
  totalOrders: number;
  totalEarnings: number;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// ── /restaurants/{id}/menuItems/{itemId} ─────────────────────────────────────

export type MenuCategory =
  | 'Starters'
  | 'Main Course'
  | 'Breads'
  | 'Rice & Biryani'
  | 'Desserts'
  | 'Beverages'
  | 'Combos'
  | 'Snacks';

export interface MenuItemDoc {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  price: number;
  mrp?: number;
  category: MenuCategory | string;
  imageUrl?: string;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTimeMinutes?: number;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// ── /orders/{id} ─────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
}

export interface OrderDoc {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  restaurantId: string;
  restaurantName: string;
  riderId?: string;
  riderName?: string;
  status: OrderStatus;
  items: OrderItem[];
  itemTotal: number;
  deliveryFee: number;
  platformFee: number;
  tax: number;
  discount: number;
  promoCode?: string;
  totalAmount: number;
  deliveryAddress: string;
  deliveryLat?: number;
  deliveryLng?: number;
  paymentMethod: 'cod' | 'online' | 'wallet';
  paymentStatus: 'pending' | 'paid' | 'refunded';
  estimatedDeliveryMinutes?: number;
  cancelReason?: string;
  createdAt: FirestoreDate;
  acceptedAt?: FirestoreDate;
  pickedUpAt?: FirestoreDate;
  deliveredAt?: FirestoreDate;
  cancelledAt?: FirestoreDate;
}

// ── /payouts/{id} ────────────────────────────────────────────────────────────

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';
export type PayoutEntityType = 'restaurant' | 'rider';

export interface PayoutDoc {
  id: string;
  entityId: string;
  entityName: string;
  entityType: PayoutEntityType;
  amount: number;
  status: PayoutStatus;
  periodStart: FirestoreDate;
  periodEnd: FirestoreDate;
  transactionId?: string;
  razorpayPayoutId?: string;
  paidAt?: FirestoreDate;
  createdAt: FirestoreDate;
}

// ── /promocodes/{id} ─────────────────────────────────────────────────────────

export type DiscountType = 'percentage' | 'flat';

export interface PromoCodeDoc {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderValue: number;
  maxDiscount?: number;
  isActive: boolean;
  usageCount: number;
  maxUsage?: number;
  validFrom?: FirestoreDate;
  validUntil?: FirestoreDate;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// ── /settings/deliveryFees ────────────────────────────────────────────────────

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
  updatedAt: FirestoreDate;
  updatedBy: string;
}

// ── /settings/referral ────────────────────────────────────────────────────────

export interface ReferralSettings {
  perReferralBonus: number;        // e.g. 10 (₹10 per referral)
  milestoneReferrals: number;      // e.g. 5 (after 5 referrals)
  milestoneBonus: number;          // e.g. 50 (₹50 extra)
  maxBonusPerUser: number;
  isActive: boolean;
  updatedAt: FirestoreDate;
  updatedBy: string;
}

// ── /riderLocations/{riderId} ─────────────────────────────────────────────────

export interface RiderLocationDoc {
  riderId: string;
  riderName: string;
  lat: number;
  lng: number;
  heading?: number;       // degrees
  speed?: number;         // km/h
  isOnline: boolean;
  currentOrderId?: string;
  updatedAt: FirestoreDate;
}

// ── /riderEarnings/{riderId} ──────────────────────────────────────────────────

export interface RiderEarningsDoc {
  riderId: string;
  totalEarnings: number;
  totalDeliveries: number;
  pendingPayout: number;
  updatedAt: FirestoreDate;
}

export interface RiderEarningEntry {
  id: string;
  orderId: string;
  restaurantName: string;
  customerName: string;
  deliveryFeeEarned: number;   // rider's cut
  distance: number;             // km
  createdAt: FirestoreDate;
}

// ── /restaurantEarnings/{restaurantId} ───────────────────────────────────────

export interface RestaurantEarningsDoc {
  restaurantId: string;
  totalEarnings: number;
  totalOrders: number;
  pendingPayout: number;
  updatedAt: FirestoreDate;
}
