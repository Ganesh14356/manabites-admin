import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, Edit2, Trash2, X, Image, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';

interface TrendingItem {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string;
  searchTerm: string;
  count: number;
  order: number;
}

const EMPTY: Omit<TrendingItem, 'id'> = {
  name: '', emoji: '🍽️', imageUrl: '', searchTerm: '', count: 0, order: 0,
};

const DEFAULTS = [
  { name: 'Chicken Biryani', emoji: '🍛', imageUrl: '', searchTerm: 'Biryani',    count: 120, order: 0 },
  { name: 'Pizza',           emoji: '🍕', imageUrl: '', searchTerm: 'Pizza',       count: 98,  order: 1 },
  { name: 'Burger',          emoji: '🍔', imageUrl: '', searchTerm: 'Burger',      count: 87,  order: 2 },
  { name: 'Dosa',            emoji: '🥞', imageUrl: '', searchTerm: 'Dosa',        count: 76,  order: 3 },
  { name: 'Chinese',         emoji: '🥡', imageUrl: '', searchTerm: 'Chinese',     count: 65,  order: 4 },
  { name: 'Paneer',          emoji: '🧀', imageUrl: '', searchTerm: 'Paneer',      count: 54,  order: 5 },
  { name: 'Noodles',         emoji: '🍜', imageUrl: '', searchTerm: 'Noodles',     count: 43,  order: 6 },
  { name: 'Fried Rice',      emoji: '🍚', imageUrl: '', searchTerm: 'Fried Rice',  count: 38,  order: 7 },
];

export default function TrendingItems() {
  const [items, setItems]     = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState<TrendingItem | null>(null);
  const [form, setForm]       = useState<Omit<TrendingItem, 'id'>>(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'trendingItems'), orderBy('order')),
      snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as TrendingItem))); setLoading(false); },
      err  => { console.error(err); setLoading(false); }
    );
    return unsub;
  }, []);

  const openAdd  = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (item: TrendingItem) => {
    setEditing(item);
    setForm({ name: item.name, emoji: item.emoji, imageUrl: item.imageUrl, searchTerm: item.searchTerm, count: item.count, order: item.order });
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'trendingItems', editing.id), { ...form });
        toast.success('Updated!');
      } else {
        await addDoc(collection(db, 'trendingItems'), { ...form });
        toast.success('Added!');
      }
      setModal(false);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this trending item?')) return;
    try { await deleteDoc(doc(db, 'trendingItems', id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  const loadDefaults = async () => {
    if (!window.confirm('Load 8 default trending items? Existing items will NOT be deleted.')) return;
    setSeeding(true);
    try {
      for (const item of DEFAULTS) await addDoc(collection(db, 'trendingItems'), item);
      toast.success('Defaults loaded!');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSeeding(false); }
  };

  const F = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp size={22} className="text-orange-500" /> Trending This Week
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">These appear as the "Trending This Week" scroll section on the home screen.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadDefaults} disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {seeding ? '⏳' : '🔄'} Load Defaults
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:opacity-90">
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      <div className="bg-orange-50 dark:bg-orange-900/20 rounded-2xl p-4 text-sm text-orange-700 dark:text-orange-300 font-medium">
        <strong>How it works:</strong> Items here override the auto-generated trending (from orders data). If you add ≥ 4 items, those show as "Trending This Week" on the home screen. Set "Count" to show as "{'{'}count{'}'} orders". Items are sorted by <strong>Display Order</strong> (lower = first).
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">🔥</div>
          <p className="font-black text-gray-800 dark:text-white">No trending items yet</p>
          <p className="text-sm text-gray-500 mt-1">Click "Load Defaults" or add items manually. The home screen shows auto-generated trending until you add ≥ 4 items here.</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm">Add First Item</button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <motion.div key={item.id} layout
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-xs font-black text-orange-600 flex-shrink-0">
                #{idx + 1}
              </div>
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-orange-50 flex-shrink-0 flex items-center justify-center">
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  : <span className="text-xl">{item.emoji}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-gray-900 dark:text-white truncate">{item.name}</p>
                <p className="text-xs text-gray-400">Search: "{item.searchTerm || item.name}" · {item.count}+ orders · Order: {item.order}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(item)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><Edit2 size={15} /></button>
                <button onClick={() => remove(item.id)} className="p-2 rounded-xl hover:bg-red-50 text-red-500"><Trash2 size={15} /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => e.target === e.currentTarget && setModal(false)}>
            <motion.div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-6 space-y-4 shadow-2xl"
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black">{editing ? 'Edit Trending Item' : 'Add Trending Item'}</h2>
                <button onClick={() => setModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X size={18} /></button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Emoji</label>
                    <input value={form.emoji} onChange={e => F('emoji', e.target.value)}
                      className="w-full mt-1 p-2 border rounded-xl text-center text-2xl" />
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs font-bold text-gray-500 uppercase">Name *</label>
                    <input value={form.name} onChange={e => F('name', e.target.value)} placeholder="e.g. Chicken Biryani"
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm font-medium dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1"><Image size={11} /> Image URL</label>
                  <input value={form.imageUrl} onChange={e => F('imageUrl', e.target.value)} placeholder="https://..."
                    className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  {form.imageUrl && <img src={form.imageUrl} alt="preview" className="mt-2 h-20 w-full object-cover rounded-xl" />}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Search Term</label>
                    <input value={form.searchTerm} onChange={e => F('searchTerm', e.target.value)} placeholder="e.g. Biryani"
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Count</label>
                    <input type="number" value={form.count} onChange={e => F('count', Number(e.target.value))} placeholder="120"
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Order</label>
                    <input type="number" value={form.order} onChange={e => F('order', Number(e.target.value))}
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50">
                  {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
