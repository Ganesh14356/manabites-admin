import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  collection, query, onSnapshot, doc, updateDoc,
  serverTimestamp, orderBy, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search, CheckCircle, XCircle, Eye, Clock,
  Store, Phone, MapPin, Calendar, ChefHat, DollarSign,
  X, AlertTriangle, ChevronLeft, ChevronRight, ExternalLink,
  ShieldCheck, ShieldX, Building2, Edit2, Save,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  ownerName?: string;
  phone: string;
  email?: string;
  address: string;
  city?: string;
  cuisine?: string[];
  logo?: string;
  approved: boolean;
  status: ApprovalStatus;
  fssaiNumber?: string;
  fssaiDocUrl?: string;
  panNumber?: string;
  panDocUrl?: string;
  bankAccountNumber?: string;
  bankIFSC?: string;
  openingTime?: string;
  closingTime?: string;
  commissionRate?: number;
  rejectedReason?: string;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  createdAt: Timestamp;
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

const STATUS_STYLES: Record<ApprovalStatus, { badge: string; label: string; dot: string }> = {
  pending:  { badge: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Pending',  dot: 'bg-yellow-400' },
  approved: { badge: 'bg-green-100  text-green-800  border-green-200',  label: 'Approved', dot: 'bg-green-500' },
  rejected: { badge: 'bg-red-100    text-red-800    border-red-200',    label: 'Rejected', dot: 'bg-red-500'   },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${s.badge}`}>
      <motion.span
        className={`w-1.5 h-1.5 rounded-full ${s.dot}`}
        animate={status === 'pending' ? { opacity: [1, 0.3, 1] } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      {s.label}
    </span>
  );
}

function DocLink({ label, url, number }: { label: string; url?: string; number?: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold text-gray-800 mt-0.5">{number || '—'}</p>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">
          <ExternalLink className="w-3.5 h-3.5" /> View Doc
        </a>
      ) : (
        <span className="text-xs text-gray-300 font-medium">Not uploaded</span>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RestaurantApproval() {
  const [restaurants, setRestaurants]     = useState<Restaurant[]>([]);
  const [loading, setLoading]             = useState(true);
  const [searchQuery, setSearchQuery]     = useState('');
  const [statusFilter, setStatusFilter]   = useState<ApprovalStatus | 'all'>('pending');
  const [page, setPage]                   = useState(1);

  // Approve
  const [approvingId, setApprovingId]     = useState<string | null>(null);

  // Reject modal
  const [rejectTarget, setRejectTarget]   = useState<Restaurant | null>(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);

  // Detail modal
  const [detailTarget, setDetailTarget]   = useState<Restaurant | null>(null);

  // Edit mode inside detail modal
  const [isEditing, setIsEditing]         = useState(false);
  const [editData, setEditData]           = useState<Partial<Restaurant>>({});
  const [saving, setSaving]               = useState(false);

  // ── Realtime listener (all restaurants) ───────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'restaurants'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setRestaurants(snap.docs.map(d => ({ id: d.id, ...d.data() } as Restaurant)));
      setLoading(false);
    }, err => {
      toast.error('Failed to load restaurants: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const counts = useMemo(() => ({
    all:      restaurants.length,
    pending:  restaurants.filter(r => r.status === 'pending'  || (!r.approved && !r.status)).length,
    approved: restaurants.filter(r => r.status === 'approved' || r.approved).length,
    rejected: restaurants.filter(r => r.status === 'rejected').length,
  }), [restaurants]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return restaurants.filter(r => {
      const matchSearch = !searchQuery ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(searchQuery) ||
        (r.ownerName || '').toLowerCase().includes(q);

      const effectiveStatus: ApprovalStatus =
        r.status || (r.approved ? 'approved' : 'pending');

      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'pending'  ? (effectiveStatus === 'pending'  || (!r.approved && !r.status)) :
        statusFilter === 'approved' ? (effectiveStatus === 'approved' || r.approved) :
        effectiveStatus === 'rejected';

      return matchSearch && matchStatus;
    });
  }, [restaurants, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); }, [searchQuery, statusFilter]);

  // Keep detailTarget in sync with live Firestore data so edit form shows fresh values
  useEffect(() => {
    if (!detailTarget) return;
    const updated = restaurants.find(r => r.id === detailTarget.id);
    if (updated) setDetailTarget(updated);
  }, [restaurants]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleApprove = async (r: Restaurant) => {
    setApprovingId(r.id);
    try {
      await updateDoc(doc(db, 'restaurants', r.id), {
        approved:        true,
        isApproved:      true,
        isActive:        true,
        status:          'approved',
        approvedAt:      serverTimestamp(),
        rejectionReason: null,
        rejectedReason:  null,
      });
      toast.success(`✅ "${r.name}" approved successfully!`, { duration: 4000 });
    } catch (err: any) {
      toast.error('Approval failed: ' + err.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error('Please enter a rejection reason');
      return;
    }
    setRejecting(true);
    try {
      await updateDoc(doc(db, 'restaurants', rejectTarget.id), {
        approved:        false,
        isApproved:      false,
        isActive:        false,
        status:          'rejected',
        rejectionReason: rejectReason.trim(),
        rejectedReason:  rejectReason.trim(),
        rejectedAt:      serverTimestamp(),
      });
      toast.error(`❌ "${rejectTarget.name}" has been rejected`, { duration: 4000 });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error('Rejection failed: ' + err.message);
    } finally {
      setRejecting(false);
    }
  };

  const openEdit = (r: Restaurant) => {
    setEditData({
      name: r.name, phone: r.phone, email: r.email ?? '',
      address: r.address, city: r.city ?? '',
      openingTime: r.openingTime ?? '', closingTime: r.closingTime ?? '',
      cuisine: r.cuisine ?? [],
      commissionRate: r.commissionRate ?? 10,
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!detailTarget) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'restaurants', detailTarget.id), {
        ...editData,
        updatedAt: serverTimestamp(),
      });
      toast.success('Restaurant info updated!');
      setIsEditing(false);
    } catch (err: any) {
      toast.error('Update failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-brand" />
          Restaurant Approvals
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Review and manage restaurant onboarding requests
        </p>
      </motion.div>

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: 'all',      label: 'Total',    color: 'border-gray-300',   bg: 'bg-gray-50',   text: 'text-gray-700'  },
          { key: 'pending',  label: 'Pending',  color: 'border-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700' },
          { key: 'approved', label: 'Approved', color: 'border-green-500',  bg: 'bg-green-50',  text: 'text-green-700'  },
          { key: 'rejected', label: 'Rejected', color: 'border-red-400',    bg: 'bg-red-50',    text: 'text-red-600'   },
        ] as const).map((s, i) => (
          <motion.button
            key={s.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setStatusFilter(s.key)}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.color} text-left transition-all ${statusFilter === s.key ? 'ring-2 ring-offset-2 ring-brand' : ''}`}
          >
            <p className={`text-3xl font-black ${s.text}`}>{counts[s.key]}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{s.label}</p>
          </motion.button>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search restaurant name, owner, phone..."
            className="input-field pl-10"
          />
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${statusFilter === f ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {f} {f !== 'all' && <span className="ml-1 opacity-70">({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
            />
            <p className="text-gray-400 font-medium">Loading restaurants...</p>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="table-header">Restaurant</th>
                    <th className="table-header">Owner</th>
                    <th className="table-header">Phone</th>
                    <th className="table-header">Address</th>
                    <th className="table-header">Cuisine</th>
                    <th className="table-header">Applied On</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {paginated.map((r, i) => {
                      const effectiveStatus: ApprovalStatus =
                        (r.status as ApprovalStatus) || (r.approved ? 'approved' : 'pending');
                      const isPending   = effectiveStatus === 'pending';
                      const isApproving = approvingId === r.id;

                      return (
                        <motion.tr
                          key={r.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors"
                        >
                          {/* Restaurant */}
                          <td className="table-cell">
                            <div className="flex items-center gap-3">
                              {r.logo ? (
                                <img src={r.logo} alt={r.name}
                                  className="w-10 h-10 rounded-xl object-cover border border-gray-100 flex-shrink-0"
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center flex-shrink-0">
                                  <Store className="w-5 h-5 text-brand" />
                                </div>
                              )}
                              <div>
                                <p className="font-bold text-gray-800">{r.name}</p>
                                <p className="text-xs text-gray-400 font-mono">{r.id.slice(0, 8)}</p>
                              </div>
                            </div>
                          </td>

                          {/* Owner */}
                          <td className="table-cell">
                            <p className="font-semibold text-gray-700">{r.ownerName || '—'}</p>
                            {r.email && <p className="text-xs text-gray-400 truncate max-w-[120px]">{r.email}</p>}
                          </td>

                          {/* Phone */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5 text-gray-700">
                              <Phone className="w-3.5 h-3.5 text-gray-400" />
                              {r.phone || '—'}
                            </div>
                          </td>

                          {/* Address */}
                          <td className="table-cell">
                            <div className="flex items-start gap-1.5 text-gray-600 max-w-[160px]">
                              <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2 text-xs">{r.address || '—'}</span>
                            </div>
                          </td>

                          {/* Cuisine */}
                          <td className="table-cell">
                            <div className="flex flex-wrap gap-1">
                              {(r.cuisine || []).slice(0, 2).map(c => (
                                <span key={c} className="px-2 py-0.5 bg-orange-50 text-orange-700 text-[10px] font-bold rounded-md">{c}</span>
                              ))}
                              {(r.cuisine || []).length > 2 && (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded-md">+{r.cuisine!.length - 2}</span>
                              )}
                              {(!r.cuisine || r.cuisine.length === 0) && <span className="text-gray-300 text-xs">—</span>}
                            </div>
                          </td>

                          {/* Created */}
                          <td className="table-cell text-gray-500 text-xs">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-300" />
                              {formatDate(r.createdAt)}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="table-cell">
                            <StatusBadge status={effectiveStatus} />
                            {effectiveStatus === 'rejected' && (r.rejectedReason || (r as any).rejectionReason) && (
                              <p className="text-[10px] text-red-500 mt-1 max-w-[100px] truncate" title={r.rejectedReason || (r as any).rejectionReason}>
                                {r.rejectedReason || (r as any).rejectionReason}
                              </p>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5">
                              {/* View Details */}
                              <motion.button
                                whileTap={{ scale: 0.94 }}
                                onClick={() => setDetailTarget(r)}
                                className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-100 flex-shrink-0"
                                title="View Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </motion.button>

                              {/* Approve */}
                              {isPending && (
                                <motion.button
                                  whileTap={{ scale: 0.94 }}
                                  onClick={() => handleApprove(r)}
                                  disabled={isApproving}
                                  title="Approve"
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors shadow-sm shadow-green-200"
                                >
                                  {isApproving ? (
                                    <motion.div
                                      animate={{ rotate: 360 }}
                                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                                      className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"
                                    />
                                  ) : (
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  )}
                                  Approve
                                </motion.button>
                              )}

                              {/* Reject */}
                              {isPending && (
                                <motion.button
                                  whileTap={{ scale: 0.94 }}
                                  onClick={() => { setRejectTarget(r); setRejectReason(''); }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition-colors"
                                  title="Reject"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </motion.button>
                              )}

                              {/* Re-review already-decided restaurants */}
                              {effectiveStatus === 'approved' && (
                                <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                                  <ShieldCheck className="w-3.5 h-3.5" /> Live
                                </span>
                              )}
                              {effectiveStatus === 'rejected' && (
                                <motion.button
                                  whileTap={{ scale: 0.94 }}
                                  onClick={() => handleApprove(r)}
                                  disabled={isApproving}
                                  className="px-2.5 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-lg hover:bg-green-100"
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

              {/* Empty state */}
              {!loading && paginated.length === 0 && (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Store className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-semibold">No restaurants found</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {statusFilter !== 'all' ? `No ${statusFilter} restaurants` : 'No restaurants in the system yet'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Pagination ─────────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <p className="text-sm text-gray-500 font-medium">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
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
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Reject Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {rejectTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={() => setRejectTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{   opacity: 0, scale: 0.92, y: 20  }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              {/* Red top strip */}
              <div className="h-1.5 bg-red-500 w-full" />

              <div className="p-6">
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <ShieldX className="w-6 h-6 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-black text-gray-800">Reject Restaurant</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      This will prevent <span className="font-bold text-gray-700">"{rejectTarget.name}"</span> from going live.
                    </p>
                  </div>
                  <button onClick={() => setRejectTarget(null)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 font-semibold">
                    The rejection reason will be saved on the restaurant record and may be communicated to the owner.
                  </p>
                </div>

                <div className="mb-5">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Rejection Reason *
                  </label>
                  <textarea
                    rows={4}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. FSSAI license is expired. Please renew and reapply..."
                    className="input-field resize-none"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1">{rejectReason.length} / 500 characters</p>
                </div>

                {/* Quick reject reasons */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {[
                    'Incomplete documents',
                    'Invalid FSSAI license',
                    'Duplicate registration',
                    'Blurry/invalid photos',
                    'Address mismatch',
                  ].map(r => (
                    <button
                      key={r}
                      onClick={() => setRejectReason(r)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setRejectTarget(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleReject}
                    disabled={rejecting || !rejectReason.trim()}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {rejecting ? (
                      <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Rejecting...</>
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

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {detailTarget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              onClick={() => { setDetailTarget(null); setIsEditing(false); }}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{   opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center gap-3">
                  {detailTarget.logo ? (
                    <img src={detailTarget.logo} alt={detailTarget.name}
                      className="w-12 h-12 rounded-xl object-cover border border-gray-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
                      <Store className="w-6 h-6 text-brand" />
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-black text-gray-800">{detailTarget.name}</h2>
                    <StatusBadge status={(detailTarget.status as ApprovalStatus) || (detailTarget.approved ? 'approved' : 'pending')} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    onClick={() => isEditing ? setIsEditing(false) : openEdit(detailTarget)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      isEditing
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    {isEditing ? 'Cancel' : 'Edit'}
                  </motion.button>
                  <button onClick={() => { setDetailTarget(null); setIsEditing(false); }} className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
                    <X className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* Basic Info / Edit Form */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Restaurant Info</p>
                  {isEditing ? (
                    <div className="space-y-3">
                      {[
                        { label: 'Name *',   key: 'name',    type: 'text' },
                        { label: 'Phone',    key: 'phone',   type: 'tel'  },
                        { label: 'Email',    key: 'email',   type: 'email' },
                        { label: 'Address',  key: 'address', type: 'text' },
                        { label: 'City',     key: 'city',    type: 'text' },
                        { label: 'Opening Time', key: 'openingTime', type: 'time' },
                        { label: 'Closing Time', key: 'closingTime', type: 'time' },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{f.label}</label>
                          <input
                            type={f.type}
                            value={(editData as any)[f.key] ?? ''}
                            onChange={e => setEditData(d => ({ ...d, [f.key]: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-brand transition-colors"
                          />
                        </div>
                      ))}
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Cuisine (comma-separated)</label>
                        <input
                          type="text"
                          value={(editData.cuisine || []).join(', ')}
                          onChange={e => setEditData(d => ({ ...d, cuisine: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-brand transition-colors"
                          placeholder="North Indian, Chinese, Fast Food"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">ManaBites Commission Rate (%)</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={(editData as any).commissionRate ?? 10}
                          onChange={e => setEditData(d => ({ ...d, commissionRate: parseFloat(e.target.value) || 0 }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-brand transition-colors"
                          placeholder="10"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">% of subtotal deducted as platform commission on each delivered order</p>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="w-full py-2.5 bg-brand text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        {saving ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
                      </motion.button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[
                        { icon: Store,    label: 'Name',     value: detailTarget.name },
                        { icon: Phone,    label: 'Phone',    value: detailTarget.phone || '—' },
                        { icon: Building2, label: 'Email',   value: detailTarget.email || '—' },
                        { icon: MapPin,   label: 'Address',  value: `${detailTarget.address}${detailTarget.city ? ', ' + detailTarget.city : ''}` || '—' },
                        { icon: ChefHat,  label: 'Cuisine',  value: (detailTarget.cuisine || []).join(', ') || '—' },
                        { icon: Clock,    label: 'Hours',    value: detailTarget.openingTime && detailTarget.closingTime ? `${detailTarget.openingTime} – ${detailTarget.closingTime}` : '—' },
                        { icon: Calendar, label: 'Applied',  value: formatDateTime(detailTarget.createdAt) },
                        { icon: DollarSign, label: 'Commission', value: `${detailTarget.commissionRate ?? 10}%` },
                      ].map(row => (
                        <div key={row.label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                          <row.icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{row.label}</p>
                            <p className="text-sm font-semibold text-gray-800 truncate">{row.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Owner Info */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Owner Details</p>
                  <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 font-medium">Owner Name</span>
                      <span className="font-bold text-gray-800">{detailTarget.ownerName || '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 font-medium">Owner UID</span>
                      <span className="font-mono text-xs text-gray-500">{detailTarget.ownerId?.slice(0, 16)}...</span>
                    </div>
                  </div>
                </section>

                {/* Documents */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Documents & Compliance</p>
                  <div className="space-y-2">
                    <DocLink label="FSSAI License" url={detailTarget.fssaiDocUrl} number={detailTarget.fssaiNumber} />
                    <DocLink label="PAN Card"      url={detailTarget.panDocUrl}   number={detailTarget.panNumber} />
                    <DocLink label="Bank Account"  number={detailTarget.bankAccountNumber ? `${detailTarget.bankAccountNumber} · ${detailTarget.bankIFSC}` : undefined} />
                  </div>
                </section>

                {/* Rejection reason (if rejected) */}
                {detailTarget.status === 'rejected' && (detailTarget.rejectedReason || (detailTarget as any).rejectionReason) && (
                  <section>
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3">Rejection Reason</p>
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-700 font-medium">{detailTarget.rejectedReason || (detailTarget as any).rejectionReason}</p>
                      {detailTarget.rejectedAt && (
                        <p className="text-xs text-red-400 mt-2">Rejected on {formatDateTime(detailTarget.rejectedAt)}</p>
                      )}
                    </div>
                  </section>
                )}

                {/* Approval timestamp */}
                {detailTarget.status === 'approved' && detailTarget.approvedAt && (
                  <section>
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
                      <ShieldCheck className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-sm font-bold text-green-700">Approved & Live</p>
                        <p className="text-xs text-green-500">{formatDateTime(detailTarget.approvedAt)}</p>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* Footer action buttons */}
              {((detailTarget.status as ApprovalStatus) === 'pending' || (!detailTarget.approved && !detailTarget.status)) && (
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { handleApprove(detailTarget); setDetailTarget(null); }}
                    className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 flex items-center justify-center gap-2 shadow-md shadow-green-200"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setRejectTarget(detailTarget); setDetailTarget(null); setRejectReason(''); }}
                    className="flex-1 py-3 bg-red-100 text-red-700 font-bold rounded-xl hover:bg-red-200 flex items-center justify-center gap-2"
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
