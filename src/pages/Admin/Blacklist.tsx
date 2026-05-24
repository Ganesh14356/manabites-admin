import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, orderBy,
  setDoc, doc, updateDoc, getDocs, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Ban, UserCheck, Search, Plus, Trash2, User, Store, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface BlacklistEntry {
  id: string;
  type: 'user' | 'restaurant';
  identifier: string; // phone or restaurantId
  name?: string;
  reason: string;
  bannedAt: number;
  bannedBy?: string;
  active: boolean;
}

function AddBanModal({ onClose }: { onClose: () => void }) {
  const [type, setType]       = useState<'user' | 'restaurant'>('user');
  const [identifier, setId]   = useState('');
  const [name, setName]       = useState('');
  const [reason, setReason]   = useState('');
  const [saving, setSaving]   = useState(false);

  const handleAdd = async () => {
    if (!identifier.trim() || !reason.trim()) { toast.error('Fill all required fields'); return; }
    setSaving(true);
    try {
      const id = `${type}_${identifier.trim().replace(/\s+/g, '_')}`;
      await setDoc(doc(db, 'blacklist', id), {
        type,
        identifier: identifier.trim(),
        name: name.trim() || null,
        reason: reason.trim(),
        bannedAt: Date.now(),
        active: true,
      });

      // Also mark the user/restaurant as banned
      if (type === 'user') {
        // Try updating by phone number search
        const snap = await getDocs(query(collection(db, 'users'), where('phone', '==', identifier.trim())));
        for (const d of snap.docs) {
          await updateDoc(doc(db, 'users', d.id), { isBanned: true, banReason: reason.trim(), bannedAt: Date.now() });
        }
      } else {
        const snap = await getDocs(query(collection(db, 'restaurants'), where('id', '==', identifier.trim())));
        for (const d of snap.docs) {
          await updateDoc(doc(db, 'restaurants', d.id), { isBanned: true, banReason: reason.trim(), bannedAt: Date.now() });
        }
      }

      toast.success(`${type === 'user' ? 'User' : 'Restaurant'} added to blacklist`);
      onClose();
    } catch {
      toast.error('Failed to add to blacklist');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-black text-gray-900 dark:text-white text-lg">Add to Blacklist</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500"><X size={16} /></button>
        </div>

        {/* Type toggle */}
        <div className="flex gap-2 mb-4">
          {(['user', 'restaurant'] as const).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                type === t ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {t === 'user' ? <User size={14} /> : <Store size={14} />}
              {t === 'user' ? 'User' : 'Restaurant'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
              {type === 'user' ? 'Phone Number *' : 'Restaurant ID *'}
            </label>
            <input
              value={identifier}
              onChange={e => setId(e.target.value)}
              placeholder={type === 'user' ? '+91XXXXXXXXXX' : 'Restaurant Firestore ID'}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400/30"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
              Name (optional)
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Customer or restaurant name"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400/30"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
              Ban Reason *
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Repeated COD non-payment, fake orders, abuse..."
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400/30 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="flex-1 bg-red-600 text-white font-black py-3 rounded-2xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-red-700 transition-colors"
          >
            {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ban size={15} />}
            {saving ? 'Banning…' : 'Add to Blacklist'}
          </button>
          <button onClick={onClose} className="px-5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-bold rounded-2xl text-sm">
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function BanCard({ entry, onUnban }: { entry: BlacklistEntry; onUnban: (id: string) => Promise<void> }) {
  const [unbanning, setUnbanning] = useState(false);

  const handleUnban = async () => {
    if (!confirm(`Unban this ${entry.type}?`)) return;
    setUnbanning(true);
    try {
      await onUnban(entry.id);
      toast.success('Unban successful');
    } catch {
      toast.error('Failed to unban');
    } finally {
      setUnbanning(false);
    }
  };

  const date = new Date(entry.bannedAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-white dark:bg-gray-900 rounded-2xl border shadow-sm p-4 flex items-start gap-4 ${
        entry.active ? 'border-red-100 dark:border-red-900/30' : 'border-gray-100 dark:border-gray-800 opacity-50'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
        entry.type === 'user' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-orange-100 dark:bg-orange-900/30'
      }`}>
        {entry.type === 'user'
          ? <User size={18} className="text-red-600 dark:text-red-400" />
          : <Store size={18} className="text-orange-600 dark:text-orange-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-900 dark:text-white text-sm">
            {entry.name || entry.identifier}
          </span>
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
            entry.type === 'user'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}>
            {entry.type}
          </span>
          {!entry.active && (
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              unbanned
            </span>
          )}
        </div>
        {entry.name && (
          <p className="text-xs text-gray-400 mt-0.5">{entry.identifier}</p>
        )}
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          <span className="font-semibold">Reason:</span> {entry.reason}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Banned on {date}</p>
      </div>

      {entry.active && (
        <button
          onClick={handleUnban}
          disabled={unbanning}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 text-xs font-bold rounded-xl hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
        >
          {unbanning ? (
            <span className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          ) : (
            <UserCheck size={13} />
          )}
          Unban
        </button>
      )}
    </motion.div>
  );
}

export default function Blacklist() {
  const [entries, setEntries]       = useState<BlacklistEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'user' | 'restaurant'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'blacklist'), orderBy('bannedAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as BlacklistEntry)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const handleUnban = async (id: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    await updateDoc(doc(db, 'blacklist', id), { active: false, unbannedAt: Date.now() });
    // Also clear the ban flag
    if (entry.type === 'user') {
      const snap = await getDocs(query(collection(db, 'users'), where('phone', '==', entry.identifier)));
      for (const d of snap.docs) await updateDoc(doc(db, 'users', d.id), { isBanned: false });
    } else {
      const snap = await getDocs(query(collection(db, 'restaurants'), where('id', '==', entry.identifier)));
      for (const d of snap.docs) await updateDoc(doc(db, 'restaurants', d.id), { isBanned: false });
    }
  };

  const q = search.toLowerCase().trim();
  const filtered = entries.filter(e => {
    if (!showInactive && !e.active) return false;
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (q) return (
      (e.name || '').toLowerCase().includes(q) ||
      e.identifier.toLowerCase().includes(q) ||
      e.reason.toLowerCase().includes(q)
    );
    return true;
  });

  const activeUsers = entries.filter(e => e.active && e.type === 'user').length;
  const activeRests = entries.filter(e => e.active && e.type === 'restaurant').length;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Blacklist Manager</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage banned users and restaurants</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-red-600 text-white font-black px-4 py-2.5 rounded-xl text-sm hover:bg-red-700 transition-colors"
        >
          <Plus size={15} /> Add to Blacklist
        </motion.button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Banned Users',       value: activeUsers, color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20',    border: 'border-red-100 dark:border-red-800' },
          { label: 'Banned Restaurants', value: activeRests, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-100 dark:border-orange-800' },
          { label: 'Total Records',      value: entries.length, color: 'text-gray-700 dark:text-gray-300', bg: 'bg-white dark:bg-gray-900', border: 'border-gray-100 dark:border-gray-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border ${s.bg} ${s.border} p-4`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-3 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or reason…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400/30"
          />
        </div>

        <div className="flex gap-1.5">
          {(['all', 'user', 'restaurant'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border capitalize transition-colors ${
                typeFilter === t
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowInactive(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
            showInactive
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Show Unbanned
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0,1,2].map(i => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl h-20 animate-pulse border border-gray-100 dark:border-gray-800" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
          <div className="text-5xl mb-3">✅</div>
          <h3 className="text-lg font-black text-gray-800 dark:text-gray-200">No entries found</h3>
          <p className="text-sm text-gray-400 mt-1">The blacklist is empty or no results match your search</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {filtered.map(e => (
              <BanCard key={e.id} entry={e} onUnban={handleUnban} />
            ))}
          </div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {showAddModal && <AddBanModal onClose={() => setShowAddModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
