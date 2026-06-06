import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection, query, where, onSnapshot, doc, getDocs,
  updateDoc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp, runTransaction,
} from 'firebase/firestore';
import { auth, db, secondaryAuth } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { logAuditEvent } from '../../services/auditLog';
import {
  Search, CheckCircle, XCircle, Eye, EyeOff, Calendar, Phone, MapPin, X, AlertTriangle,
  ChevronLeft, ChevronRight, Bike, ShieldCheck, ShieldX, User, ExternalLink,
  Hash, Plus, RefreshCw, UserPlus, Copy, Lock, Key, Trash2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'under_review' | 'approved' | 'rejected';
type AddStep = 1 | 2 | 3 | 4;

interface RiderDoc {
  id: string;
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
  licenseDocUrl?: string;
  aadharNumber?: string;
  aadharDocUrl?: string;
  panNumber?: string;
  panDocUrl?: string;
  bankAccountNumber?: string;
  bankIFSC?: string;
  bankDocUrl?: string;
  licenseVerified?: boolean;
  aadharVerified?: boolean;
  panVerified?: boolean;
  bankVerified?: boolean;
  profileVerified?: boolean;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectedReason?: string;
  reviewStartedAt?: Timestamp;
  createdAt: Timestamp;
  role?: string;
  isActive?: boolean;
  loginCreated?: boolean;
  authUid?: string;
}

interface AddWizardData {
  name: string; phone: string; email: string; city: string;
  vehicleType: 'Bike' | 'Scooter' | 'Bicycle' | 'Car';
  vehicleNumber: string;
  licenseNumber: string; aadharNumber: string; panNumber: string;
  bankAccountNumber: string; bankIFSC: string;
}

const INIT_ADD_DATA: AddWizardData = {
  name: '', phone: '', email: '', city: '',
  vehicleType: 'Bike', vehicleNumber: '',
  licenseNumber: '', aadharNumber: '', panNumber: '',
  bankAccountNumber: '', bankIFSC: '',
};

const STEP_LABELS = ['Personal', 'Vehicle', 'Documents', 'Bank'];

const PAGE_SIZE = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * MBR<YY><MM><seq> — e.g. MBR26060001, MBR26060002. The 4-digit sequence is a
 * globally auto-incrementing counter (atomic Firestore transaction), prefixed
 * with the approval month so IDs stay both sequential and time-readable.
 */
async function generateRiderId(): Promise<string> {
  const counterRef = doc(db, 'counters', 'riderId');
  const seq = await runTransaction(db, async (txn) => {
    const snap = await txn.get(counterRef);
    const next = (snap.exists() ? (snap.data().seq ?? 0) : 0) + 1;
    txn.set(counterRef, { seq: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `MBR${yy}${mm}${String(seq).padStart(4, '0')}`;
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

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

function getFirebaseError(err: unknown): string {
  const code = (err as any)?.code ?? '';
  const map: Record<string, string> = {
    'auth/email-already-in-use': 'This email already has a login account.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password too weak (min 8 chars).',
  };
  return map[code] ?? (err as any)?.message ?? 'Unknown error';
}

const STATUS_META: Record<ApprovalStatus, { badge: string; dot: string; label: string }> = {
  pending:      { badge: 'bg-amber-100  text-amber-800  border-amber-200',  dot: 'bg-amber-400',  label: 'New Application' },
  under_review: { badge: 'bg-blue-100   text-blue-800   border-blue-200',   dot: 'bg-blue-500',   label: 'Under Review'    },
  approved:     { badge: 'bg-green-100  text-green-800  border-green-200',  dot: 'bg-green-500',  label: 'Approved'        },
  rejected:     { badge: 'bg-red-100    text-red-800    border-red-200',    dot: 'bg-red-500',    label: 'Rejected'        },
};

const VEHICLE_ICON: Record<string, string> = {
  Bike: '🏍️', Scooter: '🛵', Bicycle: '🚲', Car: '🚗',
};

function getDocScore(r: RiderDoc) {
  return {
    verified: [r.licenseVerified, r.aadharVerified, r.panVerified, r.bankVerified, r.profileVerified].filter(Boolean).length,
    uploaded: [r.licenseDocUrl, r.aadharDocUrl, r.panDocUrl, r.bankDocUrl, r.profileImage].filter(Boolean).length,
    total: 5,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${m.badge}`}>
      <motion.span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.dot}`}
        animate={status === 'pending' || status === 'under_review' ? { opacity: [1, 0.25, 1] } : {}}
        transition={{ duration: 1.4, repeat: Infinity }}
      />
      {m.label}
    </span>
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

function DocVerifyRow({
  label, number, url, verified, onVerify, onFlag,
}: {
  label: string; number?: string; url?: string;
  verified?: boolean; onVerify: () => void; onFlag: () => void;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
      verified === true  ? 'bg-green-50 border-green-200' :
      verified === false ? 'bg-red-50   border-red-200'   :
                           'bg-gray-50  border-gray-200'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        {verified === true ? (
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
        ) : verified === false ? (
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
          <p className="text-sm font-semibold text-gray-800 truncate">{number || '—'}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
        {url ? (
          <>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100">
              <ExternalLink className="w-3 h-3" /> View
            </a>
            <button onClick={onVerify}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                verified === true ? 'bg-green-500 text-white' : 'bg-green-100 text-green-600 hover:bg-green-200'
              }`} title="Verify">
              <CheckCircle className="w-3.5 h-3.5" />
            </button>
            <button onClick={onFlag}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                verified === false ? 'bg-red-500 text-white' : 'bg-red-100 text-red-500 hover:bg-red-200'
              }`} title="Flag issue">
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-300">Not uploaded</span>
        )}
      </div>
    </div>
  );
}

function StageStepper({ status }: { status: ApprovalStatus }) {
  const stages = [
    { key: 'pending',      label: 'Applied'     },
    { key: 'under_review', label: 'In Review'   },
    { key: 'approved',     label: 'Approved'    },
  ];
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-xl">
        <XCircle className="w-4 h-4 text-red-500" />
        <span className="text-sm font-bold text-red-700">Application Rejected</span>
      </div>
    );
  }
  const currentIdx = stages.findIndex(s => s.key === status);
  return (
    <div className="flex items-center">
      {stages.map((s, i) => {
        const done   = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all ${
                done   ? 'bg-green-500 border-green-500 text-white' :
                active ? 'bg-brand    border-brand    text-white' :
                         'bg-white    border-gray-300 text-gray-400'
              }`}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${
                done || active ? 'text-gray-700' : 'text-gray-400'
              }`}>{s.label}</span>
            </div>
            {i < stages.length - 1 && (
              <div className={`w-10 h-0.5 mb-4 mx-0.5 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RiderApproval() {
  const { user, profile } = useAuth();
  const adminName = profile?.name || user?.email || 'Admin';
  const [riders, setRiders]             = useState<RiderDoc[]>([]);
  const [loading, setLoading]           = useState(true);
  const [searchQuery, setSearchQuery]   = useState('');
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [page, setPage]                 = useState(1);

  const [approvingId, setApprovingId]           = useState<string | null>(null);
  const [startingReviewId, setStartingReviewId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget]         = useState<RiderDoc | null>(null);
  const [rejectReason, setRejectReason]         = useState('');
  const [rejecting, setRejecting]               = useState(false);
  const [detailTarget, setDetailTarget]         = useState<RiderDoc | null>(null);

  // Wizard state
  const [showAddModal, setShowAddModal]   = useState(false);
  const [addStep, setAddStep]             = useState<AddStep>(1);
  const [addData, setAddData]             = useState<AddWizardData>(INIT_ADD_DATA);
  const [addStepError, setAddStepError]   = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<RiderDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create account state
  const [creatingAccountId, setCreatingAccountId] = useState<string | null>(null);
  const [showCredModal, setShowCredModal]         = useState(false);
  const [createdCreds, setCreatedCreds]           = useState<{ email: string; password: string; name: string } | null>(null);
  const [showPass, setShowPass]                   = useState(false);
  const [credCopied, setCredCopied]               = useState(false);

  // ── Live listeners ────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    const map = new Map<string, RiderDoc>();

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

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rider')),
      snap => {
        snap.docs.forEach(d => {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() } as RiderDoc);
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

  useEffect(() => {
    if (!detailTarget) return;
    const fresh = riders.find(r => r.id === detailTarget.id);
    if (fresh) setDetailTarget(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riders]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const getStatus = (r: RiderDoc): ApprovalStatus =>
    (r.status as ApprovalStatus) || (r.approved ? 'approved' : 'pending');

  const counts = useMemo(() => ({
    all:          riders.length,
    pending:      riders.filter(r => getStatus(r) === 'pending').length,
    under_review: riders.filter(r => getStatus(r) === 'under_review').length,
    approved:     riders.filter(r => getStatus(r) === 'approved').length,
    rejected:     riders.filter(r => getStatus(r) === 'rejected').length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [riders]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return riders.filter(r => {
      const matchSearch = !searchQuery ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(searchQuery) ||
        (r.city || '').toLowerCase().includes(q) ||
        (r.vehicleNumber || '').toLowerCase().includes(q);
      const s = getStatus(r);
      return matchSearch && (statusFilter === 'all' || s === statusFilter);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riders, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [searchQuery, statusFilter]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const collectionFor = (r: RiderDoc) => r.role === 'rider' ? 'users' : 'riders';

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddStep(1);
    setAddData(INIT_ADD_DATA);
    setAddStepError(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCredCopied(true);
    setTimeout(() => setCredCopied(false), 2000);
  };

  // ── Wizard step validation & navigation ──────────────────────────────────

  const handleWizardNext = () => {
    setAddStepError(null);
    if (addStep === 1) {
      if (addData.name.trim().length < 2) { setAddStepError('Full name must be at least 2 characters.'); return; }
      if (!/^[6-9]\d{9}$/.test(addData.phone)) { setAddStepError('Enter a valid 10-digit Indian mobile number.'); return; }
    }
    if (addStep === 2) {
      if (addData.vehicleNumber.trim().length < 4) { setAddStepError('Vehicle number must be at least 4 characters.'); return; }
    }
    setAddStep(s => (s + 1) as AddStep);
  };

  const handleWizardBack = () => {
    setAddStepError(null);
    setAddStep(s => (s - 1) as AddStep);
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleAddWizardSubmit = async () => {
    setAddSubmitting(true);
    try {
      await setDoc(doc(db, 'riders', addData.phone), {
        name: addData.name, phone: addData.phone, email: addData.email || '',
        city: addData.city || '', vehicleType: addData.vehicleType,
        vehicleNumber: addData.vehicleNumber, licenseNumber: addData.licenseNumber || '',
        aadharNumber: addData.aadharNumber || '', panNumber: addData.panNumber || '',
        bankAccountNumber: addData.bankAccountNumber || '', bankIFSC: addData.bankIFSC || '',
        approved: false, status: 'pending', approvalStatus: 'pending',
        isOnline: false, activeOrderId: null, loginCreated: false,
        totalDeliveries: 0, totalEarnings: 0, todayEarnings: 0, weeklyEarnings: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      toast.success(`Application created for ${addData.name}`);
      closeAddModal();
    } catch (err: any) {
      setAddStepError('Failed: ' + err.message);
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleStartReview = async (r: RiderDoc) => {
    setStartingReviewId(r.id);
    try {
      await updateDoc(doc(db, collectionFor(r), r.id), {
        status: 'under_review', approvalStatus: 'under_review',
        reviewStartedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      if (r.phone && collectionFor(r) === 'users') {
        const ph = String(r.phone).replace(/^\+91/, '').trim();
        await setDoc(doc(db, 'riders', ph), {
          status: 'under_review', approvalStatus: 'under_review',
          reviewStartedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      toast.success(`Review started for ${r.name}`);
      if (detailTarget?.id === r.id)
        setDetailTarget(prev => prev ? { ...prev, status: 'under_review' } : null);
    } catch (err: any) {
      toast.error('Failed: ' + err.message);
    } finally {
      setStartingReviewId(null);
    }
  };

  const handleDocVerify = async (r: RiderDoc, field: string, value: boolean) => {
    try {
      await updateDoc(doc(db, collectionFor(r), r.id), { [field]: value, updatedAt: serverTimestamp() });
      if (r.phone) {
        const ph = String(r.phone).replace(/^\+91/, '').trim();
        await setDoc(doc(db, 'riders', ph), { [field]: value, updatedAt: serverTimestamp() }, { merge: true });
      }
      if (detailTarget?.id === r.id)
        setDetailTarget(prev => prev ? { ...prev, [field]: value } : null);
      toast.success(value ? 'Document verified ✓' : 'Document flagged ⚠');
    } catch (err: any) {
      toast.error('Update failed: ' + err.message);
    }
  };

  const handleApprove = async (r: RiderDoc) => {
    setApprovingId(r.id);
    try {
      const riderID = await generateRiderId();
      await updateDoc(doc(db, collectionFor(r), r.id), {
        approved: true, approvalStatus: 'approved', status: 'approved',
        isActive: true, approvedAt: serverTimestamp(), rejectedReason: null,
        riderID, approvedBy: adminName, approvedByUid: user?.uid ?? null,
      });
      if (r.phone) {
        const ph = String(r.phone).replace(/^\+91/, '').trim();
        await setDoc(doc(db, 'riders', ph), {
          name: r.name, phone: ph, email: r.email ?? '',
          vehicleType: r.vehicleType ?? '', vehicleNumber: r.vehicleNumber ?? '',
          licenseNumber: r.licenseNumber ?? '', city: r.city ?? '',
          approved: true, approvalStatus: 'approved', status: 'offline',
          isOnline: false, activeOrderId: null,
          totalDeliveries: 0, totalEarnings: 0, todayEarnings: 0, weeklyEarnings: 0,
          approvedAt: serverTimestamp(), updatedAt: serverTimestamp(),
          riderID, approvedBy: adminName, approvedByUid: user?.uid ?? null,
        }, { merge: true });
      }
      await logAuditEvent({
        action: 'RIDER_APPROVED', entityType: 'rider', entityId: r.id, entityName: r.name,
        adminUid: user?.uid, adminName, adminEmail: user?.email,
        details: { riderID, phone: r.phone ?? null },
      });
      toast.success(`${r.name} approved! Rider ID: ${riderID}`, { duration: 4500 });
    } catch (err: any) {
      toast.error('Approval failed: ' + err.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) {
      toast.error('Please enter a rejection reason'); return;
    }
    setRejecting(true);
    try {
      await updateDoc(doc(db, collectionFor(rejectTarget), rejectTarget.id), {
        approved: false, approvalStatus: 'rejected', status: 'rejected',
        isActive: false, rejectedReason: rejectReason.trim(), rejectedAt: serverTimestamp(),
      });
      if (rejectTarget.phone) {
        const ph = String(rejectTarget.phone).replace(/^\+91/, '').trim();
        await setDoc(doc(db, 'riders', ph), {
          approvalStatus: 'rejected', approved: false,
          rejectedReason: rejectReason.trim(), rejectedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await logAuditEvent({
        action: 'RIDER_REJECTED', entityType: 'rider', entityId: rejectTarget.id, entityName: rejectTarget.name,
        adminUid: user?.uid, adminName, adminEmail: user?.email,
        details: { reason: rejectReason.trim(), phone: rejectTarget.phone ?? null },
      });
      toast.error(`${rejectTarget.name} has been rejected.`, { duration: 4000 });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error('Rejection failed: ' + err.message);
    } finally {
      setRejecting(false);
    }
  };

  const handleCreateAccount = async (r: RiderDoc) => {
    if (!r.email) {
      toast.error('Rider has no email address. Add an email before creating a login.');
      return;
    }
    setCreatingAccountId(r.id);
    try {
      const password = generatePassword(12);
      const { user: authUser } = await createUserWithEmailAndPassword(secondaryAuth, r.email, password);
      await signOut(secondaryAuth);

      await setDoc(doc(db, 'users', authUser.uid), {
        uid: authUser.uid, email: r.email, name: r.name, phone: r.phone || '',
        role: 'rider', isActive: true,
        vehicleType: r.vehicleType ?? '', vehicleNumber: r.vehicleNumber ?? '',
        licenseNumber: r.licenseNumber ?? '', aadharNumber: r.aadharNumber ?? '',
        panNumber: r.panNumber ?? '', bankAccountNumber: r.bankAccountNumber ?? '',
        bankIFSC: r.bankIFSC ?? '',
        licenseApproved: r.licenseVerified ?? false, bankApproved: r.bankVerified ?? false,
        approved: true, approvalStatus: 'approved', status: 'offline',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      const ph = String(r.phone || '').replace(/^\+91/, '').trim();
      if (ph) {
        await setDoc(doc(db, 'riders', ph), {
          authUid: authUser.uid, loginCreated: true, loginCreatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      await logAuditEvent({
        action: 'RIDER_LOGIN_CREATED', entityType: 'rider', entityId: r.id, entityName: r.name,
        adminUid: user?.uid, adminName, adminEmail: user?.email,
        details: { email: r.email, authUid: authUser.uid },
      });
      setCreatedCreds({ email: r.email, password, name: r.name });
      setShowPass(false);
      setShowCredModal(true);
      toast.success('Login account created!', { duration: 3000 });
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        // Email already in Firebase Auth — check if there's already a users doc for this rider
        try {
          const existing = await getDocs(
            query(collection(db, 'users'), where('email', '==', r.email), where('role', '==', 'rider'))
          );
          if (!existing.empty) {
            const existingUid = existing.docs[0].id;
            const ph = String(r.phone || '').replace(/^\+91/, '').trim();
            if (ph) {
              await setDoc(doc(db, 'riders', ph), {
                authUid: existingUid, loginCreated: true, updatedAt: serverTimestamp(),
              }, { merge: true });
            }
            toast.success('Linked to existing rider account!', { duration: 3000 });
          } else {
            toast.error('This email is already used by another account. Please use a different email for this rider.');
          }
        } catch {
          toast.error('This email already has a login account. Use a different email.');
        }
      } else {
        toast.error(getFirebaseError(err));
      }
    } finally {
      setCreatingAccountId(null);
    }
  };

  const handleResetPassword = async (r: RiderDoc) => {
    if (!r.email) { toast.error('No email on file.'); return; }
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, r.email);
      toast.success(`Password reset email sent to ${r.email}`);
    } catch (err) { toast.error(getFirebaseError(err)); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const ph = String(deleteTarget.phone || '').replace(/^\+91/, '').trim();
      if (ph) await deleteDoc(doc(db, 'riders', ph));
      if (deleteTarget.authUid) await deleteDoc(doc(db, 'users', deleteTarget.authUid));
      else if (collectionFor(deleteTarget) === 'users') await deleteDoc(doc(db, 'users', deleteTarget.id));
      await logAuditEvent({
        action: 'RIDER_DELETED', entityType: 'rider', entityId: deleteTarget.id, entityName: deleteTarget.name,
        adminUid: user?.uid, adminName, adminEmail: user?.email,
        details: { phone: deleteTarget.phone ?? null, source: 'approvals' },
      });
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      if (detailTarget?.id === deleteTarget.id) setDetailTarget(null);
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-6">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Bike className="w-7 h-7 text-brand" /> Rider Onboarding
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Review and approve delivery partner applications</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => setShowAddModal(true)}
          className="btn-primary w-auto px-5 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Application
        </motion.button>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: 'pending',      label: 'New Applications', border: 'border-amber-400',  text: 'text-amber-700'  },
          { key: 'under_review', label: 'Under Review',     border: 'border-blue-500',   text: 'text-blue-700'   },
          { key: 'approved',     label: 'Approved',         border: 'border-green-500',  text: 'text-green-700'  },
          { key: 'rejected',     label: 'Rejected',         border: 'border-red-400',    text: 'text-red-600'    },
        ] as const).map((s, i) => (
          <motion.button
            key={s.key}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}
            onClick={() => setStatusFilter(s.key)}
            className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${s.border} text-left transition-all ${statusFilter === s.key ? 'ring-2 ring-offset-2 ring-brand' : 'hover:shadow-md'}`}
          >
            <motion.p
              key={counts[s.key]}
              initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
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
            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, vehicle no..."
            className="input-field pl-10"
          />
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl flex-wrap gap-0.5">
          {([
            { key: 'all',          label: 'All'       },
            { key: 'pending',      label: 'New'       },
            { key: 'under_review', label: 'In Review' },
            { key: 'approved',     label: 'Approved'  },
            { key: 'rejected',     label: 'Rejected'  },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                statusFilter === f.key ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] > 0 && (
                <span className="ml-1 opacity-60">({counts[f.key]})</span>
              )}
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
          <p className="text-gray-400 font-medium">Loading applications...</p>
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
                    <th className="table-header">Stage</th>
                    <th className="table-header">Applied</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {paginated.map((r, i) => {
                      const status      = getStatus(r);
                      const isPending   = status === 'pending';
                      const isReview    = status === 'under_review';
                      const isApproving = approvingId === r.id;
                      const isStarting  = startingReviewId === r.id;
                      const score       = getDocScore(r);

                      return (
                        <motion.tr
                          key={r.id} layout
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ delay: i * 0.025 }}
                          className={`border-b border-gray-50 transition-colors ${
                            isPending ? 'hover:bg-amber-50/40' :
                            isReview  ? 'hover:bg-blue-50/40'  :
                            'hover:bg-gray-50/60'
                          }`}
                        >
                          {/* Rider */}
                          <td className="table-cell">
                            <div className="flex items-center gap-3">
                              <Avatar rider={r} />
                              <div>
                                <p className="font-bold text-gray-800">{r.name}</p>
                                {r.email && <p className="text-[11px] text-gray-400 truncate max-w-[130px]">{r.email}</p>}
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
                              <span className="text-base leading-none">{VEHICLE_ICON[r.vehicleType || ''] || '🛵'}</span>
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

                          {/* Stage + doc score */}
                          <td className="table-cell">
                            <StatusBadge status={status} />
                            {score.uploaded > 0 && (
                              <div className="flex items-center gap-1 mt-1.5">
                                <div className="flex gap-0.5">
                                  {Array.from({ length: 5 }).map((_, idx) => (
                                    <div key={idx} className={`w-2 h-2 rounded-full ${
                                      idx < score.verified ? 'bg-green-500' :
                                      idx < score.uploaded ? 'bg-amber-300' :
                                      'bg-gray-200'
                                    }`} />
                                  ))}
                                </div>
                                <span className="text-[9px] font-bold text-gray-400">
                                  {score.verified}/{score.total} docs
                                </span>
                              </div>
                            )}
                            {status === 'approved' && r.loginCreated && (
                              <div className="flex items-center gap-1 mt-1">
                                <Key className="w-2.5 h-2.5 text-indigo-400" />
                                <span className="text-[9px] font-bold text-indigo-500">Login active</span>
                              </div>
                            )}
                            {status === 'rejected' && r.rejectedReason && (
                              <p className="text-[10px] text-red-400 mt-1 max-w-[100px] truncate" title={r.rejectedReason}>
                                {r.rejectedReason}
                              </p>
                            )}
                          </td>

                          {/* Date */}
                          <td className="table-cell text-gray-500 text-xs">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-300" />
                              {formatDate(r.createdAt)}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <motion.button
                                whileTap={{ scale: 0.93 }}
                                onClick={() => setDetailTarget(r)}
                                className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-100"
                                title="View Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </motion.button>
                              <motion.button
                                whileTap={{ scale: 0.93 }}
                                onClick={() => setDeleteTarget(r)}
                                className="w-8 h-8 bg-red-50 text-red-500 rounded-lg flex items-center justify-center hover:bg-red-100"
                                title="Delete Application"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </motion.button>

                              {isPending && (
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => handleStartReview(r)}
                                  disabled={isStarting}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                                >
                                  {isStarting ? (
                                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                                      className="w-3 h-3 border-2 border-white border-t-transparent rounded-full block" />
                                  ) : <RefreshCw className="w-3.5 h-3.5" />}
                                  Review
                                </motion.button>
                              )}

                              {(isPending || isReview) && (
                                <>
                                  <motion.button
                                    whileTap={{ scale: 0.93 }}
                                    onClick={() => handleApprove(r)}
                                    disabled={isApproving}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-60 shadow-sm shadow-green-200 transition-colors"
                                  >
                                    {isApproving ? (
                                      <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                                        className="w-3 h-3 border-2 border-white border-t-transparent rounded-full block" />
                                    ) : <CheckCircle className="w-3.5 h-3.5" />}
                                    Approve
                                  </motion.button>
                                  <motion.button
                                    whileTap={{ scale: 0.93 }}
                                    onClick={() => { setRejectTarget(r); setRejectReason(''); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition-colors"
                                  >
                                    <XCircle className="w-3.5 h-3.5" /> Reject
                                  </motion.button>
                                </>
                              )}

                              {status === 'approved' && !r.loginCreated && (
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => handleCreateAccount(r)}
                                  disabled={creatingAccountId === r.id}
                                  className="flex items-center gap-1 text-xs text-indigo-600 font-bold bg-indigo-50 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                                  title="Create login account"
                                >
                                  {creatingAccountId === r.id ? (
                                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                                      className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full block" />
                                  ) : <UserPlus className="w-3.5 h-3.5" />}
                                  Login
                                </motion.button>
                              )}

                              {status === 'approved' && r.loginCreated && (
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => handleResetPassword(r)}
                                  className="flex items-center gap-1 text-xs text-green-600 font-bold bg-green-50 px-2.5 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                                  title="Send password reset email"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" /> Reset
                                </motion.button>
                              )}

                              {status === 'rejected' && (
                                <motion.button
                                  whileTap={{ scale: 0.93 }}
                                  onClick={() => handleApprove(r)}
                                  disabled={isApproving}
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

              {paginated.length === 0 && (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Bike className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-semibold">No applications found</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {statusFilter !== 'all' ? `No ${statusFilter.replace('_', ' ')} applications` : 'No rider applications yet'}
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowAddModal(true)}
                    className="mt-4 btn-primary w-auto px-5 inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add First Application
                  </motion.button>
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
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
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
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-bold transition-all ${
                        page === p ? 'bg-brand text-white shadow-md shadow-orange-200' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════ ADD RIDER — 4-STEP WIZARD ════════════════════════════ */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={closeAddModal} />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Progress bar */}
              <div className="h-1 bg-gray-100 flex-shrink-0">
                <motion.div
                  className="h-1 bg-gradient-to-r from-brand to-orange-400"
                  animate={{ width: `${(addStep / 4) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-black text-gray-800">Add Rider Application</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Step {addStep} of 4 — {STEP_LABELS[addStep - 1]}</p>
                  </div>
                  <button onClick={closeAddModal} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Step indicators */}
                <div className="flex items-center justify-between">
                  {STEP_LABELS.map((label, i) => {
                    const step = (i + 1) as AddStep;
                    const isDone   = addStep > step;
                    const isActive = addStep === step;
                    return (
                      <div key={label} className="flex items-center flex-1">
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all ${
                            isDone   ? 'bg-green-500 border-green-500 text-white' :
                            isActive ? 'bg-brand border-brand text-white' :
                                       'bg-white border-gray-300 text-gray-400'
                          }`}>
                            {isDone ? '✓' : step}
                          </div>
                          <span className={`text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${
                            isDone || isActive ? 'text-gray-700' : 'text-gray-400'
                          }`}>{label}</span>
                        </div>
                        {i < 3 && (
                          <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${isDone ? 'bg-green-400' : 'bg-gray-200'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step content */}
              <div className="flex-1 overflow-y-auto p-6">
                {addStepError && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm mb-5 flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {addStepError}
                  </motion.div>
                )}

                <AnimatePresence mode="wait">
                  {/* STEP 1: Personal Info */}
                  {addStep === 1 && (
                    <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-4">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Personal Information</p>

                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                          Full Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          value={addData.name}
                          onChange={e => setAddData(d => ({ ...d, name: e.target.value }))}
                          className="input-field" placeholder="Ravi Kumar"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                          Phone Number <span className="text-red-400">*</span>
                          <span className="text-gray-400 font-normal normal-case ml-1">(10-digit)</span>
                        </label>
                        <input
                          type="tel"
                          value={addData.phone}
                          onChange={e => setAddData(d => ({ ...d, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                          className="input-field" placeholder="9876543210"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
                          <input
                            type="email"
                            value={addData.email}
                            onChange={e => setAddData(d => ({ ...d, email: e.target.value }))}
                            className="input-field" placeholder="rider@email.com"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">City</label>
                          <input
                            value={addData.city}
                            onChange={e => setAddData(d => ({ ...d, city: e.target.value }))}
                            className="input-field" placeholder="Hyderabad"
                          />
                        </div>
                      </div>

                      <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
                        <Hash className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700">
                          Phone number is used as the rider's unique ID. Make sure it's correct before proceeding.
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 2: Vehicle Details */}
                  {addStep === 2 && (
                    <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-4">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vehicle Details</p>

                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vehicle Type</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['Bike', 'Scooter', 'Bicycle', 'Car'] as const).map(v => (
                            <button
                              key={v} type="button"
                              onClick={() => setAddData(d => ({ ...d, vehicleType: v }))}
                              className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${
                                addData.vehicleType === v
                                  ? 'border-brand bg-orange-50 text-brand'
                                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-lg">{VEHICLE_ICON[v]}</span> {v}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                          Vehicle Number <span className="text-red-400">*</span>
                        </label>
                        <input
                          value={addData.vehicleNumber}
                          onChange={e => setAddData(d => ({ ...d, vehicleNumber: e.target.value.toUpperCase() }))}
                          className="input-field font-mono" placeholder="TS09EA1234"
                        />
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 3: Documents */}
                  {addStep === 3 && (
                    <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Document Numbers</p>
                        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Optional</span>
                      </div>
                      <p className="text-xs text-gray-500 -mt-2">
                        Rider can upload document photos later via the app. Enter numbers here if available.
                      </p>

                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Driving License No.</label>
                        <input
                          value={addData.licenseNumber}
                          onChange={e => setAddData(d => ({ ...d, licenseNumber: e.target.value.toUpperCase() }))}
                          className="input-field font-mono" placeholder="TS0920200012345"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Aadhaar Number</label>
                        <input
                          value={addData.aadharNumber}
                          onChange={e => setAddData(d => ({ ...d, aadharNumber: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                          className="input-field font-mono" placeholder="XXXX XXXX XXXX"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">PAN Number</label>
                        <input
                          value={addData.panNumber}
                          onChange={e => setAddData(d => ({ ...d, panNumber: e.target.value.toUpperCase().slice(0, 10) }))}
                          className="input-field font-mono" placeholder="ABCDE1234F"
                        />
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 4: Bank + Review */}
                  {addStep === 4 && (
                    <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-5">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Bank Details</p>
                          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Optional</span>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Account Number</label>
                            <input
                              value={addData.bankAccountNumber}
                              onChange={e => setAddData(d => ({ ...d, bankAccountNumber: e.target.value.replace(/\D/g, '') }))}
                              className="input-field font-mono" placeholder="Account number"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">IFSC Code</label>
                            <input
                              value={addData.bankIFSC}
                              onChange={e => setAddData(d => ({ ...d, bankIFSC: e.target.value.toUpperCase().slice(0, 11) }))}
                              className="input-field font-mono" placeholder="SBIN0001234"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Summary */}
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Application Summary</p>
                        <div className="bg-gray-50 rounded-2xl p-4 space-y-2 text-sm">
                          {[
                            { label: 'Name',    value: addData.name },
                            { label: 'Phone',   value: addData.phone },
                            { label: 'Email',   value: addData.email || '—' },
                            { label: 'City',    value: addData.city || '—' },
                            { label: 'Vehicle', value: `${addData.vehicleType} · ${addData.vehicleNumber}` },
                          ].map(row => (
                            <div key={row.label} className="flex items-center justify-between">
                              <span className="text-gray-400 font-medium text-xs">{row.label}</span>
                              <span className="text-gray-800 font-semibold text-xs">{row.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700">
                          Application starts as <strong>Pending</strong>. Review documents and approve to give the rider access.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer nav */}
              <div className="p-5 border-t border-gray-100 bg-white flex-shrink-0 flex gap-3">
                {addStep > 1 ? (
                  <button
                    onClick={handleWizardBack}
                    className="flex items-center gap-2 px-5 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                ) : (
                  <button onClick={closeAddModal} className="px-5 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">
                    Cancel
                  </button>
                )}

                {addStep < 4 ? (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleWizardNext}
                    className="flex-1 btn-primary flex items-center justify-center gap-2"
                  >
                    Continue <ChevronRight className="w-4 h-4" />
                  </motion.button>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleAddWizardSubmit}
                    disabled={addSubmitting}
                    className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {addSubmitting
                      ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Creating...</>
                      : <><Plus className="w-4 h-4" /> Create Application</>
                    }
                  </motion.button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════ REJECT MODAL ═════════════════════════════════════════ */}
      <AnimatePresence>
        {rejectTarget && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={() => setRejectTarget(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-400" />
              <div className="p-6">
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <ShieldX className="w-6 h-6 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-black text-gray-800">Reject Application</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      This will block <span className="font-bold text-gray-700">"{rejectTarget.name}"</span> from delivering orders.
                    </p>
                  </div>
                  <button onClick={() => setRejectTarget(null)}
                    className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 font-medium">
                    The rejection reason will be visible to the rider in their app.
                  </p>
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Rejection Reason *</label>
                  <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. Driving license is expired or unreadable..."
                    className="input-field resize-none" autoFocus />
                </div>

                <div className="flex flex-wrap gap-2 mb-5">
                  {['Invalid license', 'Document mismatch', 'Blurry ID photo', 'Fake vehicle number', 'Incomplete profile', 'Under 18 years'].map(c => (
                    <button key={c} onClick={() => setRejectReason(c)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors">
                      {c}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setRejectTarget(null)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">
                    Cancel
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleReject}
                    disabled={rejecting || !rejectReason.trim()}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    {rejecting
                      ? <><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-white border-t-transparent rounded-full block" /> Rejecting...</>
                      : <><XCircle className="w-4 h-4" /> Confirm Reject</>
                    }
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════ CREDENTIAL MODAL ═════════════════════════════════════ */}
      <AnimatePresence>
        {showCredModal && createdCreds && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[61] max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500" />
              <div className="p-6">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Lock className="w-7 h-7 text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-black text-gray-800">Login Account Created!</h2>
                  <p className="text-sm text-gray-500 mt-1">{createdCreds.name} can now log into the rider app</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 font-semibold">
                    Save this password now — it won't be shown again!
                  </p>
                </div>

                <div className="space-y-3 mb-5">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Email / Username</p>
                    <p className="font-mono text-sm text-gray-800 break-all">{createdCreds.email}</p>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Temporary Password</p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setShowPass(s => !s)} className="p-1 text-gray-400 hover:text-gray-600">
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => copyToClipboard(`Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="Copy credentials"
                        >
                          {credCopied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <p className="font-mono text-base text-gray-800 tracking-wider">
                      {showPass ? createdCreds.password : '•'.repeat(createdCreds.password.length)}
                    </p>
                  </div>
                </div>

                <div className="bg-indigo-50 rounded-xl p-3 mb-5 text-xs text-indigo-700">
                  Share these credentials with <strong>{createdCreds.name}</strong>. They can change their password after first login.
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setShowCredModal(false); setCreatedCreds(null); setShowPass(false); }}
                  className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" /> Done — Credentials Saved
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════ DELETE CONFIRM MODAL ════════════════════════════════ */}
      <AnimatePresence>
        {deleteTarget && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={() => !deleting && setDeleteTarget(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-400" />
              <div className="p-6">
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <Trash2 className="w-6 h-6 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-black text-gray-800">Delete Application</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Permanently delete <span className="font-bold text-gray-700">"{deleteTarget.name}"</span>? This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">
                    All rider data will be permanently removed from Firestore.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 disabled:opacity-50">
                    Cancel
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleDelete} disabled={deleting}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    {deleting
                      ? <><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-white border-t-transparent rounded-full block" /> Deleting...</>
                      : <><Trash2 className="w-4 h-4" /> Delete</>
                    }
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════ DETAIL SLIDE-IN ══════════════════════════════════════ */}
      <AnimatePresence>
        {detailTarget && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              onClick={() => setDetailTarget(null)} />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-brand to-orange-400" />

              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-4 flex-shrink-0">
                {detailTarget.profileImage ? (
                  <img src={detailTarget.profileImage} alt={detailTarget.name}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-white shadow-md flex-shrink-0" />
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
                    {detailTarget.loginCreated && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Key className="w-2.5 h-2.5" /> Login active
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

                {/* Stage Progress */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Application Stage</p>
                  <div className="p-4 bg-gray-50 rounded-2xl flex justify-center">
                    <StageStepper status={getStatus(detailTarget)} />
                  </div>
                  {getStatus(detailTarget) === 'pending' && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleStartReview(detailTarget)}
                      disabled={startingReviewId === detailTarget.id}
                      className="mt-2 w-full py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 flex items-center justify-center gap-2 text-sm transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" /> Start Document Review
                    </motion.button>
                  )}
                </section>

                {/* Personal Info */}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Personal Info</p>
                  <div className="space-y-2">
                    {[
                      { icon: User,     label: 'Full Name',  value: detailTarget.name     },
                      { icon: Phone,    label: 'Phone',      value: detailTarget.phone    },
                      { icon: Hash,     label: 'Email',      value: detailTarget.email    },
                      { icon: MapPin,   label: 'City',       value: detailTarget.city     },
                      { icon: Calendar, label: 'Applied On', value: formatDateTime(detailTarget.createdAt) },
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
                      { label: 'Type',        value: `${VEHICLE_ICON[detailTarget.vehicleType || ''] || '🛵'} ${detailTarget.vehicleType || '—'}` },
                      { label: 'Number',      value: detailTarget.vehicleNumber  },
                      { label: 'License No.', value: detailTarget.licenseNumber  },
                    ].map(f => (
                      <div key={f.label} className="p-3 bg-gray-50 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{f.label}</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5 font-mono">{f.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Document Verification */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Document Verification</p>
                    {(() => {
                      const s = getDocScore(detailTarget);
                      return (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          s.verified === s.total ? 'bg-green-100 text-green-700' :
                          s.verified > 0         ? 'bg-amber-100 text-amber-700' :
                                                   'bg-gray-100  text-gray-500'
                        }`}>
                          {s.verified}/{s.total} verified
                        </span>
                      );
                    })()}
                  </div>
                  <div className="space-y-2">
                    <DocVerifyRow
                      label="Driving License" number={detailTarget.licenseNumber}
                      url={detailTarget.licenseDocUrl} verified={detailTarget.licenseVerified}
                      onVerify={() => handleDocVerify(detailTarget, 'licenseVerified', true)}
                      onFlag={() => handleDocVerify(detailTarget, 'licenseVerified', false)}
                    />
                    <DocVerifyRow
                      label="Aadhaar Card" number={detailTarget.aadharNumber}
                      url={detailTarget.aadharDocUrl} verified={detailTarget.aadharVerified}
                      onVerify={() => handleDocVerify(detailTarget, 'aadharVerified', true)}
                      onFlag={() => handleDocVerify(detailTarget, 'aadharVerified', false)}
                    />
                    <DocVerifyRow
                      label="PAN Card" number={detailTarget.panNumber}
                      url={detailTarget.panDocUrl} verified={detailTarget.panVerified}
                      onVerify={() => handleDocVerify(detailTarget, 'panVerified', true)}
                      onFlag={() => handleDocVerify(detailTarget, 'panVerified', false)}
                    />
                    <DocVerifyRow
                      label="Bank Account"
                      number={detailTarget.bankAccountNumber
                        ? `${detailTarget.bankAccountNumber} · ${detailTarget.bankIFSC || '—'}`
                        : undefined}
                      url={detailTarget.bankDocUrl} verified={detailTarget.bankVerified}
                      onVerify={() => handleDocVerify(detailTarget, 'bankVerified', true)}
                      onFlag={() => handleDocVerify(detailTarget, 'bankVerified', false)}
                    />
                    <DocVerifyRow
                      label="Profile Photo" url={detailTarget.profileImage}
                      verified={detailTarget.profileVerified}
                      onVerify={() => handleDocVerify(detailTarget, 'profileVerified', true)}
                      onFlag={() => handleDocVerify(detailTarget, 'profileVerified', false)}
                    />
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

              {/* Footer */}
              {(getStatus(detailTarget) === 'pending' || getStatus(detailTarget) === 'under_review') && (
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3 flex-shrink-0">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { handleApprove(detailTarget); setDetailTarget(null); }}
                    className="flex-1 py-3.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 flex items-center justify-center gap-2 shadow-md shadow-green-200"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve Rider
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setRejectTarget(detailTarget); setDetailTarget(null); setRejectReason(''); }}
                    className="flex-1 py-3.5 bg-red-100 text-red-700 font-bold rounded-xl hover:bg-red-200 flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </motion.button>
                </div>
              )}

              {getStatus(detailTarget) === 'approved' && (
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex-shrink-0 space-y-2">
                  {!detailTarget.loginCreated ? (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleCreateAccount(detailTarget)}
                      disabled={creatingAccountId === detailTarget.id}
                      className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex items-center justify-center gap-2 shadow-md shadow-indigo-200 disabled:opacity-60"
                    >
                      {creatingAccountId === detailTarget.id ? (
                        <><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-white border-t-transparent rounded-full block" /> Creating Account...</>
                      ) : (
                        <><UserPlus className="w-4 h-4" /> Create Login Account</>
                      )}
                    </motion.button>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1 py-3 bg-green-50 border border-green-200 text-green-700 font-bold rounded-xl flex items-center justify-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4" /> Login Active
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleResetPassword(detailTarget)}
                        className="px-4 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 flex items-center gap-2 text-sm"
                        title="Send password reset email"
                      >
                        <Key className="w-4 h-4" /> Reset
                      </motion.button>
                    </div>
                  )}
                </div>
              )}

              {getStatus(detailTarget) === 'rejected' && (
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex-shrink-0">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { handleApprove(detailTarget); setDetailTarget(null); }}
                    className="w-full py-3.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" /> Re-approve Rider
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
