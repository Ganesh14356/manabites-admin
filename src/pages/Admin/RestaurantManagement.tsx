import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import {
  collection, doc, addDoc, updateDoc, setDoc,
  onSnapshot, query, orderBy, where, limit,
  serverTimestamp, Timestamp
} from 'firebase/firestore';
import { auth, db, secondaryAuth } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LocationPicker } from '../../components/LocationPicker';
import { maskAccountNumber } from '../../services/razorpay';
import {
  Plus as FiPlus,
  Edit2 as FiEdit2,
  Key as FiKey,
  ToggleLeft as FiToggleLeft,
  ToggleRight as FiToggleRight,
  Search as FiSearch,
  Copy as FiCopy,
  AlertTriangle as FiAlertTriangle,
  ExternalLink as FiExternalLink,
  X as FiX,
  Check as FiCheck,
  Eye as FiEye,
  EyeOff as FiEyeOff,
  RefreshCw as FiRefreshCw,
  IndianRupee, Banknote, CreditCard, Clock, CheckCircle2,
  ShieldCheck as FiShieldCheck, ShieldAlert as FiShieldAlert,
  ShieldQuestion as FiShieldQuestion, Loader2 as FiLoader2,
} from 'lucide-react';

// ── TYPES ─────────────────────────────────────────────────────────

interface RestaurantDoc {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  lat?: number;
  lng?: number;
  ownerId: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ── HELPER FUNCTIONS ──────────────────────────────────────────────

function generatePassword(length: number = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function formatDate(timestamp: any): string {
  if (!timestamp) return '—';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getIdentityToolkitEnableLink(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'your-project-id';
  return `https://console.cloud.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${projectId}`;
}

function getFirebaseErrorMessage(error: unknown): { message: string; showIdentityLink: boolean } {
  const code = (error as any)?.code ?? '';
  const message = (error as any)?.message ?? '';

  if (
    code === 'auth/admin-restricted-operation' ||
    message.includes('ADMIN_ONLY_OPERATION') ||
    message.includes('identitytoolkit') ||
    message.includes('Identity Toolkit') ||
    code === 'auth/operation-not-allowed'
  ) {
    return {
      message: 'The Identity Toolkit API is not enabled for this project.',
      showIdentityLink: true,
    };
  }

  const errorMap: Record<string, string> = {
    'auth/email-already-in-use': 'This email is already registered. Use a different email.',
    'auth/invalid-email': 'Invalid email address format.',
    'auth/weak-password': 'Password is too weak. Use at least 8 characters.',
    'auth/user-not-found': 'No user found with this email.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'auth/requires-recent-login': 'This operation requires recent authentication.',
    'permission-denied': 'Access denied. Check Firestore security rules.',
    'auth/quota-exceeded': 'Firebase quota exceeded. Try again later.',
    'auth/invalid-api-key': 'Invalid Firebase API key. Check your .env configuration.',
  };

  return {
    message: errorMap[code] ?? `Error: ${message || code || 'Unknown error'}`,
    showIdentityLink: false,
  };
}

// ── ZOD SCHEMAS ───────────────────────────────────────────────────

const addRestaurantSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit Indian mobile number'),
  address: z.string().min(5, 'Enter full address').max(300),
  fssai: z.string().optional(),
  bankAccount: z.string().optional(),
  accountHolderName: z.string().optional(),
  ifscCode: z.string().optional(),
  openingHours: z.string().optional(),
});

const editRestaurantSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit Indian mobile number'),
  address: z.string().min(5).max(300),
  fssai: z.string().optional(),
  bankAccount: z.string().optional(),
  accountHolderName: z.string().optional(),
  ifscCode: z.string().optional(),
  openingHours: z.string().optional(),
});

type AddFormData = z.infer<typeof addRestaurantSchema>;
type EditFormData = z.infer<typeof editRestaurantSchema>;

// ── SUB-COMPONENTS ────────────────────────────────────────────────

function IdentityToolkitBanner({ onClose }: { onClose: () => void }) {
  const link = getIdentityToolkitEnableLink();

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-4"
    >
      <div className="flex gap-3">
        <FiAlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-bold text-orange-800 text-sm mb-1">
            Identity Toolkit API Not Enabled
          </p>
          <p className="text-orange-700 text-xs mb-3 leading-relaxed">
            Firebase Authentication requires the Identity Toolkit API to be enabled
            in your Google Cloud project. This is a one-time setup step.
          </p>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-orange-800">Steps to fix:</p>
            <ol className="text-xs text-orange-700 space-y-1 list-decimal list-inside">
              <li>Click the link below to open Google Cloud Console</li>
              <li>Click the <strong>"Enable"</strong> button on the API page</li>
              <li>Wait 1-2 minutes for the API to activate</li>
              <li>Return here and try the operation again</li>
            </ol>
          </div>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 bg-orange-500 text-white
                       text-xs font-bold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors"
          >
            <FiExternalLink className="w-3.5 h-3.5" />
            Enable Identity Toolkit API
          </a>
        </div>
        <button onClick={onClose} className="text-orange-400 hover:text-orange-600">
          <FiX className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

function PasswordDisplayModal({
  isOpen,
  password,
  email,
  restaurantName,
  onClose,
}: {
  isOpen: boolean;
  password: string;
  email: string;
  restaurantName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copyPassword = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 22, stiffness: 260 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50
                       max-w-md mx-auto bg-white rounded-3xl shadow-2xl p-6"
          >
            <div className="text-center mb-5">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <FiCheck className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-black text-gray-800">Restaurant Created!</h2>
              <p className="text-sm text-gray-500 mt-1">{restaurantName}</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-700 font-semibold flex items-center gap-1.5">
                <FiAlertTriangle className="w-4 h-4 flex-shrink-0" />
                Save this password now — it won't be shown again!
              </p>
            </div>

            <div className="space-y-3 mb-5">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 font-semibold mb-1">Email</p>
                <p className="font-mono text-sm text-gray-800 select-all">{email}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400 font-semibold">Temporary Password</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setVisible(v => !v)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {visible ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={copyPassword}
                      className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg transition-colors ${
                        copied
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      {copied ? <><FiCheck className="w-3 h-3" /> Copied</> : <><FiCopy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                </div>
                <p className="font-mono text-base text-gray-800 tracking-wider select-all">
                  {visible ? password : '●'.repeat(password.length)}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center mb-4">
              Share these credentials with the restaurant owner.
              They should change the password on first login.
            </p>

            <button
              onClick={onClose}
              className="w-full bg-brand text-white font-bold py-3 rounded-2xl
                         hover:bg-brand-dark transition-colors"
            >
              Done — I've saved the password
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function AddRestaurantModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (password: string, email: string, name: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [showIdentityError, setShowIdentityError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number; address: string; placeId?: string; locationName?: string } | null>(null);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AddFormData>({
    resolver: zodResolver(addRestaurantSchema),
  });
  const watchedAddress = watch('address', '');

  const onSubmit = async (data: AddFormData) => {
    if (!locationCoords?.lat || !locationCoords?.lng) {
      toast.error('Pin the restaurant location on the map before saving — search for it or click/drag the marker.');
      return;
    }

    setLoading(true);
    setShowIdentityError(false);
    setErrorMessage(null);

    const password = generatePassword(12);

    try {
      // Create Firebase Auth user using secondary app so admin isn't logged out
      const credential = await createUserWithEmailAndPassword(secondaryAuth, data.email, password);
      const uid = credential.user.uid;
      await signOut(secondaryAuth);

      await addDoc(collection(db, 'restaurants'), {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        lat: locationCoords.lat,
        lng: locationCoords.lng,
        placeId: locationCoords.placeId ?? null,
        locationName: locationCoords.locationName ?? null,
        fssai: data.fssai || '',
        bankAccount: data.bankAccount || '',
        openingHours: data.openingHours || '',
        ownerId: uid,
        isActive: true,
        role: 'restaurant',
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'users', uid), {
        uid,
        email: data.email,
        phone: data.phone,
        name: data.name,
        role: 'restaurant',
        isActive: true,
        createdAt: serverTimestamp(),
      });

      reset();
      setLocationCoords(null);
      onClose();
      onSuccess(password, data.email, data.name);
    } catch (error: unknown) {
      const { message, showIdentityLink } = getFirebaseErrorMessage(error);
      setErrorMessage(message);
      if (showIdentityLink) setShowIdentityError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50
                       shadow-2xl overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-800">Add Restaurant</h2>
              <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
              <AnimatePresence>
                {showIdentityError && (
                  <IdentityToolkitBanner onClose={() => setShowIdentityError(false)} />
                )}
              </AnimatePresence>

              {errorMessage && !showIdentityError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-red-700 text-sm">{errorMessage}</p>
                </div>
              )}

              {[
                { name: 'name', label: 'Restaurant Name *', placeholder: 'Paradise Biryani', type: 'text' },
                { name: 'email', label: 'Owner Email *', placeholder: 'owner@restaurant.com', type: 'email' },
                { name: 'phone', label: 'Phone Number *', placeholder: '9876543210', type: 'tel' },
                { name: 'fssai', label: 'FSSAI License (Optional)', placeholder: '12345678901234', type: 'text' },
                { name: 'bankAccount',       label: 'Bank Account Number',    placeholder: 'Account Number',      type: 'text' },
                { name: 'accountHolderName', label: 'Account Holder Name',     placeholder: 'As per bank records', type: 'text' },
                { name: 'ifscCode',          label: 'IFSC Code',                placeholder: 'e.g. SBIN0001234',    type: 'text' },
                { name: 'openingHours',      label: 'Opening Hours (Optional)', placeholder: '10:00 AM - 10:00 PM', type: 'text' },
              ].map(field => (
                <div key={field.name}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {field.label}
                  </label>
                  <input
                    {...register(field.name as keyof AddFormData)}
                    type={field.type}
                    placeholder={field.placeholder}
                    className={`input-field ${errors[field.name as keyof AddFormData] ? 'border-red-400' : ''}`}
                  />
                  {errors[field.name as keyof AddFormData] && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors[field.name as keyof AddFormData]?.message}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Address *
                </label>
                <textarea
                  {...register('address')}
                  rows={3}
                  placeholder="123 Banjara Hills, Hyderabad, Telangana 500034"
                  className={`input-field resize-none ${errors.address ? 'border-red-400' : ''}`}
                />
                {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
              </div>

              <div className="relative">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Pin Location on Map *
                </label>
                <LocationPicker
                  lat={locationCoords?.lat ?? null}
                  lng={locationCoords?.lng ?? null}
                  address={watchedAddress}
                  onChange={(result) => {
                    setLocationCoords({ lat: result.lat, lng: result.lng, address: result.address, placeId: result.placeId, locationName: result.locationName });
                    setValue('address', result.address);
                  }}
                />
                {!locationCoords?.lat && (
                  <p className="text-xs text-orange-600 mt-1">Search and select the exact location, or click/drag the marker on the map — required to save.</p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-xs text-blue-700 leading-relaxed">
                  <strong>ℹ️ Note:</strong> A Firebase Auth account will be created for this restaurant owner.
                  A temporary password will be generated and shown once — save it immediately.
                  The owner should reset their password on first login.
                </p>
              </div>

              <motion.button
                type="submit"
                disabled={loading || !locationCoords?.lat || !locationCoords?.lng}
                whileTap={{ scale: 0.97 }}
                className="btn-primary disabled:opacity-60 w-full"
              >
                {loading ? (
                  <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Creating...</>
                ) : (
                  <><FiPlus className="w-5 h-5" /> Create Restaurant Account</>
                )}
              </motion.button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── BANK ACCOUNT VERIFICATION (Razorpay Fund Account Validation) ─────

interface BankVerification {
  status: 'not_verified' | 'verifying' | 'verified' | 'failed';
  referenceId?: string;
  verifiedName?: string;
  bankName?: string;
  verifiedAt?: Timestamp | null;
  lastAttemptAt?: Timestamp | null;
  errorMessage?: string;
}

function VerificationStatusBadge({ status }: { status: BankVerification['status'] }) {
  const map: Record<BankVerification['status'], { label: string; cls: string; icon: ReactNode }> = {
    not_verified: { label: 'Not Verified', cls: 'bg-gray-100 text-gray-500', icon: <FiShieldQuestion className="w-3.5 h-3.5" /> },
    verifying:    { label: 'Verifying…',   cls: 'bg-blue-50 text-blue-600',  icon: <FiLoader2 className="w-3.5 h-3.5 animate-spin" /> },
    verified:     { label: 'Verified',     cls: 'bg-green-50 text-green-700', icon: <FiShieldCheck className="w-3.5 h-3.5" /> },
    failed:       { label: 'Failed',       cls: 'bg-red-50 text-red-600',    icon: <FiShieldAlert className="w-3.5 h-3.5" /> },
  };
  const m = map[status] ?? map.not_verified;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>
      {m.icon} {m.label}
    </span>
  );
}

function BankVerificationSection({
  restaurant,
  register,
  watch,
  errors,
}: {
  restaurant: RestaurantDoc | null;
  register: ReturnType<typeof useForm<EditFormData>>['register'];
  watch: ReturnType<typeof useForm<EditFormData>>['watch'];
  errors: ReturnType<typeof useForm<EditFormData>>['formState']['errors'];
}) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [showFullAccount, setShowFullAccount] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'verify' | 'fail' | null>(null);
  const [confirmNote, setConfirmNote] = useState('');

  const bankAccount = watch('bankAccount', '');
  const accountHolderName = watch('accountHolderName', '');
  const ifscCode = watch('ifscCode', '');

  const verification: BankVerification = (restaurant as any)?.bankVerification ?? { status: 'not_verified' };
  const hasBankDetails = !!(bankAccount?.trim() && accountHolderName?.trim() && ifscCode?.trim());

  const openConfirm = (action: 'verify' | 'fail') => {
    setConfirmNote('');
    setConfirmAction(action);
  };

  // Manual verification: admin checks the bank details (cancelled cheque / passbook /
  // a real payout) and records the outcome themselves — no automated penny-drop call.
  const submitManualDecision = async () => {
    if (!restaurant) return;
    setSubmitting(true);
    const restRef = doc(db, 'restaurants', restaurant.id);
    const isVerified = confirmAction === 'verify';
    try {
      const newVerification: BankVerification = isVerified
        ? {
            status: 'verified',
            verifiedName: accountHolderName.trim(),
            verifiedAt: serverTimestamp() as unknown as Timestamp,
            lastAttemptAt: serverTimestamp() as unknown as Timestamp,
            ...(confirmNote.trim() ? { errorMessage: confirmNote.trim() } : {}),
          }
        : {
            status: 'failed',
            errorMessage: confirmNote.trim() || 'Marked as failed by admin after manual review.',
            lastAttemptAt: serverTimestamp() as unknown as Timestamp,
          };

      try {
        await updateDoc(restRef, { bankVerification: newVerification });
      } catch (err: any) {
        console.error('[bankVerification] restaurant doc update failed:', err?.code, err?.message);
        toast.error(`Could not save status on restaurant — ${err?.code ?? err?.message ?? 'unknown error'}`);
        return;
      }

      try {
        await addDoc(collection(db, 'bankVerificationLogs'), {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          maskedAccountNumber: maskAccountNumber(bankAccount.trim()),
          ifsc: ifscCode.trim().toUpperCase(),
          accountHolderName: accountHolderName.trim(),
          status: newVerification.status,
          method: 'manual',
          note: confirmNote.trim() || null,
          performedBy: user?.uid ?? null,
          performedByEmail: user?.email ?? null,
          createdAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.error('[bankVerification] audit log create failed:', err?.code, err?.message);
        toast(`Status saved, but audit log failed — ${err?.code ?? err?.message ?? 'unknown error'}`, { icon: '⚠️' });
      }

      toast.success(isVerified ? 'Marked as verified' : 'Marked as failed');
      setConfirmAction(null);
    } catch (err: any) {
      console.error('[bankVerification] unexpected error:', err);
      toast.error(err?.message || 'Could not save verification status');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-xl">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
          <Banknote className="w-4 h-4" /> Bank Account Details
        </p>
        <VerificationStatusBadge status={verification.status} />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Bank Account Number
        </label>
        <div className="relative">
          <input
            {...register('bankAccount')}
            type={showFullAccount ? 'text' : 'password'}
            placeholder="Account Number"
            autoComplete="off"
            className={`input-field pr-10 ${errors.bankAccount ? 'border-red-400' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowFullAccount(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            title={showFullAccount ? 'Hide account number' : 'Show full account number (admin only)'}
          >
            {showFullAccount ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
          </button>
        </div>
        {!showFullAccount && bankAccount && (
          <p className="text-xs text-gray-400 mt-1">Masked: {maskAccountNumber(bankAccount)}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Account Holder Name
        </label>
        <input
          {...register('accountHolderName')}
          type="text"
          placeholder="As per bank records"
          className={`input-field ${errors.accountHolderName ? 'border-red-400' : ''}`}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          IFSC Code
        </label>
        <input
          {...register('ifscCode')}
          type="text"
          placeholder="e.g. SBIN0001234"
          className={`input-field uppercase ${errors.ifscCode ? 'border-red-400' : ''}`}
        />
      </div>

      {verification.status === 'verified' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
          <p className="flex items-center gap-1.5 font-semibold"><FiCheck className="w-3.5 h-3.5" /> Verified — account eligible for payouts</p>
          {verification.verifiedName && <p>Verified Name: <span className="font-medium">{verification.verifiedName}</span></p>}
          <p>Verified On: {formatDate(verification.verifiedAt)}</p>
          {verification.errorMessage && <p className="text-green-700/70 italic">Note: {verification.errorMessage}</p>}
        </div>
      )}
      {verification.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-1">
          <p className="font-semibold">Verification failed</p>
          <p>{verification.errorMessage || 'Marked as failed by admin after manual review.'}</p>
        </div>
      )}

      {confirmAction ? (
        <div className={`rounded-xl border p-3 space-y-2 ${confirmAction === 'verify' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-xs font-semibold ${confirmAction === 'verify' ? 'text-green-800' : 'text-red-700'}`}>
            {confirmAction === 'verify'
              ? `Confirm: have you manually checked "${accountHolderName || '—'}" / ${bankAccount ? maskAccountNumber(bankAccount) : '—'} / ${ifscCode || '—'} against a cancelled cheque, passbook, or a successful payout?`
              : 'Confirm: mark this bank account as failed verification?'}
          </p>
          <textarea
            value={confirmNote}
            onChange={e => setConfirmNote(e.target.value)}
            rows={2}
            placeholder={confirmAction === 'verify' ? 'Optional note (e.g. verified via cancelled cheque)' : 'Reason for failure (e.g. name mismatch, invalid IFSC)'}
            className="input-field text-xs resize-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitManualDecision}
              disabled={submitting}
              className={`flex-1 flex items-center justify-center gap-2 text-white font-semibold text-xs py-2 rounded-lg disabled:opacity-40 ${confirmAction === 'verify' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {submitting ? <FiLoader2 className="w-3.5 h-3.5 animate-spin" /> : <FiCheck className="w-3.5 h-3.5" />}
              Confirm {confirmAction === 'verify' ? 'Verified' : 'Failed'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              disabled={submitting}
              className="px-4 text-xs font-semibold text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openConfirm('verify')}
            disabled={!hasBankDetails}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white font-semibold text-sm py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
          >
            <FiShieldCheck className="w-4 h-4" /> Mark as Verified
          </button>
          <button
            type="button"
            onClick={() => openConfirm('fail')}
            disabled={!hasBankDetails}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 font-semibold text-sm py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-50 transition-colors"
          >
            <FiShieldAlert className="w-4 h-4" /> Mark as Failed
          </button>
        </div>
      )}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Manual verification: cross-check the account number, IFSC and holder name against a cancelled cheque, bank
        passbook, or a successful payout before marking verified. Every decision is recorded in the audit log with
        your admin account and timestamp.
      </p>
    </div>
  );
}

function EditRestaurantModal({
  isOpen,
  restaurant,
  onClose,
}: {
  isOpen: boolean;
  restaurant: RestaurantDoc | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number; placeId?: string; locationName?: string } | null>(null);
  const [payouts, setPayouts] = useState<any[]>([]);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<EditFormData>({
    resolver: zodResolver(editRestaurantSchema),
  });
  const watchedAddress = watch('address', '');

  useEffect(() => {
    if (!restaurant?.id) { setPayouts([]); return; }
    const q = query(
      collection(db, 'payouts'),
      where('entityId', '==', restaurant.id),
      where('entityType', '==', 'restaurant'),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, snap => {
      setPayouts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, [restaurant?.id]);

  useEffect(() => {
    if (restaurant) {
      reset({
        name: restaurant.name,
        email: restaurant.email,
        phone: restaurant.phone,
        address: restaurant.address,
        fssai: (restaurant as any).fssai || '',
        bankAccount:        (restaurant as any).bankAccount        || '',
        accountHolderName:  (restaurant as any).accountHolderName  || '',
        ifscCode:           (restaurant as any).ifscCode           || '',
        openingHours:       (restaurant as any).openingHours       || '',
      });
      setLocationCoords(
        restaurant.lat && restaurant.lng
          ? { lat: restaurant.lat, lng: restaurant.lng, placeId: (restaurant as any).placeId ?? undefined, locationName: (restaurant as any).locationName ?? undefined }
          : null
      );
    }
  }, [restaurant, reset]);

  const onSubmit = async (data: EditFormData) => {
    if (!restaurant) return;

    if (!locationCoords?.lat || !locationCoords?.lng) {
      toast.error('Pin the restaurant location on the map before saving — search for it or click/drag the marker.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id), {
        name: data.name,
        phone: data.phone,
        address: data.address,
        email: data.email,
        lat: locationCoords.lat,
        lng: locationCoords.lng,
        placeId: locationCoords.placeId ?? null,
        locationName: locationCoords.locationName ?? null,
        fssai:              data.fssai              || '',
        bankAccount:        data.bankAccount        || '',
        accountHolderName:  data.accountHolderName  || '',
        ifscCode:           data.ifscCode           || '',
        openingHours:       data.openingHours       || '',
        updatedAt: serverTimestamp(),
      });

      if (data.email !== restaurant.email) {
        toast('⚠️ Email updated in database. Firebase Auth login email unchanged.', {
          icon: '⚠️',
          style: { background: '#f59e0b', color: 'white' }
        });
      } else {
        toast.success('Restaurant updated successfully!');
      }

      onClose();
    } catch (error: unknown) {
      const { message } = getFirebaseErrorMessage(error);
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50
                       shadow-2xl overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-800">Edit Restaurant</h2>
              <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
              {errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-red-700 text-sm">{errorMessage}</p>
                </div>
              )}

              {[
                { name: 'name', label: 'Restaurant Name *', placeholder: 'Paradise Biryani', type: 'text' },
                { name: 'email', label: 'Owner Email *', placeholder: 'owner@restaurant.com', type: 'email' },
                { name: 'phone', label: 'Phone Number *', placeholder: '9876543210', type: 'tel' },
                { name: 'fssai', label: 'FSSAI License (Optional)', placeholder: '12345678901234', type: 'text' },
              ].map(field => (
                <div key={field.name}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {field.label}
                  </label>
                  <input
                    {...register(field.name as keyof EditFormData)}
                    type={field.type}
                    placeholder={field.placeholder}
                    className={`input-field ${errors[field.name as keyof EditFormData] ? 'border-red-400' : ''}`}
                  />
                  {errors[field.name as keyof EditFormData] && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors[field.name as keyof EditFormData]?.message}
                    </p>
                  )}
                </div>
              ))}

              <BankVerificationSection
                restaurant={restaurant}
                register={register}
                watch={watch}
                errors={errors}
              />

              {[
                { name: 'openingHours', label: 'Opening Hours (Optional)', placeholder: '10:00 AM - 10:00 PM', type: 'text' },
              ].map(field => (
                <div key={field.name}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {field.label}
                  </label>
                  <input
                    {...register(field.name as keyof EditFormData)}
                    type={field.type}
                    placeholder={field.placeholder}
                    className={`input-field ${errors[field.name as keyof EditFormData] ? 'border-red-400' : ''}`}
                  />
                  {errors[field.name as keyof EditFormData] && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors[field.name as keyof EditFormData]?.message}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Address *
                </label>
                <textarea
                  {...register('address')}
                  rows={3}
                  placeholder="123 Banjara Hills, Hyderabad, Telangana 500034"
                  className={`input-field resize-none ${errors.address ? 'border-red-400' : ''}`}
                />
                {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
              </div>

              <div className="relative">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Pin Location on Map *
                </label>
                <LocationPicker
                  lat={locationCoords?.lat ?? null}
                  lng={locationCoords?.lng ?? null}
                  address={watchedAddress}
                  onChange={(result) => {
                    setLocationCoords({ lat: result.lat, lng: result.lng, placeId: result.placeId, locationName: result.locationName });
                    setValue('address', result.address);
                  }}
                />
                {!locationCoords?.lat && (
                  <p className="text-xs text-orange-600 mt-1">Search and select the exact location, or click/drag the marker on the map — required to save.</p>
                )}
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <p className="text-xs text-yellow-800 leading-relaxed">
                  <strong>Note:</strong> Changing email here only updates the database.
                  The Firebase login email remains unchanged. Use 'Reset Password' to send a new link.
                </p>
              </div>

              <motion.button
                type="submit"
                disabled={loading || !locationCoords?.lat || !locationCoords?.lng}
                whileTap={{ scale: 0.97 }}
                className="btn-primary disabled:opacity-60 w-full"
              >
                {loading ? (
                  <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                ) : (
                  <><FiEdit2 className="w-5 h-5" /> Save Changes</>
                )}
              </motion.button>
            </form>

            {/* ── Payout History ── */}
            <div className="px-6 pb-8">
              <div className="flex items-center gap-2 mb-3 pt-2 border-t border-gray-100">
                <IndianRupee size={15} className="text-brand" />
                <h3 className="font-black text-gray-800 text-sm uppercase tracking-wide">Payout History</h3>
              </div>

              {payouts.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-6 text-center">
                  <IndianRupee size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400 font-semibold">No payouts yet</p>
                  <p className="text-xs text-gray-400 mt-0.5">Run a daily settlement to generate records</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {payouts.map((p: any) => {
                    const fmtDate = (val: any) => {
                      if (!val) return '—';
                      try {
                        const d = val?.toDate ? val.toDate() : new Date(val?.toMillis?.() ?? val);
                        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                      } catch { return '—'; }
                    };
                    const BADGE: Record<string, string> = {
                      completed: 'bg-green-100 text-green-700',
                      paid:      'bg-green-100 text-green-700',
                      pending:   'bg-amber-100 text-amber-700',
                      failed:    'bg-red-100 text-red-600',
                    };
                    return (
                      <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {p.paymentMethod === 'manual'
                              ? <Banknote size={14} className="text-green-500" />
                              : <CreditCard size={14} className="text-brand" />}
                            <span className="text-xs font-bold text-gray-500 capitalize">
                              {p.paymentMethod === 'manual' ? 'Manual (offline)' : 'Online'}
                            </span>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE[p.status] || 'bg-gray-100 text-gray-500'}`}>
                            {p.status}
                          </span>
                        </div>
                        <p className="text-xl font-black text-gray-900">
                          ₹{Number(p.amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-xs text-gray-400">{p.ordersCount ?? '—'} orders · {p.settlementDate || fmtDate(p.createdAt)}</p>
                          {p.status === 'completed' || p.status === 'paid'
                            ? <CheckCircle2 size={14} className="text-green-500" />
                            : <Clock size={14} className="text-amber-400" />}
                        </div>
                        {p.grossAmount && (
                          <p className="text-[10px] text-gray-400 mt-1">
                            Gross ₹{Number(p.grossAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} · Commission ₹{Number(p.commission ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} + GST ₹{Number(p.gstOnCommission ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function RestaurantTable({
  restaurants,
  onEdit,
  onResetPassword,
  onToggleStatus,
}: {
  restaurants: RestaurantDoc[];
  onEdit: (r: RestaurantDoc) => void;
  onResetPassword: (r: RestaurantDoc) => void;
  onToggleStatus: (r: RestaurantDoc) => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Restaurant', 'Email', 'Phone', 'Address', 'Status', 'Created', 'Actions'].map(h => (
                <th key={h} className="table-header whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {restaurants.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, x: -10, y: 6 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ delay: i * 0.03, duration: 0.22 }}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="table-cell font-semibold text-gray-800">
                    <Link to={`/admin/restaurants/${r.id}/menu`} className="text-brand hover:underline flex items-center gap-1 w-fit">
                      {r.name}
                      <FiExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                  <td className="table-cell text-gray-600 max-w-[180px] truncate">{r.email}</td>
                  <td className="table-cell text-gray-600">{r.phone}</td>
                  <td className="table-cell text-gray-500 max-w-[150px] truncate" title={r.address}>
                    {r.address}
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${r.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'}`}
                    >
                      {r.isActive ? '✅ Active' : '🚫 Disabled'}
                    </span>
                  </td>
                  <td className="table-cell text-gray-400 whitespace-nowrap">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1">
                      <motion.button
                        whileTap={{ scale: 0.88 }}
                        onClick={() => onEdit(r)}
                        title="Edit restaurant"
                        className="w-8 h-8 bg-blue-50 text-blue-500 rounded-lg
                                   flex items-center justify-center hover:bg-blue-100"
                      >
                        <FiEdit2 className="w-3.5 h-3.5" />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.88 }}
                        onClick={() => onResetPassword(r)}
                        title="Send password reset email"
                        className="w-8 h-8 bg-yellow-50 text-yellow-600 rounded-lg
                                   flex items-center justify-center hover:bg-yellow-100"
                      >
                        <FiKey className="w-3.5 h-3.5" />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onToggleStatus(r)}
                        title={r.isActive ? 'Disable restaurant' : 'Enable restaurant'}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                          r.isActive
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {r.isActive ? (
                          <><FiToggleRight className="w-3.5 h-3.5" /> Disable</>
                        ) : (
                          <><FiToggleLeft className="w-3.5 h-3.5" /> Enable</>
                        )}
                      </motion.button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>

        {restaurants.length === 0 && (
          <div className="text-center py-16">
            <span className="text-5xl">🍽️</span>
            <p className="mt-3 text-gray-400 font-body">No restaurants found</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN PAGE COMPONENT ───────────────────────────────────────────

export default function RestaurantManagement() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState<RestaurantDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<RestaurantDoc | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [generatedPass, setGeneratedPass] = useState({ password: '', email: '', name: '' });
  const [showIdentityBanner, setShowIdentityBanner] = useState(false);
  const [identityBannerMsg, setIdentityBannerMsg] = useState('');

  useEffect(() => {
    if (!authLoading && profile?.role !== 'admin') {
      navigate('/unauthorized', { replace: true });
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const q = query(
      collection(db, 'restaurants'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, snapshot => {
      setRestaurants(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RestaurantDoc)));
      setLoading(false);
    }, err => {
      toast.error('Failed to load restaurants: ' + err.message);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    return restaurants.filter(r => {
      const matchSearch = !searchQuery ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? r.isActive :
        !r.isActive;
      return matchSearch && matchStatus;
    });
  }, [restaurants, searchQuery, statusFilter]);

  const stats = useMemo(() => ({
    total: restaurants.length,
    active: restaurants.filter(r => r.isActive).length,
    inactive: restaurants.filter(r => !r.isActive).length,
    today: restaurants.filter(r => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return r.createdAt?.toDate?.() >= today;
    }).length,
  }), [restaurants]);

  const handleResetPassword = async (restaurant: RestaurantDoc) => {
    try {
      await sendPasswordResetEmail(auth, restaurant.email);
      toast.success(`Password reset email sent to ${restaurant.email}`);
    } catch (error: unknown) {
      const { message, showIdentityLink } = getFirebaseErrorMessage(error);
      if (showIdentityLink) {
        setShowIdentityBanner(true);
        setIdentityBannerMsg(message);
      } else {
        toast.error(message);
      }
    }
  };

  const handleToggleStatus = async (restaurant: RestaurantDoc) => {
    const action = restaurant.isActive ? 'disable' : 'enable';

    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id), {
        isActive: !restaurant.isActive,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Restaurant ${action}d successfully`);
    } catch (error: unknown) {
      const { message } = getFirebaseErrorMessage(error);
      toast.error(message);
    }
  };

  const handleAddSuccess = (password: string, email: string, name: string) => {
    setGeneratedPass({ password, email, name });
    setShowPasswordModal(true);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      <motion.div
        className="flex items-start justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            🏢 Restaurant Management
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Manage restaurant accounts and credentials
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          whileHover={{ scale: 1.03 }}
          onClick={() => setShowAddModal(true)}
          className="btn-primary w-auto px-5"
        >
          <FiPlus className="w-5 h-5" /> Add Restaurant
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {showIdentityBanner && (
          <IdentityToolkitBanner onClose={() => setShowIdentityBanner(false)} />
        )}
      </AnimatePresence>

      <motion.div
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
        initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
      >
        {[
          { label: 'Total', value: stats.total, color: 'border-l-brand' },
          { label: 'Active', value: stats.active, color: 'border-l-green-500' },
          { label: 'Inactive', value: stats.inactive, color: 'border-l-red-400' },
          { label: 'Today', value: stats.today, color: 'border-l-blue-500' },
        ].map(stat => (
          <motion.div
            key={stat.label}
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
            className={`bg-white rounded-2xl shadow-card p-4 border-l-4 ${stat.color}`}
          >
            <p className="text-2xl font-black text-gray-800">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
          </motion.div>
        ))}
      </motion.div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name or email..."
            className="input-field pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="input-field w-36"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
          className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center hover:bg-gray-200"
          title="Clear filters"
        >
          <FiRefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-card p-8 text-center">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading restaurants...</p>
        </div>
      ) : (
        <RestaurantTable
          restaurants={filtered}
          onEdit={setEditTarget}
          onResetPassword={handleResetPassword}
          onToggleStatus={handleToggleStatus}
        />
      )}

      <AddRestaurantModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />

      <EditRestaurantModal
        isOpen={!!editTarget}
        restaurant={editTarget}
        onClose={() => setEditTarget(null)}
      />

      <PasswordDisplayModal
        isOpen={showPasswordModal}
        password={generatedPass.password}
        email={generatedPass.email}
        restaurantName={generatedPass.name}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
}
