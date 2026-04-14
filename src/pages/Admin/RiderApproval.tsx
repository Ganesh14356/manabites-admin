import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  collection, query, where, onSnapshot, doc,
  updateDoc, serverTimestamp, orderBy, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search, CheckCircle, XCircle, Eye, Calendar, Filter,
  Phone, MapPin, X, AlertTriangle, ChevronLeft, ChevronRight,
  Bike, FileText, ShieldCheck, ShieldX, Car, User,
  ExternalLink, Hash, Clock, Award,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface RiderDoc {
  id: string;
  // common fields (both collections)
  name: string;
  phone: string;
  email?: string;
  city?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  licenseNumber?: string;
  profileImage?: string;
  approved: boolean;
  status: ApprovalStatus;
  online?: boolean;
  // document uploads
  licenseDocUrl?: string;
  aadharNumber?: string;
  aadharDocUrl?: string;
  panNumber?: string;
  panDocUrl?: string;
  bankAccountNumber?: string;
  bankIFSC?: string;
  bankDocUrl?: string;
  // approval meta
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectedReason?: string;
  createdAt: Timestamp;
  // users-collection rider extras
  role?: string;
  isActive?: boolean;
  licenseApproved?: boolean;
  bankApproved?: boolean;
}

const PAGE_SIZE = 10;

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

const STATUS_META: Record<ApprovalStatus, { badge: string; dot: string; label: string }> = {
  pending:  { badge: 'bg-amber-100  text-amber-800  border-amber-200',  dot: 'bg-amber-400',  label: 'Pending'  },
  approved: { badge: 'bg-green-100  text-green-800  border-green-200',  dot: 'bg-green-500',  label: 'Approved' },
  rejected: { badge: 'bg-red-100    text-red-800    border-red-200',    dot: 'bg-red-500',    label: 'Rejected' },
};

const VEHICLE_ICON: Record<string, string> = {
  Bike: '🏍️', Scooter: '🛵', Bicycle: '🚲', Car: '🚗',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${m.badge}`}>
      <motion.span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.dot}`}
        animate={status === 'pending' ? { opacity: [1, 0.25, 1] } : {}}
        transition={{ duration: 1.4, repeat: Infinity }}
      />
      {m.label}
    </span>
  );
}

function DocRow({ label, number, url }: { label: string; number?: string; url?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl">
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold text-gray-800 mt-0.5">{number || '—'}</p>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
          <ExternalLink className="w-3.5 h-3.5" /> View
        </a>
      ) : (
        <span className="text-xs text-gray-300">Not uploaded</span>
      )}
    </div>
  );
}

function Avatar({ rider }: { rider: RiderDoc }) {
  if (rider.profileImage) {
    return (
      <img src={rider.profileImage} alt={rider.name}
        className="w-10 h-10 rounded-full object-cover border-2 border-gray-100 flex-shrink-0"
        onError={e => { (e.target as HTMLImageElement).src = ''; }}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-sm">
      {rider.name?.charAt(0)?.toUpperCase() ?? 'R'}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RiderApproval() {
  const [riders, setRiders]           = useState<RiderDoc[]>([]);
  const [loading, setLoading]         = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [page, setPage]               = useState(1);

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RiderDoc | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]     = useState(false);
  const [detailTarget, setDetailTarget] = useState<RiderDoc | null>(null);

  // ── Live listeners: merge `riders` + `users` (role=rider) ────────────────

  useEffect(() => {
    setLoading(true);
    const map = new Map<string, RiderDoc>();

    // Listener 1 — dedicated `riders` collection
    const unsubRiders = onSnapshot(
      query(collection(db, 'riders'), orderBy('createdAt', 'desc')),
      snap => {
        snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() } as RiderDoc));
        setRiders(Array.from(map.values()).sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        ));
        setLoading(false);
      },
      () => setLoading(false)
    );

    // Listener 2 — `users` collection riders (created via Admin → Rider Management)
    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rider')),
      snap => {
        snap.docs.forEach(d => {
          if (!map.has(d.id)) {          // don't overwrite dedicated-collection entry
            map.set(d.id, { id: d.id, ...d.data() } as RiderDoc);
          }
        });
        setRiders(Array.from(map.values()).sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        ));
        setLoading(false);
      },
      () => {}
    );

    return () => { unsubRiders(); unsubUsers(); };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const getStatus = (r: RiderDoc): ApprovalStatus =>
    (r.status as ApprovalStatus) ||
    (r.approved ? 'approved' : 'pending');

  const counts = useMemo(() => ({
    all:      riders.length,
    pending:  riders.filter(r => getStatus(r) === 'pending').length,
    approved: riders.filter(r => getStatus(r) === 'approved').length,
    rejected: riders.filter(r => getStatus(r) === 'rejected').length,
  }), [riders]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return riders.filter(r => {
      const matchSearch = !searchQuery ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(searchQuery) ||
        (r.city || '').toLowerCase().includes(q) ||
        (r.vehicleNumber || '').toLowerCase().includes(q) ||
        (r.licenseNumber || '').toLowerCase().includes(q);
      const s = getStatus(r);
      const matchStatus = statusFilter === 'all' || s === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [riders, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [searchQuery, statusFilter]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const collectionFor = (r: RiderDoc) =>
    r.role === 'rider' ? 'users' : 'riders';

  const handleApprove = async (r: RiderDoc) => {
    setApprovingId(r.id);
    try {
      await updateDoc(doc(db, collectionFor(r), r.id), {
        approved:       true,
        status:         'approved',
        isActive:       true,
        approvedAt:     serverTimestamp(),
        rejectedReason: null,
      });
      toast.success(`✅ ${r.name} approved! They can now receive deliveries.`, { duration: 4000 });
    } catch (err: any) {
      toast.error('Approval failed: ' + err.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error('Please enter a rejection reason'); return; }
    setRejecting(true);
    try {
      await updateDoc(doc(db, collectionFor(rejectTarget), rejectTarget.id), {
        approved:       false,
        status:         'rejected',
        isActive:       false,
        rejectedReason: rejectReason.trim(),
        rejectedAt:     serverTimestamp(),
      });
      toast.error(`❌ ${rejectTarget.name} has been rejected.`, { duration: 4000 });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error('Rejection failed: ' + err.message);
    } finally {
      setRejecting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
          <Bike className="w-7 h-7 text-brand" /> Rider Approvals
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">Review and approve delivery partner applications</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: 'all',      label: 'Total Riders', border: 'border-gray-300',   bg: 'bg-gray-50',    text: 'text-gray-700'   },
          { key: 'pending',  label: 'Pending',       border: 'border-amber-400',  bg: 'bg-amber-50',   text: 'text-amber-700'  },
          { key: 'approved', label: 'Approved',      border: 'border-green-500',  bg: 'bg-green-50',   text: 'text-green-700'  },
          { key: 'rejected', label: 'Rejected',      border: 'border-red-400',    bg: 'bg-red-50',     text: 'text-red-600'    },
        ] as const).map((s, i) => (
          <motion.button
            key={s.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setStatusFilter(s.key)}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.border} text-left transition-all ${statusFilter === s.key ? 'ring-2 ring-offset-2 ring-brand' : 'hover:shadow-md'}`}
          >
            {/* animated count */}
            <motion.p
              key={counts[s.key]}
              initial={{ scale: 1.3, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              className={`text-3xl font-black ${s.text}`}
            >
              {counts[s.key]}
            </motion.p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{s.label}</p>
          </motion.button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, vehicle no, license..."
            className="input-field pl-10"
          />
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                statusFilter === f ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f}{f !== 'all' && <span className="ml-1 opacity-60">({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full"
          />
          <p className="text-gray-400 font-medium">Loading riders...</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">Rider</th>
                    <th className="table-header">Phone</th>
                    <th className="table-header">Vehicle</th>
                    <th className="table-header">City</th>
                    <th className="table-header">License No.</th>
                    <th className="table-header">Registered</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {paginated.map((r, i) => {
                      const status     = getStatus(r);
                      const isPending  = status === 'pending';
                      const isApproving = approvingId === r.id;

                      return (
                        <motion.tr
                          key={r.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ delay: i * 0.025 }}
                          className={`border-b border-gray-50 transition-colors ${
                            isPending ? 'hover:bg-amber-50/40' : 'hover:bg-gray-50/60'
                          }`}
                        >
                          {/* Rider */}
                          <td className="table-cell">
                            <div className="flex items-center gap-3">
                              <Avatar rider={r} />
                              <div>
                                <p className="font-bold text-gray-800">{r.name}</p>
                                {r.email && (
                                  <p className="text-[11px] text-gray-400 truncate max-w-[130px]">{r.email}</p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Phone */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                              <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              {r.phone || '—'}
                            </div>
                          </td>

                          {/* Vehicle */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5">
                              <span className="text-base leading-none">
                                {VEHICLE_ICON[r.vehicleType || ''] || '🛵'}
                              </span>
                              <div>
                                <p className="font-semibold text-gray-700 text-xs">{r.vehicleType || '—'}</p>
                                <p className="font-mono text-[11px] text-gray-400">{r.vehicleNumber || '—'}</p>
                              </div>
                            </div>
                          </td>

                          {/* City */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1 text-gray-600 text-xs">
                              <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              {r.city || '—'}
                            </div>
                          </td>

                          {/* License */}
                          <td className="table-cell">
                            <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-lg">
                              {r.licenseNumber || '—'}
                            </span>
                          </td>

                          {/* Date */}
                          <td className="table-cell text-gray-500 text-xs">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-300" />
                              {formatDate(r.createdAt)}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="table-cell">
                            <StatusBadge status={status} />
                            {status === 'rejected' && r.rejectedReason && (
                              <p className="text-[10px] text-red-400 mt-1 max-w-[100px] truncate" title={r.rejectedReason}>
                                {r.rejectedReason}
                              </p>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5">
                              {/* View Details */}
                              <motion.button
                                whileTap={{ scale: 0.93 }}
                                onClick={() => setDetailTarget(r)}
                                className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-100"
                                title="View Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </motion.button>

                              {isPending && (
                                <>
                                  {/* Approve */}
                                  <motion.button
                                    whileTap={{ scale: 0.93 }}
                                    onClick={() => handleApprove(r)}
                                    disabled={isApproving}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-60 shadow-sm shadow-green-200 transition-colors"
                                  >
                                    {isApproving ? (
                                      <motion.span
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                                        className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full block"
                                      />
                                    ) : (
                                      <CheckCircle className="w-3.5 h-3.5" />
                                    )}
                                    Approve
                                  </motion.button>

                                  {/* Reject */}
                                  <motion.button
                                    whileTap={{ scale: 0.93 }}
                                    onClick={() => { setRejectTarget(r); setRejectReason(''); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition-colors"
                                  >
                                    <XCircle className="w-3.5 h-3.5" /> Reject
                                  </motion.button>
                                </>
                              )}

                              {status === 'approved' && (
                                <span className="flex items-center gap-1 text-xs text-green-600 font-bold">
                                  <ShieldCheck className="w-3.5 h-3.5" /> Active
                                </span>
                              )}

                              {status === 'rejected' && (
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => handleApprove(r)}
                                  disabled={approvingId === r.id}
                                  className="px-2.5 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-lg hover:bg-green-100 transition-colors"
                                >
                                  Re-approve
                                </motion.button>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>

              {!loading && paginated.length === 0 && (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Bike className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-semibold">No riders found</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {statusFilter !== 'all' ? `No ${statusFilter} riders` : 'No riders registered yet'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <p className="text-sm text-gray-500 font-medium">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let p = i + 1;
                  if (totalPages > 5) {
                    if (page <= 3) p = i + 1;
                    else if (page >= totalPages - 2) p = totalPages - 4 + i;
                    else p = page - 2 + i;
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-bold transition-all ${
                        page === p
                          ? 'bg-brand text-white shadow-md shadow-orange-200'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════ REJECT MODAL ════════════════════════════════════════ */}
      <AnimatePresence>
        {rejectTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={() => setRejectTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1,   y: 0  }}
              exit={{   opacity: 0, scale: 0.9, y: 20  }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-400" />
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <ShieldX className="w-6 h-6 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-black text-gray-800">Reject Rider</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      This will block <span className="font-bold text-gray-700">"{rejectTarget.name}"</span> from delivering orders.
                    </p>
                  </div>
                  <button onClick={() => setRejectTarget(null)}
                    className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Rider preview */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-5">
                  <Avatar rider={rejectTarget} />
                  <div>
                    <p className="font-bold text-gray-800">{rejectTarget.name}</p>
                    <p className="text-xs text-gray-500">{rejectTarget.phone} · {rejectTarget.vehicleType}</p>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 font-medium">
                    The rejection reason will be stored and may be shown to the rider in the app.
                  </p>
                </div>

                {/* Reason input */}
                <div className="mb-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Rejection Reason *
                  </label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. Driving license is expired or unreadable..."
                    className="input-field resize-none"
                    autoFocus
                  />
                </div>

                {/* Quick chips */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {[
                    'Invalid license',
                    'Document mismatch',
                    'Blurry ID photo',
                    'Fake vehicle number',
                    'Incomplete profile',
                    'Under 18 years',
                  ].map(c => (
                    <button key={c} onClick={() => setRejectReason(c)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors">
                      {c}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setRejectTarget(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors">
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleReject}
                    disabled={rejecting || !rejectReason.trim()}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {rejecting ? (
                      <>
                        <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-white border-t-transparent rounded-full block" />
                        Rejecting...
                      </>
                    ) : (
                      <><XCircle className="w-4 h-4" /> Confirm Reject</>
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════ DETAIL SLIDE-IN ════════════════════════════════════ */}
      <AnimatePresence>
        {detailTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              onClick={() => setDetailTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{   opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Top accent */}
              <div className="h-1.5 bg-gradient-to-r from-brand to-orange-400" />

              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-4">
                {detailTarget.profileImage ? (
                  <img src={detailTarget.profileImage} alt={detailTarget.name}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-white shadow-md flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-black text-xl flex-shrink-0 shadow-md">
                    {detailTarget.name?.charAt(0)?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-black text-gray-800 truncate">{detailTarget.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <StatusBadge status={getStatus(detailTarget)} />
                    {detailTarget.online && (
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Online
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDetailTarget(null)}
                  className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 flex-shrink-0">
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* Personal Info */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Personal Info</p>
                  <div className="space-y-2">
                    {[
                      { icon: User,     label: 'Full Name',   value: detailTarget.name     },
                      { icon: Phone,    label: 'Phone',       value: detailTarget.phone    },
                      { icon: Hash,     label: 'Email',       value: detailTarget.email    },
                      { icon: MapPin,   label: 'City',        value: detailTarget.city     },
                      { icon: Calendar, label: 'Registered',  value: formatDateTime(detailTarget.createdAt) },
                    ].map(row => (
                      <div key={row.label} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <row.icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{row.label}</p>
                          <p className="text-sm font-semibold text-gray-800 truncate">{row.value || '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Vehicle */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Vehicle Details</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Type',         value: `${VEHICLE_ICON[detailTarget.vehicleType || ''] || '🛵'} ${detailTarget.vehicleType || '—'}` },
                      { label: 'Number',       value: detailTarget.vehicleNumber  },
                      { label: 'License No.',  value: detailTarget.licenseNumber  },
                    ].map(f => (
                      <div key={f.label} className="p-3 bg-gray-50 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{f.label}</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5 font-mono">{f.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Documents */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Documents</p>
                  <div className="space-y-2">
                    <DocRow label="Driving License"  number={detailTarget.licenseNumber}      url={detailTarget.licenseDocUrl} />
                    <DocRow label="Aadhaar Card"      number={detailTarget.aadharNumber}       url={detailTarget.aadharDocUrl}  />
                    <DocRow label="PAN Card"          number={detailTarget.panNumber}          url={detailTarget.panDocUrl}     />
                    <DocRow label="Bank Account"      number={detailTarget.bankAccountNumber ? `${detailTarget.bankAccountNumber} · IFSC: ${detailTarget.bankIFSC || '—'}` : undefined} url={detailTarget.bankDocUrl} />
                  </div>
                </section>

                {/* Rejection reason */}
                {getStatus(detailTarget) === 'rejected' && detailTarget.rejectedReason && (
                  <section>
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3">Rejection Reason</p>
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-700 font-medium">{detailTarget.rejectedReason}</p>
                      {detailTarget.rejectedAt && (
                        <p className="text-xs text-red-400 mt-2">Rejected on {formatDateTime(detailTarget.rejectedAt)}</p>
                      )}
                    </div>
                  </section>
                )}

                {/* Approved stamp */}
                {getStatus(detailTarget) === 'approved' && (
                  <section>
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
                      <ShieldCheck className="w-6 h-6 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-black text-green-700">Approved & Active</p>
                        {detailTarget.approvedAt && (
                          <p className="text-xs text-green-500 mt-0.5">{formatDateTime(detailTarget.approvedAt)}</p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* Footer — only for pending */}
              {getStatus(detailTarget) === 'pending' && (
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { handleApprove(detailTarget); setDetailTarget(null); }}
                    className="flex-1 py-3.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 flex items-center justify-center gap-2 shadow-md shadow-green-200 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve Rider
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setRejectTarget(detailTarget); setDetailTarget(null); setRejectReason(''); }}
                    className="flex-1 py-3.5 bg-red-100 text-red-700 font-bold rounded-xl hover:bg-red-200 flex items-center justify-center gap-2 transition-colors"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </motion.button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
