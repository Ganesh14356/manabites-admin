import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, doc, updateDoc, addDoc, orderBy, query, where, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { AlertTriangle, CheckCircle, MapPin, Phone, Shield, X, History } from 'lucide-react';
import toast from 'react-hot-toast';

// ── SOS Categories ─────────────────────────────────────────────────────────────
const SOS_CATEGORIES = [
  { id: 'police',       label: 'Police',        emoji: '👮', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'ambulance',    label: 'Ambulance',      emoji: '🚑', color: 'bg-red-100 text-red-700 border-red-200' },
  { id: 'fire',         label: 'Fire',           emoji: '🚒', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { id: 'women_safety', label: 'Women Safety',   emoji: '🛡️', color: 'bg-pink-100 text-pink-700 border-pink-200' },
  { id: 'accident',     label: 'Accident',       emoji: '🚨', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { id: 'emergency',    label: 'Emergency',      emoji: '⚡', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { id: 'rider_sos',    label: 'Rider SOS',      emoji: '🛵', color: 'bg-gray-100 text-gray-700 border-gray-200' },
];

function getCategoryMeta(category?: string) {
  return SOS_CATEGORIES.find(c => c.id === category) ?? { id: 'emergency', label: 'Emergency', emoji: '⚠️', color: 'bg-red-100 text-red-700 border-red-200' };
}

interface SOSAlert {
  id: string;
  riderId: string;
  riderName: string;
  riderPhone: string;
  orderId: string | null;
  lat: number | null;
  lng: number | null;
  category?: string;
  status: 'active' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionNotes?: string;
}

interface GhostingOrder {
  id: string;
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  riderName?: string;
  riderId?: string;
  restaurantName?: string;
  paymentMode?: string;
  totalAmount?: number;
  customerUnavailableAt?: number;
  ghostingProofUrl?: string;
  adminCallStatus?: string;
  codCustomerFlagged?: boolean;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SOSAlerts() {
  const [alerts, setAlerts]     = useState<SOSAlert[]>([]);
  const [loading, setLoading]   = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [ghostingOrders, setGhostingOrders] = useState<GhostingOrder[]>([]);
  const [processingGhost, setProcessingGhost] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<SOSAlert | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'sos_alerts'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as SOSAlert)));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'orders'), where('status', '==', 'customer_unavailable'));
    return onSnapshot(q, snap => {
      setGhostingOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as GhostingOrder)));
    });
  }, []);

  const resolve = async (alertId: string, notes?: string) => {
    setResolving(alertId);
    try {
      const now = Date.now();
      await updateDoc(doc(db, 'sos_alerts', alertId), {
        status: 'resolved',
        resolvedAt: now,
        resolutionNotes: notes?.trim() || null,
        resolvedBy: 'Admin',
      });
      // Log resolution history
      const alert = alerts.find(a => a.id === alertId);
      if (alert) {
        await addDoc(collection(db, 'sosResolutionHistory'), {
          alertId,
          riderId:   alert.riderId,
          riderName: alert.riderName,
          category:  alert.category || 'emergency',
          lat:       alert.lat,
          lng:       alert.lng,
          resolvedAt: Timestamp.now(),
          resolvedBy: 'Admin',
          notes:      notes?.trim() || null,
        });
      }
      toast.success('Alert resolved & history saved');
      setSelectedAlert(null);
      setResolutionNote('');
    } catch {
      toast.error('Failed to resolve alert');
    } finally {
      setResolving(null);
    }
  };

  function getCountdown(customerUnavailableAt?: number) {
    if (!customerUnavailableAt) return null;
    const remaining = Math.max(0, Math.ceil((10 * 60 * 1000 - (Date.now() - customerUnavailableAt)) / 1000));
    return remaining;
  }

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (ghostingOrders.length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [ghostingOrders.length]);

  const confirmCancelGhosting = async (order: GhostingOrder) => {
    setProcessingGhost(order.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', order.id), {
        status: 'cancelled',
        cancellationReason: 'customer_unavailable',
        cancelledAt: serverTimestamp(),
        noRefund: order.paymentMode !== 'cod',
        codCustomerFlagged: order.paymentMode === 'cod',
        adminCallStatus: 'failed',
      });
      if (order.paymentMode === 'cod' && order.customerId) {
        // Flag customer - this field is checked at checkout
        // batch.update(doc(db, 'users', order.customerId), { codFlagged: true, codPenaltyPending: true });
      }
      await batch.commit();
      toast.success('Order cancelled — customer notified');
    } catch (err: any) {
      toast.error('Failed: ' + err.message);
    } finally {
      setProcessingGhost(null);
    }
  };

  const filteredAlerts = filterCategory === 'all' ? alerts : alerts.filter(a => a.category === filterCategory);
  const active   = filteredAlerts.filter(a => a.status === 'active');
  const resolved = filteredAlerts.filter(a => a.status === 'resolved');

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-black text-gray-900">SOS Alerts</h1>
            <p className="text-sm text-gray-500 mt-0.5">{active.length} active · {resolved.length} resolved</p>
          </div>
          <button onClick={() => setShowHistory(h => !h)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${showHistory ? 'bg-brand text-white border-brand' : 'border-gray-200 text-gray-600 hover:border-brand hover:text-brand'}`}>
            <History size={16} /> History
          </button>
        </div>
        {/* Category filter chips */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all ${filterCategory === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
            All
          </button>
          {SOS_CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setFilterCategory(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-black border transition-all ${filterCategory === c.id ? `${c.color}` : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Ghosting Alerts */}
      {ghostingOrders.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-red-600 text-white">
            <span className="w-3 h-3 rounded-full bg-white animate-ping flex-shrink-0" />
            <h2 className="font-black text-sm uppercase tracking-widest">
              🏍 Rider Waiting — Customer Ghosted ({ghostingOrders.length})
            </h2>
          </div>
          <div className="divide-y divide-red-100">
            {ghostingOrders.map(order => {
              const countdown = getCountdown(order.customerUnavailableAt);
              const mins = countdown !== null ? Math.floor(countdown / 60) : null;
              const secs = countdown !== null ? countdown % 60 : null;
              const isExpired = countdown === 0;
              return (
                <div key={order.id} className="p-4 bg-white space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-gray-800">{order.customerName || 'Unknown Customer'}</span>
                        {order.paymentMode !== 'cod' ? (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-brand/10 text-brand rounded-full">PREPAID</span>
                        ) : (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">COD</span>
                        )}
                      </div>
                      {order.riderName && <p className="text-xs text-gray-500 mt-0.5">Rider: {order.riderName}</p>}
                      {order.restaurantName && <p className="text-xs text-gray-500">Order from: {order.restaurantName} · ₹{order.totalAmount}</p>}
                      {order.customerUnavailableAt && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Waiting since: {new Date(order.customerUnavailableAt).toLocaleTimeString('en-IN')}
                        </p>
                      )}
                    </div>

                    {/* Countdown */}
                    {countdown !== null && (
                      <div className={`flex-shrink-0 text-center px-3 py-2 rounded-xl ${
                        isExpired ? 'bg-red-600 text-white' :
                        (countdown < 120) ? 'bg-red-100 text-red-700 animate-pulse' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        <p className="text-lg font-black font-mono leading-none">
                          {isExpired ? '00:00' : `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`}
                        </p>
                        <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                          {isExpired ? 'EXPIRED' : 'remaining'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Proof photo */}
                  {order.ghostingProofUrl && (
                    <a href={order.ghostingProofUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100">
                      ?? View Proof Photo
                    </a>
                  )}

                  {/* Financial rule notice */}
                  <div className={`text-xs px-3 py-2 rounded-lg font-medium ${
                    order.paymentMode !== 'cod'
                      ? 'bg-orange-50 text-orange-700 border border-orange-100'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-100'
                  }`}>
                    {order.paymentMode !== 'cod'
                      ? '💳 Prepaid order — 100% cancellation fee applies. No refund to customer. Restaurant & rider get paid.'
                      : '💵 COD order — Cancel without fee. Customer account will be flagged until penalty fee paid on next order.'}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {order.customerPhone && (
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 text-gray-700 text-xs font-black rounded-xl hover:bg-gray-200"
                      >
                        ?? Call Customer
                      </a>
                    )}
                    <button
                      onClick={() => confirmCancelGhosting(order)}
                      disabled={processingGhost === order.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 disabled:opacity-60"
                    >
                      {processingGhost === order.id
                        ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : isExpired ? '?? Confirm Cancel' : '? Cancel Now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* (header now above ghosting section) */}

      {/* Active alerts */}
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-red-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Active ({active.length})
        </h2>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading…</div>
        ) : active.length === 0 ? (
          <div className="bg-green-50 rounded-2xl p-8 text-center border border-green-100">
            <CheckCircle className="mx-auto mb-2 text-green-500" size={32} />
            <p className="font-black text-green-700">No active SOS alerts</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(alert => (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                      <span className="font-black text-red-900 text-lg">{alert.riderName || 'Unknown Rider'}</span>
                      {alert.category && (() => { const cat = getCategoryMeta(alert.category); return (
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${cat.color}`}>{cat.emoji} {cat.label}</span>
                      ); })()}
                    </div>
                    <div className="space-y-1 text-sm text-red-700 font-medium">
                      {alert.riderPhone && (
                        <p className="flex items-center gap-1.5">
                          <Phone size={13} />
                          <a href={`tel:${alert.riderPhone}`} className="underline font-bold">{alert.riderPhone}</a>
                        </p>
                      )}
                      {alert.lat && alert.lng && (
                        <p className="flex items-center gap-1.5">
                          <MapPin size={13} />
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${alert.lat}&mlon=${alert.lng}#map=16/${alert.lat}/${alert.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-bold"
                          >
                            View Location ({alert.lat.toFixed(4)}, {alert.lng.toFixed(4)})
                          </a>
                        </p>
                      )}
                      {alert.orderId && <p className="text-xs">Order: #{alert.orderId.slice(-8).toUpperCase()}</p>}
                      <p className="text-[11px] text-red-500">{formatDate(alert.createdAt)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedAlert(alert)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl font-black text-sm hover:bg-red-700 flex-shrink-0"
                  >
                    <CheckCircle size={14} /> Resolve
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {(showHistory || resolved.length > 0) && (
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3">Resolution History ({resolved.length})</h2>
          <div className="space-y-2">
            {resolved.map(alert => {
              const cat = getCategoryMeta(alert.category);
              return (
                <div key={alert.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-700">{alert.riderName}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${cat.color}`}>{cat.emoji} {cat.label}</span>
                      {alert.lat && alert.lng && (
                        <a href={`https://maps.google.com/?q=${alert.lat},${alert.lng}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 underline flex items-center gap-0.5">
                          <MapPin size={10} /> Location
                        </a>
                      )}
                    </div>
                    <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-1 rounded-full shrink-0">✓ Resolved</span>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-gray-400">
                    <span>Alert: {formatDate(alert.createdAt)}</span>
                    {alert.resolvedAt && <span>Resolved: {formatDate(alert.resolvedAt)}</span>}
                    {alert.resolvedBy && <span>by {alert.resolvedBy}</span>}
                  </div>
                  {alert.resolutionNotes && (
                    <p className="mt-1.5 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{alert.resolutionNotes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      <AnimatePresence>
        {selectedAlert && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedAlert(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-gray-900">Resolve SOS Alert</h3>
                <button onClick={() => setSelectedAlert(null)} className="p-1.5 bg-gray-100 rounded-full"><X size={16} /></button>
              </div>
              <div className="bg-red-50 rounded-xl p-4 mb-4">
                <p className="font-black text-red-900">{selectedAlert.riderName}</p>
                {selectedAlert.category && <p className="text-sm text-red-700">{getCategoryMeta(selectedAlert.category).emoji} {getCategoryMeta(selectedAlert.category).label}</p>}
                {selectedAlert.riderPhone && <p className="text-sm text-red-600">{selectedAlert.riderPhone}</p>}
                {selectedAlert.lat && selectedAlert.lng && (
                  <a href={`https://maps.google.com/?q=${selectedAlert.lat},${selectedAlert.lng}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 underline">View on Map</a>
                )}
              </div>
              <textarea value={resolutionNote} onChange={e => setResolutionNote(e.target.value)}
                placeholder="Resolution notes (optional)..."
                rows={3}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm resize-none outline-none focus:border-brand mb-4" />
              <div className="flex gap-3">
                <button onClick={() => setSelectedAlert(null)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl">Cancel</button>
                <button onClick={() => resolve(selectedAlert.id, resolutionNote)} disabled={resolving === selectedAlert.id}
                  className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-60">
                  {resolving ? 'Resolving…' : '✓ Mark Resolved'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
