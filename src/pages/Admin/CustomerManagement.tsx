import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  collection, doc, updateDoc, query,
  onSnapshot, getDocs, orderBy, Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../../firebase';
import {
  Key, ToggleLeft, ToggleRight, Search, Users, X,
  ShoppingBag, Clock, Download, FileText, ExternalLink, UserCog,
} from 'lucide-react';

const ROLE_LINKS: Record<string, string> = {
  rider:      'https://manabites-rider.vercel.app/rider-register',
  restaurant: 'https://restarent-tau.vercel.app/',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerDoc {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role?: string;
  isActive: boolean;
  referralCode?: string;
  referredBy?: string;
  referralCount?: number;
  createdAt: Timestamp;
}

interface OrderDoc {
  id: string;
  restaurantName: string;
  status: string;
  totalAmount: number;
  items: any[];
  createdAt: Timestamp;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-blue-100 text-blue-800',
  preparing: 'bg-blue-100 text-blue-800',
  ready: 'bg-indigo-100 text-indigo-800',
  picked_up: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

// ── CSV Download ──────────────────────────────────────────────────────────────

function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerManagement() {
  const [customers, setCustomers] = useState<CustomerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDoc | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrderDoc[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // ── Load ALL users (excluding admin/rider/restaurant) ──────────────────────
  useEffect(() => {
    // No role filter — show everyone except known non-customer roles
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      const all = snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as CustomerDoc))
        .filter(u => !['admin', 'rider', 'restaurant'].includes(u.role ?? ''))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setCustomers(all);
      setLoading(false);
    }, err => {
      toast.error('Failed to load customers: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const loadOrders = async (customer: CustomerDoc) => {
    setSelectedCustomer(customer);
    setOrdersLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      );
      // Filter client-side for the selected customer
      const orders = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as OrderDoc))
        .filter((o: any) => o.customerId === customer.uid);
      setCustomerOrders(orders);
    } catch {
      toast.error('Failed to load order history');
    } finally {
      setOrdersLoading(false);
    }
  };

  const filtered = useMemo(() => customers.filter(c => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !searchQuery ||
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(searchQuery);
    const matchStatus =
      statusFilter === 'all' ? true :
      statusFilter === 'active' ? c.isActive !== false :
      c.isActive === false;
    return matchSearch && matchStatus;
  }), [customers, searchQuery, statusFilter]);

  const stats = useMemo(() => ({
    total: customers.length,
    active: customers.filter(c => c.isActive !== false).length,
    inactive: customers.filter(c => c.isActive === false).length,
  }), [customers]);

  const handleToggleStatus = async (c: CustomerDoc) => {
    try {
      await updateDoc(doc(db, 'users', c.uid), { isActive: c.isActive === false });
      toast.success(`Customer ${c.isActive === false ? 'unblocked' : 'blocked'}`);
    } catch { toast.error('Failed to update status'); }
  };

  const handleResetPassword = async (c: CustomerDoc) => {
    if (!c.email) { toast.error('No email on record'); return; }
    try {
      await sendPasswordResetEmail(auth, c.email);
      toast.success(`Reset email sent to ${c.email}`);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleChangeRole = async (c: CustomerDoc, newRole: string) => {
    try {
      await updateDoc(doc(db, 'users', c.uid), { role: newRole, updatedAt: new Date() });
      toast.success(`${c.name || 'User'} role changed to ${newRole}`);
      const link = ROLE_LINKS[newRole];
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    } catch { toast.error('Failed to change role'); }
  };

  // ── Download customer statement ────────────────────────────────────────────
  const downloadCustomerStatement = () => {
    const rows = [
      ['#', 'Name', 'Email', 'Phone', 'Status', 'Referral Code', 'Joined'],
      ...filtered.map((c, i) => [
        i + 1,
        c.name || '—',
        c.email || '—',
        c.phone || '—',
        c.isActive !== false ? 'Active' : 'Blocked',
        c.referralCode || '—',
        formatDate(c.createdAt),
      ]),
    ];
    downloadCSV(rows, `manabites-customers-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('Customer list downloaded!');
  };

  // ── Download order statement for selected customer ─────────────────────────
  const downloadOrderStatement = () => {
    if (!selectedCustomer || customerOrders.length === 0) return;
    const rows = [
      ['Order ID', 'Restaurant', 'Status', 'Amount (₹)', 'Date'],
      ...customerOrders.map(o => [
        o.id.slice(0, 8).toUpperCase(),
        o.restaurantName || '—',
        o.status,
        (o.totalAmount || 0).toFixed(2),
        formatDateTime(o.createdAt),
      ]),
    ];
    downloadCSV(rows, `orders-${selectedCustomer.name || selectedCustomer.uid}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('Order statement downloaded!');
  };

  const orderTotal = customerOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const deliveredCount = customerOrders.filter(o => o.status === 'delivered').length;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800">Customer Management</h1>
          <p className="text-gray-400 text-sm mt-0.5">All registered users</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={downloadCustomerStatement}
          className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors text-sm shadow-lg shadow-green-200"
        >
          <Download className="w-4 h-4" /> Download List
        </motion.button>
      </motion.div>

      {/* Stat Cards with green animation */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Members', value: stats.total, color: 'border-green-500', bg: 'bg-green-50', textColor: 'text-green-700' },
          { label: 'Active', value: stats.active, color: 'border-emerald-400', bg: 'bg-emerald-50', textColor: 'text-emerald-700' },
          { label: 'Blocked', value: stats.inactive, color: 'border-red-400', bg: 'bg-red-50', textColor: 'text-red-600' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.color} relative overflow-hidden`}
          >
            {/* green pulse background */}
            {i < 2 && (
              <motion.div
                className={`absolute inset-0 ${s.bg} rounded-2xl`}
                initial={{ opacity: 0.6 }}
                animate={{ opacity: [0.6, 0.2, 0.6] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.5 }}
              />
            )}
            <div className="relative">
              <p className={`text-3xl font-black ${s.textColor}`}>{s.value}</p>
              <p className="text-xs text-gray-500 font-semibold mt-0.5">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="input-field pl-10"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="input-field w-36">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Blocked</option>
        </select>
      </div>

      <div className="flex gap-5">
        {/* Table */}
        <div className={`bg-white rounded-2xl shadow-card overflow-hidden ${selectedCustomer ? 'flex-1' : 'w-full'}`}>
          {loading ? (
            <div className="p-12 text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-3"
              />
              <p className="text-gray-400 text-sm">Loading members...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">#</th>
                    <th className="table-header">Member</th>
                    <th className="table-header">Contact</th>
                    {!selectedCustomer && <th className="table-header">Referral</th>}
                    <th className="table-header">Status</th>
                    <th className="table-header">Joined</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {filtered.map((c, i) => (
                      <motion.tr
                        key={c.uid}
                        initial={{ opacity: 0, x: -10, y: 6 }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.02, duration: 0.22 }}
                        onClick={() => loadOrders(c)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          selectedCustomer?.uid === c.uid
                            ? 'bg-green-50 border-l-4 border-l-green-500'
                            : 'hover:bg-green-50/40'
                        }`}
                      >
                        <td className="table-cell text-gray-400 text-xs font-mono">{i + 1}</td>
                        <td className="table-cell font-semibold text-gray-800">
                          <div className="flex items-center gap-2">
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                              className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-sm"
                            >
                              {c.name ? c.name.charAt(0).toUpperCase() : <Users className="w-4 h-4" />}
                            </motion.div>
                            <span className="truncate max-w-[100px]">{c.name || 'Unnamed'}</span>
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="text-gray-800 text-xs font-medium">{c.phone || 'No phone'}</div>
                          <div className="text-gray-400 text-xs truncate max-w-[140px]">{c.email || 'No email'}</div>
                        </td>
                        {!selectedCustomer && (
                          <td className="table-cell">
                            {c.referralCode
                              ? <span className="font-mono text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded-lg">{c.referralCode}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                        )}
                        <td className="table-cell">
                          <motion.span
                            animate={c.isActive !== false ? { boxShadow: ['0 0 0 0 rgba(34,197,94,0.4)', '0 0 0 6px rgba(34,197,94,0)', '0 0 0 0 rgba(34,197,94,0)'] } : {}}
                            transition={{ duration: 2, repeat: Infinity }}
                            className={`badge ${c.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${c.isActive !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                            {c.isActive !== false ? 'Active' : 'Blocked'}
                          </motion.span>
                        </td>
                        <td className="table-cell text-gray-400 text-xs">{formatDate(c.createdAt)}</td>
                        <td className="table-cell" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 flex-wrap">
                            <button onClick={() => handleResetPassword(c)} className="w-7 h-7 bg-yellow-50 text-yellow-600 rounded-lg flex items-center justify-center hover:bg-yellow-100" title="Reset Password">
                              <Key className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(c)}
                              className={`px-2 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${
                                c.isActive !== false
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'bg-green-50 text-green-600 hover:bg-green-100'
                              }`}
                            >
                              {c.isActive !== false
                                ? <><ToggleRight className="w-3.5 h-3.5" /> Block</>
                                : <><ToggleLeft className="w-3.5 h-3.5" /> Unblock</>}
                            </button>
                            {/* Role change buttons */}
                            <div className="flex items-center gap-1 mt-0.5">
                              <button
                                onClick={() => handleChangeRole(c, 'rider')}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                title="Change role to Rider & open Rider app"
                              >
                                <UserCog className="w-3 h-3" /> Rider
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                              <button
                                onClick={() => handleChangeRole(c, 'restaurant')}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors"
                                title="Change role to Restaurant & open Restaurant app"
                              >
                                <UserCog className="w-3 h-3" /> Rest.
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="py-16 text-center text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No members found</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Order History Panel ──────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedCustomer && (
            <motion.div
              initial={{ opacity: 0, x: 40, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 320 }}
              exit={{ opacity: 0, x: 40, width: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="bg-white rounded-2xl shadow-card flex flex-col overflow-hidden flex-shrink-0 border-t-4 border-green-500"
              style={{ maxHeight: 'calc(100vh - 220px)', minHeight: 360 }}
            >
              {/* Panel Header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between bg-gradient-to-r from-green-50 to-white">
                <div>
                  <p className="font-black text-gray-800">{selectedCustomer.name || 'Customer'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedCustomer.email || selectedCustomer.phone}</p>
                </div>
                <div className="flex gap-1.5">
                  {customerOrders.length > 0 && (
                    <button
                      onClick={downloadOrderStatement}
                      title="Download statement"
                      className="w-7 h-7 bg-green-100 text-green-700 rounded-lg flex items-center justify-center hover:bg-green-200"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => setSelectedCustomer(null)} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center">
                    <X className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* Summary row */}
              {!ordersLoading && customerOrders.length > 0 && (
                <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
                  {[
                    { label: 'Orders', value: customerOrders.length, color: 'text-gray-800' },
                    { label: 'Delivered', value: deliveredCount, color: 'text-green-600' },
                    { label: 'Spent', value: `₹${orderTotal.toLocaleString('en-IN')}`, color: 'text-brand' },
                  ].map(s => (
                    <motion.div
                      key={s.label}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-white p-3 text-center"
                    >
                      <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase">{s.label}</p>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Orders list */}
              <div className="flex-1 overflow-y-auto">
                {ordersLoading ? (
                  <div className="p-8 text-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full mx-auto mb-2"
                    />
                    <p className="text-gray-400 text-sm">Loading orders...</p>
                  </div>
                ) : customerOrders.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-semibold">No orders yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {customerOrders.map((o, i) => (
                      <motion.div
                        key={o.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="px-5 py-3 hover:bg-green-50/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="font-semibold text-gray-800 text-sm truncate flex-1">{o.restaurantName || '—'}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor[o.status] || 'bg-gray-100 text-gray-600'}`}>
                            {o.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatDateTime(o.createdAt)}
                          </span>
                          <span className="font-bold text-green-700">₹{(o.totalAmount || 0).toFixed(0)}</span>
                        </div>
                        {o.items?.length > 0 && (
                          <p className="text-[11px] text-gray-400 mt-1 truncate">
                            {o.items.map((item: any) => `${item.quantity}× ${item.name}`).join(', ')}
                          </p>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Download footer */}
              {customerOrders.length > 0 && (
                <div className="p-3 border-t border-gray-100">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={downloadOrderStatement}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition-colors shadow-md shadow-green-200"
                  >
                    <Download className="w-4 h-4" /> Download Statement (CSV)
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
