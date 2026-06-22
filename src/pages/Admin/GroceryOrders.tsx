import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, updateDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  ShoppingCart, Clock, CheckCircle, XCircle, Truck, Package,
  Search, Eye, X, MapPin, User, Phone, ChevronDown, ChevronUp,
} from 'lucide-react';

const STATUSES = ['pending','confirmed','picking','out_for_delivery','delivered','cancelled'] as const;
type GroceryOrderStatus = typeof STATUSES[number];

const STATUS_META: Record<GroceryOrderStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:          { label: 'Pending',         color: 'bg-yellow-100 text-yellow-700 border-yellow-200',  icon: <Clock size={12} /> },
  confirmed:        { label: 'Confirmed',        color: 'bg-blue-100 text-blue-700 border-blue-200',        icon: <CheckCircle size={12} /> },
  picking:          { label: 'Picking Items',    color: 'bg-purple-100 text-purple-700 border-purple-200',  icon: <Package size={12} /> },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-orange-100 text-orange-700 border-orange-200',  icon: <Truck size={12} /> },
  delivered:        { label: 'Delivered',        color: 'bg-green-100 text-green-700 border-green-200',     icon: <CheckCircle size={12} /> },
  cancelled:        { label: 'Cancelled',        color: 'bg-red-100 text-red-700 border-red-200',           icon: <XCircle size={12} /> },
};

interface GroceryItem { name: string; qty: number; price: number; unit?: string; }

interface GroceryOrder {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  items: GroceryItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: GroceryOrderStatus;
  address: string;
  storeName?: string;
  createdAt: any;
}

export default function GroceryOrders() {
  const [orders, setOrders]       = useState<GroceryOrder[]>([]);
  const [loading, setLoading]     = useState(true);
  const [query2, setQuery2]       = useState('');
  const [filterStatus, setFilter] = useState<string>('all');
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [updating, setUpdating]   = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'groceryOrders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<GroceryOrder,'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  async function updateStatus(id: string, status: GroceryOrderStatus) {
    setUpdating(id);
    try {
      await updateDoc(doc(db, 'groceryOrders', id), { status });
      toast.success(`Order marked as ${STATUS_META[status].label}`);
    } catch { toast.error('Failed to update status'); }
    setUpdating(null);
  }

  const filtered = orders.filter(o => {
    const matchStatus = filterStatus === 'all' || o.status === filterStatus;
    const q = query2.toLowerCase();
    const matchQ = !q || o.id.toLowerCase().includes(q) || (o.customerName || '').toLowerCase().includes(q) || (o.customerPhone || '').includes(q);
    return matchStatus && matchQ;
  });

  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: orders.filter(o => o.status === s).length }), {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="text-green-600" size={24} /> Grocery Orders
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{orders.length} total orders</p>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${filterStatus === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        >
          All ({orders.length})
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${filterStatus === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {STATUS_META[s].label} ({counts[s] || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query2}
          onChange={e => setQuery2(e.target.value)}
          placeholder="Search by name, phone, order ID…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
      </div>

      {/* Orders list */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <p className="text-4xl mb-3">🛒</p>
            <p className="font-bold text-gray-700">No grocery orders</p>
            <p className="text-sm text-gray-400 mt-1">Orders will appear here once customers place them</p>
          </div>
        ) : (
          filtered.map((order, i) => {
            const meta = STATUS_META[order.status] || STATUS_META.pending;
            const isOpen = expanded === order.id;
            const ts = order.createdAt?.toDate?.();
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                {/* Row */}
                <div className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-gray-900 text-sm">#{order.id.slice(-6).toUpperCase()}</span>
                      <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {order.customerName && <span className="flex items-center gap-1"><User size={11} />{order.customerName}</span>}
                      {order.customerPhone && <span className="flex items-center gap-1"><Phone size={11} />{order.customerPhone}</span>}
                      {ts && <span>{ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>

                  <div className="text-right mr-3">
                    <p className="font-bold text-gray-900">₹{order.total}</p>
                    <p className="text-xs text-gray-400">{order.items?.length || 0} items</p>
                  </div>

                  {/* Status changer */}
                  <select
                    value={order.status}
                    disabled={updating === order.id}
                    onChange={e => updateStatus(order.id, e.target.value as GroceryOrderStatus)}
                    className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>

                  <button
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                    className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
                  >
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Expanded items */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3"
                    >
                      {order.address && (
                        <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl p-3">
                          <MapPin size={13} className="mt-0.5 text-green-600 shrink-0" />
                          <span>{order.address}</span>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {(order.items || []).map((item, j) => (
                          <div key={j} className="flex items-center justify-between text-sm">
                            <span className="text-gray-700">{item.qty}× {item.name} {item.unit ? `(${item.unit})` : ''}</span>
                            <span className="font-semibold text-gray-900">₹{item.price * item.qty}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
                        <div className="flex justify-between text-gray-500">
                          <span>Subtotal</span><span>₹{order.subtotal}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>Delivery</span><span>₹{order.deliveryFee || 0}</span>
                        </div>
                        <div className="flex justify-between font-bold text-gray-900">
                          <span>Total</span><span>₹{order.total}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
