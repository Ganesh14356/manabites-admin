import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Store, Users, Settings, LogOut, Menu, X, ShoppingBag,
  BarChart2, DollarSign, Tag, ShieldCheck, CreditCard, Image, Bike,
  MapPin, TrendingUp, Target, Bell, RefreshCw, Star, AlertTriangle, MessageSquareWarning,
  Calculator, Percent, Sun, Moon, MessageCircle, Zap, Wallet, Crown, Shield, Crosshair,
  ShieldAlert, Ban, Rocket,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import ChatDrawer from './ChatDrawer';

const BASE_NAV = [
  { name: 'Analytics',            path: '/admin/analytics',            icon: BarChart2  },
  { name: 'Orders',               path: '/admin/orders',               icon: ShoppingBag },
  { name: 'Restaurants',          path: '/admin/restaurants',          icon: Store      },
  { name: 'Approvals',            path: '/admin/restaurants-approval', icon: ShieldCheck },
  { name: 'Riders',               path: '/admin/riders',               icon: Bike       },
  { name: 'Rider Approvals',      path: '/admin/rider-approvals',      icon: ShieldCheck },
  { name: 'Live Map',             path: '/admin/live-map',             icon: MapPin      },
  { name: 'Rider Performance',    path: '/admin/rider-performance',    icon: TrendingUp  },
  { name: 'Geofencing',           path: '/admin/geofencing',           icon: Target      },
  { name: 'Notifications',        path: '/admin/notifications',        icon: Bell        },
  { name: 'Refunds',              path: '/admin/refunds',              icon: RefreshCw   },
  { name: 'Reviews',              path: '/admin/reviews',              icon: Star        },
  { name: 'Rating Appeals',       path: '/admin/rating-appeals',       icon: MessageSquareWarning },
  { name: 'SOS Alerts',           path: '/admin/sos-alerts',           icon: AlertTriangle },
  { name: 'Customers',            path: '/admin/customers',            icon: Users      },
  { name: 'Payouts',              path: '/admin/payouts',              icon: DollarSign },
  { name: 'Daily Settlements',   path: '/admin/settlements',          icon: Calculator  },
  { name: 'Commission',          path: '/admin/commission',           icon: Percent     },
  { name: 'Surge Pricing',      path: '/admin/surge-pricing',        icon: Zap         },
  { name: 'Wallet & Gold',      path: '/admin/wallet',               icon: Wallet      },
  { name: 'Sub-Admins',         path: '/admin/sub-admins',           icon: Shield      },
  { name: 'Geo Marketing',      path: '/admin/geo-marketing',        icon: Crosshair   },
  { name: 'WhatsApp / SMS',     path: '/admin/whatsapp',             icon: MessageCircle },
  { name: 'Razorpay',            path: '/admin/razorpay',             icon: CreditCard },
  { name: 'Promo Codes',          path: '/admin/promocodes',           icon: Tag        },
  { name: 'Offer Banners',        path: '/admin/banners',              icon: Image      },
  { name: 'Fraud Detection',     path: '/admin/fraud',                icon: ShieldAlert },
  { name: 'Blacklist',           path: '/admin/blacklist',            icon: Ban        },
  { name: 'Verticals Hub',        path: '/admin/verticals',            icon: Rocket     },
  { name: 'Settings',             path: '/admin/settings',             icon: Settings   },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingRiders, setPendingRiders]       = useState(0);
  const [pendingRefunds, setPendingRefunds]     = useState(0);
  const [activeSOS, setActiveSOS]               = useState(0);
  const [pendingAppeals, setPendingAppeals]     = useState(0);
  const [pendingOrders, setPendingOrders]       = useState(0);
  const [unreadReviews, setUnreadReviews]       = useState(0);
  const [unreadNotifs, setUnreadNotifs]         = useState(0);
  const [pendingPayouts, setPendingPayouts]     = useState(0);

  // Live pending restaurant count for badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'restaurants'), where('approved', '==', false));
    const unsub = onSnapshot(q, snap => {
      const count = snap.docs.filter(d => d.data().status !== 'rejected').length;
      setPendingApprovals(count);
    }, () => {});
    return () => unsub();
  }, [user]);

  // Live pending rider count for badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'riders'), where('approved', '==', false));
    const unsub = onSnapshot(q, snap => {
      const count = snap.docs.filter(d => {
        const s = d.data().status ?? d.data().approvalStatus ?? '';
        return s !== 'rejected';
      }).length;
      setPendingRiders(count);
    }, () => {});
    return () => unsub();
  }, [user]);

  // Live pending refunds badge
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'cancelled'),
      where('paymentStatus', '==', 'paid'),
    );
    const unsub = onSnapshot(q, snap => {
      const count = snap.docs.filter(d => !d.data().refundStatus || d.data().refundStatus === 'pending').length;
      setPendingRefunds(count);
    }, () => {});
    return () => unsub();
  }, [user]);

  // Live SOS alerts badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'sos_alerts'), where('status', '==', 'active'));
    const unsub = onSnapshot(q, snap => setActiveSOS(snap.size), () => {});
    return () => unsub();
  }, [user]);

  // Live rating appeals badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'ratingAppeals'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, snap => setPendingAppeals(snap.size), () => {});
    return () => unsub();
  }, [user]);

  // Live pending orders badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'orders'), where('status', 'in', ['pending', 'placed']));
    const unsub = onSnapshot(q, snap => setPendingOrders(snap.size), () => {});
    return () => unsub();
  }, [user]);

  // Live unread reviews badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'reviews'), where('read', '==', false));
    const unsub = onSnapshot(q, snap => setUnreadReviews(snap.size), () => {});
    return () => unsub();
  }, [user]);

  // Live unread admin notifications badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'adminNotifications'), where('read', '==', false));
    const unsub = onSnapshot(q, snap => setUnreadNotifs(snap.size), () => {});
    return () => unsub();
  }, [user]);

  // Live pending payouts badge
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'payouts'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, snap => setPendingPayouts(snap.size), () => {});
    return () => unsub();
  }, [user]);

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
        fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-700">
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
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto dark:border-gray-700">
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
                    ? 'bg-orange-50 text-brand dark:bg-gray-800 dark:text-orange-400'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-brand text-white dark:bg-orange-400/20 dark:text-orange-400' : 'bg-gray-100 text-gray-500'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="flex-1">{item.name}</span>
                {/* Pending restaurant approvals badge */}
                {item.path === '/admin/restaurants-approval' && pendingApprovals > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingApprovals > 99 ? '99+' : pendingApprovals}
                  </motion.span>
                )}
                {/* Pending rider approvals badge */}
                {item.path === '/admin/rider-approvals' && pendingRiders > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingRiders > 99 ? '99+' : pendingRiders}
                  </motion.span>
                )}
                {/* Pending refunds badge */}
                {item.path === '/admin/refunds' && pendingRefunds > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-yellow-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingRefunds > 99 ? '99+' : pendingRefunds}
                  </motion.span>
                )}
                {/* Active SOS badge */}
                {item.path === '/admin/sos-alerts' && activeSOS > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 animate-pulse">
                    {activeSOS > 99 ? '99+' : activeSOS}
                  </motion.span>
                )}
                {/* Pending appeals badge */}
                {item.path === '/admin/rating-appeals' && pendingAppeals > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingAppeals > 99 ? '99+' : pendingAppeals}
                  </motion.span>
                )}
                {/* Pending orders badge */}
                {item.path === '/admin/orders' && pendingOrders > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-blue-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingOrders > 99 ? '99+' : pendingOrders}
                  </motion.span>
                )}
                {/* Unread reviews badge */}
                {item.path === '/admin/reviews' && unreadReviews > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-purple-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {unreadReviews > 99 ? '99+' : unreadReviews}
                  </motion.span>
                )}
                {/* Unread admin notifications badge */}
                {item.path === '/admin/notifications' && unreadNotifs > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-brand text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {unreadNotifs > 99 ? '99+' : unreadNotifs}
                  </motion.span>
                )}
                {/* Pending payouts badge */}
                {item.path === '/admin/payouts' && pendingPayouts > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="min-w-[18px] h-[18px] bg-green-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {pendingPayouts > 99 ? '99+' : pendingPayouts}
                  </motion.span>
                )}
                {isActive
                  && !(item.path === '/admin/restaurants-approval' && pendingApprovals > 0)
                  && !(item.path === '/admin/rider-approvals'      && pendingRiders    > 0)
                  && !(item.path === '/admin/refunds'              && pendingRefunds   > 0)
                  && !(item.path === '/admin/sos-alerts'           && activeSOS        > 0)
                  && !(item.path === '/admin/rating-appeals'       && pendingAppeals   > 0)
                  && !(item.path === '/admin/orders'               && pendingOrders    > 0)
                  && !(item.path === '/admin/reviews'              && unreadReviews    > 0)
                  && !(item.path === '/admin/notifications'        && unreadNotifs     > 0)
                  && !(item.path === '/admin/payouts'              && pendingPayouts   > 0)
                  && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                )}
              </Link>
              </motion.div>
            );
          })}
        </nav>

        {/* User card + sign out */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-700 space-y-1">
          <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50 dark:bg-gray-800">
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-black text-sm flex-shrink-0">
              {adminInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{adminName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-400 truncate">{adminEmail}</p>
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
      <div className="flex-1 overflow-y-auto dark:bg-gray-950 w-full min-h-screen">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-between px-6 py-3.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
          <div>
            <h2 className="font-black text-gray-800 dark:text-gray-100 text-base">{activeNav?.name ?? 'Dashboard'}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <button onClick={toggleTheme} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title="Toggle dark mode">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => setChatOpen(true)} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 transition-colors" title="Rider Chat">
              <MessageCircle className="w-4 h-4" />
            </button>
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

      <ChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
