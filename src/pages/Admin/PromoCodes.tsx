import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, Tag } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';

interface PromoCode {
  id: string;
  code: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  minOrderValue: number;
  maxDiscount?: number;
  isActive: boolean;
  validUntil?: any;
  createdAt: any;
}

const promoSchema = z.object({
  code: z.string().min(3).max(20).toUpperCase(),
  discountType: z.enum(['percentage', 'flat']),
  discountValue: z.string().refine(v => !isNaN(Number(v)) && Number(v) > 0, 'Must be positive'),
  minOrderValue: z.string().refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Must be 0 or more'),
  maxDiscount: z.string().optional(),
  validUntil: z.string().optional(),
});

type PromoFormData = z.infer<typeof promoSchema>;

export default function PromoCodes() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<PromoCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PromoFormData>({
    resolver: zodResolver(promoSchema),
    defaultValues: { discountType: 'percentage' }
  });

  const discountType = watch('discountType');

  useEffect(() => {
    const q = query(collection(db, 'promocodes'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snapshot => {
      setPromos(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PromoCode)));
      setLoading(false);
    }, error => {
      console.error("Error fetching promo codes:", error);
      toast.error("Failed to load promo codes");
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const openAdd = () => {
    setEditTarget(null);
    reset({ code: '', discountType: 'percentage', discountValue: '', minOrderValue: '0', maxDiscount: '', validUntil: '' });
    setShowModal(true);
  };

  const openEdit = (promo: PromoCode) => {
    setEditTarget(promo);
    reset({
      code: promo.code,
      discountType: promo.discountType,
      discountValue: (promo.discountValue || 0).toString(),
      minOrderValue: (promo.minOrderValue || 0).toString(),
      maxDiscount: promo.maxDiscount?.toString() || '',
      validUntil: promo.validUntil 
        ? (typeof promo.validUntil.toDate === 'function' 
            ? new Date(promo.validUntil.toDate()).toISOString().split('T')[0] 
            : new Date(promo.validUntil).toISOString().split('T')[0])
        : '',
    });
    setShowModal(true);
  };

  const onSubmit = async (data: PromoFormData) => {
    setIsSubmitting(true);
    try {
      const payload = {
        code: data.code.toUpperCase(),
        discountType: data.discountType,
        discountValue: Number(data.discountValue),
        minOrderValue: Number(data.minOrderValue),
        maxDiscount: data.maxDiscount ? Number(data.maxDiscount) : null,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
      };

      if (editTarget) {
        await updateDoc(doc(db, 'promocodes', editTarget.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        toast.success('Promo code updated');
      } else {
        await addDoc(collection(db, 'promocodes'), {
          ...payload,
          isActive: true,
          createdAt: serverTimestamp(),
        });
        toast.success('Promo code added');
      }
      setShowModal(false);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (promo: PromoCode) => {
    try {
      await updateDoc(doc(db, 'promocodes', promo.id), { isActive: !promo.isActive });
      toast.success(`Promo code ${!promo.isActive ? 'activated' : 'deactivated'}`);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const deletePromo = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'promocodes', id));
      toast.success('Promo code deleted');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Promo Codes</h1>
          <p className="text-gray-500 text-sm mt-1">Manage discounts and offers</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Promo Code
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {promos.map(promo => (
            <motion.div
              key={promo.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white rounded-2xl shadow-card p-5 border-l-4 ${promo.isActive ? 'border-green-500' : 'border-gray-300'}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-brand/10 rounded-lg flex items-center justify-center">
                    <Tag className="w-4 h-4 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg tracking-wide">{promo.code}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${promo.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {promo.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(promo)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => deletePromo(promo.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  <span className="font-semibold text-gray-800">Discount:</span>{' '}
                  {promo.discountType === 'percentage' ? `${promo.discountValue}%` : `₹${promo.discountValue}`}
                </p>
                <p>
                  <span className="font-semibold text-gray-800">Min Order:</span> ₹{promo.minOrderValue}
                </p>
                {promo.maxDiscount && (
                  <p>
                    <span className="font-semibold text-gray-800">Max Discount:</span> ₹{promo.maxDiscount}
                  </p>
                )}
                {promo.validUntil && (
                  <p>
                    <span className="font-semibold text-gray-800">Valid Until:</span>{' '}
                    {typeof promo.validUntil.toDate === 'function' 
                      ? new Date(promo.validUntil.toDate()).toLocaleDateString() 
                      : new Date(promo.validUntil).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => toggleStatus(promo)}
                  className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg ${
                    promo.isActive ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-green-600 bg-green-50 hover:bg-green-100'
                  }`}
                >
                  {promo.isActive ? <><ToggleRight className="w-4 h-4" /> Deactivate</> : <><ToggleLeft className="w-4 h-4" /> Activate</>}
                </button>
              </div>
            </motion.div>
          ))}
          {promos.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              No promo codes found. Create one to get started.
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h2 className="font-bold text-gray-800">{editTarget ? 'Edit Promo Code' : 'Add Promo Code'}</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Code</label>
                  <input {...register('code')} className="input-field uppercase" placeholder="SUMMER50" />
                  {errors.code && <p className="text-red-500 text-xs mt-1">{errors.code.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Type</label>
                    <select {...register('discountType')} className="input-field">
                      <option value="percentage">Percentage (%)</option>
                      <option value="flat">Flat Amount (₹)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Value</label>
                    <input {...register('discountValue')} type="number" className="input-field" placeholder="50" />
                    {errors.discountValue && <p className="text-red-500 text-xs mt-1">{errors.discountValue.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Min Order (₹)</label>
                    <input {...register('minOrderValue')} type="number" className="input-field" placeholder="200" />
                    {errors.minOrderValue && <p className="text-red-500 text-xs mt-1">{errors.minOrderValue.message}</p>}
                  </div>
                  {discountType === 'percentage' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Max Discount (₹)</label>
                      <input {...register('maxDiscount')} type="number" className="input-field" placeholder="100" />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Valid Until (Optional)</label>
                  <input {...register('validUntil')} type="date" className="input-field" />
                </div>

                <div className="pt-4">
                  <button type="submit" disabled={isSubmitting} className="btn-primary w-full flex justify-center">
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Save Promo Code'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
