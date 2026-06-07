import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, doc, updateDoc, onSnapshot,
  query, where, orderBy, getDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Banknote, CheckCircle, Clock, XCircle, AlertTriangle,
  RefreshCw, Send, UserCheck, Bike, Store, Wallet,
  ChevronDown, ChevronUp, Search,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type CfStatus = 'pending' | 'registering' | 'registered' | 'processing' | 'completed' | 'failed';

interface PayoutDoc {
  id: string;
  entityId: string;
  entityName: string;
  entityType: 'rider' | 'restaurant';
  amount: number;
  ordersCount?: number;
  deliveriesCount?: number;
  settlementDate?: string;
  status: string;
  paymentMethod?: string;
  cashfreeBeneId?: string;
  cashfreeTransferId?: string;
  cashfreeStatus?: CfStatus;
  cashfreeError?: string;
  initiatedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt?: Timestamp;
  // bank details fetched from rider/restaurant doc
  bankAccount?: string;
  bankIFSC?: string;
  bankName?: string;
  phone?: string;
  email?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function fmtDate(ts: any) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function beneId(payout: PayoutDoc) {
  return payout.cashfreeBeneId || `MB_${payout.entityType.slice(0, 1).toUpperCase()}_${payout.entityId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30)}`;
}

async function callCashfree(action: string, params: Record<string, unknown>) {
  const res = await fetch('/api/cashfree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Cashfree error ${res.status}`);
  return data;
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    pending:     { label: 'Pending',     cls: 'bg-yellow-100 text-yellow-700', icon: Clock },
    registering: { label: 'Registering', cls: 'bg-blue-100 text-blue-700',    icon: RefreshCw },
    registered:  { label: 'Registered',  cls: 'bg-cyan-100 text-cyan-700',    icon: UserCheck },
    processing:  { label: 'Processing',  cls: 'bg-blue-100 text-blue-700',    icon: RefreshCw },
    completed:   { label: 'Completed',   cls: 'bg-green-100 text-green-700',  icon: CheckCircle },
    failed:      { label: 'Failed',      cls: 'bg-red-100 text-red-700',      icon: XCircle },
  };
  const m = map[status] ?? map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${m.cls}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CashfreeSettlements() {
  const [payouts, setPayouts]       = useState<PayoutDoc[]>([]);
  const [loading, setLoading]       = useState(true);
  const [balance, setBalance]       = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'rider' | 'restaurant'>('all');
  const [statusFilter, setStatus]   = useState<'all' | 'pending' | 'registered' | 'processing' | 'completed' | 'failed'>('pending');
  const [search, setSearch]         = useState('');
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [busy, setBusy]             = useState<Record<string, boolean>>({});

  // ── Real-time payouts listener ────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'payouts'),
      where('paymentMethod', '==', 'online'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, async snap => {
      const docs: PayoutDoc[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        const p: PayoutDoc = { id: d.id, ...data };

        // Fetch bank details from rider/restaurant doc
        try {
          if (data.entityType === 'rider') {
            const riderSnap = await getDoc(doc(db, 'users', data.entityId));
            if (riderSnap.exists()) {
              const r = riderSnap.data();
              p.bankAccount = r.bankAccountNumber;
              p.bankIFSC    = r.bankIFSC;
              p.bankName    = r.bankAccountHolderName || r.name;
              p.phone       = r.phone;
              p.email       = r.email;
            }
          } else {
            const restSnap = await getDoc(doc(db, 'users', data.entityId));
            if (restSnap.exists()) {
              const r = restSnap.data();
              p.bankAccount = r.bankAccount;
              p.bankIFSC    = r.ifscCode;
              p.bankName    = r.accountHolderName || r.name;
              p.phone       = r.phone;
              p.email       = r.email;
            }
          }
        } catch { /* bank details optional */ }

        docs.push(p);
      }
      setPayouts(docs);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  // ── Fetch Cashfree balance ────────────────────────────────────────
  const fetchBalance = async () => {
    setBalanceLoading(true);
    try {
      const data = await callCashfree('get_balance', {});
      const amt = data?.data?.availableBalance ?? data?.data?.balance ?? null;
      setBalance(amt !== null ? toINR(Number(amt)) : 'N/A');
    } catch (e: any) {
      toast.error('Balance fetch failed: ' + e.message);
    } finally {
      setBalanceLoading(false);
    }
  };

  // ── Register beneficiary ──────────────────────────────────────────
  const handleRegister = async (p: PayoutDoc) => {
    if (!p.bankAccount || !p.bankIFSC) {
      toast.error('Bank account / IFSC missing for this entity');
      return;
    }
    const bid = beneId(p);
    setBusy(b => ({ ...b, [p.id]: true }));
    try {
      const data = await callCashfree('add_beneficiary', {
        beneId:      bid,
        name:        p.bankName || p.entityName,
        email:       p.email,
        phone:       p.phone,
        bankAccount: p.bankAccount,
        ifsc:        p.bankIFSC,
      });
      if (data.status === 'SUCCESS' || data.subCode === '200') {
        await updateDoc(doc(db, 'payouts', p.id), {
          cashfreeBeneId: bid,
          cashfreeStatus: 'registered',
        });
        toast.success('Beneficiary registered ✓');
      } else {
        throw new Error(data.message || 'Registration failed');
      }
    } catch (e: any) {
      toast.error('Register failed: ' + e.message);
    } finally {
      setBusy(b => ({ ...b, [p.id]: false }));
    }
  };

  // ── Initiate transfer ─────────────────────────────────────────────
  const handleTransfer = async (p: PayoutDoc) => {
    const bid = p.cashfreeBeneId || beneId(p);
    const transferId = `MB_${p.id}_${Date.now()}`;
    setBusy(b => ({ ...b, [p.id]: true }));
    try {
      const data = await callCashfree('transfer', {
        transferId,
        amount: p.amount,
        beneId: bid,
        remarks: `ManaBites ${p.entityType} settlement ${p.settlementDate || ''}`.trim(),
      });
      if (data.status === 'SUCCESS' || data.subCode === '200') {
        await updateDoc(doc(db, 'payouts', p.id), {
          cashfreeTransferId: transferId,
          cashfreeStatus: 'processing',
          status: 'processing',
          initiatedAt: serverTimestamp(),
        });
        toast.success('Transfer initiated ✓');
      } else {
        throw new Error(data.message || 'Transfer failed');
      }
    } catch (e: any) {
      await updateDoc(doc(db, 'payouts', p.id), {
        cashfreeStatus: 'failed',
        cashfreeError: e.message,
      });
      toast.error('Transfer failed: ' + e.message);
    } finally {
      setBusy(b => ({ ...b, [p.id]: false }));
    }
  };

  // ── Check transfer status ─────────────────────────────────────────
  const handleCheckStatus = async (p: PayoutDoc) => {
    if (!p.cashfreeTransferId) return;
    setBusy(b => ({ ...b, [p.id]: true }));
    try {
      const data = await callCashfree('transfer_status', { transferId: p.cashfreeTransferId });
      const st = data?.data?.transfer?.status ?? data?.data?.status;
      const cfStatus: CfStatus =
        st === 'SUCCESS' ? 'completed' :
        st === 'FAILED'  ? 'failed'    : 'processing';
      await updateDoc(doc(db, 'payouts', p.id), {
        cashfreeStatus: cfStatus,
        status: cfStatus === 'completed' ? 'paid' : p.status,
        ...(cfStatus === 'completed' ? { completedAt: serverTimestamp() } : {}),
        ...(cfStatus === 'failed'    ? { cashfreeError: data?.data?.transfer?.reason || 'Transfer failed' } : {}),
      });
      toast.success(`Status: ${st || 'unknown'}`);
    } catch (e: any) {
      toast.error('Status check failed: ' + e.message);
    } finally {
      setBusy(b => ({ ...b, [p.id]: false }));
    }
  };

  // ── Filters ───────────────────────────────────────────────────────
  const filtered = useMemo(() => payouts.filter(p => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || p.entityName.toLowerCase().includes(q) || p.entityId.toLowerCase().includes(q);
    const matchType   = typeFilter === 'all' || p.entityType === typeFilter;
    const matchStatus = statusFilter === 'all' || (p.cashfreeStatus || 'pending') === statusFilter;
    return matchSearch && matchType && matchStatus;
  }), [payouts, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total:      payouts.length,
    pending:    payouts.filter(p => !p.cashfreeStatus || p.cashfreeStatus === 'pending').length,
    processing: payouts.filter(p => p.cashfreeStatus === 'processing').length,
    completed:  payouts.filter(p => p.cashfreeStatus === 'completed').length,
    failed:     payouts.filter(p => p.cashfreeStatus === 'failed').length,
    totalAmt:   payouts.filter(p => p.cashfreeStatus !== 'completed').reduce((s, p) => s + (p.amount || 0), 0),
  }), [payouts]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <motion.div className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <Banknote className="w-6 h-6 text-brand" /> Cashfree Settlements
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage online payouts to riders and restaurants</p>
        </div>
        <button onClick={fetchBalance} disabled={balanceLoading}
          className="btn-primary w-auto px-4 text-sm flex items-center gap-2">
          {balanceLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          {balance ? `Balance: ${balance}` : 'Check Balance'}
        </button>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total,      color: 'border-brand',   text: 'text-brand' },
          { label: 'Pending', value: stats.pending,  color: 'border-yellow-400', text: 'text-yellow-700' },
          { label: 'Processing', value: stats.processing, color: 'border-blue-400', text: 'text-blue-700' },
          { label: 'Completed', value: stats.completed,   color: 'border-green-500', text: 'text-green-700' },
          { label: 'Failed',    value: stats.failed,      color: 'border-red-400',   text: 'text-red-600' },
        ].map((s, i) => (
          <motion.div key={s.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`bg-white dark:bg-gray-800 rounded-2xl shadow-card p-3 border-l-4 ${s.color}`}>
            <p className={`text-2xl font-black ${s.text}`}>{s.value}</p>
            <p className="text-xs text-gray-400 font-semibold mt-0.5">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Pending amount banner */}
      {stats.totalAmt > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300 font-semibold">
            {toINR(stats.totalAmt)} pending disbursement to {stats.pending + stats.processing} entities
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name or ID..." className="input-field pl-9" />
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          {(['all', 'rider', 'restaurant'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize ${typeFilter === t ? 'bg-white dark:bg-gray-800 shadow text-brand' : 'text-gray-500'}`}>
              {t === 'rider' ? <><Bike className="w-3 h-3 inline mr-1" />Riders</> : t === 'restaurant' ? <><Store className="w-3 h-3 inline mr-1" />Restaurants</> : 'All'}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={e => setStatus(e.target.value as any)} className="input-field w-40 text-sm">
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="registered">Registered</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading payouts...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Banknote className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No payouts found</p>
          <p className="text-sm mt-1">Generate an online settlement from Daily Settlements first</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map(p => {
              const cfStatus = (p.cashfreeStatus || 'pending') as CfStatus;
              const isBusy = !!busy[p.id];
              const hasBeneId = !!p.cashfreeBeneId;
              const hasBank   = !!(p.bankAccount && p.bankIFSC);
              const isExpanded = expanded === p.id;

              return (
                <motion.div key={p.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-white dark:bg-gray-800 rounded-2xl shadow-card overflow-hidden">
                  {/* Row */}
                  <div className="flex items-center gap-4 px-4 py-3.5">
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      p.entityType === 'rider' ? 'bg-orange-100 text-orange-600' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {p.entityType === 'rider' ? <Bike className="w-5 h-5" /> : <Store className="w-5 h-5" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-gray-800 dark:text-white truncate">{p.entityName}</p>
                        <StatusBadge status={cfStatus} />
                        {!hasBank && (
                          <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-bold">No bank details</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {p.entityType === 'rider' ? `${p.deliveriesCount || 0} deliveries` : `${p.ordersCount || 0} orders`}
                        {p.settlementDate ? ` · ${p.settlementDate}` : ''}
                        {p.cashfreeTransferId ? ` · ID: ${p.cashfreeTransferId}` : ''}
                      </p>
                    </div>

                    {/* Amount */}
                    <p className="text-lg font-black text-gray-800 dark:text-white flex-shrink-0">{toINR(p.amount)}</p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Register beneficiary */}
                      {!hasBeneId && cfStatus === 'pending' && (
                        <button onClick={() => handleRegister(p)} disabled={isBusy || !hasBank}
                          title={!hasBank ? 'Bank details missing' : 'Register with Cashfree'}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50 transition-colors">
                          {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                          Register
                        </button>
                      )}

                      {/* Initiate transfer */}
                      {(hasBeneId || cfStatus === 'registered') && cfStatus !== 'processing' && cfStatus !== 'completed' && cfStatus !== 'failed' && (
                        <button onClick={() => handleTransfer(p)} disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-bold disabled:opacity-50 transition-colors">
                          {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Pay Now
                        </button>
                      )}

                      {/* Check status */}
                      {p.cashfreeTransferId && cfStatus === 'processing' && (
                        <button onClick={() => handleCheckStatus(p)} disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold disabled:opacity-50 transition-colors">
                          {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Check
                        </button>
                      )}

                      {/* Expand */}
                      <button onClick={() => setExpanded(isExpanded ? null : p.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div key="detail"
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-gray-50 dark:border-gray-700">
                        <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-600 dark:text-gray-300">
                          <div>
                            <p className="text-gray-400 font-semibold uppercase tracking-wider mb-1">Bank Account</p>
                            <p className="font-mono">{p.bankAccount ? `****${p.bankAccount.slice(-4)}` : '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 font-semibold uppercase tracking-wider mb-1">IFSC</p>
                            <p className="font-mono">{p.bankIFSC || '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 font-semibold uppercase tracking-wider mb-1">Beneficiary ID</p>
                            <p className="font-mono text-[10px]">{p.cashfreeBeneId || '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 font-semibold uppercase tracking-wider mb-1">Initiated</p>
                            <p>{fmtDate(p.initiatedAt)}</p>
                          </div>
                          {p.cashfreeError && (
                            <div className="col-span-4 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 text-red-600 dark:text-red-400">
                              ⚠️ {p.cashfreeError}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
