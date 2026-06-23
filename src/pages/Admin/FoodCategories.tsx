import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, orderBy,
  addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, Edit2, Trash2, X, Image } from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ────────────────────────────────────────────────────────
interface BaseItem {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string;
  searchTerm: string;
  order: number;
}
interface FoodCat extends BaseItem { bgColor: string; }
interface LunchItem extends BaseItem { subtitle: string; }
interface TrendItem extends BaseItem { count: number; }

// ── Tab config ───────────────────────────────────────────────────
const TABS = [
  { key: 'foodCategories', label: "What's On Your Mind", icon: '🍽️', hint: 'Category chips shown on home screen' },
  { key: 'lunchSpecials',  label: 'Lunch Specials',      icon: '🍱', hint: 'Shown as horizontal scroll on home screen' },
  { key: 'trendingItems',  label: 'Trending This Week',  icon: '🔥', hint: 'Trending section on home screen' },
] as const;
type TabKey = typeof TABS[number]['key'];

const BG_OPTIONS = [
  { label: 'Amber',  value: 'bg-amber-50'  },
  { label: 'Red',    value: 'bg-red-50'    },
  { label: 'Yellow', value: 'bg-yellow-50' },
  { label: 'Orange', value: 'bg-orange-50' },
  { label: 'Green',  value: 'bg-green-50'  },
  { label: 'Pink',   value: 'bg-pink-50'   },
  { label: 'Lime',   value: 'bg-lime-50'   },
  { label: 'Stone',  value: 'bg-stone-50'  },
];

const EMPTY_CAT   = { name: '', emoji: '🍛', imageUrl: '', searchTerm: '', bgColor: 'bg-amber-50', order: 0 };
const EMPTY_LUNCH = { name: '', emoji: '🍱', imageUrl: '', searchTerm: '', subtitle: "Today's Special", order: 0 };
const EMPTY_TREND = { name: '', emoji: '🍽️', imageUrl: '', searchTerm: '', count: 0, order: 0 };

// ── Component ────────────────────────────────────────────────────
export default function FoodCategories() {
  const [tab, setTab]         = useState<TabKey>('foodCategories');
  const [cats, setCats]       = useState<FoodCat[]>([]);
  const [lunch, setLunch]     = useState<LunchItem[]>([]);
  const [trend, setTrend]     = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [editId, setEditId]   = useState<string | null>(null);
  const [form, setForm]       = useState<any>(EMPTY_CAT);
  const [saving, setSaving]   = useState(false);

  // Subscribe all 3 collections
  useEffect(() => {
    let loaded = 0;
    const done = () => { if (++loaded === 3) setLoading(false); };
    const u1 = onSnapshot(query(collection(db, 'foodCategories'), orderBy('order')),
      s => { setCats(s.docs.map(d => ({ id: d.id, ...d.data() } as FoodCat))); done(); },
      () => done());
    const u2 = onSnapshot(query(collection(db, 'lunchSpecials'), orderBy('order')),
      s => { setLunch(s.docs.map(d => ({ id: d.id, ...d.data() } as LunchItem))); done(); },
      () => done());
    const u3 = onSnapshot(query(collection(db, 'trendingItems'), orderBy('order')),
      s => { setTrend(s.docs.map(d => ({ id: d.id, ...d.data() } as TrendItem))); done(); },
      () => done());
    return () => { u1(); u2(); u3(); };
  }, []);

  const items = tab === 'foodCategories' ? cats : tab === 'lunchSpecials' ? lunch : trend;

  const emptyForm = () => {
    if (tab === 'foodCategories') return { ...EMPTY_CAT, order: cats.length };
    if (tab === 'lunchSpecials')  return { ...EMPTY_LUNCH, order: lunch.length };
    return { ...EMPTY_TREND, order: trend.length };
  };

  const openAdd  = () => { setEditId(null); setForm(emptyForm()); setModal(true); };
  const openEdit = (item: any) => {
    setEditId(item.id);
    const { id, ...rest } = item;
    setForm({ ...rest });
    setModal(true);
  };
  const closeModal = () => { setModal(false); setEditId(null); };

  const save = async () => {
    if (!form.name?.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db, tab, editId), { ...form });
        toast.success('Updated!');
      } else {
        await addDoc(collection(db, tab), { ...form });
        toast.success('Added!');
      }
      closeModal();
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const del = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deleteDoc(doc(db, tab, id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  const F = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Home Screen Sections</h1>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm shadow hover:opacity-90">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-bold transition-all ${
              tab === t.key
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.split(' ')[0]}</span>
            <span className="text-[10px] font-black bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full ml-0.5">
              {t.key === 'foodCategories' ? cats.length : t.key === 'lunchSpecials' ? lunch.length : trend.length}
            </span>
          </button>
        ))}
      </div>

      {/* Hint */}
      <p className="text-xs text-gray-400 font-medium px-1">
        {TABS.find(t => t.key === tab)?.hint}
      </p>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="text-5xl mb-3">{TABS.find(t => t.key === tab)?.icon}</div>
          <p className="font-black text-gray-700 dark:text-white">No items yet</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm">
            Add First Item
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(items as any[]).map(item => (
            <motion.div key={item.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  : <span className="text-3xl">{item.emoji}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-gray-900 dark:text-white truncate">{item.name}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {item.searchTerm && `Search: "${item.searchTerm}"`}
                  {(item as TrendItem).count ? ` · ${(item as TrendItem).count}+ orders` : ''}
                  {(item as LunchItem).subtitle ? ` · ${(item as LunchItem).subtitle}` : ''}
                </p>
                {item.imageUrl && (
                  <p className="text-[10px] text-blue-500 mt-0.5 flex items-center gap-1">
                    <Image size={9} /> Custom image
                  </p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => openEdit(item)} className="p-2 text-gray-400 hover:text-brand rounded-xl transition-colors"><Edit2 size={15} /></button>
                <button onClick={() => del(item.id, item.name)} className="p-2 text-gray-400 hover:text-red-500 rounded-xl transition-colors"><Trash2 size={15} /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
            <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-black text-gray-900 dark:text-white">
                  {editId ? 'Edit' : 'Add'} — {TABS.find(t => t.key === tab)?.label}
                </h2>
                <button onClick={closeModal} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"><X size={18} /></button>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="text-xs font-bold text-gray-500 block mb-1">Emoji</label>
                  <input value={form.emoji} onChange={e => F('emoji', e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-2 py-2.5 text-xl text-center focus:border-brand outline-none" />
                </div>
                <div className="col-span-3">
                  <label className="text-xs font-bold text-gray-500 block mb-1">Name *</label>
                  <input value={form.name} onChange={e => F('name', e.target.value)} placeholder="e.g. Biryani"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm font-bold focus:border-brand outline-none text-gray-900 dark:text-white" />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1 flex items-center gap-1"><Image size={11} /> Image URL</label>
                <input value={form.imageUrl} onChange={e => F('imageUrl', e.target.value)} placeholder="https://..."
                  className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white" />
                {form.imageUrl && (
                  <img src={form.imageUrl} alt="preview" className="mt-2 h-24 w-full object-cover rounded-xl"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Search Term</label>
                  <input value={form.searchTerm} onChange={e => F('searchTerm', e.target.value)} placeholder="e.g. Biryani"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Display Order</label>
                  <input type="number" value={form.order} onChange={e => F('order', Number(e.target.value))}
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white" />
                </div>
              </div>

              {tab === 'lunchSpecials' && (
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Subtitle</label>
                  <input value={form.subtitle || ''} onChange={e => F('subtitle', e.target.value)} placeholder="e.g. Today's Special"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white" />
                </div>
              )}

              {tab === 'trendingItems' && (
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Order Count (shown as "X+ orders")</label>
                  <input type="number" value={form.count || 0} onChange={e => F('count', Number(e.target.value))} placeholder="120"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white" />
                </div>
              )}

              {tab === 'foodCategories' && (
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-2">Background Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {BG_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => F('bgColor', opt.value)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${opt.value} ${
                          form.bgColor === opt.value ? 'border-brand shadow' : 'border-transparent'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={closeModal} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">Cancel</button>
                <button onClick={save} disabled={saving || !form.name?.trim()}
                  className="flex-1 py-3 bg-brand text-white rounded-2xl font-black text-sm disabled:opacity-50 shadow">
                  {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
