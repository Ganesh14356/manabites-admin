import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { uploadToImgBB } from '../../lib/imgbb';
import { Plus, Edit2, Trash2, X, Camera, Link as LinkIcon } from 'lucide-react';
import toast from 'react-hot-toast';

type TimeSlot = 'all' | 'breakfast' | 'lunch' | 'evening' | 'dinner';

interface LunchItem {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string;
  searchTerm: string;
  subtitle: string;
  timeSlot: TimeSlot;
  order: number;
  isVeg?: boolean;
}

const SLOT_LABELS: Record<TimeSlot, { label: string; icon: string; color: string }> = {
  all:       { label: 'All Times',  icon: '🕐', color: 'bg-gray-100 text-gray-700' },
  breakfast: { label: 'Breakfast',  icon: '🌅', color: 'bg-yellow-100 text-yellow-700' },
  lunch:     { label: 'Lunch',      icon: '🍱', color: 'bg-green-100 text-green-700' },
  evening:   { label: 'Evening',    icon: '☕', color: 'bg-orange-100 text-orange-700' },
  dinner:    { label: 'Dinner',     icon: '🌙', color: 'bg-indigo-100 text-indigo-700' },
};

const EMPTY: Omit<LunchItem, 'id'> = {
  name: '', emoji: '🍱', imageUrl: '', searchTerm: '', subtitle: '', timeSlot: 'all', order: 0, isVeg: true,
};

const DEFAULTS = [
  { name: 'Biryani',     emoji: '🍛', imageUrl: '', searchTerm: 'Biryani',    subtitle: 'Most Ordered',   timeSlot: 'dinner',    order: 0 },
  { name: 'Chicken',     emoji: '🍗', imageUrl: '', searchTerm: 'Chicken',    subtitle: 'Tonight\'s Pick', timeSlot: 'dinner',    order: 1 },
  { name: 'Noodles',     emoji: '🍜', imageUrl: '', searchTerm: 'Noodles',    subtitle: 'Quick & Tasty',  timeSlot: 'dinner',    order: 2 },
  { name: 'Dal Rice',    emoji: '🍚', imageUrl: '', searchTerm: 'Dal Rice',   subtitle: 'Comfort Meal',   timeSlot: 'dinner',    order: 3 },
  { name: 'Idli',        emoji: '🥘', imageUrl: '', searchTerm: 'Idli',       subtitle: 'Morning Fresh',  timeSlot: 'breakfast', order: 0 },
  { name: 'Dosa',        emoji: '🫓', imageUrl: '', searchTerm: 'Dosa',       subtitle: 'Crispy & Hot',   timeSlot: 'breakfast', order: 1 },
  { name: 'Veg Thali',   emoji: '🍽️', imageUrl: '', searchTerm: 'Thali',      subtitle: 'Homestyle',     timeSlot: 'lunch',     order: 0 },
  { name: 'Paneer',      emoji: '🧀', imageUrl: '', searchTerm: 'Paneer',     subtitle: 'Veg Delight',   timeSlot: 'lunch',     order: 1 },
  { name: 'Samosa',      emoji: '🥟', imageUrl: '', searchTerm: 'Samosa',     subtitle: 'Evening Snack', timeSlot: 'evening',   order: 0 },
  { name: 'Tea & Coffee',emoji: '☕', imageUrl: '', searchTerm: 'Tea Coffee', subtitle: 'Refreshing',    timeSlot: 'evening',   order: 1 },
];

export default function LunchSpecials() {
  const [items, setItems]         = useState<LunchItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(false);
  const [editing, setEditing]     = useState<LunchItem | null>(null);
  const [form, setForm]           = useState<Omit<LunchItem, 'id'>>(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [seeding, setSeeding]     = useState(false);
  const [slotFilter, setSlotFilter] = useState<TimeSlot | 'all'>('all');

  // Image upload state
  const [imgFile, setImgFile]     = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput]   = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'lunchSpecials'), orderBy('order')),
      snap => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as LunchItem)));
        setLoading(false);
      },
      err => { console.error(err); setLoading(false); }
    );
    return unsub;
  }, []);

  // Clipboard paste when modal open
  useEffect(() => {
    if (!modal) return;
    const handlePaste = (e: ClipboardEvent) => {
      const imgItem = Array.from(e.clipboardData?.items || []).find(it => it.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      setImgFile(file);
      setImgPreview(URL.createObjectURL(file));
      setShowUrlInput(false);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [modal]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setImgFile(null); setImgPreview(null); setShowUrlInput(false); setUrlInput('');
    setModal(true);
  };

  const openEdit = (item: LunchItem) => {
    setEditing(item);
    setForm({ name: item.name, emoji: item.emoji, imageUrl: item.imageUrl, searchTerm: item.searchTerm, subtitle: item.subtitle, timeSlot: item.timeSlot || 'all', order: item.order, isVeg: item.isVeg !== false });
    setImgFile(null);
    setImgPreview(item.imageUrl || null);
    setShowUrlInput(false);
    setUrlInput('');
    setModal(true);
  };

  const F = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    setSaving(true);

    let imageUrl = form.imageUrl || '';
    if (imgFile) {
      setUploading(true);
      try { imageUrl = await uploadToImgBB(imgFile); }
      catch { toast.error('Image upload failed'); setSaving(false); setUploading(false); return; }
      setUploading(false);
    } else if (imgPreview && !imgFile) {
      imageUrl = imgPreview;
    } else if (!imgPreview) {
      imageUrl = '';
    }

    const payload = { ...form, imageUrl };
    try {
      if (editing) {
        await updateDoc(doc(db, 'lunchSpecials', editing.id), payload);
        toast.success('Updated!');
      } else {
        await addDoc(collection(db, 'lunchSpecials'), payload);
        toast.success('Added!');
      }
      setModal(false);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this item?')) return;
    try { await deleteDoc(doc(db, 'lunchSpecials', id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  const loadDefaults = async () => {
    if (!window.confirm('Reset all specials to defaults? This will delete existing items.')) return;
    setSeeding(true);
    try {
      const col = collection(db, 'lunchSpecials');
      const existing = await getDocs(col);
      for (const d of existing.docs) await deleteDoc(d.ref);
      for (const item of DEFAULTS) await addDoc(col, item);
      toast.success('Defaults loaded!');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSeeding(false); }
  };

  const visibleItems = slotFilter === 'all' ? items : items.filter(i => (i.timeSlot || 'all') === slotFilter);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Time-Based Specials</h1>
          <p className="text-sm text-gray-500 mt-0.5">Breakfast · Lunch · Evening · Dinner items shown on home screen</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadDefaults} disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {seeding ? '⏳' : '🔄'} Defaults
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold hover:opacity-90">
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {/* Slot filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'breakfast', 'lunch', 'evening', 'dinner'] as const).map(slot => {
          const cfg = slot === 'all' ? { icon: '🕐', label: 'All' } : SLOT_LABELS[slot];
          const count = slot === 'all' ? items.length : items.filter(i => (i.timeSlot || 'all') === slot).length;
          return (
            <button key={slot} onClick={() => setSlotFilter(slot)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${slotFilter === slot ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:border-brand/40'}`}>
              {cfg.icon} {cfg.label} <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Info */}
      <div className="bg-blue-50 rounded-2xl p-4 text-sm text-blue-700 font-medium">
        Each item shows only during its assigned time slot. Set <strong>Time Slot</strong> correctly — e.g. Biryani → Dinner, Idli → Breakfast.
      </div>

      {/* Items list */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">🍱</div>
          <p className="font-black text-gray-800">No items for this time slot</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm">Add Item</button>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleItems.map(item => {
            const slotCfg = SLOT_LABELS[item.timeSlot || 'all'];
            return (
              <motion.div key={item.id} layout
                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-amber-50 flex-shrink-0 flex items-center justify-center">
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    : <span className="text-3xl">{item.emoji}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className={`w-3.5 h-3.5 rounded-sm border-2 flex-shrink-0 flex items-center justify-center ${item.isVeg !== false ? 'border-green-600' : 'border-red-600'}`}>
                      <div className={`w-2 h-2 rounded-full ${item.isVeg !== false ? 'bg-green-600' : 'bg-red-600'}`} />
                    </div>
                    <p className="font-black text-gray-900 dark:text-white truncate">{item.name}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${slotCfg?.color || 'bg-gray-100 text-gray-600'}`}>
                      {slotCfg?.icon} {slotCfg?.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{item.subtitle} · Search: "{item.searchTerm || item.name}"</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(item)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><Edit2 size={15} /></button>
                  <button onClick={() => remove(item.id)} className="p-2 rounded-xl hover:bg-red-50 text-red-500"><Trash2 size={15} /></button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => e.target === e.currentTarget && setModal(false)}>
            <motion.div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}>

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black">{editing ? 'Edit Item' : 'Add Special'}</h2>
                <button onClick={() => setModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X size={18} /></button>
              </div>

              <div className="space-y-4">

                {/* Image upload */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Photo</label>
                  <label className="cursor-pointer block">
                    <div className={`w-full h-32 border-2 border-dashed rounded-2xl flex items-center justify-center overflow-hidden transition-colors ${imgPreview ? 'border-transparent' : 'border-gray-200 hover:border-brand'}`}>
                      {imgPreview
                        ? <img src={imgPreview} className="w-full h-full object-cover rounded-2xl" alt="preview" />
                        : <div className="text-center">
                            <Camera className="w-8 h-8 text-gray-300 mx-auto mb-1.5" />
                            <p className="text-xs font-semibold text-gray-400">Click to upload</p>
                            <p className="text-[10px] text-gray-300 mt-0.5">or Ctrl+V to paste</p>
                          </div>
                      }
                    </div>
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setImgFile(file);
                      setImgPreview(URL.createObjectURL(file));
                      setShowUrlInput(false);
                    }} />
                  </label>

                  <AnimatePresence>
                    {!showUrlInput ? (
                      <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setShowUrlInput(true)}
                        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-brand bg-gray-50 hover:bg-brand/5 border border-gray-200 hover:border-brand/30 px-3 py-1.5 rounded-lg transition-all">
                        <LinkIcon className="w-3 h-3" /> Paste image link
                      </motion.button>
                    ) : (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="mt-2 flex gap-2 overflow-hidden">
                        <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (urlInput.trim()) { setImgPreview(urlInput.trim()); setImgFile(null); setShowUrlInput(false); setUrlInput(''); }}}}
                          placeholder="https://example.com/image.jpg"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:border-brand" autoFocus />
                        <button type="button" disabled={!urlInput.trim()}
                          onClick={() => { const url = urlInput.trim(); if (url) { setImgPreview(url); setImgFile(null); setShowUrlInput(false); setUrlInput(''); }}}
                          className="px-3 py-2 bg-brand text-white text-xs font-bold rounded-lg disabled:opacity-40">Use</button>
                        <button type="button" onClick={() => { setShowUrlInput(false); setUrlInput(''); }}
                          className="px-2 py-2 bg-gray-100 text-gray-500 rounded-lg"><X className="w-3.5 h-3.5" /></button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {imgPreview && (
                    <button type="button" onClick={() => { setImgFile(null); setImgPreview(null); F('imageUrl', ''); }}
                      className="mt-1.5 text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                      <X className="w-3 h-3" /> Remove photo
                    </button>
                  )}
                  {uploading && (
                    <p className="text-xs text-brand mt-1 flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin inline-block" /> Uploading...
                    </p>
                  )}
                </div>

                {/* Time Slot */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Time Slot *</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(['all', 'breakfast', 'lunch', 'evening', 'dinner'] as TimeSlot[]).map(slot => {
                      const cfg = SLOT_LABELS[slot];
                      return (
                        <button key={slot} type="button" onClick={() => F('timeSlot', slot)}
                          className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-[10px] font-bold transition-all ${form.timeSlot === slot ? 'bg-brand text-white border-brand' : 'border-gray-200 text-gray-500 hover:border-brand/40'}`}>
                          <span className="text-lg">{cfg.icon}</span>
                          <span>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Veg / Non-Veg */}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => F('isVeg', true)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${form.isVeg !== false ? 'bg-green-50 border-green-500 text-green-700' : 'border-gray-200 text-gray-400 hover:border-green-200'}`}>
                      <div className="w-4 h-4 rounded-sm border-2 border-green-600 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                      </div>
                      Veg
                    </button>
                    <button type="button" onClick={() => F('isVeg', false)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${form.isVeg === false ? 'bg-red-50 border-red-500 text-red-700' : 'border-gray-200 text-gray-400 hover:border-red-200'}`}>
                      <div className="w-4 h-4 rounded-sm border-2 border-red-600 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                      </div>
                      Non-Veg
                    </button>
                  </div>
                </div>

                {/* Name + Emoji */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Emoji</label>
                    <input value={form.emoji} onChange={e => F('emoji', e.target.value)}
                      className="w-full mt-1 p-2 border rounded-xl text-center text-2xl dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs font-bold text-gray-500 uppercase">Name *</label>
                    <input value={form.name} onChange={e => F('name', e.target.value)} placeholder="e.g. Chicken Biryani"
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm font-medium dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Subtitle</label>
                  <input value={form.subtitle} onChange={e => F('subtitle', e.target.value)} placeholder="e.g. Tonight's Pick"
                    className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Search Term</label>
                    <input value={form.searchTerm} onChange={e => F('searchTerm', e.target.value)} placeholder="e.g. Biryani"
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Display Order</label>
                    <input type="number" value={form.order} onChange={e => F('order', Number(e.target.value))}
                      className="w-full mt-1 p-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">Cancel</button>
                <button onClick={save} disabled={saving || uploading}
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
