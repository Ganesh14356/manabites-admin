import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { MapContainer, TileLayer, Marker, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import toast from 'react-hot-toast';
import { Save, MapPin, ShieldCheck } from 'lucide-react';

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

export default function Geofencing() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [saving, setSaving] = useState(false);
  const [fssaiVerified, setFssaiVerified] = useState(false);
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [savingFssai, setSavingFssai] = useState(false);

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
        <p className="text-sm text-gray-500 font-medium mt-0.5">Set delivery radius for each restaurant</p>
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
