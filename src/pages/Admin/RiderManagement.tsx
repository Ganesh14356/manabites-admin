import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, query, where,
  onSnapshot, orderBy, getDocs, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { auth, db, secondaryAuth } from '../../firebase';
import {
  Plus, Edit2, Key, ToggleLeft, ToggleRight, Search, Copy, Trash2,
  AlertTriangle, X, Check, Eye, EyeOff, Bike,
  Map as MapIcon, List, DollarSign, FileCheck, FileX, ShoppingBag,
  TrendingUp, ChevronDown, ExternalLink, FileText,
} from 'lucide-react';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const onlineIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">&#x1F6F5;</div>`,
  iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
});
const offlineIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;background:#9ca3af;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">&#x1F6F5;</div>`,
  iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
});

// ── Vehicle icons ──────────────────────────────────────────────────────────────
const VEHICLE_ICONS: Record<string, string> = {
  Bike: '🏍️', Scooter: '🛵', Bicycle: '🚴', Car: '🚗',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderDoc {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: 'rider';
  isActive: boolean;
  vehicleType?: string;
  vehicleNumber?: string;
  licenseDocUrl?: string;
  licenseApproved?: boolean;
  licenseNumber?: string;
  aadharDocUrl?: string;
  aadharApproved?: boolean;
  bankAccountNumber?: string;
  bankIFSC?: string;
  bankDocUrl?: string;
  bankApproved?: boolean;
  createdAt: Timestamp;
  _fromRidersCollection?: boolean;
}

interface RiderLocation {
  riderId: string;
  riderName: string;
  lat: number;
  lng: number;
  isOnline: boolean;
  currentOrderId?: string;
  updatedAt: any;
}

interface EarningEntry {
  id: string;
  orderId: string;
  restaurantName: string;
  customerName: string;
  deliveryFeeEarned: number;
  distance: number;
  createdAt: any;
}

type Tab = 'list' | 'map' | 'earnings';
type DocApprovalField = 'licenseApproved' | 'bankApproved' | 'aadharApproved';

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeInitials(name?: string): string {
  if (!name || !name.trim()) return 'R';
  return name.trim().split(/\s+/).map(n => n[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'R';
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

function getFirebaseError(err: unknown): string {
  const code = (err as any)?.code ?? '';
  const map: Record<string, string> = {
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password too weak (min 8 chars).',
  };
  return map[code] ?? (err as any)?.message ?? 'Unknown error';
}

// ── Zod Schema ────────────────────────────────────────────────────────────────

const riderSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile required'),
  vehicleType: z.enum(['Bike', 'Scooter', 'Bicycle', 'Car']),
  vehicleNumber: z.string().min(4).max(20),
  licenseNumber: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIFSC: z.string().optional(),
});
type RiderFormData = z.infer<typeof riderSchema>;

// ── Document Preview Modal ────────────────────────────────────────────────────

function DocPreviewModal({ rider, onClose, onApprove }: {
  rider: RiderDoc;
  onClose: () => void;
  onApprove: (field: DocApprovalField, value: boolean) => void;
}) {
  const docs = [
    { label: 'Driving License', url: rider.licenseDocUrl, approved: rider.licenseApproved, field: 'licenseApproved' as DocApprovalField, number: rider.licenseNumber },
    { label: 'Aadhaar Card', url: rider.aadharDocUrl, approved: rider.aadharApproved, field: 'aadharApproved' as DocApprovalField, number: undefined },
    { label: 'Bank Document', url: rider.bankDocUrl, approved: rider.bankApproved, field: 'bankApproved' as DocApprovalField, number: rider.bankAccountNumber ? `A/C: ${rider.bankAccountNumber}${rider.bankIFSC ? ` · ${rider.bankIFSC}` : ''}` : undefined },
  ];

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[61] max-w-lg mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-black text-gray-800">Document Verification</h2>
            <p className="text-xs text-gray-400 mt-0.5">{rider.name || 'Unknown Rider'} · {rider.phone}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {docs.map(d => (
            <div key={d.field} className={`rounded-2xl border-2 overflow-hidden ${
              d.approved === true  ? 'border-green-300 bg-green-50/40' :
              d.approved === false ? 'border-red-200 bg-red-50/30' :
                                     'border-gray-200 bg-white'
            }`}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-black text-gray-800">{d.label}</p>
                    {d.number && <p className="text-[10px] font-mono text-gray-400">{d.number}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100">
                      <ExternalLink className="w-3 h-3" /> View
                    </a>
                  )}
                  {d.url && (
                    <>
                      <button
                        onClick={() => onApprove(d.field, true)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black transition-colors ${
                          d.approved === true ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        <FileCheck className="w-3 h-3" /> Approve
                      </button>
                      <button
                        onClick={() => onApprove(d.field, false)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black transition-colors ${
                          d.approved === false ? 'bg-red-500 text-white' : 'bg-red-100 text-red-600 hover:bg-red-200'
                        }`}
                      >
                        <FileX className="w-3 h-3" /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              {d.url ? (
                <div className="p-3">
                  <img
                    src={d.url}
                    alt={d.label}
                    className="w-full h-40 object-cover rounded-xl"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-400 font-medium">No document uploaded yet</p>
                  <p className="text-xs text-gray-300 mt-0.5">Rider needs to upload this document via the app</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}

// ── Quick Action Dropdown ─────────────────────────────────────────────────────

function QuickActionMenu({ rider, onEarnings, onResetPass, onToggle, onDelete }: {
  rider: RiderDoc;
  onEarnings: () => void;
  onResetPass: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
      >
        More <ChevronDown className="w-3 h-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl shadow-xl border border-gray-100 z-20 overflow-hidden"
          >
            <button
              onClick={() => { setOpen(false); onEarnings(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 text-left"
            >
              <DollarSign className="w-3.5 h-3.5 text-green-500" /> View Earnings
            </button>
            <button
              onClick={() => { setOpen(false); onResetPass(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 text-left"
            >
              <Key className="w-3.5 h-3.5 text-yellow-500" /> Reset Password
            </button>
            <div className="border-t border-gray-100" />
            <button
              onClick={() => { setOpen(false); onToggle(); }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-left hover:bg-gray-50 ${rider.isActive ? 'text-orange-600' : 'text-green-600'}`}
            >
              {rider.isActive
                ? <><ToggleRight className="w-3.5 h-3.5" /> Suspend Rider</>
                : <><ToggleLeft className="w-3.5 h-3.5" /> Activate Rider</>
              }
            </button>
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 text-left"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RiderManagement() {
  const [tab, setTab] = useState<Tab>('list');
  const [riders, setRiders] = useState<RiderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<RiderDoc | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [generatedPass, setGeneratedPass] = useState({ password: '', email: '', name: '' });
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<RiderDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Document preview modal
  const [docPreviewRider, setDocPreviewRider] = useState<RiderDoc | null>(null);

  // Map
  const [riderLocations, setRiderLocations] = useState<RiderLocation[]>([]);

  // Earnings
  const [selectedRiderForEarnings, setSelectedRiderForEarnings] = useState<RiderDoc | null>(null);
  const [earnings, setEarnings] = useState<EarningEntry[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [totalEarnings, setTotalEarnings] = useState(0);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RiderFormData>({
    resolver: zodResolver(riderSchema),
    defaultValues: { vehicleType: 'Bike' },
  });

  // ── Listeners ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let usersData: RiderDoc[] = [];
    let approvedRidersData: RiderDoc[] = [];

    const merge = () => {
      const usersEmails = new Set(usersData.map(r => r.email?.toLowerCase()).filter(Boolean));
      const fromApproval = approvedRidersData.filter(
        r => !r.email || !usersEmails.has(r.email.toLowerCase())
      );
      setRiders(
        [...usersData, ...fromApproval].sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        )
      );
      setLoading(false);
    };

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rider')),
      snap => { usersData = snap.docs.map(d => ({ uid: d.id, ...d.data() } as RiderDoc)); merge(); },
      err => { toast.error('Failed to load riders: ' + err.message); setLoading(false); }
    );

    const unsubRiders = onSnapshot(
      query(collection(db, 'riders'), where('approved', '==', true)),
      snap => {
        approvedRidersData = snap.docs
          .filter(d => !d.data().loginCreated)
          .map(d => {
            const data = d.data();
            return {
              uid: d.id,
              name: data.name || '',
              email: data.email || '',
              phone: data.phone || d.id,
              role: 'rider' as const,
              isActive: data.isActive ?? true,
              vehicleType: data.vehicleType,
              vehicleNumber: data.vehicleNumber,
              licenseDocUrl: data.licenseDocUrl,
              licenseApproved: data.licenseVerified,
              bankDocUrl: data.bankDocUrl,
              bankApproved: data.bankVerified,
              createdAt: data.createdAt,
              _fromRidersCollection: true,
            } as RiderDoc;
          });
        merge();
      },
      () => {}
    );

    return () => { unsubUsers(); unsubRiders(); };
  }, []);

  useEffect(() => {
    if (tab !== 'map') return;
    const unsub = onSnapshot(collection(db, 'riderLocations'), snap => {
      setRiderLocations(snap.docs.map(d => ({ riderId: d.id, ...d.data() } as RiderLocation)));
    });
    return () => unsub();
  }, [tab]);

  // ── Earnings ────────────────────────────────────────────────────────────────

  const loadEarnings = async (rider: RiderDoc) => {
    setSelectedRiderForEarnings(rider);
    setEarningsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'orders'), where('riderId', '==', rider.uid), where('status', '==', 'delivered'))
      );
      const entries: EarningEntry[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, orderId: d.id,
          restaurantName: data.restaurantName || '—',
          customerName: data.customerName || '—',
          deliveryFeeEarned: data.deliveryFee || 0,
          distance: data.distanceKm || 0,
          createdAt: data.createdAt,
        };
      }).sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setEarnings(entries);
      setTotalEarnings(entries.reduce((s, e) => s + e.deliveryFeeEarned, 0));
    } catch { toast.error('Failed to load earnings'); }
    finally { setEarningsLoading(false); }
  };

  // ── Filters ─────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => riders.filter(r => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !searchQuery ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.phone || '').includes(searchQuery);
    const matchStatus =
      statusFilter === 'all' ? true :
      statusFilter === 'active' ? r.isActive :
      !r.isActive;
    return matchSearch && matchStatus;
  }), [riders, searchQuery, statusFilter]);

  // Stats — pendingDocs counts riders missing ANY document OR with pending approval
  const stats = useMemo(() => ({
    total: riders.length,
    active: riders.filter(r => r.isActive).length,
    inactive: riders.filter(r => !r.isActive).length,
    pendingDocs: riders.filter(r =>
      !r.licenseDocUrl || !r.bankDocUrl ||
      (r.licenseDocUrl && !r.licenseApproved) ||
      (r.bankDocUrl && !r.bankApproved)
    ).length,
  }), [riders]);

  const onlineCount = riderLocations.filter(r => r.isOnline).length;

  // ── Actions ──────────────────────────────────────────────────────────────────

  const onSubmit = async (data: RiderFormData) => {
    setIsSubmitting(true);
    setFormError(null);
    try {
      if (editTarget) {
        await updateDoc(doc(db, 'users', editTarget.uid), {
          name: data.name, phone: data.phone,
          vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber,
          licenseNumber: data.licenseNumber || null,
          bankAccountNumber: data.bankAccountNumber || null,
          bankIFSC: data.bankIFSC || null,
          updatedAt: serverTimestamp(),
        });
        toast.success('Rider updated');
        closeModal();
      } else {
        const password = generatePassword(12);
        const { user } = await createUserWithEmailAndPassword(secondaryAuth, data.email, password);
        const uid = user.uid;
        await signOut(secondaryAuth);
        await setDoc(doc(db, 'users', uid), {
          uid, email: data.email, name: data.name, phone: data.phone,
          role: 'rider', isActive: true,
          vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber,
          licenseNumber: data.licenseNumber || null,
          bankAccountNumber: data.bankAccountNumber || null,
          bankIFSC: data.bankIFSC || null,
          licenseApproved: false, bankApproved: false,
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'riders', data.phone), {
          name: data.name, phone: data.phone, email: data.email,
          vehicleType: data.vehicleType, vehicleNumber: data.vehicleNumber,
          licenseNumber: data.licenseNumber || null,
          approvalStatus: 'pending', approved: false,
          status: 'offline', isOnline: false, activeOrderId: null,
          totalDeliveries: 0, totalEarnings: 0, todayEarnings: 0, weeklyEarnings: 0,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
        closeModal();
        setGeneratedPass({ password, email: data.email, name: data.name });
        setShowPasswordModal(true);
      }
    } catch (err) {
      setFormError(getFirebaseError(err));
    } finally { setIsSubmitting(false); }
  };

  const handleToggleStatus = async (rider: RiderDoc) => {
    try {
      const ref = rider._fromRidersCollection
        ? doc(db, 'riders', rider.uid)
        : doc(db, 'users', rider.uid);
      await updateDoc(ref, { isActive: !rider.isActive });
      toast.success(`Rider ${!rider.isActive ? 'activated' : 'suspended'}`);
    } catch { toast.error('Failed to update status'); }
  };

  const handleDocApproval = async (rider: RiderDoc, field: DocApprovalField, approve: boolean) => {
    try {
      const ref = rider._fromRidersCollection
        ? doc(db, 'riders', rider.uid)
        : doc(db, 'users', rider.uid);
      await updateDoc(ref, { [field]: approve });
      // refresh doc preview
      setDocPreviewRider(prev => prev ? { ...prev, [field]: approve } : null);
      toast.success(`Document ${approve ? 'approved ✓' : 'rejected ✗'}`);
    } catch { toast.error('Failed to update document status'); }
  };

  const handleResetPassword = async (rider: RiderDoc) => {
    if (!rider.email) { toast.error('No email on file'); return; }
    try {
      await sendPasswordResetEmail(auth, rider.email);
      toast.success(`Reset email sent to ${rider.email}`);
    } catch (err) { toast.error(getFirebaseError(err)); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget._fromRidersCollection) {
        const ph = String(deleteTarget.phone || deleteTarget.uid || '').replace(/^\+91/, '').trim();
        if (ph) await deleteDoc(doc(db, 'riders', ph));
      } else {
        await deleteDoc(doc(db, 'users', deleteTarget.uid));
        const ph = String(deleteTarget.phone || '').replace(/^\+91/, '').trim();
        if (ph) { try { await deleteDoc(doc(db, 'riders', ph)); } catch { /* ignore */ } }
      }
      toast.success(`${deleteTarget.name || 'Rider'} deleted`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    } finally { setDeleting(false); }
  };

  const openEditModal = (r: RiderDoc) => {
    setEditTarget(r);
    reset({
      name: r.name || '', email: r.email || '', phone: r.phone || '',
      vehicleType: (r.vehicleType as any) ?? 'Bike',
      vehicleNumber: r.vehicleNumber ?? '',
      licenseNumber: (r as any).licenseNumber ?? '',
      bankAccountNumber: r.bankAccountNumber ?? '',
      bankIFSC: r.bankIFSC ?? '',
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false); setEditTarget(null);
    reset({ name: '', email: '', phone: '', vehicleType: 'Bike', vehicleNumber: '' });
    setFormError(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // doc status summary helper
  const docSummary = (r: RiderDoc) => {
    const checks = [
      { has: !!r.licenseDocUrl, ok: r.licenseApproved, label: 'License' },
      { has: !!r.bankDocUrl, ok: r.bankApproved, label: 'Bank' },
    ];
    const uploaded = checks.filter(c => c.has).length;
    const approved = checks.filter(c => c.ok).length;
    return { uploaded, approved, total: checks.length };
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white">Rider Management</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage delivery partners</p>
        </div>
        {tab === 'list' && (
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowAddModal(true)} className="btn-primary w-auto px-5">
            <Plus className="w-5 h-5" /> Add Rider
          </motion.button>
        )}
      </motion.div>

      {/* Stat Cards — real-time from Firestore */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Riders', value: stats.total, color: 'border-brand', bg: 'bg-brand/5', text: 'text-brand' },
          { label: 'Active', value: stats.active, color: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700' },
          { label: 'Inactive', value: stats.inactive, color: 'border-red-400', bg: 'bg-red-50', text: 'text-red-600' },
          { label: 'Docs Pending', value: stats.pendingDocs, color: 'border-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ y: -3 }}
            className={`bg-white dark:bg-gray-800 rounded-2xl shadow-card p-4 border-l-4 ${s.color}`}
          >
            <p className={`text-3xl font-black ${s.text}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 font-semibold">{s.label}</p>
            {s.label === 'Docs Pending' && s.value > 0 && (
              <p className="text-[10px] text-yellow-600 mt-1">Missing or unverified docs</p>
            )}
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {([
          { key: 'list', label: 'Rider List', icon: List },
          { key: 'map', label: `Live Map${onlineCount > 0 ? ` (${onlineCount})` : ''}`, icon: MapIcon },
          { key: 'earnings', label: 'Earnings', icon: DollarSign },
        ] as { key: Tab; label: string; icon: any }[]).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key !== 'earnings') setSelectedRiderForEarnings(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === t.key ? 'bg-white shadow text-brand' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: List ─────────────────────────────────────────────────────── */}
      {tab === 'list' && (
        <>
          <div className="flex gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search name, email, phone..." className="input-field pl-10" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="input-field w-36">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 font-medium text-sm">Loading riders...</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="table-header min-w-[160px]">Rider</th>
                      <th className="table-header min-w-[150px]">Contact</th>
                      <th className="table-header min-w-[140px]">Vehicle</th>
                      <th className="table-header min-w-[160px]">Documents</th>
                      <th className="table-header min-w-[90px]">Status</th>
                      <th className="table-header min-w-[100px]">Joined</th>
                      <th className="table-header min-w-[140px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filtered.map((r, idx) => {
                        const initials = safeInitials(r.name);
                        const vehicleIcon = VEHICLE_ICONS[r.vehicleType || ''] || '🛵';
                        const ds = docSummary(r);

                        return (
                          <motion.tr
                            key={r.uid || r.phone || `rider-${idx}`}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors"
                          >
                            {/* Rider */}
                            <td className="table-cell">
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-black text-sm flex-shrink-0">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-gray-800 dark:text-white truncate max-w-[110px]">
                                    {r.name || <span className="text-gray-300 italic">No name</span>}
                                  </p>
                                  {r._fromRidersCollection && (
                                    <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">No login</span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Contact */}
                            <td className="table-cell">
                              <p className="text-gray-800 font-medium">{r.phone || '—'}</p>
                              <p className="text-gray-400 text-xs truncate max-w-[140px]">{r.email || '—'}</p>
                            </td>

                            {/* Vehicle */}
                            <td className="table-cell">
                              <div className="flex items-center gap-2">
                                <span className="text-xl leading-none">{vehicleIcon}</span>
                                <div>
                                  <p className="font-semibold text-gray-700 text-xs">{r.vehicleType || '—'}</p>
                                  <p className="font-mono text-[10px] text-gray-400 mt-0.5">
                                    {r.vehicleNumber
                                      ? <span className="px-1.5 py-0.5 bg-gray-100 rounded">{r.vehicleNumber}</span>
                                      : <span className="text-gray-300">No plate</span>
                                    }
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Documents — clickable to open preview modal */}
                            <td className="table-cell">
                              <button
                                onClick={() => setDocPreviewRider(r)}
                                className="flex items-center gap-1.5 group hover:bg-gray-100 px-2 py-1.5 rounded-lg transition-colors -ml-2"
                              >
                                <div className="flex gap-0.5">
                                  {[r.licenseDocUrl, r.bankDocUrl].map((url, i) => (
                                    <div key={i} className={`w-2 h-2 rounded-full ${
                                      !url ? 'bg-gray-200' :
                                      (i === 0 ? r.licenseApproved : r.bankApproved) ? 'bg-green-500' :
                                      'bg-yellow-400'
                                    }`} />
                                  ))}
                                </div>
                                <span className={`text-xs font-bold ${ds.uploaded === 0 ? 'text-red-400' : ds.approved === ds.uploaded ? 'text-green-600' : 'text-yellow-600'}`}>
                                  {ds.uploaded === 0 ? 'No docs' : `${ds.approved}/${ds.uploaded} verified`}
                                </span>
                                <Eye className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
                              </button>
                            </td>

                            {/* Status */}
                            <td className="table-cell">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {r.isActive ? '● Active' : '● Inactive'}
                              </span>
                            </td>

                            {/* Joined */}
                            <td className="table-cell text-gray-400 text-xs whitespace-nowrap">
                              {formatDate(r.createdAt)}
                            </td>

                            {/* Actions */}
                            <td className="table-cell">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {r._fromRidersCollection ? (
                                  <>
                                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                                      Rider Approvals → Login
                                    </span>
                                    <button onClick={() => setDeleteTarget(r)}
                                      className="w-7 h-7 bg-red-50 text-red-500 rounded-lg flex items-center justify-center hover:bg-red-100">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => openEditModal(r)}
                                      className="w-8 h-8 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center hover:bg-blue-100"
                                      title="Edit">
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleToggleStatus(r)}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${r.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                                    >
                                      {r.isActive
                                        ? <><ToggleRight className="w-3.5 h-3.5" /> Suspend</>
                                        : <><ToggleLeft className="w-3.5 h-3.5" /> Activate</>
                                      }
                                    </button>
                                    <QuickActionMenu
                                      rider={r}
                                      onEarnings={() => { setTab('earnings'); loadEarnings(r); }}
                                      onResetPass={() => handleResetPassword(r)}
                                      onToggle={() => handleToggleStatus(r)}
                                      onDelete={() => setDeleteTarget(r)}
                                    />
                                  </>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className="text-center py-16 text-gray-400">
                    <Bike className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-semibold">No riders found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB: Map ─────────────────────────────────────────────────────── */}
      {tab === 'map' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
              <span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Online ({riderLocations.filter(r => r.isOnline).length})
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-400">
              <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Offline ({riderLocations.filter(r => !r.isOnline).length})
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-card overflow-hidden" style={{ height: 500 }}>
            {typeof window !== 'undefined' && (
              <MapContainer center={[17.385, 78.4867]} zoom={12} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                {riderLocations.map(loc => (
                  <Marker key={loc.riderId} position={[loc.lat, loc.lng]} icon={loc.isOnline ? onlineIcon : offlineIcon}>
                    <Popup>
                      <div className="min-w-[160px]">
                        <p className="font-bold text-gray-800">{loc.riderName}</p>
                        <p className={`text-xs font-semibold mt-1 ${loc.isOnline ? 'text-green-600' : 'text-gray-400'}`}>
                          {loc.isOnline ? '● Online' : '● Offline'}
                        </p>
                        {loc.currentOrderId && <p className="text-xs text-blue-600 mt-1">On delivery: {loc.currentOrderId.slice(0, 8)}</p>}
                        <p className="text-xs text-gray-400 mt-1">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            )}
          </div>
          {riderLocations.length === 0 && (
            <div className="bg-white rounded-2xl shadow-card p-8 text-center text-gray-400">
              <MapIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold">No rider location data</p>
              <p className="text-sm mt-1">Locations appear when riders are active in the app</p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Earnings ───────────────────────────────────────────────── */}
      {tab === 'earnings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-card p-4">
            <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-3">Select Rider</h3>
            <div className="flex flex-wrap gap-2">
              {riders.map(r => (
                <button key={r.uid} onClick={() => loadEarnings(r)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    selectedRiderForEarnings?.uid === r.uid
                      ? 'bg-brand text-white border-brand'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-brand hover:text-brand'
                  }`}
                >
                  <span className="text-base">{VEHICLE_ICONS[r.vehicleType || ''] || '🛵'}</span>
                  {r.name || r.phone || '—'}
                </button>
              ))}
              {riders.length === 0 && <p className="text-gray-400 text-sm">No riders found</p>}
            </div>
          </div>

          {selectedRiderForEarnings && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Total Earned', value: `₹${totalEarnings.toLocaleString('en-IN')}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'Deliveries', value: earnings.length, icon: ShoppingBag, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Avg per Delivery', value: earnings.length ? `₹${(totalEarnings / earnings.length).toFixed(0)}` : '—', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-2xl shadow-card p-5">
                    <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center mb-3`}>
                      <s.icon className={`w-5 h-5 ${s.color}`} />
                    </div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
                    <p className="text-2xl font-black text-gray-800 mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-bold text-gray-800">Delivery History — {selectedRiderForEarnings.name || selectedRiderForEarnings.phone}</h3>
                </div>
                {earningsLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading...</div>
                ) : earnings.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No completed deliveries yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="table-header">Order ID</th>
                          <th className="table-header">Restaurant</th>
                          <th className="table-header">Customer</th>
                          <th className="table-header">Earned</th>
                          <th className="table-header">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earnings.map(e => (
                          <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="table-cell font-mono text-xs text-gray-500">{e.orderId.slice(0, 8).toUpperCase()}</td>
                            <td className="table-cell font-semibold text-gray-800">{e.restaurantName}</td>
                            <td className="table-cell text-gray-600">{e.customerName}</td>
                            <td className="table-cell font-bold text-green-600">₹{e.deliveryFeeEarned.toFixed(2)}</td>
                            <td className="table-cell text-gray-400 text-xs">{formatDate(e.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {!selectedRiderForEarnings && (
            <div className="bg-white rounded-2xl shadow-card p-12 text-center text-gray-400">
              <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold">Select a rider above to view their earnings</p>
            </div>
          )}
        </div>
      )}

      {/* ── Document Preview Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {docPreviewRider && (
          <DocPreviewModal
            rider={docPreviewRider}
            onClose={() => setDocPreviewRider(null)}
            onApprove={(field, value) => handleDocApproval(docPreviewRider, field, value)}
          />
        )}
      </AnimatePresence>

      {/* ── Add / Edit Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={closeModal} />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-lg font-black text-gray-800">{editTarget ? 'Edit Rider' : 'Add Rider'}</h2>
                <button onClick={closeModal} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
                {formError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {formError}
                  </div>
                )}
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Basic Info</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
                      <input {...register('name')} className={`input-field ${errors.name ? 'border-red-400' : ''}`} placeholder="John Doe" />
                      {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email *</label>
                      <input {...register('email')} type="email" disabled={!!editTarget}
                        className={`input-field ${errors.email ? 'border-red-400' : ''} ${editTarget ? 'bg-gray-100 text-gray-500' : ''}`}
                        placeholder="rider@example.com" />
                      {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone *</label>
                      <input {...register('phone')} type="tel" className={`input-field ${errors.phone ? 'border-red-400' : ''}`} placeholder="9876543210" />
                      {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
                    </div>
                  </div>
                </section>
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Vehicle</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Type *</label>
                      <select {...register('vehicleType')} className="input-field">
                        {Object.entries(VEHICLE_ICONS).map(([v, icon]) => (
                          <option key={v} value={v}>{icon} {v}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Number *</label>
                      <input {...register('vehicleNumber')} className={`input-field ${errors.vehicleNumber ? 'border-red-400' : ''}`} placeholder="TS09EA1234" />
                      {errors.vehicleNumber && <p className="text-red-500 text-xs mt-1">{errors.vehicleNumber.message}</p>}
                    </div>
                  </div>
                </section>
                <section>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Documents (Optional)</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">DL Number</label>
                      <input {...register('licenseNumber')} className="input-field" placeholder="TS0920200012345" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Bank Account</label>
                        <input {...register('bankAccountNumber')} className="input-field" placeholder="Account number" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">IFSC</label>
                        <input {...register('bankIFSC')} className="input-field" placeholder="SBIN0001234" />
                      </div>
                    </div>
                  </div>
                </section>
                <motion.button type="submit" disabled={isSubmitting} whileTap={{ scale: 0.97 }} className="btn-primary w-full disabled:opacity-60">
                  {isSubmitting
                    ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                    : editTarget ? 'Save Changes' : 'Add Rider'
                  }
                </motion.button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={() => !deleting && setDeleteTarget(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
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
                    <h2 className="text-lg font-black text-gray-800">Delete Rider</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Permanently delete <span className="font-bold text-gray-700">"{deleteTarget.name || deleteTarget.phone}"</span>? This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">
                    All rider data will be permanently removed. Firebase Auth account must be deleted separately from the Firebase console.
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

      {/* ── Password Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPasswordModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-white rounded-3xl shadow-2xl p-6"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Check className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="text-xl font-black text-gray-800">Rider Created!</h2>
                <p className="text-sm text-gray-500 mt-1">{generatedPass.name}</p>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
                <p className="text-xs text-yellow-700 font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Save this password — it won't be shown again!
                </p>
              </div>
              <div className="space-y-3 mb-5">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 font-semibold mb-1">Email</p>
                  <p className="font-mono text-sm text-gray-800">{generatedPass.email}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-400 font-semibold">Temporary Password</p>
                    <div className="flex gap-1">
                      <button onClick={() => setShowPass(!showPass)} className="p-1 text-gray-400 hover:text-gray-600">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => copyToClipboard(`Email: ${generatedPass.email}\nPassword: ${generatedPass.password}`)} className="p-1 text-gray-400 hover:text-gray-600">
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <p className="font-mono text-base text-gray-800 tracking-wider">
                    {showPass ? generatedPass.password : '•'.repeat(generatedPass.password.length)}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowPasswordModal(false)} className="w-full bg-brand text-white font-bold py-3 rounded-2xl hover:bg-brand-dark">
                Done — I've saved the password
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
