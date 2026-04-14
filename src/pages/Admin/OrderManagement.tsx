import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  collection, doc, updateDoc,
  onSnapshot, query, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search, Filter, Eye, XCircle, UserPlus, Clock, MapPin, CheckCircle, AlertTriangle
} from 'lucide-react';

interface OrderDoc {
  id: string;
  customerId: string;
  customerName: string;
  restaurantId: string;
  restaurantName: string;
  riderId?: string;
  riderName?: string;
  status: 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled';
  totalAmount: number;
  deliveryFee: number;
  platformFee: number;
  tax: number;
  items: any[];
  deliveryAddress: string;
  createdAt: Timestamp;
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
  const [selectedOrder, setSelectedOrder] = useState<OrderDoc | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snapshot => {
      setOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as OrderDoc)));
      setLoading(false);
    }, err => {
      toast.error('Failed to load orders: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

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

  const handleCancelOrder = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'cancelled' });
      toast.success('Order cancelled');
      setSelectedOrder(null);
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
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            📦 Order Management
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Monitor live and past orders</p>
        </div>
      </div>

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
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading orders...</div>
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
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
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
                          {o.status}
                        </span>
                      </td>
                      <td className="table-cell text-gray-500 text-xs">{formatDate(o.createdAt)}</td>
                      <td className="table-cell">
                        <button
                          onClick={() => setSelectedOrder(o)}
                          className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
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
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedOrder(null)}
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
                <button onClick={() => setSelectedOrder(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
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
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <UserPlus className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{selectedOrder.riderName || 'Not Assigned'}</p>
                      <p className="text-xs text-gray-500">Delivery Partner</p>
                    </div>
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
    </div>
  );
}
