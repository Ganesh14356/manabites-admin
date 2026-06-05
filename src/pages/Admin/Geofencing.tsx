import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { MapContainer, TileLayer, Marker, Circle, Popup, Polygon, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import toast from 'react-hot-toast';
import { Save, MapPin, ShieldCheck, Hexagon, X, RotateCcw, Search, Loader2 } from 'lucide-react';

// ── Map navigator: flies to given coords when they change ──────────────────────
function MapFlyTo({ coords }: { coords: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) map.flyTo(coords, 15, { duration: 1.2 });
  }, [coords, map]);
  return null;
}

// ── Nominatim location search hook ────────────────────────────────────────────
function useLocationSearch() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [loading, setLoading]   = useState(false);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=6&countrycodes=in`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setResults(data.map((d: any) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
  }, [query]);

  return { query, setQuery, results, setResults, loading };
}

const restaurantIcon = L.divIcon({
  className: '',
  html: `<div style="width:38px;height:38px;background:#1BA94C;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:20px">🍱</div>`,
  iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -40],
});

interface Restaurant {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  deliveryRadiusKm?: number;
  isActive?: boolean;
  fssaiVerified?: boolean;
  fssaiNumber?: string;
}

// Helper: click handler inside map to collect polygon points
function PolygonDrawer({ drawing, onPoint }: { drawing: boolean; onPoint: (p: [number, number]) => void }) {
  useMapEvents({ click: e => { if (drawing) onPoint([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

export default function Geofencing() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [saving, setSaving] = useState(false);
  const [fssaiVerified, setFssaiVerified] = useState(false);
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [savingFssai, setSavingFssai] = useState(false);

  // Location search
  const { query: locQuery, setQuery: setLocQuery, results: locResults, setResults: setLocResults, loading: locLoading } = useLocationSearch();
  const [flyTo, setFlyTo]           = useState<[number, number] | null>(null);
  const [showLocDropdown, setShowLocDropdown] = useState(false);

  // Polygon drawing
  const [drawMode, setDrawMode]     = useState(false);
  const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
  const [savedZones, setSavedZones] = useState<{ id: string; name: string; points: [number, number][] }[]>([]);

  const addPoint = useCallback((p: [number, number]) => {
    setPolyPoints(prev => [...prev, p]);
  }, []);

  const closePolygon = () => {
    if (polyPoints.length < 3) { toast.error('Minimum 3 points needed'); return; }
    // Auto-close: first point == last point
    setPolyPoints(prev => [...prev, prev[0]]);
    setDrawMode(false);
  };

  const saveZone = async () => {
    if (polyPoints.length < 3) { toast.error('Draw a zone first'); return; }
    if (!selected) { toast.error('Select a restaurant first'); return; }
    setSaving(true);
    try {
      const zone = polyPoints;
      await updateDoc(doc(db, 'restaurants', selected.id), { deliveryZone: zone, deliveryZoneType: 'polygon' });
      setSavedZones(prev => [...prev.filter(z => z.id !== selected.id), { id: selected.id, name: selected.name, points: zone }]);
      toast.success('Delivery zone saved ✓');
      setPolyPoints([]);
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    return onSnapshot(collection(db, 'restaurants'), snap => {
      setRestaurants(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as Restaurant))
      );
    });
  }, []);

  const selectRestaurant = (r: Restaurant) => {
    setSelected(r);
    setRadiusKm(r.deliveryRadiusKm ?? 5);
    setFssaiVerified(r.fssaiVerified ?? false);
    setFssaiNumber(r.fssaiNumber ?? '');
  };

  const saveFssai = async () => {
    if (!selected) return;
    setSavingFssai(true);
    try {
      await updateDoc(doc(db, 'restaurants', selected.id), {
        fssaiVerified,
        fssaiNumber: fssaiNumber.trim(),
      });
      setRestaurants(prev =>
        prev.map(r => r.id === selected.id ? { ...r, fssaiVerified, fssaiNumber } : r)
      );
      setSelected(s => s ? { ...s, fssaiVerified, fssaiNumber } : s);
      toast.success(fssaiVerified ? 'FSSAI verified ✓' : 'FSSAI verification removed');
    } catch {
      toast.error('Save failed');
    } finally {
      setSavingFssai(false);
    }
  };

  const saveRadius = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'restaurants', selected.id), { deliveryRadiusKm: radiusKm });
      setRestaurants(prev => prev.map(r => r.id === selected.id ? { ...r, deliveryRadiusKm: radiusKm } : r));
      setSelected(s => s ? { ...s, deliveryRadiusKm: radiusKm } : s);
      toast.success(`Delivery radius set to ${radiusKm} km`);
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Geofencing</h1>
        <p className="text-sm text-gray-500 font-medium mt-0.5">Set delivery zones — circle radius or custom polygon</p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-72 space-y-2">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Restaurants ({restaurants.length})</p>
          {restaurants.map(r => (
            <button
              key={r.id}
              onClick={() => selectRestaurant(r)}
              className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                selected?.id === r.id
                  ? 'border-brand bg-brand/5'
                  : 'border-gray-100 bg-white hover:border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={12} className="text-brand flex-shrink-0" />
                <p className="font-black text-gray-900 text-sm truncate">{r.name}</p>
              </div>
              <p className="text-xs text-gray-400 truncate pl-4">{r.address}</p>
              {r.lat && r.lng ? (
                <p className="text-xs font-bold text-brand mt-1 pl-4">
                  Radius: {r.deliveryRadiusKm ?? 5} km
                </p>
              ) : (
                <p className="text-xs font-bold text-orange-400 mt-1 pl-4">No location set</p>
              )}
              {r.fssaiVerified && (
                <span className="ml-4 mt-0.5 inline-flex items-center gap-1 text-[10px] font-black text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                  <ShieldCheck size={10} /> FSSAI
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Map + editor */}
        <div className="flex-1 flex flex-col gap-3">

          {/* Location Search */}
          <div className="relative">
            <div className="flex items-center gap-2 bg-white border-2 border-gray-200 rounded-xl px-3 py-2.5 focus-within:border-brand transition-colors">
              {locLoading ? <Loader2 size={16} className="text-gray-400 animate-spin shrink-0" /> : <Search size={16} className="text-gray-400 shrink-0" />}
              <input
                value={locQuery}
                onChange={e => { setLocQuery(e.target.value); setShowLocDropdown(true); }}
                onFocus={() => setShowLocDropdown(true)}
                placeholder="Search location to navigate map (e.g. Hanamkonda, Warangal)..."
                className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400 bg-transparent"
              />
              {locQuery && (
                <button onClick={() => { setLocQuery(''); setLocResults([]); setShowLocDropdown(false); }}
                  className="p-0.5 rounded-full hover:bg-gray-100">
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>
            {showLocDropdown && locResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
                {locResults.map((r, i) => (
                  <button key={i} onMouseDown={e => { e.preventDefault(); setFlyTo([r.lat, r.lng]); setLocQuery(r.label.split(',')[0]); setShowLocDropdown(false); setLocResults([]); }}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-orange-50 border-b border-gray-50 last:border-0 flex items-center gap-2">
                    <MapPin size={13} className="text-brand shrink-0 mt-0.5" />
                    <span className="line-clamp-1 text-gray-700">{r.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-black text-gray-900">{selected.name}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs font-bold text-gray-500">Radius:</span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={radiusKm}
                    onChange={e => setRadiusKm(parseFloat(e.target.value))}
                    className="flex-1 accent-brand"
                  />
                  <span className="text-sm font-black text-brand w-14 text-right">{radiusKm} km</span>
                </div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {[2, 3, 5, 8, 10, 15].map(km => (
                    <button
                      key={km}
                      onClick={() => setRadiusKm(km)}
                      className={`px-2.5 py-1 rounded-full text-xs font-black transition-colors ${
                        radiusKm === km ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {km} km
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={saveRadius}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl font-black text-sm disabled:opacity-60"
              >
                <Save size={15} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Polygon Drawing Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 flex-wrap">
              <Hexagon size={18} className="text-purple-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-black text-gray-900 text-sm mb-1">Custom Delivery Zone (Polygon)</p>
                <p className="text-xs text-gray-400">
                  {drawMode ? `${polyPoints.length} points placed — click map to add more` : 'Draw a custom polygon delivery zone'}
                </p>
                {polyPoints.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button onClick={closePolygon} disabled={polyPoints.length < 3}
                      className="px-3 py-1.5 text-xs font-black bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                      ✓ Close Polygon
                    </button>
                    <button onClick={() => setPolyPoints([])}
                      className="px-3 py-1.5 text-xs font-black bg-gray-100 text-gray-600 rounded-lg flex items-center gap-1">
                      <RotateCcw size={12} /> Clear
                    </button>
                    <button onClick={saveZone} disabled={saving || polyPoints.length < 3}
                      className="px-3 py-1.5 text-xs font-black bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                      <Save size={12} /> {saving ? 'Saving…' : 'Save Zone'}
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => setDrawMode(d => !d)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm transition-colors ${drawMode ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}`}>
                <Hexagon size={15} />
                {drawMode ? 'Drawing… (click map)' : 'Draw Zone'}
              </button>
            </div>

            {/* FSSAI Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 flex-wrap">
              <ShieldCheck size={18} className="text-green-600 flex-shrink-0" />
              <div className="flex-1 min-w-[180px]">
                <p className="font-black text-gray-900 text-sm mb-2">FSSAI License Verification</p>
                <input
                  type="text"
                  placeholder="FSSAI License Number (optional)"
                  value={fssaiNumber}
                  onChange={e => setFssaiNumber(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand mb-2"
                />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fssaiVerified}
                    onChange={e => setFssaiVerified(e.target.checked)}
                    className="w-4 h-4 accent-green-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold text-gray-700">Mark as FSSAI Verified</span>
                  {fssaiVerified && <span className="text-[10px] font-black text-green-700 bg-green-50 px-2 py-0.5 rounded">✓ Verified</span>}
                </label>
              </div>
              <button
                onClick={saveFssai}
                disabled={savingFssai}
                className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl font-black text-sm disabled:opacity-60"
              >
                <ShieldCheck size={15} />
                {savingFssai ? 'Saving…' : 'Save FSSAI'}
              </button>
            </div>
            </>
          )}

          <div className="flex-1 rounded-2xl overflow-hidden shadow-sm border border-gray-200 min-h-[500px]">
            <MapContainer
              center={[17.4483, 78.3915]}
              zoom={12}
              className="h-full w-full"
              scrollWheelZoom
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />
              <MapFlyTo coords={flyTo} />
              <PolygonDrawer drawing={drawMode} onPoint={addPoint} />
              {/* Live polygon being drawn */}
              {polyPoints.length >= 2 && (
                <Polygon positions={polyPoints} pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.1, weight: 2, dashArray: '6 4' }} />
              )}
              {/* Saved zones */}
              {savedZones.map(z => (
                <Polygon key={z.id} positions={z.points} pathOptions={{ color: '#1BA94C', fillColor: '#1BA94C', fillOpacity: 0.08, weight: 2 }}>
                  <Popup><p className="font-bold text-sm">{z.name}</p><p className="text-xs text-gray-500">Custom delivery zone</p></Popup>
                </Polygon>
              ))}

              {restaurants.filter(r => r.lat && r.lng).map(r => {
                const pos: [number, number] = [r.lat!, r.lng!];
                const radius = (selected?.id === r.id ? radiusKm : (r.deliveryRadiusKm ?? 5)) * 1000;
                const isSelected = selected?.id === r.id;

                return (
                  <React.Fragment key={r.id}>
                    <Circle
                      center={pos}
                      radius={radius}
                      pathOptions={{
                        color: isSelected ? '#1BA94C' : '#94a3b8',
                        fillColor: isSelected ? '#1BA94C' : '#94a3b8',
                        fillOpacity: isSelected ? 0.1 : 0.05,
                        weight: isSelected ? 2 : 1,
                        dashArray: isSelected ? undefined : '5 5',
                      }}
                    />
                    <Marker
                      position={pos}
                      icon={restaurantIcon}
                      eventHandlers={{ click: () => selectRestaurant(r) }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <p className="font-black">{r.name}</p>
                          <p className="text-gray-500">{r.address}</p>
                          <p className="text-brand font-bold mt-1">
                            Delivery radius: {r.deliveryRadiusKm ?? 5} km
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  </React.Fragment>
                );
              })}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
