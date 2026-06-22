import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, orderBy, where,
  setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, addDoc,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { db, secondaryAuth } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { logAuditEvent } from '../../services/auditLog';
import toast from 'react-hot-toast';
import {
  Shield, UserPlus, Trash2, Key, Check, X, Eye, EyeOff, Copy,
  Download, Search, Edit2, Building2, Globe, Users, RefreshCw,
  CheckCircle2, PauseCircle, ShoppingBag, Bike, Store, Headphones,
  DollarSign, Megaphone, AlertTriangle, BarChart3, ChevronDown,
  ChevronRight, Clock, Lock, Unlock, Activity, TrendingUp,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';
export const ACTIONS: PermAction[] = ['view', 'create', 'edit', 'delete', 'approve', 'export'];
export const ACTION_LABELS: Record<PermAction, string> = {
  view: 'View', create: 'Create', edit: 'Edit',
  delete: 'Delete', approve: 'Approve', export: 'Export',
};

export interface ModulePerms {
  view: boolean; create: boolean; edit: boolean;
  delete: boolean; approve: boolean; export: boolean;
}
export type PermissionsMap = Record<string, ModulePerms>;

export type SubAdminRole =
  | 'operations_manager' | 'restaurant_manager' | 'rider_manager'
  | 'support_manager' | 'finance_manager' | 'marketing_manager' | 'fraud_manager';

export type SubAdminStatus = 'active' | 'suspended' | 'inactive';

export interface LoginRecord {
  timestamp: Timestamp;
  ip?: string;
  device?: string;
}

export interface SubAdmin {
  uid: string; name: string; email: string; phone: string;
  role: SubAdminRole; permissions: string[]; permissionsMap: PermissionsMap;
  city: string; franchise: string; status: SubAdminStatus;
  createdAt?: Timestamp; createdBy?: string;
  lastLogin?: Timestamp; loginCount?: number;
  loginHistory?: LoginRecord[];
}

// ═══════════════════════════════════════════════════════════════
// MODULES (15 core modules, path-key matches AdminLayout nav)
// ═══════════════════════════════════════════════════════════════

interface ModuleDef {
  key: string; label: string; dept: string;
  icon: React.ReactNode; color: string;
}

const MODULES: ModuleDef[] = [
  { key: 'orders',         label: 'Orders',             dept: 'Operations', icon: <ShoppingBag className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
  { key: 'support',        label: 'ManaBites Support',  dept: 'Operations', icon: <Headphones  className="w-4 h-4" />, color: 'text-sky-600 bg-sky-50' },
  { key: 'restaurants',    label: 'Restaurants',        dept: 'Operations', icon: <Store       className="w-4 h-4" />, color: 'text-yellow-600 bg-yellow-50' },
  { key: 'riders',         label: 'Riders',             dept: 'Operations', icon: <Bike        className="w-4 h-4" />, color: 'text-teal-600 bg-teal-50' },
  { key: 'customers',      label: 'Customers',          dept: 'Support',    icon: <Users       className="w-4 h-4" />, color: 'text-blue-600 bg-blue-50' },
  { key: 'refunds',        label: 'Refunds',            dept: 'Finance',    icon: <RefreshCw   className="w-4 h-4" />, color: 'text-red-600 bg-red-50' },
  { key: 'complaints',     label: 'Complaints',         dept: 'Support',    icon: <AlertTriangle className="w-4 h-4" />, color: 'text-rose-600 bg-rose-50' },
  { key: 'analytics',      label: 'Analytics',          dept: 'Analytics',  icon: <BarChart3   className="w-4 h-4" />, color: 'text-indigo-600 bg-indigo-50' },
  { key: 'wallet',         label: 'Wallet & Gold',      dept: 'Finance',    icon: <DollarSign  className="w-4 h-4" />, color: 'text-emerald-600 bg-emerald-50' },
  { key: 'payouts',        label: 'Payouts',            dept: 'Finance',    icon: <DollarSign  className="w-4 h-4" />, color: 'text-green-600 bg-green-50' },
  { key: 'notifications',  label: 'Notifications',      dept: 'Marketing',  icon: <Megaphone   className="w-4 h-4" />, color: 'text-pink-600 bg-pink-50' },
  { key: 'promocodes',     label: 'Promo Codes',        dept: 'Marketing',  icon: <TrendingUp  className="w-4 h-4" />, color: 'text-purple-600 bg-purple-50' },
  { key: 'fraud',          label: 'Fraud Detection',    dept: 'Security',   icon: <Shield      className="w-4 h-4" />, color: 'text-red-700 bg-red-100' },
  { key: 'geo-marketing',  label: 'Geo Marketing',      dept: 'Marketing',  icon: <Globe       className="w-4 h-4" />, color: 'text-violet-600 bg-violet-50' },
  { key: 'sos-alerts',     label: 'SOS Alerts',         dept: 'Support',    icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-600 bg-amber-50' },
];

const DEPTS = [...new Set(MODULES.map(m => m.dept))];
const DEPT_COLORS: Record<string, string> = {
  Operations: 'text-orange-700 bg-orange-100',
  Support:    'text-blue-700 bg-blue-100',
  Finance:    'text-green-700 bg-green-100',
  Marketing:  'text-purple-700 bg-purple-100',
  Security:   'text-red-700 bg-red-100',
  Analytics:  'text-indigo-700 bg-indigo-100',
};

// ═══════════════════════════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════════════════════════

const ROLE_CONFIG: Record<SubAdminRole, {
  label: string; short: string;
  color: string; bg: string; border: string;
  desc: string; dept: string; icon: React.ReactNode;
}> = {
  operations_manager: {
    label: 'Operations Manager',   short: 'Ops',
    color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200',
    desc: 'Manage orders, riders, restaurants & live operations',
    dept: 'Operations', icon: <ShoppingBag className="w-4 h-4" />,
  },
  restaurant_manager: {
    label: 'Restaurant Manager',   short: 'Rest',
    color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200',
    desc: 'Restaurant onboarding, approvals & menu management',
    dept: 'Operations', icon: <Store className="w-4 h-4" />,
  },
  rider_manager: {
    label: 'Rider Manager',        short: 'Rider',
    color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200',
    desc: 'Rider onboarding, performance & incentive management',
    dept: 'Operations', icon: <Bike className="w-4 h-4" />,
  },
  support_manager: {
    label: 'Customer Support Mgr', short: 'Supp',
    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200',
    desc: 'Handle complaints, refunds & customer queries',
    dept: 'Support', icon: <Headphones className="w-4 h-4" />,
  },
  finance_manager: {
    label: 'Finance Manager',      short: 'Fin',
    color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200',
    desc: 'Payouts, settlements, wallet & refund approvals',
    dept: 'Finance', icon: <DollarSign className="w-4 h-4" />,
  },
  marketing_manager: {
    label: 'Marketing Manager',    short: 'Mktg',
    color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200',
    desc: 'Promos, campaigns, notifications & geo marketing',
    dept: 'Marketing', icon: <Megaphone className="w-4 h-4" />,
  },
  fraud_manager: {
    label: 'Fraud Monitor Mgr',    short: 'Fraud',
    color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200',
    desc: 'Fraud detection, blacklist & suspicious activity monitoring',
    dept: 'Security', icon: <Shield className="w-4 h-4" />,
  },
};

// ═══════════════════════════════════════════════════════════════
// ROLE DEFAULT PERMISSIONS
// ═══════════════════════════════════════════════════════════════

function mp(v=false,c=false,e=false,d=false,a=false,x=false): ModulePerms {
  return { view:v, create:c, edit:e, delete:d, approve:a, export:x };
}
const fullP = () => mp(true,true,true,true,true,true);
const viewP = () => mp(true);
const veP   = () => mp(true,false,true);
const vxP   = () => mp(true,false,false,false,false,true);
const vaxP  = () => mp(true,false,false,false,true,false);

const ROLE_DEFAULTS: Record<SubAdminRole, PermissionsMap> = {
  operations_manager: {
    orders:        mp(true,true,true,false,true,true),
    support:       mp(true,false,false,false,false,false),
    restaurants:   mp(true,false,true,false,true,true),
    riders:        mp(true,true,true,false,true,true),
    analytics:     vxP(),
    'sos-alerts':  vaxP(),
    notifications: mp(true,true,true,false,false,false),
    'geo-marketing': mp(true,true,true,false,false,false),
  },
  restaurant_manager: {
    orders:      mp(true,false,false,false,false,true),
    restaurants: fullP(),
    refunds:     mp(true,false,true,false,true,false),
    analytics:   vxP(),
    notifications: mp(true,true,false,false,false,false),
    complaints:  mp(true,false,true,false,false,false),
  },
  rider_manager: {
    orders:        mp(true,false,false,false,false,true),
    riders:        fullP(),
    analytics:     vxP(),
    'sos-alerts':  vaxP(),
    notifications: mp(true,true,false,false,false,false),
    'geo-marketing': viewP(),
  },
  support_manager: {
    orders:     mp(true,false,false,false,false,true),
    support:    mp(true,true,true,false,false,false),
    customers:  mp(true,false,true,false,false,true),
    refunds:    mp(true,true,true,false,true,false),
    complaints: fullP(),
    'sos-alerts': vaxP(),
    analytics:  vxP(),
  },
  finance_manager: {
    orders:   mp(true,false,false,false,false,true),
    refunds:  mp(true,false,true,false,true,true),
    analytics: vxP(),
    wallet:   vxP(),
    payouts:  mp(true,false,false,false,true,true),
    customers: vxP(),
  },
  marketing_manager: {
    customers:     vxP(),
    analytics:     vxP(),
    notifications: fullP(),
    promocodes:    fullP(),
    'geo-marketing': fullP(),
  },
  fraud_manager: {
    orders:     mp(true,false,false,false,false,true),
    customers:  vxP(),
    riders:     viewP(),
    fraud:      fullP(),
    analytics:  vxP(),
    complaints: vaxP(),
    'sos-alerts': vaxP(),
  },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function permMapToArray(map: PermissionsMap): string[] {
  return Object.entries(map).filter(([,p]) => p.view).map(([k]) => k);
}

function emptyPermMap(): PermissionsMap {
  return Object.fromEntries(MODULES.map(m => [m.key, mp()]));
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function fmtTs(ts?: Timestamp): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function relTime(ts?: Timestamp): string {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function downloadCSV(data: SubAdmin[]) {
  const H = ['Name','Email','Phone','Role','City','Status','Modules','Created'];
  const rows = data.map(sa => [
    sa.name, sa.email, sa.phone,
    ROLE_CONFIG[sa.role]?.label ?? sa.role,
    sa.city || '—', sa.status,
    String(Object.values(sa.permissionsMap ?? {}).filter(p => p.view).length),
    fmtTs(sa.createdAt),
  ]);
  const csv = [H,...rows].map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = `sub-admins-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ═══════════════════════════════════════════════════════════════
// PERMISSION TOGGLE MATRIX
// ═══════════════════════════════════════════════════════════════

function PermMatrix({ value, onChange }: { value: PermissionsMap; onChange: (v: PermissionsMap) => void }) {
  const [openDepts, setOpenDepts] = useState<Set<string>>(new Set(DEPTS));

  function getPerms(key: string): ModulePerms {
    return value[key] ?? mp();
  }

  function toggle(moduleKey: string, action: PermAction) {
    const cur = getPerms(moduleKey);
    onChange({ ...value, [moduleKey]: { ...cur, [action]: !cur[action] } });
  }

  function setRow(moduleKey: string, on: boolean) {
    onChange({ ...value, [moduleKey]: mp(on,on,on,on,on,on) });
  }

  function setDept(dept: string, on: boolean) {
    const upd = { ...value };
    MODULES.filter(m => m.dept === dept).forEach(m => {
      upd[m.key] = mp(on,on,on,on,on,on);
    });
    onChange(upd);
  }

  function setAction(action: PermAction, on: boolean) {
    const upd = { ...value };
    MODULES.forEach(m => {
      const cur = upd[m.key] ?? mp();
      upd[m.key] = { ...cur, [action]: on };
    });
    onChange(upd);
  }

  function toggleDept(dept: string) {
    setOpenDepts(prev => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Global column toggles */}
      <div className="flex items-center flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
        <span className="text-[11px] font-black text-gray-400 uppercase tracking-wider mr-1">Grant all:</span>
        {ACTIONS.map(a => (
          <button key={a} onClick={() => setAction(a, true)}
            className="px-2.5 py-1 bg-brand text-white text-[11px] font-bold rounded-lg hover:bg-orange-600 transition-colors">
            {ACTION_LABELS[a]}
          </button>
        ))}
        <button onClick={() => onChange(emptyPermMap())}
          className="px-2.5 py-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-bold rounded-lg hover:bg-gray-300 transition-colors ml-1">
          Clear All
        </button>
      </div>

      {/* Dept groups */}
      {DEPTS.map(dept => {
        const deptModules = MODULES.filter(m => m.dept === dept);
        const isOpen = openDepts.has(dept);
        const deptActive = deptModules.filter(m => getPerms(m.key).view).length;

        return (
          <div key={dept} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
              onClick={() => toggleDept(dept)}>
              <div className="flex items-center gap-2.5">
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${DEPT_COLORS[dept] ?? 'text-gray-600 bg-gray-100'}`}>{dept}</span>
                <span className="text-xs text-gray-400">{deptActive}/{deptModules.length} modules active</span>
              </div>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button onClick={() => setDept(dept, true)} className="px-2 py-1 text-[10px] font-bold text-green-600 bg-green-50 rounded-lg hover:bg-green-100">All</button>
                <button onClick={() => setDept(dept, false)} className="px-2 py-1 text-[10px] font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200">None</button>
              </div>
            </div>

            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-gray-50 dark:border-gray-800">
                  {deptModules.map((mod, i) => {
                    const perms = getPerms(mod.key);
                    const rowActive = ACTIONS.every(a => perms[a]);
                    return (
                      <div key={mod.key}
                        className={`flex items-center justify-between px-4 py-3 ${i < deptModules.length - 1 ? 'border-b border-gray-50 dark:border-gray-800' : ''} hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors`}>
                        {/* Module label */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-shrink-0 w-44">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${mod.color}`}>
                            {mod.icon}
                          </span>
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{mod.label}</span>
                        </div>

                        {/* Action toggles */}
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {ACTIONS.map(action => (
                            <button key={action} onClick={() => toggle(mod.key, action)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                perms[action]
                                  ? 'bg-brand text-white shadow-sm'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}>
                              {ACTION_LABELS[action]}
                            </button>
                          ))}
                          <button onClick={() => setRow(mod.key, !rowActive)}
                            className={`ml-1 px-2 py-1 rounded-lg text-[10px] font-black transition-all ${
                              rowActive
                                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                                : 'bg-green-50 text-green-600 hover:bg-green-100'
                            }`}>
                            {rowActive ? '✕' : 'All'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROLE BADGE
// ═══════════════════════════════════════════════════════════════

function RoleBadge({ role }: { role: SubAdminRole }) {
  const cfg = ROLE_CONFIG[role];
  if (!cfg) return <span className="text-xs text-gray-400 italic">{role}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function SubAdminManagement() {
  const { user } = useAuth();
  const adminName = user?.displayName ?? user?.email ?? 'Admin';

  // ── Data ────────────────────────────────────────────────────
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Live ops stats ──────────────────────────────────────────
  const [pendingRestaurants, setPendingRestaurants] = useState(0);
  const [pendingRiders, setPendingRiders] = useState(0);
  const [openComplaints, setOpenComplaints] = useState(0);
  const [pendingRefunds, setPendingRefunds] = useState(0);
  const [activeSOS, setActiveSOS] = useState(0);

  // ── Modal ───────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<SubAdmin | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'permissions' | 'security'>('profile');

  // ── Form ────────────────────────────────────────────────────
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formRole, setFormRole] = useState<SubAdminRole>('support_manager');
  const [formPermsMap, setFormPermsMap] = useState<PermissionsMap>({ ...ROLE_DEFAULTS.support_manager });
  const [formStatus, setFormStatus] = useState<SubAdminStatus>('active');
  const [formPassword, setFormPassword] = useState(generatePassword());
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Post-create creds ────────────────────────────────────────
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string; role: string } | null>(null);

  // ── Search/filter ────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<SubAdminRole | ''>('');
  const [filterStatus, setFilterStatus] = useState<SubAdminStatus | ''>('');

  // ── Load sub-admins ──────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'subAdmins'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setSubAdmins(snap.docs.map(d => ({ uid: d.id, ...d.data() } as SubAdmin)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  // ── Live ops stats ────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'restaurants'), where('approved','==',false)),
      s => setPendingRestaurants(s.docs.filter(d=>d.data().status!=='rejected').length), ()=>{});
    const u2 = onSnapshot(query(collection(db,'riders'), where('approved','==',false)),
      s => setPendingRiders(s.docs.filter(d=>{const st=d.data().status??d.data().approvalStatus??'';return st!=='rejected';}).length), ()=>{});
    const u3 = onSnapshot(query(collection(db,'complaints'), where('status','in',['open','pending'])),
      s => setOpenComplaints(s.size), ()=>{});
    const u4 = onSnapshot(query(collection(db,'orders'), where('status','==','cancelled'), where('paymentStatus','==','paid')),
      s => setPendingRefunds(s.docs.filter(d=>!d.data().refundStatus||d.data().refundStatus==='pending').length), ()=>{});
    const u5 = onSnapshot(query(collection(db,'sos_alerts'), where('status','==','active')),
      s => setActiveSOS(s.size), ()=>{});
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // ── Derived stats ─────────────────────────────────────────────
  const activeCount    = subAdmins.filter(s => s.status === 'active').length;
  const suspendedCount = subAdmins.filter(s => s.status === 'suspended').length;
  const cities = [...new Set(subAdmins.map(s => s.city).filter(Boolean))];

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return subAdmins.filter(sa => {
      const ms = !q || sa.name.toLowerCase().includes(q) || sa.email.toLowerCase().includes(q) || sa.phone?.includes(q);
      return ms && (!filterRole || sa.role === filterRole) && (!filterStatus || sa.status === filterStatus);
    });
  }, [subAdmins, search, filterRole, filterStatus]);

  // ── Modal handlers ────────────────────────────────────────────
  function openAdd() {
    setEditTarget(null);
    setFormName(''); setFormEmail(''); setFormPhone(''); setFormCity('');
    setFormRole('support_manager');
    setFormPermsMap({ ...ROLE_DEFAULTS.support_manager });
    setFormStatus('active');
    setFormPassword(generatePassword());
    setShowPw(false); setActiveTab('profile');
    setShowModal(true);
  }

  function openEdit(sa: SubAdmin) {
    setEditTarget(sa);
    setFormName(sa.name); setFormEmail(sa.email);
    setFormPhone(sa.phone ?? ''); setFormCity(sa.city ?? '');
    setFormRole(sa.role); setFormStatus(sa.status);
    setFormPermsMap(sa.permissionsMap ?? { ...ROLE_DEFAULTS[sa.role] ?? {} });
    setFormPassword(''); setShowPw(false); setActiveTab('profile');
    setShowModal(true);
  }

  function handleRoleChange(role: SubAdminRole) {
    setFormRole(role);
    setFormPermsMap({ ...ROLE_DEFAULTS[role] });
  }

  async function handleSave() {
    if (!formName.trim() || !formEmail.trim()) { toast.error('Name and email are required'); return; }
    setSaving(true);
    try {
      const permArray = permMapToArray(formPermsMap);
      const base = {
        name: formName.trim(), phone: formPhone.trim(), role: formRole,
        status: formStatus, city: formCity.trim(),
        permissions: permArray, permissionsMap: formPermsMap,
      };

      if (editTarget) {
        await updateDoc(doc(db,'subAdmins', editTarget.uid), { ...base, updatedAt: serverTimestamp() });
        await updateDoc(doc(db,'adminUsers', editTarget.uid), {
          role: formRole, permissions: permArray, permissionsMap: formPermsMap, city: formCity.trim(),
        }).catch(() => {});
        await logAuditEvent({ action:'SUBADMIN_EDITED', entityType:'subAdmin', entityId: editTarget.uid,
          entityName: formName.trim(), adminUid: user?.uid, adminName, adminEmail: user?.email,
          details: { role: formRole } });
        toast.success(`${formName.trim()} updated`);
        setShowModal(false);
      } else {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, formEmail.trim(), formPassword);
        await secondaryAuth.signOut();
        const uid = cred.user.uid;
        await setDoc(doc(db,'subAdmins', uid), {
          uid, email: formEmail.trim(), ...base, loginCount: 0,
          createdAt: serverTimestamp(), createdBy: user?.email ?? 'admin',
        });
        await setDoc(doc(db,'adminUsers', uid), {
          email: formEmail.trim(), role: formRole, isSubAdmin: true,
          permissions: permArray, permissionsMap: formPermsMap, city: formCity.trim(),
        });
        await logAuditEvent({ action:'SUBADMIN_CREATED', entityType:'subAdmin', entityId: uid,
          entityName: formName.trim(), adminUid: user?.uid, adminName, adminEmail: user?.email,
          details: { role: formRole, email: formEmail.trim() } });
        setShowModal(false);
        setCreatedCreds({ email: formEmail.trim(), password: formPassword, role: ROLE_CONFIG[formRole].label });
      }
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') {
        toast.error('This email already has a Firebase account. Use a different email or delete the old account first.');
      } else {
        toast.error(e.message || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(sa: SubAdmin) {
    const next: SubAdminStatus = sa.status === 'active' ? 'suspended' : 'active';
    try {
      await updateDoc(doc(db,'subAdmins', sa.uid), { status: next, updatedAt: serverTimestamp() });
      await logAuditEvent({ action: next === 'suspended' ? 'SUBADMIN_SUSPENDED' : 'SUBADMIN_ACTIVATED',
        entityType:'subAdmin', entityId: sa.uid, entityName: sa.name,
        adminUid: user?.uid, adminName, adminEmail: user?.email });
      toast.success(`${sa.name} ${next}`);
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleDelete(sa: SubAdmin) {
    if (!window.confirm(`Permanently delete "${sa.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db,'subAdmins', sa.uid));
      await deleteDoc(doc(db,'adminUsers', sa.uid)).catch(() => {});
      await logAuditEvent({ action:'SUBADMIN_DELETED', entityType:'subAdmin', entityId: sa.uid,
        entityName: sa.name, adminUid: user?.uid, adminName, adminEmail: user?.email });
      toast.success(`${sa.name} deleted`);
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleResetPassword(sa: SubAdmin) {
    try {
      await sendPasswordResetEmail(secondaryAuth, sa.email);
      await logAuditEvent({ action:'SUBADMIN_PASSWORD_RESET', entityType:'subAdmin',
        entityId: sa.uid, entityName: sa.name, adminUid: user?.uid, adminName, adminEmail: user?.email });
      toast.success(`Reset email sent to ${sa.email}`);
    } catch (e: any) { toast.error(e.message); }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-20 space-y-5">

      {/* ── Header ── */}
      <motion.div initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-brand" />
              </div>
              Sub-Admin Management
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Role-based access control — {activeCount} active · {subAdmins.length} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadCSV(filtered)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">
              <Download className="w-4 h-4" /> Export
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-orange-600 transition-colors shadow-sm">
              <UserPlus className="w-4 h-4" /> Add Sub-Admin
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Live Ops Dashboard ── */}
      <div>
        <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2.5">Live Operations Overview</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Restaurant Approvals', value: pendingRestaurants, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-100', urgent: pendingRestaurants > 0 },
            { label: 'Rider Approvals',       value: pendingRiders,      color: 'text-teal-600',   bg: 'bg-teal-50',   border: 'border-teal-100',   urgent: pendingRiders > 0 },
            { label: 'Open Complaints',        value: openComplaints,     color: 'text-rose-600',   bg: 'bg-rose-50',   border: 'border-rose-100',   urgent: openComplaints > 0 },
            { label: 'Refund Queue',           value: pendingRefunds,     color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100', urgent: pendingRefunds > 0 },
            { label: 'Active SOS Alerts',      value: activeSOS,          color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',    urgent: activeSOS > 0 },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.05 }}
              className={`rounded-xl p-4 border ${s.bg} ${s.border} relative overflow-hidden`}>
              {s.urgent && (
                <div className="absolute top-2 right-2 w-2 h-2 bg-current rounded-full animate-pulse" style={{ color: 'currentColor' }} />
              )}
              <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
              <div className={`text-xs font-bold mt-0.5 ${s.color} opacity-70`}>{s.label}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Sub-Admin Stats + Role Distribution ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Stats */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4 flex gap-4">
          {[
            { label: 'Total', value: subAdmins.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-600' },
            { label: 'Suspended', value: suspendedCount, color: 'text-yellow-600' },
          ].map(s => (
            <div key={s.label} className="flex-1 text-center">
              <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-400 font-semibold mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Role distribution */}
        <div className="md:col-span-2 bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4">
          <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2.5">Role Distribution</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROLE_CONFIG) as SubAdminRole[]).map(role => {
              const count = subAdmins.filter(s => s.role === role).length;
              const cfg = ROLE_CONFIG[role];
              return (
                <div key={role} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                  {cfg.icon}
                  <span>{cfg.short}</span>
                  <span className="bg-white/70 rounded-full px-1.5 py-0.5 font-black text-[11px]">{count}</span>
                </div>
              );
            })}
            {cities.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs font-bold text-blue-600">
                <Globe className="w-3.5 h-3.5" />
                {cities.length} cities
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Search & Filter ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, phone…"
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <select value={filterRole} onChange={e => setFilterRole(e.target.value as SubAdminRole | '')}
            className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">All Roles</option>
            {(Object.keys(ROLE_CONFIG) as SubAdminRole[]).map(r => (
              <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as SubAdminStatus | '')}
            className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          {(search || filterRole || filterStatus) && (
            <button onClick={() => { setSearch(''); setFilterRole(''); setFilterStatus(''); }}
              className="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card py-16 text-center">
          <motion.div animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:'linear' }}
            className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">Loading…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card py-16 text-center">
          <Shield className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-bold">{subAdmins.length === 0 ? 'No sub-admins yet' : 'No results match filters'}</p>
          {subAdmins.length === 0 && (
            <button onClick={openAdd} className="mt-4 px-5 py-2 bg-brand text-white rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors">
              Add First Sub-Admin
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="table-header">Admin</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">City</th>
                  <th className="table-header">Access</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Added</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sa => {
                  const viewCount = Object.values(sa.permissionsMap ?? {}).filter(p => p.view).length;
                  return (
                    <tr key={sa.uid} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/40 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center text-sm font-black text-brand flex-shrink-0">
                            {sa.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-gray-800 dark:text-gray-100 leading-tight">{sa.name}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{sa.email}</div>
                            {sa.phone && <div className="text-[10px] text-gray-300">{sa.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="table-cell"><RoleBadge role={sa.role} /></td>
                      <td className="table-cell">
                        {sa.city ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
                            <Globe className="w-3.5 h-3.5 text-gray-400" />{sa.city}
                          </span>
                        ) : <span className="text-gray-300 text-xs">All Cities</span>}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                            <div className="bg-brand h-1.5 rounded-full" style={{ width: `${Math.round((viewCount/MODULES.length)*100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-gray-500">{viewCount}/{MODULES.length}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black ${
                          sa.status === 'active' ? 'bg-green-100 text-green-700' :
                          sa.status === 'suspended' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sa.status === 'active' ? 'bg-green-500' : sa.status === 'suspended' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                          {sa.status}
                        </span>
                      </td>
                      <td className="table-cell text-xs text-gray-400">
                        <div>{fmtTs(sa.createdAt)}</div>
                        {sa.lastLogin && <div className="text-[10px] text-gray-300 flex items-center gap-1 mt-0.5"><Clock className="w-2.5 h-2.5" />{relTime(sa.lastLogin)}</div>}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(sa)} title="Edit"
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-orange-50 hover:text-brand transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleResetPassword(sa)} title="Reset password"
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleToggleStatus(sa)}
                            title={sa.status === 'active' ? 'Suspend' : 'Activate'}
                            className={`p-1.5 rounded-lg transition-colors ${sa.status === 'active' ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                            {sa.status === 'active' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleDelete(sa)} title="Delete"
                            className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
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

      {/* ═══════════════════════════════════════════════════════
          CREDENTIALS MODAL
      ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {createdCreds && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale:0.9, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:0.9, y:20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-green-100 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-black text-gray-800 dark:text-gray-100 text-lg">Account Created!</h3>
                  <p className="text-xs text-gray-400">{createdCreds.role}</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { label: 'Email Address', val: createdCreds.email, cls: 'bg-gray-50 dark:bg-gray-800' },
                  { label: 'Temporary Password', val: createdCreds.password, cls: 'bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800' },
                ].map(({ label, val, cls }) => (
                  <div key={label}>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1.5">{label}</label>
                    <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${cls}`}>
                      <span className="flex-1 text-sm font-mono text-gray-800 dark:text-gray-100 break-all select-all">{val}</span>
                      <button onClick={() => { navigator.clipboard.writeText(val); toast.success(`${label} copied`); }}
                        className="p-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-brand flex-shrink-0 transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 font-medium dark:bg-amber-950/30 dark:text-amber-400">
                  ⚠ Save these credentials now — password won't be visible again
                </p>
                <button onClick={() => { navigator.clipboard.writeText(`Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`); toast.success('Credentials copied!'); }}
                  className="w-full py-2.5 bg-brand text-white rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors flex items-center justify-center gap-2">
                  <Copy className="w-4 h-4" /> Copy Both
                </button>
              </div>
              <div className="px-6 pb-6">
                <button onClick={() => setCreatedCreds(null)}
                  className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          ADD / EDIT MODAL
      ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
            <motion.div initial={{ scale:0.95, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:0.95, y:20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                    {editTarget ? <Edit2 className="w-4 h-4 text-brand" /> : <UserPlus className="w-4 h-4 text-brand" />}
                  </div>
                  <div>
                    <h3 className="font-black text-gray-800 dark:text-gray-100">
                      {editTarget ? `Edit — ${editTarget.name}` : 'Create Sub-Admin'}
                    </h3>
                    {editTarget && <RoleBadge role={editTarget.role} />}
                  </div>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="px-6 border-b border-gray-100 dark:border-gray-800 flex gap-1 flex-shrink-0">
                {(['profile', 'permissions', 'security'] as const).map(tab => {
                  const labels: Record<string, string> = {
                    profile: 'Profile & Role',
                    permissions: `Permissions (${Object.values(formPermsMap).filter(p=>p.view).length} modules)`,
                    security: 'Security',
                  };
                  return (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`py-3 px-1 text-sm font-bold border-b-2 mr-4 transition-colors ${
                        activeTab === tab ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'
                      }`}>
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-6">

                {/* ─── PROFILE TAB ─── */}
                {activeTab === 'profile' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { label: 'Full Name *', val: formName, set: setFormName, type: 'text', ph: 'e.g. Priya Sharma', disabled: false },
                        { label: 'Email Address *', val: formEmail, set: setFormEmail, type: 'email', ph: 'staff@manabites.in', disabled: !!editTarget },
                        { label: 'Mobile Number', val: formPhone, set: setFormPhone, type: 'tel', ph: '10-digit number', disabled: false },
                      ].map(f => (
                        <div key={f.label}>
                          <label className="text-xs font-black text-gray-500 uppercase tracking-wider block mb-1.5">{f.label}</label>
                          <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)}
                            disabled={f.disabled} placeholder={f.ph}
                            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-black text-gray-500 uppercase tracking-wider block mb-1.5">Assigned City</label>
                        <input type="text" value={formCity} onChange={e => setFormCity(e.target.value)}
                          placeholder="e.g. Warangal, Hyderabad…"
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                        <p className="text-[11px] text-gray-400 mt-1">Leave empty for all-cities access</p>
                      </div>

                      {editTarget && (
                        <div>
                          <label className="text-xs font-black text-gray-500 uppercase tracking-wider block mb-1.5">Account Status</label>
                          <div className="flex gap-2">
                            {(['active','suspended','inactive'] as SubAdminStatus[]).map(s => (
                              <button key={s} onClick={() => setFormStatus(s)}
                                className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-all capitalize ${
                                  formStatus === s ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 bg-white text-gray-400 dark:bg-gray-800 dark:border-gray-700'
                                }`}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Password */}
                    {!editTarget && (
                      <div>
                        <label className="text-xs font-black text-gray-500 uppercase tracking-wider block mb-1.5">Temporary Password</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input type={showPw ? 'text' : 'password'} value={formPassword}
                              onChange={e => setFormPassword(e.target.value)}
                              className="w-full px-4 py-2.5 pr-10 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand/30" />
                            <button type="button" onClick={() => setShowPw(v=>!v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <button onClick={() => setFormPassword(generatePassword())}
                            className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> New
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Shown after save — share it with the staff member</p>
                      </div>
                    )}

                    {/* Role selector */}
                    <div>
                      <label className="text-xs font-black text-gray-500 uppercase tracking-wider block mb-2">Department Role</label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {(Object.keys(ROLE_CONFIG) as SubAdminRole[]).map(role => {
                          const cfg = ROLE_CONFIG[role];
                          const active = formRole === role;
                          return (
                            <button key={role} onClick={() => handleRoleChange(role)}
                              className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border-2 transition-all text-left ${
                                active
                                  ? `border-current ${cfg.bg} ${cfg.color}`
                                  : 'border-gray-100 bg-white dark:bg-gray-800 dark:border-gray-700 text-gray-500 hover:border-gray-200'
                              }`}>
                              <div className="flex items-center gap-1.5">
                                <span className={`${active ? '' : 'opacity-50'}`}>{cfg.icon}</span>
                                <span className={`text-[11px] font-black uppercase tracking-wide ${active ? cfg.color : 'text-gray-500'}`}>{cfg.short}</span>
                              </div>
                              <span className={`text-[11px] font-semibold leading-tight ${active ? '' : 'text-gray-400'}`}>{cfg.label}</span>
                              {active && (
                                <span className={`text-[10px] font-bold opacity-60`}>
                                  {Object.values(ROLE_DEFAULTS[role]).filter(p=>p.view).length} modules loaded
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">Selecting a role loads default permissions — fine-tune them in the Permissions tab.</p>
                    </div>
                  </div>
                )}

                {/* ─── PERMISSIONS TAB ─── */}
                {activeTab === 'permissions' && (
                  <div className="space-y-4">
                    {/* Role preset row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Load preset:</span>
                      {(Object.keys(ROLE_CONFIG) as SubAdminRole[]).map(role => {
                        const cfg = ROLE_CONFIG[role];
                        return (
                          <button key={role} onClick={() => setFormPermsMap({ ...ROLE_DEFAULTS[role] })}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${cfg.color} ${cfg.bg} ${cfg.border} hover:opacity-80`}>
                            {cfg.icon}{cfg.short}
                          </button>
                        );
                      })}
                    </div>

                    <PermMatrix value={formPermsMap} onChange={setFormPermsMap} />
                  </div>
                )}

                {/* ─── SECURITY TAB ─── */}
                {activeTab === 'security' && (
                  <div className="space-y-4">
                    {editTarget ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Login Count', value: String(editTarget.loginCount ?? 0), icon: <Activity className="w-4 h-4 text-blue-500" /> },
                            { label: 'Last Login', value: fmtTs(editTarget.lastLogin), icon: <Clock className="w-4 h-4 text-green-500" /> },
                          ].map(s => (
                            <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm">{s.icon}</div>
                              <div>
                                <div className="font-black text-gray-800 dark:text-gray-100">{s.value}</div>
                                <div className="text-xs text-gray-400">{s.label}</div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {editTarget.loginHistory && editTarget.loginHistory.length > 0 ? (
                          <div>
                            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Login History</p>
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden">
                              {editTarget.loginHistory.slice(0, 10).map((rec, i) => (
                                <div key={i} className={`flex items-center justify-between px-4 py-3 text-sm ${i > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                                    <span className="text-gray-700 dark:text-gray-200 font-medium">{fmtTs(rec.timestamp)}</span>
                                  </div>
                                  {rec.ip && <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{rec.ip}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl py-10 text-center">
                            <Clock className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                            <p className="text-gray-400 text-sm font-medium">No login history yet</p>
                            <p className="text-gray-300 text-xs mt-1">Recorded automatically on first login</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl py-12 text-center">
                        <Lock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-gray-400 font-semibold">Security features available after account creation</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
                <div className="text-xs text-gray-400">
                  <span className="font-bold text-gray-600 dark:text-gray-300">{Object.values(formPermsMap).filter(p=>p.view).length}</span> modules •{' '}
                  <span className="font-bold text-gray-600 dark:text-gray-300">
                    {Object.values(formPermsMap).reduce((n,p) => n + Object.values(p).filter(Boolean).length, 0)}
                  </span> total permissions
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-brand text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-60 transition-colors">
                    {saving ? (
                      <motion.div animate={{ rotate:360 }} transition={{ duration:0.8, repeat:Infinity, ease:'linear' }}
                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : <Check className="w-4 h-4" />}
                    {editTarget ? 'Save Changes' : 'Create Sub-Admin'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
