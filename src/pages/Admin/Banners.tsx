import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection, onSnapshot, query, orderBy,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, Image } from 'lucide-react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

interface Banner {
  id: string;
  title: string;
  subtitle: string;
  code: string;
  emoji: string;
  gradient: string;
  isActive: boolean;
  order: number;
  createdAt: any;
}

const GRADIENT_OPTIONS = [
  { label: 'Green',  value: 'from-green-500 to-emerald-700' },
  { label: 'Orange', value: 'from-orange-400 to-red-500' },
  { label: 'Purple', value: 'from-purple-500 to-indigo-600' },
  { label: 'Pink',   value: 'from-pink-500 to-rose-600' },
  { label: 'Blue',   value: 'from-blue-500 to-cyan-600' },
  { label: 'Yellow', value: 'from-yellow-400 to-orange-500' },
];

const EMOJI_OPTIONS = ['🎉', '🛵', '🌟', '🍕', '🔥', '💰', '🎁', '🍔', '🍜', '🥗'];

type FormData = {
  title: string;
  subtitle: string;
  code: string;
  emoji: string;
  gradient: string;
  order: string;
};

export default function Banners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Banner | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: { gradient: GRADIENT_OPTIONS[0].value, emoji: '🎉', order: '0' },
  });

  const watchGradient = watch('gradient');
  const watchEmoji = watch('emoji');
  const watchTitle = watch('title');
  const watchSubtitle = watch('subtitle');
  const watchCode = watch('code');

  useEffect(() => {
    const q = query(collection(db, 'banners'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setBanners(snap.docs.map(d => ({ id: d.id, ...d.data() } as Banner)));
      setLoading(false);
    }, () => { toast.error('Failed to load banners'); setLoading(false); });
    return () => unsub();
  }, []);

  const openAdd = () => {
    setEditTarget(null);
    reset({ title: '', subtitle: '', code: '', emoji: '🎉', gradient: GRADIENT_OPTIONS[0].value, order: String(banners.length) });
    setShowModal(true);
  };

  const openEdit = (b: Banner) => {
    setEditTarget(b);
    reset({ title: b.title, subtitle: b.subtitle, code: b.code || '', emoji: b.emoji, gradient: b.gradient, order: String(b.order) });
    setShowModal(true);
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const payload = {
        title: data.title.trim(),
        subtitle: data.subtitle.trim(),
        code: data.code.trim().toUpperCase(),
        emoji: data.emoji,
        gradient: data.gradient,
        order: parseInt(data.order) || 0,
        isActive: editTarget?.isActive ?? true,
      };
      if (editTarget) {
        await updateDoc(doc(db, 'banners', editTarget.id), payload);
        toast.success('Banner updated!');
      } else {
        await addDoc(collection(db, 'banners'), { ...payload, createdAt: serverTimestamp() });
        toast.success('Banner created!');
      }
      setShowModal(false);
    } catch {
      toast.error('Failed to save banner');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleActive = async (b: Banner) => {
    try {
      await updateDoc(doc(db, 'banners', b.id), { isActive: !b.isActive });
      toast.success(b.isActive ? 'Banner hidden' : 'Banner shown');
    } catch {
      toast.error('Failed to update banner');
    }
  };

  const deleteBanner = async (b: Banner) => {
    if (!confirm(`Delete "${b.title}"?`)) return;
    try {
      await deleteDoc(doc(db, 'banners', b.id));
      toast.success('Banner deleted');
    } catch {
      toast.error('Failed to delete banner');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div
        className="flex items-center justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-900">Offer Banners</h1>
          <p className="text-sm text-gray-500 mt-0.5">Banners shown in the home page carousel</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={openAdd}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Banner
        </motion.button>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : banners.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎨</div>
          <h3 className="text-lg font-black text-gray-700">No banners yet</h3>
          <p className="text-sm text-gray-400 mt-1">Add your first offer banner to show on the home screen</p>
          <button onClick={openAdd} className="btn-primary mt-4">Add Banner</button>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b, i) => (
            <motion.div
              key={b.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.28 }}
              whileHover={{ scale: 1.01, boxShadow: '0 6px 20px rgba(0,0,0,0.07)' }}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4"
            >
              {/* Preview */}
              <div className={`w-14 h-14 bg-gradient-to-br ${b.gradient} rounded-2xl flex items-center justify-center text-2xl flex-shrink-0`}>
                {b.emoji}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-black text-gray-900 text-sm truncate">{b.title}</p>
                  {!b.isActive && <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Hidden</span>}
                </div>
                <p className="text-xs text-gray-500 truncate">{b.subtitle}</p>
                {b.code && <span className="text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full mt-0.5 inline-block">{b.code}</span>}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleActive(b)} className="p-2 text-gray-400 hover:text-brand transition-colors" title={b.isActive ? 'Hide' : 'Show'}>
                  {b.isActive ? <ToggleRight className="w-5 h-5 text-brand" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => openEdit(b)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => deleteBanner(b)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowModal(false)} />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-black text-gray-800">{editTarget ? 'Edit Banner' : 'New Banner'}</h2>
                <button onClick={() => setShowModal(false)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
                {/* Live preview */}
                <div className={`h-28 bg-gradient-to-br ${watchGradient} rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden`}>
                  <span className="absolute -right-3 -bottom-3 text-7xl opacity-20 rotate-12">{watchEmoji}</span>
                  <p className="text-white text-[10px] font-black uppercase tracking-widest opacity-80">{watchSubtitle || 'Subtitle'}</p>
                  <p className="text-white text-xl font-black">{watchTitle || 'Offer Title'}</p>
                  {watchCode && (
                    <span className="text-[9px] font-black text-white/80 border border-dashed border-white/50 px-2 py-0.5 rounded w-fit">
                      {watchCode}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Offer Title *</label>
                  <input {...register('title', { required: true })}
                    placeholder="50% OFF up to ₹100"
                    className={`input-field ${errors.title ? 'border-red-400' : ''}`} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtitle *</label>
                  <input {...register('subtitle', { required: true })}
                    placeholder="First order special"
                    className={`input-field ${errors.subtitle ? 'border-red-400' : ''}`} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Coupon Code (optional)</label>
                  <input {...register('code')} placeholder="NEWUSER50" className="input-field" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Emoji</label>
                  <div className="flex gap-2 flex-wrap">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} type="button"
                        onClick={() => setValue('emoji', e)}
                        className={`w-10 h-10 text-xl rounded-xl border-2 transition-all ${watchEmoji === e ? 'border-brand bg-brand/10' : 'border-gray-100 hover:border-gray-300'}`}
                      >{e}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Color</label>
                  <div className="grid grid-cols-3 gap-2">
                    {GRADIENT_OPTIONS.map(g => (
                      <button key={g.value} type="button"
                        onClick={() => setValue('gradient', g.value)}
                        className={`h-10 bg-gradient-to-r ${g.value} rounded-xl border-2 transition-all ${watchGradient === g.value ? 'border-gray-900 scale-105' : 'border-transparent'}`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Display Order</label>
                  <input {...register('order')} type="number" min="0" placeholder="0" className="input-field" />
                  <p className="text-xs text-gray-400 mt-1">Lower number = shown first</p>
                </div>

                <button type="submit" disabled={isSubmitting}
                  className="btn-primary w-full disabled:opacity-60 flex items-center justify-center gap-2">
                  {isSubmitting ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : editTarget ? 'Save Changes' : 'Create Banner'}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
