import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, onSnapshot, query, orderBy, where, doc, addDoc, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  PhoneCall, Search, Phone, Clock, Package, User,
  Shield, X, ChevronDown,
} from 'lucide-react';

interface CustomerRow {
  uid: string;
  name: string;
  phone: string;
  email?: string;
  totalOrders: number;
  lastOrderAt?: any;
  lastOrderId?: string;
  lastOrderStatus?: string;
}

interface CallLog {
  id: string;
  agentName: string;
  customerName: string;
  customerPhone: string;
  orderId?: string;
  calledAt: any;
  masked: boolean;
  status: 'connected' | 'fallback' | 'failed';
}

type CallingState = 'idle' | 'calling' | 'connected' | 'error';

function formatPhone(p: string) {
  const d = String(p).replace(/\D/g, '').replace(/^91/, '');
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p;
}

function timeAgo(ts: any) {
  if (!ts) return 'â€”';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function CustomerCare() {
  const { user, profile } = useAuth();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [callLogs, setCallLogs]   = useState<CallLog[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searchQuery, setSearch]  = useState('');
  const [activeTab, setActiveTab] = useState<'customers' | 'logs' | 'complaints'>('customers');
  const [complaints, setComplaints] = useState<any[]>([]);

  // Call state
  const [callingState, setCallingState]   = useState<CallingState>('idle');
  const [callingTarget, setCallingTarget] = useState<string | null>(null);
  const [showCallSheet, setShowCallSheet] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [agentPhone, setAgentPhone]       = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');

  // Load customers from Firestore users collection
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCustomers(snap.docs.map(d => {
        const data = d.data() as any;
        return {
          uid:             d.id,
          name:            data.name || data.displayName || 'Customer',
          phone:           data.phone || data.phoneNumber || '',
          email:           data.email || '',
          totalOrders:     data.totalOrders || 0,
          lastOrderAt:     data.lastOrderAt,
          lastOrderId:     data.lastOrderId,
          lastOrderStatus: data.lastOrderStatus,
        };
      }));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  // Load call logs
  useEffect(() => {
    const q = query(collection(db, 'call_logs'), orderBy('calledAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCallLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as CallLog)));
    }, () => {});
    return () => unsub();
  }, []);

  // Load complaints
  useEffect(() => {
    const q = query(collection(db, 'complaints'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setComplaints(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  const openCallSheet = (customer: CustomerRow) => {
    setSelectedCustomer(customer);
    setSelectedOrderId(customer.lastOrderId || '');
    setShowCallSheet(true);
    setCallingState('idle');
  };

  const initiateCall = async () => {
    if (!selectedCustomer?.phone) { toast.error('No phone number available'); return; }
    if (!agentPhone || agentPhone.replace(/\D/g, '').length < 10) {
      toast.error('Enter your phone number to initiate the masked call');
      return;
    }

    setCallingState('calling');
    const targetPhone = selectedCustomer.phone;

    try {
      const res  = await fetch('/api/masked-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentNumber:    agentPhone,
          customerNumber: targetPhone,
          orderId:        selectedOrderId || undefined,
          callType:       'customer_care',
        }),
      });
      const data = await res.json();

      const logEntry = {
        agentName:     profile?.name || user?.email || 'Admin',
        agentPhone:    agentPhone,
        customerName:  selectedCustomer.name,
        customerPhone: targetPhone,
        orderId:       selectedOrderId || null,
        calledAt:      Timestamp.now(),
        masked:        data.masked !== false,
        status:        data.fallback ? 'fallback' : 'connected',
      };
      await addDoc(collection(db, 'call_logs'), logEntry);

      if (data.fallback) {
        window.location.href = `tel:${targetPhone}`;
        setCallingState('idle');
        setShowCallSheet(false);
        return;
      }

      setCallingState('connected');
      toast.success('MSG91 is calling you â€” pick up to connect to the customer!', { duration: 6000 });
      setTimeout(() => { setCallingState('idle'); setShowCallSheet(false); }, 5000);
    } catch (err) {
      setCallingState('error');
      toast.error('Call failed â€” check MSG91 configuration');
      await addDoc(collection(db, 'call_logs'), {
        agentName: profile?.name || user?.email || 'Admin',
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        calledAt: Timestamp.now(),
        masked: true,
        status: 'failed',
      }).catch(() => {});
      setTimeout(() => setCallingState('idle'), 3000);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 pb-16">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mb-6">
        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
          ðŸŽ§ Customer Care
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">Call customers via masked number â€” your number stays private</p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        <button
          onClick={() => setActiveTab('customers')}
          className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'customers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          ðŸ‘¥ Customers {customers.length > 0 ? `(${customers.length})` : ''}
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'logs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          ðŸ“‹ Call Logs {callLogs.length > 0 ? `(${callLogs.length})` : ''}
        </button>
        <button
          onClick={() => setActiveTab('complaints')}
          className={`px-5 py-2 rounded-lg text-sm font-bold transition-all relative ${activeTab === 'complaints' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          ðŸš© Complaints
          {complaints.filter((c: any) => c.status === 'open').length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5">
              {complaints.filter((c: any) => c.status === 'open').length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'customers' && (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email..."
              className="input-field pl-10"
            />
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">Customer</th>
                    <th className="table-header">Phone</th>
                    <th className="table-header">Orders</th>
                    <th className="table-header">Last Order</th>
                    <th className="table-header">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {filtered.map(c => (
                      <motion.tr
                        key={c.uid}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="border-b border-gray-50 hover:bg-gray-50"
                      >
                        <td className="table-cell">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-black text-brand flex-shrink-0">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800 text-sm">{c.name}</p>
                              {c.email && <p className="text-xs text-gray-400 truncate max-w-[150px]">{c.email}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="table-cell text-gray-600">{c.phone ? formatPhone(c.phone) : 'â€”'}</td>
                        <td className="table-cell">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-full text-xs font-bold text-gray-600">
                            <Package className="w-3 h-3" /> {c.totalOrders}
                          </span>
                        </td>
                        <td className="table-cell text-gray-500 text-xs">
                          <div>{timeAgo(c.lastOrderAt)}</div>
                          {c.lastOrderStatus && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              c.lastOrderStatus === 'delivered' ? 'bg-green-100 text-green-700' :
                              c.lastOrderStatus === 'cancelled' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>{c.lastOrderStatus}</span>
                          )}
                        </td>
                        <td className="table-cell">
                          {c.phone ? (
                            <button
                              onClick={() => openCallSheet(c)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-lg hover:bg-green-100 border border-green-200"
                            >
                              <Shield className="w-3 h-3" />
                              Call (Masked)
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">No phone</span>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-16 text-gray-400">No customers found</div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-header">Agent</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Order</th>
                <th className="table-header">Time</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {callLogs.map(log => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="table-cell font-medium text-gray-800">{log.agentName}</td>
                  <td className="table-cell">
                    <div className="font-medium text-gray-800">{log.customerName}</div>
                    <div className="text-xs text-gray-400">{formatPhone(log.customerPhone)}</div>
                  </td>
                  <td className="table-cell text-gray-500 font-mono text-xs">
                    {log.orderId ? `#${String(log.orderId).slice(-6).toUpperCase()}` : 'â€”'}
                  </td>
                  <td className="table-cell text-gray-500 text-xs">{timeAgo(log.calledAt)}</td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                      log.status === 'connected' ? 'bg-green-100 text-green-700' :
                      log.status === 'fallback'  ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {log.masked && log.status === 'connected' ? <Shield className="w-2.5 h-2.5" /> : <Phone className="w-2.5 h-2.5" />}
                      {log.status === 'connected' ? 'Masked' : log.status}
                    </span>
                  </td>
                </tr>
              ))}
              {callLogs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-16 text-gray-400">No call logs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'complaints' && (
        <div className="space-y-3">
          {complaints.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">
              No complaints yet
            </div>
          )}
          {complaints.map((c: any) => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-gray-900 text-sm">{c.customerName}</span>
                    {c.isLive && (
                      <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase animate-pulse">
                        Live
                      </span>
                    )}
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${
                      c.priority === 'high' ? 'bg-red-100 text-red-700 border-red-200' :
                      'bg-orange-100 text-orange-700 border-orange-200'
                    }`}>{c.priority}</span>
                  </div>
                  <p className="text-xs font-bold text-gray-600">
                    {c.type === 'rider' ? 'ðŸ›µ' : 'ðŸ±'} {c.targetName} â€” {c.category?.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{c.description}</p>
                  <p className="text-[10px] text-gray-300 mt-1">
                    #{c.orderId?.slice(-8).toUpperCase()} Â· {timeAgo(c.createdAt)}
                  </p>
                </div>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase flex-shrink-0 ${
                  c.status === 'open' ? 'bg-red-50 text-red-700 border-red-200' :
                  c.status === 'in_progress' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                  'bg-green-50 text-green-700 border-green-200'
                }`}>
                  {c.status?.replace('_', ' ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Call Bottom Sheet */}
      <AnimatePresence>
        {showCallSheet && selectedCustomer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowCallSheet(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-3xl p-5 z-50 pb-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <Shield className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-black text-gray-900">Call {selectedCustomer.name}</h3>
                    <p className="text-xs text-gray-400">Number masking â€” your number stays private</p>
                  </div>
                </div>
                <button onClick={() => setShowCallSheet(false)} className="p-2 bg-gray-100 rounded-full">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{selectedCustomer.name}</span>
                  <span className="text-gray-400 ml-auto">{formatPhone(selectedCustomer.phone)}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500 text-xs">
                  <Shield className="w-3.5 h-3.5 text-green-500" />
                  <span>Customer's number is shown as masked to you</span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Your Phone Number (MSG91 will call this)
                </label>
                <input
                  type="tel"
                  value={agentPhone}
                  onChange={e => setAgentPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Your 10-digit number"
                  className="input-field"
                />
              </div>

              {selectedCustomer.lastOrderId && (
                <div className="mb-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                    Related Order (optional)
                  </label>
                  <input
                    type="text"
                    value={selectedOrderId}
                    onChange={e => setSelectedOrderId(e.target.value)}
                    placeholder="Order ID"
                    className="input-field font-mono text-sm"
                  />
                </div>
              )}

              {callingState === 'connected' ? (
                <div className="w-full bg-green-50 border border-green-200 rounded-2xl py-4 flex items-center justify-center gap-2 text-green-700 font-bold">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  MSG91 is calling your phone now...
                </div>
              ) : (
                <button
                  onClick={initiateCall}
                  disabled={callingState === 'calling' || !agentPhone || agentPhone.length < 10}
                  className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 hover:bg-green-700 transition-colors"
                >
                  {callingState === 'calling' ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Connecting...</>
                  ) : (
                    <><PhoneCall className="w-5 h-5" /> Initiate Masked Call</>
                  )}
                </button>
              )}
              <p className="text-center text-xs text-gray-400 mt-3">
                MSG91 calls you first â†’ when you pick up â†’ connects to the customer
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
