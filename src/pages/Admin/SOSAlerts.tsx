import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { collection, onSnapshot, doc, updateDoc, orderBy, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { AlertTriangle, CheckCircle, MapPin, Phone } from 'lucide-react';
import toast from 'react-hot-toast';

interface SOSAlert {
  id: string;
  riderId: string;
  riderName: string;
  riderPhone: string;
  orderId: string | null;
  lat: number | null;
  lng: number | null;
  status: 'active' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
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

  const resolve = async (alertId: string) => {
    setResolving(alertId);
    try {
      await updateDoc(doc(db, 'sos_alerts', alertId), { status: 'resolved', resolvedAt: Date.now() });
      toast.success('Alert marked as resolved');
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

  const active   = alerts.filter(a => a.status === 'active');
  const resolved = alerts.filter(a => a.status === 'resolved');

  return (
    <div className="space-y-6">
      {/* Customer Ghosting Alerts */}
      {ghostingOrders.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-red-600 text-white">
            <span className="w-3 h-3 rounded-full bg-white animate-ping flex-shrink-0" />
            <h2 className="font-black text-sm uppercase tracking-widest">
              🚨 Rider Waiting — Customer Ghosted ({ghostingOrders.length})
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
                      📷 View Proof Photo
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
                        📞 Call Customer
                      </a>
                    )}
                    <button
                      onClick={() => confirmCancelGhosting(order)}
                      disabled={processingGhost === order.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-600 text-white text-xs font-black rounded-xl hover:bg-red-700 disabled:opacity-60"
                    >
                      {processingGhost === order.id
                        ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : isExpired ? '🚫 Confirm Cancel' : '⏱ Cancel Now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <AlertTriangle className="text-red-500" size={24} /> SOS Alerts
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Emergency alerts from delivery riders</p>
      </div>

      {/* Active alerts */}
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-red-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Active ({active.length})
        </h2>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loadingâ€¦</div>
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
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                      <span className="font-black text-red-900 text-lg">{alert.riderName || 'Unknown Rider'}</span>
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
                    onClick={() => resolve(alert.id)}
                    disabled={resolving === alert.id}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl font-black text-sm hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                  >
                    <CheckCircle size={14} />
                    {resolving === alert.id ? 'Resolvingâ€¦' : 'Resolved'}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3">Resolved ({resolved.length})</h2>
          <div className="space-y-2">
            {resolved.map(alert => (
              <div key={alert.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between opacity-60">
                <div>
                  <span className="font-bold text-gray-700">{alert.riderName}</span>
                  <span className="text-xs text-gray-400 ml-2">{formatDate(alert.createdAt)}</span>
                </div>
                <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-1 rounded-full">Resolved</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
