import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, orderBy,
  addDoc, updateDoc, deleteDoc, doc, writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, Edit2, Trash2, X, GripVertical, Image, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const DEFAULT_CATEGORIES = [
  { name: 'Biryani',      emoji: '🍛', imageUrl: '', searchTerm: 'Biryani',      bgColor: 'bg-amber-50',  order: 0 },
  { name: 'Pizza',        emoji: '🍕', imageUrl: '', searchTerm: 'Pizza',        bgColor: 'bg-red-50',    order: 1 },
  { name: 'Burger',       emoji: '🍔', imageUrl: '', searchTerm: 'Burger',       bgColor: 'bg-yellow-50', order: 2 },
  { name: 'Chinese',      emoji: '🥡', imageUrl: '', searchTerm: 'Chinese',      bgColor: 'bg-orange-50', order: 3 },
  { name: 'South Indian', emoji: '🥘', imageUrl: '', searchTerm: 'South Indian', bgColor: 'bg-green-50',  order: 4 },
  { name: 'Desserts',     emoji: '🍰', imageUrl: '', searchTerm: 'Desserts',     bgColor: 'bg-pink-50',   order: 5 },
  { name: 'North Indian', emoji: '🍲', imageUrl: '', searchTerm: 'North Indian', bgColor: 'bg-orange-50', order: 6 },
  { name: 'Healthy',      emoji: '🥗', imageUrl: '', searchTerm: 'Healthy',      bgColor: 'bg-lime-50',   order: 7 },
  { name: 'Fast Food',    emoji: '🌮', imageUrl: '', searchTerm: 'Fast Food',    bgColor: 'bg-yellow-50', order: 8 },
  { name: 'Beverages',    emoji: '☕', imageUrl: '', searchTerm: 'Beverages',    bgColor: 'bg-stone-50',  order: 9 },
];

interface FoodCategory {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string;
  searchTerm: string;
  bgColor: string;
  order: number;
}

const EMPTY: Omit<FoodCategory, 'id'> = {
  name: '', emoji: '🍛', imageUrl: '', searchTerm: '', bgColor: 'bg-amber-50', order: 0,
};

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

export default function FoodCategories() {
  const [cats, setCats]         = useState<FoodCategory[]>([]);
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState<Omit<FoodCategory, 'id'> | null>(null);
  const [editId, setEditId]     = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [seeding, setSeeding]   = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'foodCategories'), orderBy('order')),
      snap => {
        setCats(snap.docs.map(d => ({ id: d.id, ...d.data() } as FoodCategory)));
        setLoading(false);
      },
      err => { console.error(err); setLoading(false); }
    );
    return unsub;
  }, []);

  const loadDefaults = async () => {
    if (!window.confirm('Load 10 default categories (Biryani, Pizza, Burger…)? Existing categories will NOT be deleted.')) return;
    setSeeding(true);
    try {
      const col = collection(db, 'foodCategories');
      console.log('DB app:', db.app.name, 'DB id:', (db as any)._databaseId?.database);
      for (const cat of DEFAULT_CATEGORIES) {
        await addDoc(col, cat);
      }
      toast.success('Default categories loaded!');
    } catch (e: any) {
      console.error('loadDefaults error:', e?.code, e?.message, e);
      toast.error(e?.message || 'Failed to load defaults');
    }
    finally { setSeeding(false); }
  };

  const openAdd = () => { setForm({ ...EMPTY, order: cats.length }); setEditId(null); };
  const openEdit = (c: FoodCategory) => {
    setForm({ name: c.name, emoji: c.emoji, imageUrl: c.imageUrl, searchTerm: c.searchTerm, bgColor: c.bgColor, order: c.order });
    setEditId(c.id);
  };
  const close = () => { setForm(null); setEditId(null); };

  const save = async () => {
    if (!form || !form.name.trim() || !form.searchTerm.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db, 'foodCategories', editId), { ...form });
        toast.success('Category updated');
      } else {
        await addDoc(collection(db, 'foodCategories'), { ...form });
        toast.success('Category added');
      }
      close();
    } catch (e) {
      console.error(e);
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'foodCategories', id));
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Food Categories</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            These appear as category chips on the ManaBites home screen. If none are added, default categories are shown.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadDefaults}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={seeding ? 'animate-spin' : ''} />
            {seeding ? 'Loading…' : 'Load Defaults'}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm shadow hover:opacity-90 transition"
          >
            <Plus size={16} /> Add Category
          </button>
        </div>
      </div>

      {/* Preview note */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-sm text-blue-700 dark:text-blue-300">
        <strong>How it works:</strong> Add ≥ 4 categories here and they will replace the default emoji grid on the customer home screen. Each category can have an image URL (shown instead of emoji) and a search term (what gets searched when customer taps it).
      </div>

      {/* Category list */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : cats.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="text-5xl mb-3">📂</div>
          <p className="font-black text-gray-700 dark:text-white text-lg">No custom categories yet</p>
          <p className="text-sm text-gray-400 mt-1">Default categories (Biryani, Pizza, etc.) are shown to customers.</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm">
            Add First Category
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cats.map(c => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 flex items-center gap-4"
            >
              <GripVertical size={16} className="text-gray-300 flex-shrink-0" />

              {/* Image / emoji preview */}
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                {c.imageUrl ? (
                  <img
                    src={c.imageUrl} alt={c.name}
                    className="w-full h-full object-cover"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="text-3xl">{c.emoji}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-black text-gray-900 dark:text-white truncate">{c.name}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  Search: "<span className="text-gray-600 dark:text-gray-300">{c.searchTerm}</span>" · #{c.order}
                </p>
                {c.imageUrl && (
                  <p className="text-[10px] text-blue-500 truncate mt-0.5 flex items-center gap-1">
                    <Image size={10} /> Custom image
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => openEdit(c)} className="p-2 text-gray-400 hover:text-brand rounded-lg transition-colors">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => del(c.id, c.name)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add / Edit drawer */}
      <AnimatePresence>
        {form && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) close(); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-6 space-y-4"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-black text-gray-900 dark:text-white">{editId ? 'Edit' : 'Add'} Category</h2>
                <button onClick={close} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"><X size={18} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Biryani"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm font-bold focus:border-brand outline-none text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Emoji (fallback)</label>
                  <input
                    value={form.emoji}
                    onChange={e => setForm({ ...form, emoji: e.target.value })}
                    placeholder="🍛"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-xl focus:border-brand outline-none text-center"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">
                  Image URL <span className="font-normal text-gray-400">(optional — replaces emoji on home screen)</span>
                </label>
                <input
                  value={form.imageUrl}
                  onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                  placeholder="https://images.unsplash.com/photo-..."
                  className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none text-gray-900 dark:text-white"
                />
                {form.imageUrl ? (
                  <div className="mt-2 flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <img src={form.imageUrl} alt="preview" className="w-12 h-12 rounded-xl object-cover"
                      onError={e => { (e.currentTarget as HTMLImageElement).src = ''; }} />
                    <span className="text-xs text-gray-400">Image preview</span>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Search Term *</label>
                  <input
                    value={form.searchTerm}
                    onChange={e => setForm({ ...form, searchTerm: e.target.value })}
                    placeholder="Biryani"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm font-bold focus:border-brand outline-none text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Display Order</label>
                  <input
                    type="number"
                    value={form.order}
                    onChange={e => setForm({ ...form, order: Number(e.target.value) })}
                    className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-sm font-bold focus:border-brand outline-none text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-2">Background Color</label>
                <div className="flex gap-2 flex-wrap">
                  {BG_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm({ ...form, bgColor: opt.value })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${opt.value} ${
                        form.bgColor === opt.value ? 'border-brand shadow' : 'border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={save}
                disabled={saving || !form.name.trim() || !form.searchTerm.trim()}
                className="w-full py-3 bg-brand text-white rounded-2xl font-black text-sm disabled:opacity-50 shadow"
              >
                {saving ? 'Saving…' : editId ? 'Update Category' : 'Add Category'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
