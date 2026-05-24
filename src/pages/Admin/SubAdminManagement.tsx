import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, orderBy,
  setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { db, secondaryAuth } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Shield, UserPlus, Trash2, Key, Check, X, Eye, EyeOff,
  ShoppingBag, RefreshCw, Star, DollarSign, Users, Edit2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type SubAdminRole = 'support' | 'finance';

interface RoleSchema {
  uid: string;
  email: string;
  name: string;
  role: SubAdminRole;
  permissions: string[];
  createdAt?: Timestamp;
  createdBy?: string;
  active: boolean;
}

const ROLE_CONFIG: Record<SubAdminRole, {
  label: string;
  desc: string;
  color: string;
  icon: React.ReactNode;
  permissions: string[];
}> = {
  support: {
    label: 'Support',
    desc: 'Can view and manage Orders, Refunds, Reviews, and SOS Alerts',
    color: 'text-blue-700 bg-blue-100',
    icon: <ShoppingBag className="w-4 h-4" />,
    permissions: ['orders', 'refunds', 'reviews', 'sos-alerts', 'rating-appeals'],
  },
  finance: {
    label: 'Finance',
    desc: 'Can view Payouts, Settlements, Commission, and Razorpay Payments',
    color: 'text-green-700 bg-green-100',
    icon: <DollarSign className="w-4 h-4" />,
    permissions: ['payouts', 'settlements', 'commission', 'razorpay', 'refunds'],
  },
};

const ALL_PERMISSIONS = [
  { key: 'orders',         label: 'Orders',           icon: ShoppingBag },
  { key: 'refunds',        label: 'Refunds',           icon: RefreshCw   },
  { key: 'reviews',        label: 'Reviews',           icon: Star        },
  { key: 'sos-alerts',     label: 'SOS Alerts',        icon: Shield      },
  { key: 'rating-appeals', label: 'Rating Appeals',    icon: Star        },
  { key: 'payouts',        label: 'Payouts',           icon: DollarSign  },
  { key: 'settlements',    label: 'Settlements',       icon: DollarSign  },
  { key: 'commission',     label: 'Commission',        icon: DollarSign  },
  { key: 'razorpay',       label: 'Razorpay',          icon: DollarSign  },
  { key: 'customers',      label: 'Customers',         icon: Users       },
  { key: 'restaurants',    label: 'Restaurants',       icon: ShoppingBag },
  { key: 'riders',         label: 'Riders',            icon: Users       },
  { key: 'analytics',      label: 'Analytics',         icon: DollarSign  },
];

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubAdminManagement() {
  const { user } = useAuth();

  const [subAdmins, setSubAdmins] = useState<RoleSchema[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleSchema | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<SubAdminRole>('support');
  const [formPerms, setFormPerms] = useState<string[]>(ROLE_CONFIG.support.permissions);
  const [formPassword, setFormPassword] = useState(generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load sub-admins
  useEffect(() => {
    const q = query(collection(db, 'subAdmins'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setSubAdmins(snap.docs.map(d => ({ uid: d.id, ...d.data() } as RoleSchema)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  function openAdd() {
    setEditTarget(null);
    setFormName('');
    setFormEmail('');
    setFormRole('support');
    setFormPerms([...ROLE_CONFIG.support.permissions]);
    setFormPassword(generatePassword());
    setShowPassword(false);
    setShowAddModal(true);
  }

  function openEdit(sa: RoleSchema) {
    setEditTarget(sa);
    setFormName(sa.name);
    setFormEmail(sa.email);
    setFormRole(sa.role);
    setFormPerms([...sa.permissions]);
    setFormPassword('');
    setShowPassword(false);
    setShowAddModal(true);
  }

  function handleRoleChange(role: SubAdminRole) {
    setFormRole(role);
    setFormPerms([...ROLE_CONFIG[role].permissions]);
  }

  function togglePerm(key: string) {
    setFormPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  }

  async function handleSave() {
    if (!formName.trim() || !formEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setSaving(true);
    try {
      if (editTarget) {
        // Update existing
        await updateDoc(doc(db, 'subAdmins', editTarget.uid), {
          name: formName.trim(),
          role: formRole,
          permissions: formPerms,
          updatedAt: serverTimestamp(),
        });
        toast.success('Sub-admin updated');
      } else {
        // Create new Firebase Auth user via secondaryAuth to avoid logging out main admin
        const cred = await createUserWithEmailAndPassword(secondaryAuth, formEmail.trim(), formPassword);
        await secondaryAuth.signOut();
        await setDoc(doc(db, 'subAdmins', cred.user.uid), {
          uid: cred.user.uid,
          email: formEmail.trim(),
          name: formName.trim(),
          role: formRole,
          permissions: formPerms,
          active: true,
          createdAt: serverTimestamp(),
          createdBy: user?.email ?? 'admin',
        });
        // Also mark in users collection for auth guard
        await setDoc(doc(db, 'adminUsers', cred.user.uid), {
          email: formEmail.trim(),
          role: formRole,
          isSubAdmin: true,
          permissions: formPerms,
        });
        toast.success(`Sub-admin created — ${formEmail}`);
      }
      setShowAddModal(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(sa: RoleSchema) {
    try {
      await updateDoc(doc(db, 'subAdmins', sa.uid), { active: !sa.active });
      toast.success(`${sa.name} ${sa.active ? 'deactivated' : 'activated'}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleDelete(sa: RoleSchema) {
    if (!window.confirm(`Delete sub-admin ${sa.name}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'subAdmins', sa.uid));
      await deleteDoc(doc(db, 'adminUsers', sa.uid));
      toast.success(`${sa.name} deleted`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleResetPassword(sa: RoleSchema) {
    try {
      await sendPasswordResetEmail(secondaryAuth, sa.email);
      toast.success(`Reset email sent to ${sa.email}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-7 h-7 text-brand" />
              Sub-Admin Management
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Create limited-access accounts for support and finance staff
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-orange-600 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Sub-Admin
          </button>
        </div>
      </motion.div>

      {/* Role Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.entries(ROLE_CONFIG) as [SubAdminRole, typeof ROLE_CONFIG[SubAdminRole]][]).map(([key, cfg], i) => (
          <motion.div
            key={key}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black ${cfg.color}`}>
                {cfg.icon}{cfg.label}
              </span>
              <span className="text-xs text-gray-400 font-semibold">
                {subAdmins.filter(s => s.role === key && s.active).length} active
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{cfg.desc}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {cfg.permissions.map(p => (
                <span key={p} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[11px] font-bold rounded-md capitalize">
                  {p.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Sub-Admin List */}
      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3" />
          Loading sub-admins...
        </div>
      ) : subAdmins.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card py-16 text-center">
          <Shield className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No sub-admins yet</p>
          <p className="text-gray-300 text-sm mt-1">Click "Add Sub-Admin" to create your first limited-access account</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="table-header">Name</th>
                  <th className="table-header">Email</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Permissions</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subAdmins.map(sa => {
                  const cfg = ROLE_CONFIG[sa.role];
                  return (
                    <tr key={sa.uid} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-xs font-black text-brand">
                            {sa.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-gray-800 dark:text-gray-100">{sa.name}</span>
                        </div>
                      </td>
                      <td className="table-cell text-gray-500">{sa.email}</td>
                      <td className="table-cell">
                        <span className={`flex items-center gap-1.5 w-fit px-2.5 py-0.5 rounded-full text-xs font-black ${cfg.color}`}>
                          {cfg.icon}{cfg.label}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1">
                          {sa.permissions.slice(0, 3).map(p => (
                            <span key={p} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 text-[10px] font-bold rounded capitalize">
                              {p.replace(/-/g, ' ')}
                            </span>
                          ))}
                          {sa.permissions.length > 3 && (
                            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-400 text-[10px] font-bold rounded">+{sa.permissions.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${sa.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {sa.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(sa)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-orange-50 hover:text-brand transition-colors"
                            title="Edit permissions"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleResetPassword(sa)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                            title="Send reset email"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(sa)}
                            className={`p-1.5 rounded-lg transition-colors ${sa.active ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                            title={sa.active ? 'Deactivate' : 'Activate'}
                          >
                            {sa.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDelete(sa)}
                            className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            >
              <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-black text-gray-800 dark:text-gray-100">
                  {editTarget ? 'Edit Sub-Admin' : 'Create Sub-Admin'}
                </h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Name */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Full Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>

                {/* Email (read-only on edit) */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    disabled={!!editTarget}
                    placeholder="staff@manabites.com"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>

                {/* Password (only on create) */}
                {!editTarget && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Temporary Password</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={formPassword}
                          onChange={e => setFormPassword(e.target.value)}
                          className="w-full px-4 py-2.5 pr-10 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => setFormPassword(generatePassword())}
                        className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors"
                      >
                        Regen
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Share this with the staff member — they can change it after first login</p>
                  </div>
                )}

                {/* Role */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Role</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(ROLE_CONFIG) as [SubAdminRole, typeof ROLE_CONFIG[SubAdminRole]][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => handleRoleChange(key)}
                        className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 text-sm font-semibold transition-all text-left ${
                          formRole === key
                            ? 'border-brand bg-orange-50 text-brand dark:bg-orange-950/30'
                            : 'border-gray-200 bg-white text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${cfg.color}`}>{cfg.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Permissions</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_PERMISSIONS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => togglePerm(p.key)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                          formPerms.includes(p.key)
                            ? 'border-green-400 bg-green-50 text-green-700 dark:bg-green-950/30'
                            : 'border-gray-200 bg-white text-gray-400 dark:bg-gray-800 dark:border-gray-700'
                        }`}
                      >
                        {formPerms.includes(p.key)
                          ? <Check className="w-3 h-3 flex-shrink-0" />
                          : <div className="w-3 h-3 rounded border border-gray-300 flex-shrink-0" />
                        }
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-brand text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-60 transition-colors"
                >
                  {saving ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {editTarget ? 'Update' : 'Create Sub-Admin'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
