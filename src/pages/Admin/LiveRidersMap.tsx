import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Search, Radar, Navigation, Phone, Clock, Package, BatteryMedium } from 'lucide-react';

// ── Marker icons — green = available, red = busy (on delivery), gray = offline ──

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">&#x1F6F5;</div>`,
    iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
  });
}
const availableIcon = pinIcon('#22c55e');
const busyIcon = pinIcon('#ef4444');
const offlineIcon = pinIcon('#9ca3af');

const VEHICLE_ICONS: Record<string, string> = {
  Bike: '🏍️', Scooter: '🛵', Bicycle: '🚴', Car: '🚗',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type RiderMapStatus = 'available' | 'busy' | 'offline';

interface LiveRider {
  id: string;
  uid?: string;
  name: string;
  phone: string;
  riderID?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  isOnline: boolean;
  activeOrderId: string | null;
  lat: number;
  lng: number;
  updatedAt?: any;
}

const STATUS_META: Record<RiderMapStatus, { label: string; emoji: string; dot: string; text: string; icon: L.DivIcon }> = {
  available: { label: 'Available', emoji: '🟢', dot: 'bg-green-500', text: 'text-green-700', icon: availableIcon },
  busy:      { label: 'On Delivery', emoji: '🔴', dot: 'bg-red-500',   text: 'text-red-700',   icon: busyIcon },
  offline:   { label: 'Offline', emoji: '⚪', dot: 'bg-gray-400',   text: 'text-gray-500',  icon: offlineIcon },
};

function deriveStatus(r: { isOnline: boolean; activeOrderId: string | null }): RiderMapStatus {
  if (!r.isOnline) return 'offline';
  return r.activeOrderId ? 'busy' : 'available';
}

function timeAgo(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function safeInitials(name?: string): string {
  if (!name || !name.trim()) return 'R';
  return name.trim().split(/\s+/).map(n => n[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'R';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LiveRidersMap() {
  const [riders, setRiders] = useState<LiveRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RiderMapStatus>('all');

  // Real-time listener — the rider app writes location updates roughly every
  // few seconds, so onSnapshot already gives us a live feed without polling.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'riders'), snap => {
      const live: LiveRider[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const loc = data.location;
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
        live.push({
          id: d.id,
          uid: data.uid,
          name: data.name || '',
          phone: data.phone || d.id,
          riderID: data.riderID,
          vehicleType: data.vehicleType,
          vehicleNumber: data.vehicleNumber,
          isOnline: !!data.isOnline,
          activeOrderId: data.activeOrderId ?? null,
          lat: loc.lat,
          lng: loc.lng,
          updatedAt: data.updatedAt,
        });
      });
      setRiders(live);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => riders.filter(r => {
    const q = searchQuery.trim().toLowerCase();
    const matchSearch = !q ||
      r.name.toLowerCase().includes(q) ||
      r.phone.includes(q) ||
      (r.riderID || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || deriveStatus(r) === statusFilter;
    return matchSearch && matchStatus;
  }), [riders, searchQuery, statusFilter]);

  const counts = useMemo(() => {
    const c = { available: 0, busy: 0, offline: 0 };
    riders.forEach(r => { c[deriveStatus(r)]++; });
    return c;
  }, [riders]);

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <Radar className="w-6 h-6 text-brand" /> Live Riders Map
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Real-time rider locations & delivery status</p>
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Riders Online', value: counts.available + counts.busy, color: 'border-brand', text: 'text-brand' },
          { label: 'Available', value: counts.available, color: 'border-green-500', text: 'text-green-700' },
          { label: 'On Delivery', value: counts.busy, color: 'border-red-400', text: 'text-red-600' },
          { label: 'Offline', value: counts.offline, color: 'border-gray-300', text: 'text-gray-500' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.06 }}
            whileHover={{ y: -3 }}
            className={`bg-white dark:bg-gray-800 rounded-2xl shadow-card p-4 border-l-4 ${s.color}`}
          >
            <p className={`text-3xl font-black ${s.text}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 font-semibold">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, Rider ID..." className="input-field pl-10" />
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit">
          {([
            { key: 'all', label: 'All' },
            { key: 'available', label: '🟢 Available' },
            { key: 'busy', label: '🔴 On Delivery' },
            { key: 'offline', label: '⚪ Offline' },
          ] as { key: 'all' | RiderMapStatus; label: string }[]).map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${statusFilter === f.key ? 'bg-white dark:bg-gray-800 shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-card overflow-hidden">
        <div className="h-[600px] relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-white/70 dark:bg-gray-800/70">
              <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 font-medium text-sm">Loading live rider positions...</p>
            </div>
          ) : null}

          {typeof window !== 'undefined' && (
            <MapContainer center={[17.385, 78.4867]} zoom={12} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              {filtered.map(r => {
                const status = deriveStatus(r);
                const meta = STATUS_META[status];
                const vehicleEmoji = VEHICLE_ICONS[r.vehicleType || ''] || '🛵';
                return (
                  <Marker key={r.id} position={[r.lat, r.lng]} icon={meta.icon}>
                    <Popup>
                      <div className="min-w-[220px]">
                        <div className="flex items-center gap-2.5 mb-2">
                          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-black text-sm flex-shrink-0">
                            {safeInitials(r.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 truncate">{r.name || 'Unnamed Rider'}</p>
                            <p className="text-[11px] font-mono text-gray-400">{r.riderID || '—'}</p>
                          </div>
                        </div>

                        <p className={`text-xs font-bold mb-1.5 ${meta.text}`}>
                          {meta.emoji} {meta.label}
                        </p>

                        <div className="space-y-1 text-xs text-gray-600">
                          <p className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-gray-400" /> {r.phone || '—'}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <span className="leading-none">{vehicleEmoji}</span>
                            {r.vehicleType || '—'} {r.vehicleNumber ? `· ${r.vehicleNumber}` : ''}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Package className="w-3 h-3 text-gray-400" />
                            {r.activeOrderId ? <>On delivery: <span className="font-mono">#{r.activeOrderId.slice(0, 8)}</span></> : 'No active order'}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <BatteryMedium className="w-3 h-3 text-gray-400" /> Battery: —
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-gray-400" /> Last seen: {timeAgo(r.updatedAt)}
                          </p>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-xs">
          <span className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5" /> Legend
          </span>
          {(Object.keys(STATUS_META) as RiderMapStatus[]).map(k => (
            <span key={k} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
              <span className={`w-3 h-3 rounded-full inline-block ${STATUS_META[k].dot}`} /> {STATUS_META[k].label} ({counts[k]})
            </span>
          ))}
          <span className="ml-auto text-gray-300 italic">Updates live as riders move — no refresh needed</span>
        </div>
      </div>

      {!loading && filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm mt-4">No riders match the current filters.</p>
      )}

      <p className="text-[11px] text-gray-300 mt-3">
        Battery % requires a rider-app update to publish device battery level — shown as “—” until then.
      </p>
    </div>
  );
}
