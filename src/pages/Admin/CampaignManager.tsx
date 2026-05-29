import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, addDoc, updateDoc, doc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, X, Megaphone, ToggleLeft, ToggleRight, Trash2, Tag, Zap, Gift, Percent, Calendar } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type CampaignType = 'cashback' | 'discount' | 'free_delivery' | 'double_points' | 'flat_bonus';

interface Campaign {
  id: string;
  name: string;
  description: string;
  type: CampaignType;
  value: number;             // % or flat ₹
  minOrderValue: number;
  maxUsesPerUser: number;
  startDate: Timestamp;
  endDate: Timestamp;
  isActive: boolean;
  usedCount: number;
  totalDiscount: number;
  targetAudience: 'all' | 'new' | 'gold' | 'inactive';
  bannerEmoji: string;
  createdAt: Timestamp;
}

const TYPE_META: Record<CampaignType, { label: string; icon: string; color: string; unit: string }> = {
  cashback:       { label: 'Cashback',       icon: '💰', color: 'bg-green-50 text-green-700',   unit: '%' },
  discount:       { label: 'Discount',       icon: '🏷️', color: 'bg-blue-50 text-blue-700',     unit: '%' },
  free_delivery:  { label: 'Free Delivery',  icon: '🚚', color: 'bg-purple-50 text-purple-700', unit: 'flat' },
  double_points:  { label: 'Double Points',  icon: '⭐', color: 'bg-amber-50 text-amber-700',  unit: 'x' },
  flat_bonus:     { label: 'Flat Bonus',     icon: '🎁', color: 'bg-red-50 text-red-700',       unit: '₹' },
};

const AUDIENCE_LABELS: Record<string, string> = {
  all:      'All Users',
  new:      'New Users (0 orders)',
  gold:     'Gold Members',
  inactive: 'Inactive (>15 days)',
};

const FESTIVAL_PRESETS = [
  { name: '🎉 Diwali Dhamaka', type: 'cashback'      as CampaignType, value: 20, emoji: '🎇', desc: '20% cashback on all orders during Diwali' },
  { name: '🥳 New Year Offer', type: 'discount'       as CampaignType, value: 15, emoji: '🎆', desc: '15% off to celebrate the new year' },
  { name: '🏏 IPL Fever',      type: 'double_points'  as CampaignType, value: 2,  emoji: '🏏', desc: 'Double loyalty points during IPL matches' },
  { name: '❤️ Valentine\'s',   type: 'free_delivery'  as CampaignType, value: 0,  emoji: '❤️', desc: 'Free delivery for couples on Valentine\'s Day' },
  { name: '📚 Student Offer',  type: 'flat_bonus'     as CampaignType, value: 50, emoji: '📚', desc: '₹50 bonus wallet credit for students' },
];

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isCampaignLive(c: Campaign): boolean {
  if (!c.isActive) return false;
  const now = Date.now();
  const start = c.startDate?.toMillis?.() ?? 0;
  const end   = c.endDate?.toMillis?.()   ?? Infinity;
  return now >= start && now <= end;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', description: '', type: 'cashback' as CampaignType,
    value: '', minOrderValue: '0', maxUsesPerUser: '1',
    startDate: '', endDate: '', targetAudience: 'all' as Campaign['targetAudience'],
    bannerEmoji: '🎉',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'campaigns'), orderBy('createdAt', 'desc')), snap => {
      setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as Campaign)));
      setLoading(false);
    });
  }, []);

  const applyPreset = (p: typeof FESTIVAL_PRESETS[0]) => {
    setForm(f => ({ ...f, name: p.name, type: p.type, value: String(p.value), description: p.desc, bannerEmoji: p.emoji }));
    setShowModal(true);
  };

  const saveCampaign = async () => {
    if (!form.name || !form.startDate || !form.endDate) { toast.error('Fill name and dates'); return; }
    const val = parseFloat(form.value);
    if (form.type !== 'free_delivery' && (isNaN(val) || val <= 0)) { toast.error('Enter a valid value'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'campaigns'), {
        name:           form.name.trim(),
        description:    form.description.trim(),
        type:           form.type,
        value:          val || 0,
        minOrderValue:  parseFloat(form.minOrderValue) || 0,
        maxUsesPerUser: parseInt(form.maxUsesPerUser) || 1,
        startDate:      Timestamp.fromDate(new Date(form.startDate)),
        endDate:        Timestamp.fromDate(new Date(form.endDate + 'T23:59:59')),
        isActive:       true,
        usedCount:      0,
        totalDiscount:  0,
        targetAudience: form.targetAudience,
        bannerEmoji:    form.bannerEmoji,
        createdAt:      serverTimestamp(),
      });
      toast.success('Campaign created!');
      setShowModal(false);
      setForm({ name: '', description: '', type: 'cashback', value: '', minOrderValue: '0', maxUsesPerUser: '1', startDate: '', endDate: '', targetAudience: 'all', bannerEmoji: '🎉' });
    } catch { toast.error('Failed to create campaign'); }
    finally { setSaving(false); }
  };

  const toggleCampaign = async (c: Campaign) => {
    await updateDoc(doc(db, 'campaigns', c.id), { isActive: !c.isActive });
    toast.success(c.isActive ? 'Campaign paused' : 'Campaign activated');
  };

  const deleteCampaign = async (id: string) => {
    if (!window.confirm('Delete this campaign?')) return;
    setDeleting(id);
    try { await deleteDoc(doc(db, 'campaigns', id)); toast.success('Deleted'); }
    catch { toast.error('Failed to delete'); }
    finally { setDeleting(null); }
  };

  const live    = useMemo(() => campaigns.filter(isCampaignLive), [campaigns]);
  const upcoming = useMemo(() => campaigns.filter(c => c.isActive && c.startDate?.toMillis?.() > Date.now()), [campaigns]);
  const ended   = useMemo(() => campaigns.filter(c => c.endDate?.toMillis?.() < Date.now() || !c.isActive), [campaigns]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Megaphone className="w-7 h-7 text-brand" /> Campaign Manager
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Festival offers, cashback campaigns, seasonal promotions</p>
        </div>
        <motion.button whileTap={{ scale: 0.96 }} onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl text-sm font-bold hover:bg-brand/90 shadow-md shadow-brand/20">
          <Plus className="w-4 h-4" /> New Campaign
        </motion.button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Live Now',  value: live.length,     emoji: '🟢', bg: 'bg-green-50' },
          { label: 'Upcoming',  value: upcoming.length, emoji: '⏳', bg: 'bg-blue-50' },
          { label: 'Total',     value: campaigns.length, emoji: '📊', bg: 'bg-gray-50' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-2xl p-4 text-center`}>
            <div className="text-2xl mb-1">{c.emoji}</div>
            <p className="text-2xl font-black text-gray-800">{c.value}</p>
            <p className="text-xs font-bold text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Festival Presets */}
      <div>
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Quick Festival Presets</p>
        <div className="flex gap-2 flex-wrap">
          {FESTIVAL_PRESETS.map(p => (
            <button key={p.name} onClick={() => applyPreset(p)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border-2 border-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:border-brand hover:text-brand transition-all">
              {p.emoji} {p.name.replace(/^[^ ]+ /, '')}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign List */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" /></div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <Megaphone className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="font-black text-gray-400">No campaigns yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c, i) => {
            const meta = TYPE_META[c.type];
            const live = isCampaignLive(c);
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all ${live ? 'border-green-200' : c.isActive ? 'border-brand/10' : 'border-gray-100 opacity-60'}`}>
                <div className="flex items-start gap-4">
                  <div className="text-3xl leading-none flex-shrink-0">{c.bannerEmoji || meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-gray-800">{c.name}</p>
                      {live && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black rounded-full animate-pulse">🟢 LIVE</span>}
                      <span className={`px-2 py-0.5 text-[10px] font-black rounded-full ${meta.color}`}>{meta.label}</span>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-black rounded-full">{AUDIENCE_LABELS[c.targetAudience]}</span>
                    </div>
                    {c.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{c.description}</p>}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 font-bold flex-wrap">
                      <span>📅 {formatDate(c.startDate)} → {formatDate(c.endDate)}</span>
                      <span>🔢 Used {c.usedCount} times</span>
                      {c.totalDiscount > 0 && <span>💸 ₹{c.totalDiscount.toLocaleString()} given</span>}
                      {c.minOrderValue > 0 && <span>Min ₹{c.minOrderValue}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-gray-400 font-bold">Value</p>
                      <p className="font-black text-brand">
                        {c.type === 'free_delivery' ? 'Free' :
                         c.type === 'double_points' ? `${c.value}x` :
                         c.type === 'flat_bonus' ? `₹${c.value}` : `${c.value}%`}
                      </p>
                    </div>
                    <button onClick={() => toggleCampaign(c)}
                      className={`p-1.5 rounded-lg transition-colors ${c.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                      {c.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button onClick={() => deleteCampaign(c.id)} disabled={deleting === c.id}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}>
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92 }}
              className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-gray-900 text-lg">New Campaign</h3>
                <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input value={form.bannerEmoji} onChange={e => setForm(f => ({ ...f, bannerEmoji: e.target.value }))}
                    className="w-14 border-2 border-gray-100 rounded-xl px-2 py-2.5 text-xl text-center outline-none focus:border-brand" placeholder="🎉" />
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Campaign name" className="flex-1 border-2 border-gray-100 focus:border-brand rounded-xl px-4 py-2.5 text-sm font-bold outline-none" />
                </div>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short description" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-4 py-2.5 text-sm outline-none" />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Type</label>
                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CampaignType }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none">
                      {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                    </select>
                  </div>
                  {form.type !== 'free_delivery' && (
                    <div>
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">
                        Value ({TYPE_META[form.type].unit})
                      </label>
                      <input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                        placeholder="e.g. 20" className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Start Date</label>
                    <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">End Date</label>
                    <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Min Order (₹)</label>
                    <input type="number" value={form.minOrderValue} onChange={e => setForm(f => ({ ...f, minOrderValue: e.target.value }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Max Uses / User</label>
                    <input type="number" value={form.maxUsesPerUser} onChange={e => setForm(f => ({ ...f, maxUsesPerUser: e.target.value }))}
                      className="w-full border-2 border-gray-100 focus:border-brand rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider block mb-1">Target Audience</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
                      <button key={k} onClick={() => setForm(f => ({ ...f, targetAudience: k as any }))}
                        className={`py-2 px-3 rounded-xl border-2 text-xs font-bold transition-all text-left ${form.targetAudience === k ? 'border-brand bg-brand/5 text-brand' : 'border-gray-100 text-gray-600'}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowModal(false)} className="flex-1 py-3 border-2 border-gray-100 rounded-xl text-gray-600 font-bold text-sm">Cancel</button>
                <button onClick={saveCampaign} disabled={saving}
                  className="flex-1 py-3 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 disabled:opacity-60">
                  {saving ? 'Creating…' : '🚀 Launch Campaign'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
