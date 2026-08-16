import { useState, useEffect, useMemo, useRef } from 'react';
import { OrderId } from '../../components/OrderId';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, updateDoc, getDocs, getDoc,
  onSnapshot, query, orderBy, where, limit, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search, Eye, XCircle, UserPlus, MapPin, CheckCircle,
  AlertTriangle, Bike, ChevronDown, X, Clock,
  Siren, Zap, RefreshCw, ChevronRight,
} from 'lucide-react';

interface OrderDoc {
  id: string;
  customerId: string;
  customerName: string;
  restaurantId: string;
  restaurantName: string;
  riderId?: string;
  riderName?: string;
  status: 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'customer_unavailable';
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
  deliveryOtp?: string;
  displayOrderId?: string;
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
  const assigningRef = useRef(false);
  const [selectedRiderId, setSelectedRiderId] = useState('');

  // Rapido manual booking state
  const [rapidoForm, setRapidoForm] = useState({ pickupOtp: '', captainName: '', captainPhone: '', trackingUrl: '', deliveryOtp: '' });
  const [savingRapido, setSavingRapido] = useState(false);
  const [restaurantPhone, setRestaurantPhone] = useState<string>('');

  // Reset Rapido form when a different order is opened; pre-fill existing OTP
  useEffect(() => {
    const existingOtp = (selectedOrder as any)?.deliveryOtp ?? '';
    setRapidoForm({ pickupOtp: '', captainName: '', captainPhone: '', trackingUrl: '', deliveryOtp: existingOtp });
  }, [selectedOrderId]);

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, snapshot => {
      setOrders(snapshot.docs.map(d => {
        const data = d.data() as Record<string, any>;
        return {
          id: d.id,
          ...data,
          // normalize field name variants written by different apps
          customerName: data.customerName || data.name || '—',
          totalAmount:  data.totalAmount ?? data.total ?? data.orderAmount ?? 0,
          deliveryAddress: (() => {
            const da = data.deliveryAddress;
            const cleanAddr = (s: string) =>
              s.replace(/\b[A-Z0-9]{4}\+[A-Z0-9]{2,}\b,?\s*/g, '').replace(/,\s*,/g, ',').trim().replace(/^,|,$/g, '').trim();
            if (typeof da === 'string' && da) return cleanAddr(da);
            if (da && typeof da === 'object') {
              const parts = [
                da.street || da.address || da.line1 || '',
                da.area || da.locality || '',
                da.city || '',
                da.state || '',
                da.pincode || da.zip || '',
              ].filter(Boolean).join(', ');
              return cleanAddr(parts);
            }
            return cleanAddr(data.customerAddress || data.address || '—');
          })(),
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

  const [restaurantAddress, setRestaurantAddress] = useState<string>('');

  // Fetch restaurant phone + address when order is selected
  useEffect(() => {
    setRestaurantPhone('');
    setRestaurantAddress('');
    if (!selectedOrder?.restaurantId) return;
    getDoc(doc(db, 'restaurants', selectedOrder.restaurantId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setRestaurantPhone(data.phone || data.ownerPhone || data.contactPhone || '');
        setRestaurantAddress(data.address || data.fullAddress || data.location?.address || '');
      }
    });
  }, [selectedOrder?.restaurantId]);

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
            fcmToken: d.data().fcmToken || null,
          }))
          .filter(r => r.name !== '—')
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  }, []);

  const handleAssignRider = async () => {
    if (!selectedOrder || !selectedRiderId) return;
    if (assigningRef.current) return; // prevent double-submit
    const rider = riders.find(r => r.uid === selectedRiderId);
    if (!rider) return;
    assigningRef.current = true;
    setAssigningRider(true);
    try {
      const assignmentExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes to accept

      // If a previous rider had already accepted (riderId set) or the order is in a
      // post-accept terminal state, we must clear the old rider and reset status to
      // 'ready' so the new rider can accept. Without this, useOrderAssignment filters
      // the order as terminal and the assignment popup never appears.
      const postAcceptStatuses = ['out_for_delivery', 'picked_up'];
      const needsReset = !!selectedOrder.riderId || postAcceptStatuses.includes(selectedOrder.status);

      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        assignedRiderId:   rider.uid,
        assignedRiderName: rider.name,
        assignmentExpiry,
        ...(needsReset ? {
          riderId:   null,
          riderName: null,
          riderPhone: null,
          status:    'ready',
        } : {}),
        updatedAt: Timestamp.now(),
      });
      // Send FCM push so rider app shows the assignment popup immediately
      fetch('/api/notify-rider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riderId:  rider.uid,
          fcmToken: (rider as any).fcmToken || null,
          orderId:  selectedOrder.id,
          type:     'delivery_request',
          sentAt:   Date.now(),
          title:    '🛵 New Delivery Request!',
          body:     `Order #${selectedOrder.id.slice(-6)} assigned by admin — tap to accept!`,
        }),
      }).catch(() => {});
      toast.success(`Rider "${rider.name}" notified — waiting for acceptance`);
      setShowAssignModal(false);
      setSelectedRiderId('');
    } catch {
      toast.error('Failed to assign rider');
    } finally {
      assigningRef.current = false;
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
    if (!window.confirm('Cancel this order and trigger auto-refund?')) return;
    const order = orders.find(o => o.id === orderId);
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status:             'cancelled',
        statusBeforeCancel: order?.status || 'unknown',
        cancelledBy:        'admin',
        cancellationReason: 'Admin cancelled',
        updatedAt:          Timestamp.now(),
      });
      // Trigger auto-refund
      fetch('/api/auto-refund', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId, cancelledBy: 'admin', cancellationReason: 'Admin cancelled' }),
      }).then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          toast.error(`Refund failed: ${e.error || r.status}`);
        }
      }).catch(() => toast.error('Refund request failed — check server logs'));
      toast.success('Order cancelled and refund triggered');
      setSelectedOrderId(null);
    } catch {
      toast.error('Failed to cancel order');
    }
  };

  const handleEscalate = async (orderId: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { escalated: true, escalatedAt: Timestamp.now() });
      toast.success('Order escalated — support team notified');
    } catch {
      toast.error('Failed to escalate');
    }
  };

  const handleSaveRapidoDetails = async () => {
    if (!selectedOrder) return;
    setSavingRapido(true);
    try {
      const updates: any = {
        deliverySource: 'rapido_manual',
        updatedAt: Timestamp.now(),
      };
      if (rapidoForm.pickupOtp)   updates.pickupOtp = rapidoForm.pickupOtp.trim();
      if (rapidoForm.deliveryOtp) updates.deliveryOtp     = rapidoForm.deliveryOtp.trim();
      if (rapidoForm.captainName || rapidoForm.captainPhone) {
        const captainName  = rapidoForm.captainName.trim()  || 'Rapido Captain';
        const captainPhone = rapidoForm.captainPhone.trim() || null;
        updates.rapidoRider = { name: captainName, phone: captainPhone };
        // Flat fields — these are what the customer app reads
        updates.riderName  = captainName;
        updates.riderPhone = captainPhone;
      }
      if (rapidoForm.trackingUrl) {
        const trackingUrl = rapidoForm.trackingUrl.trim();
        updates.rapidoTrackingUrl = trackingUrl;
        updates.trackingUrl = trackingUrl; // flat field read by customer app
      }
      // Auto set out_for_delivery when captain details saved
      if (rapidoForm.captainName || rapidoForm.captainPhone) {
        updates.status = 'out_for_delivery';
        updates.pickedUpAt = Timestamp.now();
      }
      await updateDoc(doc(db, 'orders', selectedOrder.id), updates);

      // Send push notification to customer when captain is on the way
      if (updates.status === 'out_for_delivery') {
        const captainName = rapidoForm.captainName.trim() || 'Rapido Captain';
        fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId:  selectedOrder.customerId,
            orderId: selectedOrder.id,
            title:   '🛵 Your order is on the way!',
            body:    `${captainName} is delivering your order. ${rapidoForm.deliveryOtp ? `Delivery OTP: ${rapidoForm.deliveryOtp.trim()}` : ''}`.trim(),
            type:    'order_update',
          }),
        }).catch(() => {});
      }

      toast.success('Rapido details saved ✅');
      setRapidoForm({ pickupOtp: '', captainName: '', captainPhone: '', trackingUrl: '', deliveryOtp: (selectedOrder as any).deliveryOtp ?? '' });
    } catch {
      toast.error('Failed to save Rapido details');
    } finally {
      setSavingRapido(false);
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status:      'delivered',
        deliveredAt: Timestamp.now(),
        updatedAt:   Timestamp.now(),
      });
      toast.success('Order marked as Delivered ✅');
    } catch {
      toast.error('Failed to mark delivered');
    }
  };

  const handleTogglePriority = async (orderId: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { isPriority: !current });
      toast.success(current ? 'Priority removed' : '⚡ Marked as Priority Delivery');
    } catch {
      toast.error('Failed to update priority');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'accepted': case 'preparing': case 'ready': return 'bg-blue-100 text-blue-800';
      case 'picked_up': case 'out_for_delivery': return 'bg-purple-100 text-purple-800';
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
          <option value="accepted">Accepted</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="picked_up">Picked Up</option>
          <option value="out_for_delivery">Out for Delivery</option>
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
                          {o.status === 'customer_unavailable' ? '🚨 Rider Waiting' : o.status === 'out_for_delivery' ? 'Out for Delivery' : o.status.replace(/_/g, ' ')}
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
                {/* ── Rapido Manual Booking ─────────────────────────── */}
                {selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                  <div className="border-2 border-yellow-300 bg-yellow-50 rounded-2xl p-4 space-y-4">
                    <p className="text-xs font-black text-yellow-700 uppercase tracking-widest">🛵 Rapido Manual Booking</p>

                    {/* STEP 1 — Locations */}
                    <div className="bg-white rounded-xl p-3 space-y-2 border border-yellow-100">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Step 1 — Locations చూడు</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-blue-500 uppercase">🍽️ Pickup</p>
                          <p className="text-xs font-bold text-gray-700 leading-tight">{selectedOrder.restaurantName}</p>
                          {restaurantAddress && <p className="text-[10px] text-gray-400 leading-tight">{restaurantAddress}</p>}
                          {restaurantPhone && <a href={`tel:${restaurantPhone}`} className="text-xs font-black text-blue-600 block">{restaurantPhone}</a>}
                          {(selectedOrder as any).restaurantLat && (
                            <a href={`https://maps.google.com/?q=${(selectedOrder as any).restaurantLat},${(selectedOrder as any).restaurantLng}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 underline">📍 Map చూడు</a>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-green-500 uppercase">🏠 Drop</p>
                          <p className="text-xs font-bold text-gray-700 leading-tight">{selectedOrder.customerName}</p>
                          <p className="text-[10px] text-gray-400 leading-tight">{selectedOrder.deliveryAddress}</p>
                          {(selectedOrder as any).customerPhone && <a href={`tel:${(selectedOrder as any).customerPhone}`} className="text-xs font-black text-green-600 block">{(selectedOrder as any).customerPhone}</a>}
                          {(selectedOrder as any).customerLat && (
                            <a href={`https://maps.google.com/?q=${(selectedOrder as any).customerLat},${(selectedOrder as any).customerLng}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-green-500 underline">📍 Map చూడు</a>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* STEP 2 — Book on Rapido */}
                    <div className="bg-white rounded-xl p-3 space-y-2 border border-yellow-100">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Step 2 — Rapido లో Book చేయి</p>
                      <p className="text-[10px] text-red-600 font-bold bg-red-50 rounded-lg px-2 py-1">⚠️ "Bike Ride" కాదు — "Parcel" option select చేయి!</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            const addr = `${selectedOrder.restaurantName}${restaurantAddress ? ', ' + restaurantAddress : ''}`.trim();
                            navigator.clipboard.writeText(addr).then(() => toast.success('Pickup address copied!'));
                          }}
                          className="py-2 bg-blue-50 text-blue-700 font-black rounded-xl text-[10px] hover:bg-blue-100 border border-blue-200"
                        >
                          📋 Copy Pickup
                        </button>
                        <button
                          onClick={() => {
                            const custPhone = (selectedOrder as any).customerPhone || '';
                            const addr = `${selectedOrder.deliveryAddress || ''}${custPhone ? ' Ph:' + custPhone : ''}`;
                            navigator.clipboard.writeText(addr).then(() => toast.success('Drop address + phone copied!'));
                          }}
                          className="py-2 bg-green-50 text-green-700 font-black rounded-xl text-[10px] hover:bg-green-100 border border-green-200"
                        >
                          📋 Copy Drop + Ph
                        </button>
                      </div>
                      <a
                        href="https://m.rapido.bike"
                        target="_blank" rel="noopener noreferrer"
                        className="block w-full py-2.5 bg-black text-white font-black rounded-xl text-xs text-center hover:bg-gray-900"
                      >
                        🛵 Open Rapido — Parcel Book చేయి
                      </a>
                    </div>

                    {/* STEP 3 — After booking enter details */}
                    <div className="bg-white rounded-xl p-3 space-y-2 border border-yellow-100">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Step 3 — Captain Details Enter చేయి</p>

                      {/* Delivery OTP for customer */}
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-2.5 space-y-1.5">
                        <p className="text-[10px] font-black text-orange-600 uppercase">🔑 Delivery OTP — Customer కి show అవుతుంది</p>
                        <div className="flex gap-2">
                          <input
                            type="text" inputMode="numeric" maxLength={6}
                            placeholder="e.g. 7823"
                            value={rapidoForm.deliveryOtp}
                            onChange={e => setRapidoForm(f => ({ ...f, deliveryOtp: e.target.value }))}
                            className="flex-1 px-3 py-2 rounded-xl border border-orange-200 text-sm font-mono font-black bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 tracking-widest"
                          />
                          <button
                            onClick={() => {
                              const otp = String(1000 + Math.floor(Math.random() * 9000));
                              setRapidoForm(f => ({ ...f, deliveryOtp: otp }));
                            }}
                            className="px-3 py-2 bg-orange-100 text-orange-700 font-black rounded-xl text-xs hover:bg-orange-200"
                          >Generate</button>
                        </div>
                        <p className="text-[9px] text-orange-500">Rider customer దగ్గర ఈ OTP అడుగుతాడు → delivery confirm</p>
                      </div>

                      <input
                        type="text" inputMode="numeric" maxLength={6}
                        placeholder="Pickup OTP (restaurant కి — e.g. 4521)"
                        value={rapidoForm.pickupOtp}
                        onChange={e => setRapidoForm(f => ({ ...f, pickupOtp: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-yellow-200 text-sm font-mono font-black bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <input
                        type="text"
                        placeholder="Captain Name"
                        value={rapidoForm.captainName}
                        onChange={e => setRapidoForm(f => ({ ...f, captainName: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-yellow-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <input
                        type="tel"
                        placeholder="Captain Phone"
                        value={rapidoForm.captainPhone}
                        onChange={e => setRapidoForm(f => ({ ...f, captainPhone: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-yellow-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <input
                        type="url"
                        placeholder="Tracking URL (optional)"
                        value={rapidoForm.trackingUrl}
                        onChange={e => setRapidoForm(f => ({ ...f, trackingUrl: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-yellow-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                      <button
                        onClick={handleSaveRapidoDetails}
                        disabled={savingRapido || (!rapidoForm.pickupOtp && !rapidoForm.captainName && !rapidoForm.deliveryOtp)}
                        className="w-full py-2.5 bg-green-500 text-white font-black rounded-xl text-sm hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {savingRapido ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save & Notify Restaurant + Customer
                      </button>
                    </div>

                    {/* STEP 4 — WhatsApp Captain */}
                    {(rapidoForm.captainPhone || (selectedOrder as any).rapidoRider?.phone) && (
                      <div className="bg-white rounded-xl p-3 border border-yellow-100 space-y-2">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Step 4 — Captain కి WhatsApp పంపు</p>
                        {(() => {
                          const captPhone = rapidoForm.captainPhone || (selectedOrder as any).rapidoRider?.phone || '';
                          const custPhone = (selectedOrder as any).customerPhone || '';
                          const restLat = (selectedOrder as any).restaurantLat;
                          const restLng = (selectedOrder as any).restaurantLng;
                          const custLat = (selectedOrder as any).customerLat;
                          const custLng = (selectedOrder as any).customerLng;
                          const msg = encodeURIComponent(`🛵 ManaBites Delivery

📍 PICKUP: ${selectedOrder.restaurantName}
${restaurantAddress || ''}
Ph: ${restaurantPhone || ''}
${restLat && restLng ? `Maps: https://maps.google.com/?q=${restLat},${restLng}` : ''}

🏠 DROP: ${selectedOrder.customerName}
${selectedOrder.deliveryAddress || ''}
Ph: ${custPhone}
${custLat && custLng ? `Maps: https://maps.google.com/?q=${custLat},${custLng}` : ''}`);
                          return (
                            <a
                              href={`https://wa.me/91${captPhone.replace(/\D/g,'')}?text=${msg}`}
                              target="_blank" rel="noopener noreferrer"
                              className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-500 text-white font-black rounded-xl text-xs hover:bg-green-600"
                            >
                              💬 WhatsApp Captain — Delivery Details Send
                            </a>
                          );
                        })()}
                      </div>
                    )}

                    {/* STEP 5 — Mark Delivered */}
                    {(selectedOrder.status === 'out_for_delivery' || selectedOrder.status === 'picked_up') && (
                      <div className="bg-white rounded-xl p-3 border border-yellow-100 space-y-2">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Step 5 — Delivered అయిన తర్వాత</p>
                        <button
                          onClick={() => handleMarkDelivered(selectedOrder.id)}
                          className="w-full py-2.5 bg-brand text-white font-black rounded-xl text-sm hover:bg-orange-600 flex items-center justify-center gap-2"
                        >
                          ✅ Mark Delivered
                        </button>
                      </div>
                    )}

                    {/* Show saved info */}
                    {((selectedOrder as any).pickupOtp || (selectedOrder as any).rapidoRider?.name) && (
                      <div className="bg-white rounded-xl px-3 py-2 space-y-1 border border-yellow-100">
                        {(selectedOrder as any).pickupOtp && (
                          <p className="text-xs font-bold text-gray-700">🔑 Pickup OTP: <span className="font-mono text-base text-yellow-700">{(selectedOrder as any).pickupOtp}</span></p>
                        )}
                        {(selectedOrder as any).rapidoRider?.name && (
                          <p className="text-xs font-bold text-gray-700">🛵 Captain: {(selectedOrder as any).rapidoRider.name} · {(selectedOrder as any).rapidoRider.phone || '—'}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

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
                {(() => {
                  const o = selectedOrder as any;
                  const walletDiscount = o.walletDiscount ?? 0;
                  const couponDiscount = o.couponDiscount ?? o.discount ?? 0;
                  const itemTotal = selectedOrder.totalAmount
                    - (selectedOrder.deliveryFee || 0)
                    - (selectedOrder.tax || 0)
                    - (selectedOrder.platformFee || 0)
                    + walletDiscount
                    + couponDiscount;
                  return (
                    <div className="bg-gray-50 p-4 rounded-xl space-y-2 text-sm">
                      <div className="flex justify-between text-gray-600">
                        <span>Item Total</span>
                        <span>₹{itemTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Delivery Fee</span>
                        <span>₹{(selectedOrder.deliveryFee || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Taxes & Platform Fee</span>
                        <span>₹{((selectedOrder.tax || 0) + (selectedOrder.platformFee || 0)).toFixed(2)}</span>
                      </div>
                      {walletDiscount > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>Wallet Discount</span>
                          <span>−₹{walletDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      {couponDiscount > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>Coupon Discount{o.couponCode ? ` (${o.couponCode})` : ''}</span>
                          <span>−₹{couponDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-gray-800 pt-2 border-t border-gray-200">
                        <span>Grand Total</span>
                        <span>₹{selectedOrder.totalAmount?.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Delivery Verification */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 mb-3 border-b pb-2">Delivery Verification</h3>
                  <div className="space-y-2">
                    {/* Order ID */}
                    {(selectedOrder as any).displayOrderId && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-50 text-gray-700">
                        <span>🆔</span>
                        <span className="font-mono font-bold">{(selectedOrder as any).displayOrderId}</span>
                      </div>
                    )}
                    {/* OTP code — admin only */}
                    {selectedOrder.deliveryOtp && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-orange-50 text-orange-700">
                        <div className="flex items-center gap-2">
                          <span>🔑</span>
                          <span className="font-bold">Delivery OTP:</span>
                          <span className="font-mono text-lg font-black tracking-widest">{selectedOrder.deliveryOtp}</span>
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(selectedOrder.deliveryOtp!).then(() => toast.success('OTP copied')).catch(() => {})}
                          className="text-xs bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold"
                        >Copy</button>
                      </div>
                    )}
                    {/* OTP verified status */}
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
                    {/* Regenerate OTP */}
                    {selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                      <button
                        onClick={async () => {
                          const newOtp = String(1000 + Math.floor(Math.random() * 9000));
                          try {
                            await updateDoc(doc(db, 'orders', selectedOrder.id), { deliveryOtp: newOtp });
                            toast.success(`New OTP generated: ${newOtp}`);
                          } catch { toast.error('Failed to regenerate OTP'); }
                        }}
                        className="w-full py-2 bg-orange-50 text-orange-700 font-bold rounded-xl text-sm hover:bg-orange-100 flex items-center justify-center gap-2"
                      >
                        🔄 Regenerate Delivery OTP
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Order Timeline ─────────────────────────────────────── */}
              {(() => {
                const o = selectedOrder as any;
                const TIMELINE = [
                  { label: 'Order Placed',       ts: o.createdAt,    emoji: '📝' },
                  { label: 'Restaurant Accepted', ts: o.acceptedAt,   emoji: '✅' },
                  { label: 'Preparing',           ts: o.preparingAt,  emoji: '👨‍🍳' },
                  { label: 'Ready',               ts: o.readyAt,      emoji: '📦' },
                  { label: 'Rider Assigned',      ts: o.riderAssignedAt || o.assignedAt, emoji: '🛵' },
                  { label: 'Picked Up',           ts: o.pickedUpAt,   emoji: '⬆️' },
                  { label: 'Delivered',           ts: o.deliveredAt,  emoji: '🏠' },
                ];
                const steps = TIMELINE.filter(s => s.ts);
                if (!steps.length) return null;
                return (
                  <div className="px-6 pb-4">
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Order Timeline</p>
                    <div className="relative">
                      <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-100" />
                      <div className="space-y-3">
                        {steps.map((s, i) => (
                          <div key={i} className="flex items-start gap-3 relative">
                            <div className="w-7 h-7 rounded-full bg-white border-2 border-brand flex items-center justify-center text-sm z-10 flex-shrink-0">
                              {s.emoji}
                            </div>
                            <div className="pt-0.5">
                              <p className="text-sm font-bold text-gray-800">{s.label}</p>
                              <p className="text-xs text-gray-400">{formatDate(s.ts)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {o.cancellationReason && (
                      <div className="mt-3 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-700 font-bold">
                        ❌ Cancelled: {o.cancellationReason} {o.cancelledBy ? `(by ${o.cancelledBy})` : ''}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Admin Actions ──────────────────────────────────────── */}
              <div className="p-6 border-t border-gray-100 bg-gray-50 space-y-2">
                {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'delivered' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleTogglePriority(selectedOrder.id, !!(selectedOrder as any).isPriority)}
                        className={`py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                          (selectedOrder as any).isPriority
                            ? 'bg-yellow-400 text-white'
                            : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                        {(selectedOrder as any).isPriority ? 'Priority ✓' : 'Set Priority'}
                      </button>
                      <button
                        onClick={() => handleEscalate(selectedOrder.id)}
                        disabled={!!(selectedOrder as any).escalated}
                        className="py-2.5 rounded-xl bg-orange-50 text-orange-700 font-bold text-sm flex items-center justify-center gap-2 hover:bg-orange-100 disabled:opacity-50"
                      >
                        <Siren className="w-4 h-4" />
                        {(selectedOrder as any).escalated ? 'Escalated ✓' : 'Escalate'}
                      </button>
                    </div>
                    <button
                      onClick={() => { setShowAssignModal(true); }}
                      className="w-full py-2.5 bg-blue-50 text-blue-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-blue-100"
                    >
                      <RefreshCw className="w-4 h-4" /> Reassign Rider
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Override delivery? This marks the order as delivered without OTP verification.')) return;
                        try {
                          await updateDoc(doc(db, 'orders', selectedOrder.id), {
                            status: 'delivered',
                            deliveredAt: Timestamp.now(),
                            deliveryOtpVerified: false,
                            adminOverride: true,
                            adminOverrideAt: Timestamp.now(),
                            updatedAt: Timestamp.now(),
                          });
                          toast.success('Order marked as delivered (admin override)');
                        } catch { toast.error('Override failed'); }
                      }}
                      className="w-full py-2.5 bg-green-50 text-green-700 font-bold rounded-xl text-sm hover:bg-green-100 flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" /> Override Delivery (Admin)
                    </button>
                    <button
                      onClick={() => handleCancelOrder(selectedOrder.id)}
                      className="w-full py-2.5 bg-red-100 text-red-700 font-bold rounded-xl text-sm hover:bg-red-200 flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" /> Cancel Order
                    </button>
                  </>
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
                    <p className="text-[11px] text-gray-400">Order <OrderId id={selectedOrder.id} displayOrderId={(selectedOrder as any).displayOrderId} className="text-[11px]" /></p>
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
