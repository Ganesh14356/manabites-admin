import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Store, Users, Settings, LogOut, Menu, X, ShoppingBag,
  BarChart2, DollarSign, Tag, ShieldCheck, CreditCard, Image,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

const BASE_NAV = [
  { name: 'Analytics',            path: '/admin/analytics',            icon: BarChart2  },
  { name: 'Orders',               path: '/admin/orders',               icon: ShoppingBag },
  { name: 'Restaurants',          path: '/admin/restaurants',          icon: Store      },
  { name: 'Approvals',            path: '/admin/restaurants-approval', icon: ShieldCheck },
  { name: 'Customers',            path: '/admin/customers',            icon: Users      },
  { name: 'Payouts',              path: '/admin/payouts',              icon: DollarSign },
  { name: 'Razorpay',            path: '/admin/razorpay',             icon: CreditCard },
  { name: 'Promo Codes',          path: '/admin/promocodes',           icon: Tag        },
  { name: 'Offer Banners',        path: '/admin/banners',              icon: Image      },
  { name: 'Settings',             path: '/admin/settings',             icon: Settings   },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // Live pending restaurant count for badge
  useEffect(() => {
    const q = query(collection(db, 'restaurants'), where('approved', '==', false));
    const unsub = onSnapshot(q, snap => {
      const count = snap.docs.filter(d => d.data().status !== 'rejected').length;
      setPendingApprovals(count);
    }, () => {});
    return () => unsub();
  }, []);


  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut(auth);
    navigate('/login');
  };

  const adminName = profile?.name || user?.email?.split('@')[0] || 'Admin';
  const adminEmail = user?.email ?? '';
  const adminInitial = adminName.charAt(0).toUpperCase();

  const NAV_ITEMS = BASE_NAV;
  const activeNav = NAV_ITEMS.find(item => location.pathname.startsWith(item.path));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* ── Mobile Header ─────────────────────────────────────────────────── */}
      <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-gray-600 -ml-2"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="font-black text-lg text-brand">Manabites</span>
        </div>
        {activeNav && (
          <span className="text-sm font-bold text-gray-700">{activeNav.name}</span>
        )}
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-lg leading-none">🍔</span>
            </div>
            <div>
              <p className="font-black text-gray-900 text-base leading-tight">Manabites</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item, idx) => {
            const isActive = location.pathname.startsWith(item.path);
            const Icon = item.icon;
            return (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.25, ease: 'easeOut' }}
              >
              <Link
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-orange-50 text-brand'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="flex-1">{item.name}</span>
                {/* Pending restaurant approvals badge */}
                {item.path === '/admin/restaurants-approval' && pendingApprovals > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1"
                  >
                    {pendingApprovals > 99 ? '99+' : pendingApprovals}
                  </motion.span>
                )}
                {isActive && !(item.path === '/admin/restaurants-approval' && pendingApprovals > 0) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                )}
              </Link>
              </motion.div>
            );
          })}
        </nav>

        {/* User card + sign out */}
        <div className="p-3 border-t border-gray-100 space-y-1">
          <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50">
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-black text-sm flex-shrink-0">
              {adminInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 truncate">{adminName}</p>
              <p className="text-xs text-gray-400 truncate">{adminEmail}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
          >
            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
              <LogOut className="w-4 h-4 text-red-500" />
            </div>
            {loggingOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto w-full min-h-screen">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-between px-6 py-3.5 bg-white border-b border-gray-100 sticky top-0 z-10">
          <div>
            <h2 className="font-black text-gray-800 text-base">{activeNav?.name ?? 'Dashboard'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white font-black text-xs">
              {adminInitial}
            </div>
            {adminName}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
