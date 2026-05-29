import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  collection, getDocs, query, orderBy, where, Timestamp, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Users, Gift, TrendingUp, Search, Download, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ────────────────────────────────────────────────────────────────────

interface ReferralEntry {
  id: string;
  referrerId: string;
  referrerName: string;
  referrerPhone: string;
  referredId: string;
  referredName: string;
  referredPhone: string;
  status: 'pending' | 'completed' | 'credited';
  ordersPlaced: number;
  rewardAmount: number;
  credited: boolean;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

interface TopReferrer {
  userId: string;
  name: string;
  phone: string;
  count: number;
  earned: number;
}

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ReferralDashboard() {
  const [referrals, setReferrals] = useState<ReferralEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState<'all' | 'pending' | 'completed' | 'credited'>('all');
  const [crediting, setCrediting] = useState<string | null>(null);

  const fetchReferrals = async () => {
    setLoading(true);
    try {
      // Read from 'referrals' collection
      const snap = await getDocs(query(collection(db, 'referrals'), orderBy('createdAt', 'desc')));
      setReferrals(snap.docs.map(d => ({ id: d.id, ...d.data() } as ReferralEntry)));
    } catch {
      // Fallback: read referral data from users collection
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const entries: ReferralEntry[] = [];
        usersSnap.forEach(d => {
          const u = d.data() as any;
          (u.referrals || []).forEach((r: any) => {
            entries.push({
              id:            `${d.id}_${r.id || r.referredId}`,
              referrerId:    d.id,
              referrerName:  u.name || '—',
              referrerPhone: u.phone || '—',
              referredId:    r.id || r.referredId || '—',
              referredName:  r.referredName || '—',
              referredPhone: r.referredPhone || '—',
              status:        r.status || 'pending',
              ordersPlaced:  r.ordersPlaced || 0,
              rewardAmount:  r.rewardAmount || 50,
              credited:      r.credited || false,
              createdAt:     r.createdAt,
              completedAt:   r.completedAt,
            });
          });
        });
        setReferrals(entries.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));
      } catch { toast.error('Failed to load referrals'); }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReferrals(); }, []);

  const creditReferral = async (ref: ReferralEntry) => {
    if (ref.credited) return;
    setCrediting(ref.id);
    try {
      // Credit referrer wallet
      const userRef = doc(db, 'users', ref.referrerId);
      const userSnap = await getDocs(query(collection(db, 'users'), where('__name__', '==', ref.referrerId)));
      if (!userSnap.empty) {
        const current = userSnap.docs[0].data().walletBalance || 0;
        await updateDoc(userRef, { walletBalance: current + ref.rewardAmount });
      }
      // Mark credited in referrals collection
      if (ref.id.includes('_')) {
        // Embedded in user doc — update parent
        await updateDoc(doc(db, 'users', ref.referrerId), {
          [`referrals`]: referrals
            .filter(r => r.referrerId === ref.referrerId)
            .map(r => r.id === ref.id ? { ...r, credited: true, status: 'credited' } : r),
        });
      } else {
        await updateDoc(doc(db, 'referrals', ref.id), { credited: true, status: 'credited', creditedAt: Timestamp.now() });
      }
      toast.success(`₹${ref.rewardAmount} credited to ${ref.referrerName}`);
      setReferrals(prev => prev.map(r => r.id === ref.id ? { ...r, credited: true, status: 'credited' } : r));
    } catch { toast.error('Failed to credit'); }
    finally { setCrediting(null); }
  };

  const filtered = useMemo(() => {
    let list = referrals;
    if (filter !== 'all') list = list.filter(r => r.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.referrerName.toLowerCase().includes(q) ||
        r.referredName.toLowerCase().includes(q) ||
        r.referrerPhone.includes(q)
      );
    }
    return list;
  }, [referrals, filter, search]);

  const topReferrers = useMemo((): TopReferrer[] => {
    const map = new Map<string, TopReferrer>();
    referrals.forEach(r => {
      if (!map.has(r.referrerId)) {
        map.set(r.referrerId, { userId: r.referrerId, name: r.referrerName, phone: r.referrerPhone, count: 0, earned: 0 });
      }
      const t = map.get(r.referrerId)!;
      t.count++;
      if (r.credited) t.earned += r.rewardAmount;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [referrals]);

  const stats = useMemo(() => ({
    total:     referrals.length,
    completed: referrals.filter(r => r.status === 'completed' || r.status === 'credited').length,
    credited:  referrals.filter(r => r.credited).length,
    totalPaid: referrals.filter(r => r.credited).reduce((s, r) => s + r.rewardAmount, 0),
  }), [referrals]);

  const exportCSV = () => {
    downloadCSV([
      ['Referrer', 'Phone', 'Referred User', 'Status', 'Orders Placed', 'Reward ₹', 'Credited', 'Date'],
      ...filtered.map(r => [
        r.referrerName, r.referrerPhone, r.referredName,
        r.status, r.ordersPlaced, r.rewardAmount, r.credited ? 'Yes' : 'No', formatDate(r.createdAt),
      ]),
    ], `referrals-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Users className="w-7 h-7 text-brand" /> Referral Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Track referrals, credit rewards, analyse growth</p>
        </div>
        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.96 }} onClick={fetchReferrals}
            className="p-2 bg-white border-2 border-gray-100 rounded-xl text-gray-500 hover:border-brand">
            <RefreshCw className="w-4 h-4" />
          </motion.button>
          <motion.button whileTap={{ scale: 0.96 }} onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700">
            <Download className="w-4 h-4" /> Export
          </motion.button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Referrals',  value: stats.total,     icon: Users,       color: 'text-blue-600 bg-blue-50' },
          { label: 'Completed',        value: stats.completed, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
          { label: 'Credited',         value: stats.credited,  icon: Gift,        color: 'text-brand bg-brand/10' },
          { label: 'Total Paid Out',   value: `₹${stats.totalPaid.toLocaleString()}`, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
        ].map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-black text-gray-800">{c.value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{c.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Top Referrers */}
      {topReferrers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-black text-gray-700 uppercase tracking-wider mb-4">🏆 Top Referrers</h3>
          <div className="space-y-3">
            {topReferrers.map((r, i) => (
              <div key={r.userId} className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 text-xs font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{r.name}</p>
                  <p className="text-xs text-gray-400">{r.phone} · {r.count} referral{r.count > 1 ? 's' : ''}</p>
                </div>
                <p className="font-black text-brand">₹{r.earned.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search referrer or referred…"
            className="w-full pl-9 pr-4 py-2.5 border-2 border-gray-100 focus:border-brand rounded-xl text-sm font-bold outline-none" />
        </div>
        {(['all', 'pending', 'completed', 'credited'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              filter === f ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>{f}</button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="font-black text-gray-400">No referrals found</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Referrer', 'Referred User', 'Orders', 'Reward', 'Status', 'Date', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-800">{r.referrerName}</p>
                      <p className="text-xs text-gray-400">{r.referrerPhone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-700">{r.referredName || '—'}</p>
                      <p className="text-xs text-gray-400">{r.referredPhone || '—'}</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-600">{r.ordersPlaced}</td>
                    <td className="px-4 py-3 font-black text-brand">₹{r.rewardAmount}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                        r.status === 'credited'  ? 'bg-green-100 text-green-700'  :
                        r.status === 'completed' ? 'bg-blue-100 text-blue-700'    :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {r.status === 'credited' ? '✓ Credited' : r.status === 'completed' ? 'Completed' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      {r.status === 'completed' && !r.credited && (
                        <button onClick={() => creditReferral(r)} disabled={crediting === r.id}
                          className="px-3 py-1.5 bg-brand text-white text-xs font-black rounded-lg hover:bg-brand/90 disabled:opacity-60 whitespace-nowrap">
                          {crediting === r.id ? '…' : `Credit ₹${r.rewardAmount}`}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
