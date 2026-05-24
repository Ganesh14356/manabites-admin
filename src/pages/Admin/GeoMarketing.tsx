import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, addDoc, getDocs, onSnapshot, query,
  orderBy, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  MapPin, Zap, Users, Gift, Send, Clock, Tag, Search,
  CheckCircle, X, AlertTriangle, TrendingDown, Bell,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PromoCodeDoc {
  id: string;
  code: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  minOrder: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: Timestamp;
}

interface GeoNotifJob {
  id: string;
  title: string;
  message: string;
  lat: number;
  lng: number;
  radiusKm: number;
  promoCode?: string;
  sentCount: number;
  createdAt: Timestamp;
}

interface InactivePromoJob {
  id: string;
  title: string;
  message: string;
  promoCode: string;
  inactiveDays: number;
  sentCount: number;
  createdAt: Timestamp;
}

interface InactiveUser {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  lastOrderAt?: Timestamp;
  daysSinceOrder: number;
}

// haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GeoMarketing() {
  const [activeTab, setActiveTab] = useState<'inactive' | 'geo'>('inactive');

  // ── Inactive user promo tab ──
  const [inactiveDays, setInactiveDays] = useState(14);
  const [inactiveUsers, setInactiveUsers] = useState<InactiveUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [scanned, setScanned] = useState(false);

  const [promoCodes, setPromoCodes] = useState<PromoCodeDoc[]>([]);
  const [selectedPromo, setSelectedPromo] = useState('');
  const [inactiveTitle, setInactiveTitle] = useState("We miss you! Come back for a treat 🎁");
  const [inactiveMsg, setInactiveMsg] = useState("It's been a while! Use code {CODE} for 20% off your next order. Valid 3 days.");
  const [sendingInactive, setSendingInactive] = useState(false);
  const [inactiveJobs, setInactiveJobs] = useState<InactivePromoJob[]>([]);

  // ── Geo notification tab ──
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [geoRadius, setGeoRadius] = useState(5);
  const [geoTitle, setGeoTitle] = useState('');
  const [geoMsg, setGeoMsg] = useState('');
  const [geoPromo, setGeoPromo] = useState('');
  const [sendingGeo, setSendingGeo] = useState(false);
  const [geoJobs, setGeoJobs] = useState<GeoNotifJob[]>([]);

  // Load promo codes
  useEffect(() => {
    getDocs(collection(db, 'promoCodes')).then(snap => {
      setPromoCodes(snap.docs.map(d => ({ id: d.id, ...d.data() } as PromoCodeDoc)));
    });
  }, []);

  // Load inactive promo jobs
  useEffect(() => {
    const q = query(collection(db, 'inactivePromoJobs'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, snap => {
      setInactiveJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as InactivePromoJob)));
    });
    return () => unsub();
  }, []);

  // Load geo notification jobs
  useEffect(() => {
    const q = query(collection(db, 'geoNotifJobs'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, snap => {
      setGeoJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as GeoNotifJob)));
    });
    return () => unsub();
  }, []);

  async function scanInactiveUsers() {
    setLoadingUsers(true);
    setScanned(false);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - inactiveDays);
      const snap = await getDocs(query(collection(db, 'users')));
      const users: InactiveUser[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const lastOrder: Timestamp | undefined = data.lastOrderAt;
        if (!lastOrder) return;
        const lastDate = lastOrder.toDate();
        const days = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
        if (days >= inactiveDays) {
          users.push({ id: d.id, name: data.name, email: data.email, phone: data.phone, lastOrderAt: lastOrder, daysSinceOrder: days });
        }
      });
      users.sort((a, b) => b.daysSinceOrder - a.daysSinceOrder);
      setInactiveUsers(users);
      setScanned(true);
    } catch (e: any) {
      toast.error('Scan failed: ' + e.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function sendInactivePromo() {
    if (!selectedPromo) { toast.error('Select a promo code first'); return; }
    if (!inactiveTitle.trim() || !inactiveMsg.trim()) { toast.error('Fill in title and message'); return; }
    if (inactiveUsers.length === 0) { toast.error('Scan for inactive users first'); return; }
    setSendingInactive(true);
    try {
      const promo = promoCodes.find(p => p.code === selectedPromo);
      const finalMsg = inactiveMsg.replace('{CODE}', selectedPromo);

      // Write notifications for each user (the customer app reads userNotifications/{uid})
      const batch: Promise<any>[] = inactiveUsers.map(u =>
        addDoc(collection(db, 'userNotifications'), {
          userId: u.id,
          title: inactiveTitle,
          message: finalMsg,
          type: 'promo',
          promoCode: selectedPromo,
          read: false,
          createdAt: serverTimestamp(),
        })
      );
      await Promise.all(batch);

      await addDoc(collection(db, 'inactivePromoJobs'), {
        title: inactiveTitle,
        message: finalMsg,
        promoCode: selectedPromo,
        inactiveDays,
        sentCount: inactiveUsers.length,
        createdAt: serverTimestamp(),
      });

      toast.success(`Promo sent to ${inactiveUsers.length} inactive users`);
      setInactiveUsers([]);
      setScanned(false);
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSendingInactive(false);
    }
  }

  async function sendGeoNotification() {
    const lat = parseFloat(geoLat);
    const lng = parseFloat(geoLng);
    if (isNaN(lat) || isNaN(lng)) { toast.error('Enter valid lat/lng coordinates'); return; }
    if (!geoTitle.trim() || !geoMsg.trim()) { toast.error('Fill in title and message'); return; }
    setSendingGeo(true);
    try {
      // Fetch users with known location
      const snap = await getDocs(query(collection(db, 'users')));
      const nearby: string[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.lat && data.lng) {
          const dist = haversineKm(lat, lng, data.lat, data.lng);
          if (dist <= geoRadius) nearby.push(d.id);
        }
      });

      if (nearby.length === 0) {
        toast.error('No users found within the specified radius');
        setSendingGeo(false);
        return;
      }

      // Write notifications
      const batch = nearby.map(uid =>
        addDoc(collection(db, 'userNotifications'), {
          userId: uid,
          title: geoTitle,
          message: geoMsg + (geoPromo ? `\nCode: ${geoPromo}` : ''),
          type: 'geo_promo',
          promoCode: geoPromo || null,
          read: false,
          createdAt: serverTimestamp(),
        })
      );
      await Promise.all(batch);

      await addDoc(collection(db, 'geoNotifJobs'), {
        title: geoTitle,
        message: geoMsg,
        lat,
        lng,
        radiusKm: geoRadius,
        promoCode: geoPromo || null,
        sentCount: nearby.length,
        createdAt: serverTimestamp(),
      });

      toast.success(`Notification sent to ${nearby.length} users within ${geoRadius}km`);
      setGeoTitle('');
      setGeoMsg('');
      setGeoPromo('');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSendingGeo(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeoLat(pos.coords.latitude.toFixed(6));
        setGeoLng(pos.coords.longitude.toFixed(6));
        toast.success('Location set');
      },
      () => toast.error('Could not get location'),
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Zap className="w-7 h-7 text-brand" />
          Geo-Targeted Marketing
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Re-engage inactive customers and broadcast location-specific promotions
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {[
          { key: 'inactive', label: '⏰ Inactive Users', icon: TrendingDown },
          { key: 'geo',      label: '📍 Geo Broadcast', icon: MapPin },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === t.key
                ? 'bg-white dark:bg-gray-900 text-brand shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Inactive User Promo ── */}
        {activeTab === 'inactive' && (
          <motion.div
            key="inactive"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Config panel */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h2 className="font-black text-gray-800 dark:text-gray-100">Re-engage Inactive Users</h2>
                  <p className="text-xs text-gray-400">Find customers who haven't ordered in N days and send them a promo</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                    Inactive for at least
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={inactiveDays}
                      onChange={e => setInactiveDays(parseInt(e.target.value) || 14)}
                      min={1}
                      max={365}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                    <span className="text-gray-400 text-sm font-medium flex-shrink-0">days</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Promo Code to Attach</label>
                  <select
                    value={selectedPromo}
                    onChange={e => setSelectedPromo(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">— Select a code —</option>
                    {promoCodes.map(p => (
                      <option key={p.id} value={p.code}>{p.code} ({p.discountType === 'percent' ? `${p.discountValue}% off` : `₹${p.discountValue} off`})</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={scanInactiveUsers}
                  disabled={loadingUsers}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 disabled:opacity-60 transition-colors"
                >
                  {loadingUsers ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Scan Users
                </button>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Notification Title</label>
                <input
                  type="text"
                  value={inactiveTitle}
                  onChange={e => setInactiveTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Message <span className="text-gray-400 font-normal normal-case">(use {'{CODE}'} for the promo code)</span>
                </label>
                <textarea
                  value={inactiveMsg}
                  onChange={e => setInactiveMsg(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
                />
              </div>
            </div>

            {/* Scan results */}
            {scanned && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-gray-800 dark:text-gray-100">
                      {inactiveUsers.length} inactive users found
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">Last ordered {inactiveDays}+ days ago</p>
                  </div>
                  {inactiveUsers.length > 0 && (
                    <button
                      onClick={sendInactivePromo}
                      disabled={sendingInactive}
                      className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-60 transition-colors"
                    >
                      {sendingInactive ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Send to All {inactiveUsers.length}
                    </button>
                  )}
                </div>

                {inactiveUsers.length > 0 ? (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                        <tr>
                          <th className="table-header">Name</th>
                          <th className="table-header">Contact</th>
                          <th className="table-header">Last Order</th>
                          <th className="table-header">Days Inactive</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inactiveUsers.map(u => (
                          <tr key={u.id} className="border-b border-gray-50 dark:border-gray-800">
                            <td className="table-cell font-semibold text-gray-800 dark:text-gray-100">{u.name || '—'}</td>
                            <td className="table-cell text-gray-500">{u.email || u.phone || '—'}</td>
                            <td className="table-cell text-gray-400">{formatDate(u.lastOrderAt)}</td>
                            <td className="table-cell">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${u.daysSinceOrder > 30 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                {u.daysSinceOrder}d
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-2" />
                    <p className="text-gray-400 font-semibold">No inactive users found!</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Job history */}
            {inactiveJobs.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                  <h3 className="font-black text-gray-800 dark:text-gray-100">Past Campaigns</h3>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {inactiveJobs.map(j => (
                    <div key={j.id} className="px-5 py-3 flex items-center gap-4">
                      <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Gift className="w-4 h-4 text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{j.title}</p>
                        <p className="text-xs text-gray-400">Code: <strong>{j.promoCode}</strong> · {j.inactiveDays}+ days inactive</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-brand">{j.sentCount} sent</p>
                        <p className="text-xs text-gray-400">{formatDate(j.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Geo Broadcast ── */}
        {activeTab === 'geo' && (
          <motion.div
            key="geo"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-black text-gray-800 dark:text-gray-100">Geofenced Notification</h2>
                  <p className="text-xs text-gray-400">Send a push notification to customers within a radius of a pin</p>
                </div>
              </div>

              {/* Coordinates */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Latitude</label>
                  <input
                    type="number"
                    value={geoLat}
                    onChange={e => setGeoLat(e.target.value)}
                    step="0.000001"
                    placeholder="17.3850"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Longitude</label>
                  <input
                    type="number"
                    value={geoLng}
                    onChange={e => setGeoLng(e.target.value)}
                    step="0.000001"
                    placeholder="78.4867"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <button
                  onClick={useMyLocation}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-xl font-bold text-sm hover:bg-blue-100 transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  Use My Location
                </button>
              </div>

              {/* Radius */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                  Radius — <span className="text-brand">{geoRadius}km</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={geoRadius}
                  onChange={e => setGeoRadius(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>1km</span><span>10km</span><span>25km</span><span>50km</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Notification Title</label>
                <input
                  type="text"
                  value={geoTitle}
                  onChange={e => setGeoTitle(e.target.value)}
                  placeholder="e.g. New restaurant near you! 🍕"
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Message</label>
                <textarea
                  value={geoMsg}
                  onChange={e => setGeoMsg(e.target.value)}
                  rows={3}
                  placeholder="Notify customers in the selected area..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Promo Code <span className="text-gray-400 font-normal normal-case">(optional)</span>
                </label>
                <select
                  value={geoPromo}
                  onChange={e => setGeoPromo(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="">— No promo code —</option>
                  {promoCodes.map(p => (
                    <option key={p.id} value={p.code}>{p.code} ({p.discountType === 'percent' ? `${p.discountValue}% off` : `₹${p.discountValue} off`})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl text-xs text-blue-700 dark:text-blue-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Requires customers to have location permissions enabled in the Manabites app
              </div>

              <button
                onClick={sendGeoNotification}
                disabled={sendingGeo}
                className="flex items-center gap-2 px-6 py-3 bg-brand text-white rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-60 transition-colors"
              >
                {sendingGeo ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send Geo Notification
              </button>
            </div>

            {/* Geo job history */}
            {geoJobs.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                  <h3 className="font-black text-gray-800 dark:text-gray-100">Past Geo Campaigns</h3>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {geoJobs.map(j => (
                    <div key={j.id} className="px-5 py-3 flex items-center gap-4">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{j.title}</p>
                        <p className="text-xs text-gray-400">
                          {j.lat.toFixed(4)}, {j.lng.toFixed(4)} · {j.radiusKm}km radius
                          {j.promoCode ? ` · Code: ${j.promoCode}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-blue-600">{j.sentCount} sent</p>
                        <p className="text-xs text-gray-400">{formatDate(j.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
