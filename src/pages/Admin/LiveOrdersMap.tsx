import React, { useState, useEffect, useMemo } from 'react';
import { OrderId } from '../../components/OrderId';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const restaurantIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;background:#1BA94C;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">🍱</div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22],
});
const customerIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;background:#3B82F6;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">🏠</div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22],
});
const riderIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;background:#F59E0B;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">🛵</div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22],
});

const STATUS_COLOR: Record<string, string> = {
  pending:          '#f59e0b',
  placed:           '#f59e0b',
  confirmed:        '#3b82f6',
  accepted:         '#3b82f6',
  preparing:        '#f97316',
  ready:            '#8b5cf6',
  ready_for_pickup: '#8b5cf6',
  out:              '#22c55e',
  out_for_delivery: '#22c55e',
  delivered:        '#6b7280',
  cancelled:        '#ef4444',
};

interface ActiveOrder {
  id: string;
  restaurantId: string;
  restaurantName: string;
  customerName?: string;
  riderName?: string;
  riderId?: string;
  status: string;
  total: number;
  restaurantLat?: number;
  restaurantLng?: number;
  deliveryAddress?: { lat?: number; lng?: number; formatted?: string };
  deliveryLat?: number;
  deliveryLng?: number;
}

interface RiderLocation {
  id: string;
  lat: number;
  lng: number;
  riderName?: string;
  isOnline: boolean;
  activeOrderId?: string;
}

// All possible in-flight statuses used across all 4 apps
const ACTIVE_STATUSES = [
  'pending', 'placed', 'confirmed', 'accepted', 'preparing', 'ready', 'out',
];

export default function LiveOrdersMap() {
  const [orders, setOrders]   = useState<ActiveOrder[]>([]);
  const [riders, setRiders]   = useState<RiderLocation[]>([]);
  const [restaurantCoords, setRestaurantCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [heatMode, setHeatMode] = useState(false);

  // Active orders listener
  useEffect(() => {
    const q = query(collection(db, 'orders'), where('status', 'in', ACTIVE_STATUSES));
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActiveOrder)));
    }, () => {});
  }, []);

  // Fetch restaurant coordinates once we know which restaurants are needed
  useEffect(() => {
    if (orders.length === 0) return;
    const missingIds = [...new Set(orders.map(o => o.restaurantId))]
      .filter(id => id && !restaurantCoords[id]);
    if (missingIds.length === 0) return;

    getDocs(query(collection(db, 'restaurants'), where('__name__', 'in', missingIds)))
      .then(snap => {
        const newCoords: Record<string, { lat: number; lng: number }> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.lat && data.lng) newCoords[d.id] = { lat: data.lat, lng: data.lng };
        });
        if (Object.keys(newCoords).length > 0) {
          setRestaurantCoords(prev => ({ ...prev, ...newCoords }));
        }
      })
      .catch(() => {});
  }, [orders]);

  // Rider locations listener
  useEffect(() => {
    return onSnapshot(collection(db, 'riderLocations'), (snap) => {
      setRiders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as RiderLocation))
          .filter(r => r.lat && r.lng)
      );
    }, () => {});
  }, []);

  // Enrich orders with restaurant coords from the restaurants collection
  const enrichedOrders = useMemo(() => orders.map(o => {
    const rc = restaurantCoords[o.restaurantId];
    return {
      ...o,
      restaurantLat: o.restaurantLat ?? rc?.lat,
      restaurantLng: o.restaurantLng ?? rc?.lng,
    };
  }), [orders, restaurantCoords]);

  const onlineRiders = riders.filter(r => r.isOnline).length;

  // Heat map points with density calculation
  const heatMapPoints = useMemo(() => {
    const points = enrichedOrders
      .map(o => {
        const lat = o.deliveryAddress?.lat ?? o.deliveryLat;
        const lng = o.deliveryAddress?.lng ?? o.deliveryLng;
        return lat && lng ? { lat, lng } : null;
      })
      .filter((p): p is { lat: number; lng: number } => p !== null);

    return points.map(p => {
      // Count other points within ~0.5km (roughly 0.0045 degrees)
      const density = points.filter(other => {
        const dlat = Math.abs(other.lat - p.lat);
        const dlng = Math.abs(other.lng - p.lng);
        return dlat < 0.0045 && dlng < 0.0045 && !(other.lat === p.lat && other.lng === p.lng);
      }).length + 1; // +1 to count self
      return { ...p, density };
    });
  }, [enrichedOrders]);

  return (
    <div className="flex flex-col h-full gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Live Orders Map</h1>
          <p className="text-sm text-gray-500 font-medium mt-0.5">
            {enrichedOrders.length} active orders · {onlineRiders} rider{onlineRiders !== 1 ? 's' : ''} online
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={() => setHeatMode(!heatMode)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${heatMode ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-500'}`}
          >
            🔥 Heat Map
          </button>
          {heatMode ? (
            <>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-red-500 inline-block opacity-70" /> Hot (3+ orders)</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-orange-400 inline-block opacity-70" /> Medium (2 orders)</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-yellow-400 inline-block opacity-70" /> Low (1 order)</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Restaurant</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Customer</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> Rider</span>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 rounded-2xl overflow-hidden shadow-sm border border-gray-200" style={{ minHeight: 500 }}>
          <MapContainer
            center={[17.4483, 78.3915]}
            zoom={12}
            style={{ height: '100%', width: '100%', minHeight: 500 }}
            scrollWheelZoom
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            {/* Heat map layer (rendered under regular markers) */}
            {heatMode && heatMapPoints.map((point, idx) => {
              const fillColor = point.density >= 3 ? '#ef4444' : point.density === 2 ? '#f97316' : '#fbbf24';
              return (
                <CircleMarker
                  key={`heat-${idx}`}
                  center={[point.lat, point.lng]}
                  radius={20}
                  pathOptions={{ fillColor, fillOpacity: 0.35, stroke: false }}
                />
              );
            })}

            {/* Per-order restaurant + customer markers */}
            {enrichedOrders.map(order => {
              const hasRestaurant = !!(order.restaurantLat && order.restaurantLng);
              const custLat = order.deliveryAddress?.lat ?? order.deliveryLat;
              const custLng = order.deliveryAddress?.lng ?? order.deliveryLng;
              const hasCust = !!(custLat && custLng);
              const restPos: [number, number] | null = hasRestaurant
                ? [order.restaurantLat!, order.restaurantLng!]
                : null;
              const custPos: [number, number] | null = hasCust ? [custLat!, custLng!] : null;
              const color = STATUS_COLOR[order.status] ?? '#6b7280';
              const isSelected = selectedOrder === order.id;

              return (
                <React.Fragment key={order.id}>
                  {restPos && (
                    <Marker
                      position={restPos}
                      icon={restaurantIcon}
                      eventHandlers={{ click: () => setSelectedOrder(order.id) }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <p className="font-black">{order.restaurantName}</p>
                          <p className="text-gray-500 text-xs"><OrderId id={order.id} className="text-xs" /></p>
                          <p style={{ color }} className="capitalize font-bold text-xs mt-1">
                            {order.status.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  )}

                  {custPos && (
                    <Marker position={custPos} icon={customerIcon}>
                      <Popup>
                        <div className="text-sm">
                          <p className="font-black">{order.customerName || 'Customer'}</p>
                          <p className="text-gray-500 text-xs">₹{order.total}</p>
                        </div>
                      </Popup>
                    </Marker>
                  )}

                  {restPos && custPos && (
                    <Polyline
                      positions={[restPos, custPos]}
                      pathOptions={{
                        color,
                        weight: isSelected ? 3 : 2,
                        opacity: isSelected ? 0.9 : 0.45,
                        dashArray: '6 4',
                      }}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {/* Rider markers */}
            {riders.map(rider => (
              <Marker key={rider.id} position={[rider.lat, rider.lng]} icon={riderIcon}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-black">{rider.riderName || 'Rider'}</p>
                    <p className={`font-bold text-xs ${rider.isOnline ? 'text-green-600' : 'text-gray-400'}`}>
                      {rider.isOnline ? '🟢 Online' : '⚫ Offline'}
                    </p>
                    {rider.activeOrderId && (
                      <p className="text-orange-500 font-bold text-xs">On delivery</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Order sidebar */}
        <div className="w-72 overflow-y-auto space-y-2 flex-shrink-0">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">
            Active Orders ({enrichedOrders.length})
          </p>
          {enrichedOrders.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-2">🗺️</p>
              <p className="text-sm text-gray-400 font-semibold">No active orders</p>
            </div>
          ) : (
            enrichedOrders.map(order => {
              const color = STATUS_COLOR[order.status] ?? '#6b7280';
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrder(order.id === selectedOrder ? null : order.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                    selectedOrder === order.id
                      ? 'border-brand bg-brand/5'
                      : 'border-gray-100 bg-white hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <OrderId id={order.id} className="text-xs font-black" />
                    <span
                      className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: color + '20', color }}
                    >
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="font-black text-gray-900 text-sm truncate">{order.restaurantName}</p>
                  <p className="text-xs text-gray-500 truncate">{order.customerName || '—'}</p>
                  {order.riderName && (
                    <p className="text-xs font-bold text-brand mt-1">🛵 {order.riderName}</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
