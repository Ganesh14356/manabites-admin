import { useState, useEffect, useCallback } from 'react';
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { DeliveryFeeSettings, DEFAULT_DELIVERY_SETTINGS } from '../types/settings.types';

const SETTINGS_DOC_REF = () => doc(db, 'settings', 'deliveryFees');

export function useDeliverySettings() {
  const [settings, setSettings] = useState<DeliveryFeeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      SETTINGS_DOC_REF(),
      (snap) => {
        if (snap.exists()) {
          setSettings(snap.data() as DeliveryFeeSettings);
        } else {
          setSettings({
            ...DEFAULT_DELIVERY_SETTINGS,
            updatedAt: null,
            updatedBy: '',
          });
        }
        setLoading(false);
      },
      (err) => {
        console.error('Settings fetch error:', err);
        setError('Failed to load settings. ' + err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const saveSettings = useCallback(async (
    newSettings: Omit<DeliveryFeeSettings, 'updatedAt' | 'updatedBy'>,
    adminUid: string
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      if (newSettings.baseFee < 0) throw new Error('Base fee cannot be negative');
      if (newSettings.perKmRate < 0) throw new Error('Per-km rate cannot be negative');
      if (newSettings.freeAbove < 0) throw new Error('Free delivery threshold cannot be negative');
      if (newSettings.maxFee < newSettings.minFee) throw new Error('Max fee must be ≥ min fee');
      if (newSettings.maxDistanceKm <= 0) throw new Error('Max distance must be positive');
      if (newSettings.surgeMultiplier < 1) throw new Error('Surge multiplier must be ≥ 1.0');

      await setDoc(
        SETTINGS_DOC_REF(),
        {
          ...newSettings,
          updatedAt: serverTimestamp(),
          updatedBy: adminUid,
        },
        { merge: true }
      );

      setLastSaved(new Date());
      setSaving(false);
      return true;

    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
      setSaving(false);
      return false;
    }
  }, []);

  return {
    settings,
    loading,
    saving,
    error,
    lastSaved,
    saveSettings,
    clearError: () => setError(null),
  };
}

export async function fetchDeliverySettings(): Promise<DeliveryFeeSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'deliveryFees'));
    if (snap.exists()) return snap.data() as DeliveryFeeSettings;
    return { ...DEFAULT_DELIVERY_SETTINGS, updatedAt: null, updatedBy: '' };
  } catch {
    return { ...DEFAULT_DELIVERY_SETTINGS, updatedAt: null, updatedBy: '' };
  }
}
