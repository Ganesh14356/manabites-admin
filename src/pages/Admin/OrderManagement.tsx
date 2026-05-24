import { useState, useEffect, useMemo } from 'react';
import { OrderId } from '../../components/OrderId';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, updateDoc, getDocs,
  onSnapshot, query, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search, Eye, XCircle, UserPlus, MapPin, CheckCircle,
  AlertTriangle, Bike, ChevronDown, X, Clock
} from 'lucide-react';

interface OrderDoc {
  id: string;
  customerId: string;
  customerName: string;
  restaurantId: string;
  restaurantName: string;
  riderId?: string;
  riderName?: string;
  status: 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled' | 'customer_unavailable';
  totalAmount: number;
  deliveryFee: number;
  platformFee: number;
  tax: number;
  items: any[];
  deliveryAddress: string;
  createdAt: Timestamp;
  preparingAt?: Timestamp;
  readyAt?: Timestamp;
  pickedUpAt?: Timestamp;
  deliveredAt?: Timestamp;
  riderArrivedAt?: Timestamp;
  estimatedCookingMins?: number;
  deliveryOtpVerified?: boolean;
  deliveryPhotoUrl?: string;
  geofenceFailed?: boolean;
  suspicious?: boolean;
  waitTimeMins?: number;
}

interface RiderOption {
  uid: string;
  name: string;
  phone: string;
  vehicleType?: string;
}

function formatDate(timestamp: any): string {
  if (!timestamp) return '—';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function OrderManagement() {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId) ?? null, [orders, selectedOrderId]);

  // Rider assignment state
  const [riders, setRiders] = useState<RiderOption[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningRider, setAssigningRider] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snapshot => {
      setOrders(snapshot.docs.map(d => {
        const data = d.data() as Record<string, any>;
        return {
          id: d.id,
          ...data,
          // normalize field name variants written by different apps
          customerName: data.customerName || data.name || '—',
          totalAmount:  data.totalAmount ?? data.total ?? data.orderAmount ?? 0,
          deliveryAddress: typeof data.deliveryAddress === 'string'
            ? data.deliveryAddress
            : data.deliveryAddress
              ? [data.deliveryAddress.street, data.deliveryAddress.city, data.deliveryAddress.state, data.deliveryAddress.pincode].filter(Boolean).join(', ')
              : data.address || '—',
          items: (data.items || []).map((item: any) => ({
            ...item,
            quantity: item.quantity ?? item.qty ?? 1,
            price:    item.price ?? item.unitPrice ?? 0,
          })),
        } as OrderDoc;
      }));
      setLoading(false);
    }, err => {
      toast.error('Failed to load orders: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Fetch active riders from the riders collection (keyed by phone number)
  useEffect(() => {
    getDocs(query(collection(db, 'riders'), where('approvalStatus', '==', 'approved'))).then(snap => {
      setRiders(
        snap.docs
          .map(d => ({
            uid: d.id, // doc ID is the 10-digit phone number
            name: d.data().name || '—',
            phone: d.data().phone || d.id,
            vehicleType: d.data().vehicle || d.data().vehicleType,
          }))
          .filter(r => r.name !== '—')
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  }, []);

  const handleAssignRider = async () => {
    if (!selectedOrder || !selectedRiderId) return;
    const rider = riders.find(r => r.uid === selectedRiderId);
    if (!rider) return;
    setAssigningRider(true);
    try {
      // Set assignedRiderId so the rider app shows the accept/reject popup.
      // Do NOT set riderId or change status yet — rider must confirm first.
      const assignmentExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes to accept
      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        assignedRiderId:   rider.uid,
        assignedRiderName: rider.name,
        assignmentExpiry,
        updatedAt: Timestamp.now(),
      });
      toast.success(`Rider "${rider.name}" notified — waiting for acceptance`);
      setShowAssignModal(false);
      setSelectedRiderId('');
    } catch {
      toast.error('Failed to assign rider');
    } finally {
      setAssigningRider(false);
    }
  };

  const filtered = useMemo(() => {
    return orders.filter(o => {
      const matchSearch = !searchQuery ||
        o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.restaurantName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.customerName?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, searchQuery, statusFilter]);

  // Restaurant delay alerts: preparing > 20 min with no readyAt
  const delayAlerts = useMemo(() => orders.filter(o => {
    if (o.status !== 'preparing') return false;
    const t = o.preparingAt?.toMillis?.() ?? ((o as any).acceptedAt)?.toMillis?.() ?? null;
    if (!t) return false;
    return (Date.now() - t) > 20 * 60 * 1000 && !o.readyAt;
  }), [orders]);

  // Rider wait alerts: rider arrived but still not picked up after 10 min
  const waitAlerts = useMemo(() => orders.filter(o => {
    if (o.status !== 'ready' && o.status !== 'preparing') return false;
    const t = o.riderArrivedAt?.toMillis?.() ?? null;
    if (!t || !o.riderId) return false;
    return (Date.now() - t) > 10 * 60 * 1000;
  }), [orders]);

  const handleCancelOrder = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'cancelled' });
      toast.success('Order cancelled');
      setSelectedOrderId(null);
    } catch (error) {
      toast.error('Failed to cancel order');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'accepted': case 'preparing': case 'ready': return 'bg-blue-100 text-blue-800';
      case 'picked_up': return 'bg-purple-100 text-purple-800';
      case 'delivered': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      case 'customer_unavailable': return 'bg-red-100 text-red-800 animate-pulse';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Restaurant Delay Alerts */}
      {(delayAlerts.length > 0 || waitAlerts.length > 0) && (
        <div className="mb-5 space-y-2">
          {delayAlerts.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-orange-800">
                  {delayAlerts.length} Restaurant Delay Alert{delayAlerts.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-orange-600 mt-0.5">
                  {delayAlerts.map(o => o.restaurantName || 'Unknown').join(' · ')} — not marked Ready for Pickup after 20 min
                </p>
              </div>
            </div>
          )}
          {waitAlerts.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-yellow-800">
                  {waitAlerts.length} Rider Waiting Alert{waitAlerts.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  Rider has been waiting &gt;10 min at restaurant — may be eligible for wait-time payout
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            📦 Order Management
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Monitor live and past orders</p>
        </div>
      </motion.div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by Order ID, Restaurant, or Customer..."
            className="input-field pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input-field w-40"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="preparing">Preparing</option>
          <option value="picked_up">Picked Up</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="customer_unavailable">Customer Unavailable</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.div
              key={i}
              className="h-14 bg-gray-100 rounded-xl animate-pulse"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Restaurant</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Time</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map(o => (
                    <motion.tr
                      key={o.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-b border-gray-50 hover:bg-gray-50"
                    >
                      <td className="table-cell font-mono text-xs text-gray-500">
                        {o.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="table-cell font-semibold text-gray-800">{o.restaurantName || 'Unknown'}</td>
                      <td className="table-cell text-gray-600">{o.customerName || 'Unknown'}</td>
                      <td className="table-cell font-medium">₹{o.totalAmount?.toFixed(2) || '0.00'}</td>
                      <td className="table-cell">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${getStatusColor(o.status)}`}>
                          {o.status === 'customer_unavailable' ? '🚨 Rider Waiting' : o.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="table-cell text-gray-500 text-xs">{formatDate(o.createdAt)}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1.5">
                            {o.geofenceFailed && (
                              <span title="Suspicious delivery - rider too far" className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center text-[9px]">⚠</span>
                            )}
                            {o.deliveryOtpVerified && (
                              <span title="OTP verified" className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center text-[9px]">🔐</span>
                            )}
                            {o.deliveryPhotoUrl && (
                              <a href={o.deliveryPhotoUrl} target="_blank" rel="noopener noreferrer" title="Delivery photo" className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-[9px]">📷</a>
                            )}
                            <button
                              onClick={() => setSelectedOrderId(o.id)}
                              className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-16 text-gray-400">No orders found</div>
            )}
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      <AnimatePresence>
        {selectedOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedOrderId(null)}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-gray-800">Order Details</h2>
                  <p className="text-xs text-gray-500 font-mono mt-1">ID: {selectedOrder.id}</p>
                </div>
                <button onClick={() => setSelectedOrderId(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                  <XCircle className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Status */}
                <div className="bg-gray-50 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Current Status</p>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${getStatusColor(selectedOrder.status)}`}>
                      {selectedOrder.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Time</p>
                    <p className="text-sm font-medium text-gray-800">{formatDate(selectedOrder.createdAt)}</p>
                  </div>
                </div>

                {/* Restaurant delay badge */}
                {selectedOrder.status === 'preparing' && (() => {
                  const t = (selectedOrder as any).preparingAt?.toMillis?.() ?? null;
                  const waitMins = t ? Math.floor((Date.now() - t) / 60000) : 0;
                  if (waitMins < 20) return null;
                  return (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-2">
                      <span className="text-sm">⚠️</span>
                      <div>
                        <p className="text-xs font-black text-orange-800">Restaurant Delayed — {waitMins} min</p>
                        <p className="text-[10px] text-orange-600">Food not marked Ready after {waitMins} minutes</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Rider wait time compensation */}
                {(selectedOrder as any).riderArrivedAt && (() => {
                  const arrivedMs = (selectedOrder as any).riderArrivedAt?.toMillis?.() ?? (selectedOrder as any).riderArrivedAt ?? 0;
                  const pickedMs = (selectedOrder as any).pickedUpAt?.toMillis?.() ?? (selectedOrder as any).pickedUpAt ?? Date.now();
                  const waitMins = Math.floor((pickedMs - arrivedMs) / 60000);
                  if (waitMins < 10) return null;
                  const compensation = (waitMins - 10) * 2;
                  return (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-2">
                      <span className="text-sm">⏱️</span>
                      <div>
                        <p className="text-xs font-black text-yellow-800">Rider Wait: {waitMins} min</p>
                        <p className="text-[10px] text-yellow-600">
                          Wait-time payout: ₹{compensation} (₹2/min after 10 min) — deducted from restaurant commission
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* People */}
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{selectedOrder.restaurantName}</p>
                      <p className="text-xs text-gray-500">Restaurant</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{selectedOrder.customerName}</p>
                      <p className="text-xs text-gray-500">{selectedOrder.deliveryAddress}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${selectedOrder.riderId ? 'bg-green-100' : 'bg-yellow-100'}`}>
                      <Bike className={`w-4 h-4 ${selectedOrder.riderId ? 'text-green-600' : 'text-yellow-600'}`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-800">{selectedOrder.riderName || 'Not Assigned'}</p>
                      <p className="text-xs text-gray-500">Delivery Partner</p>
                    </div>
                    {selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        whileHover={{ scale: 1.03 }}
                        onClick={() => { setShowAssignModal(true); setSelectedRiderId(selectedOrder.riderId || ''); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        {selectedOrder.riderId ? 'Reassign' : 'Assign'}
                      </motion.button>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 mb-3 border-b pb-2">Order Items</h3>
                  <div className="space-y-2">
                    {selectedOrder.items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600">{item.quantity}x {item.name}</span>
                        <span className="font-medium text-gray-800">₹{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bill */}
                <div className="bg-gray-50 p-4 rounded-xl space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Item Total</span>
                    <span>₹{(selectedOrder.totalAmount - (selectedOrder.deliveryFee || 0) - (selectedOrder.tax || 0) - (selectedOrder.platformFee || 0)).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Delivery Fee</span>
                    <span>₹{(selectedOrder.deliveryFee || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Taxes & Platform Fee</span>
                    <span>₹{((selectedOrder.tax || 0) + (selectedOrder.platformFee || 0)).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-800 pt-2 border-t border-gray-200">
                    <span>Grand Total</span>
                    <span>₹{selectedOrder.totalAmount?.toFixed(2)}</span>
                  </div>
                </div>

                {/* Delivery Verification */}
                {(selectedOrder.deliveryOtpVerified !== undefined || selectedOrder.geofenceFailed || selectedOrder.deliveryPhotoUrl) && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-800 mb-3 border-b pb-2">Delivery Verification</h3>
                    <div className="space-y-2">
                      {selectedOrder.deliveryOtpVerified !== undefined && (
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${selectedOrder.deliveryOtpVerified ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                          <span>{selectedOrder.deliveryOtpVerified ? '✅' : '⏳'}</span>
                          <span className="font-bold">OTP {selectedOrder.deliveryOtpVerified ? 'Verified' : 'Not yet verified'}</span>
                        </div>
                      )}
                      {selectedOrder.deliveryPhotoUrl && (
                        <a href={selectedOrder.deliveryPhotoUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 hover:bg-blue-100">
                          <span>📷</span>
                          <span className="font-bold">View Delivery Photo</span>
                        </a>
                      )}
                      {selectedOrder.geofenceFailed && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700">
                          <span>🚨</span>
                          <span className="font-bold">Suspicious: Rider was &gt;50m from delivery location</span>
                        </div>
                      )}
                      {selectedOrder.waitTimeMins && selectedOrder.waitTimeMins > 10 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-yellow-50 text-yellow-700">
                          <span>⏱️</span>
                          <span className="font-bold">Rider waited {selectedOrder.waitTimeMins} min at restaurant</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="p-6 border-t border-gray-100 bg-gray-50">
                {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'delivered' && (
                  <button
                    onClick={() => handleCancelOrder(selectedOrder.id)}
                    className="w-full py-3 bg-red-100 text-red-700 font-bold rounded-xl hover:bg-red-200 flex items-center justify-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4" /> Cancel Order
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Assign Rider Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAssignModal && selectedOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-[60]"
              onClick={() => setShowAssignModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[70] max-w-sm mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
                    <Bike className="w-4 h-4 text-brand" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-800">Assign Rider</h3>
                    <p className="text-[11px] text-gray-400">Order <OrderId id={selectedOrder.id} className="text-[11px]" /></p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200"
                >
                  <X className="w-3.5 h-3.5 text-gray-500" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Current assignment info */}
                {selectedOrder.riderId && (
                  <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm">
                    <Bike className="w-4 h-4 text-brand flex-shrink-0" />
                    <span className="text-gray-600">Currently: <span className="font-bold text-gray-800">{selectedOrder.riderName}</span></span>
                  </div>
                )}

                {/* Rider dropdown */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                    Select Rider
                  </label>
                  <div className="relative">
                    <select
                      value={selectedRiderId}
                      onChange={e => setSelectedRiderId(e.target.value)}
                      className="input-field appearance-none pr-9"
                    >
                      <option value="">— Choose a rider —</option>
                      {riders.map(r => (
                        <option key={r.uid} value={r.uid}>
                          {r.name}{r.vehicleType ? ` · ${r.vehicleType}` : ''}{r.phone ? ` · ${r.phone}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  {riders.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1.5">No riders found in the system.</p>
                  )}
                </div>

                {/* Selected rider preview */}
                <AnimatePresence>
                  {selectedRiderId && (() => {
                    const r = riders.find(x => x.uid === selectedRiderId);
                    return r ? (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-full bg-green-200 flex items-center justify-center font-black text-green-700 text-sm flex-shrink-0">
                          {r.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">{r.name}</p>
                          <p className="text-xs text-gray-500">{r.phone}{r.vehicleType ? ` · ${r.vehicleType}` : ''}</p>
                        </div>
                      </motion.div>
                    ) : null;
                  })()}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 text-sm"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleAssignRider}
                  disabled={!selectedRiderId || assigningRider}
                  className="flex-1 py-2.5 bg-brand text-white font-bold rounded-xl hover:bg-orange-600 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {assigningRider ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  {assigningRider ? 'Assigning...' : 'Assign Rider'}
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
