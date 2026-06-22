import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Store, Plus, Edit2, Trash2, Check, X,
  Phone, Clock, ShoppingBag, ToggleLeft, ToggleRight,
} from 'lucide-react';

interface GroceryStore {
  id: string;
  name: string;
  area: string;
  city: string;
  phone: string;
  deliveryTime: number;
  minOrder: number;
  isActive: boolean;
  createdAt: any;
}

interface FormState {
  name: string;
  area: string;
  city: string;
  phone: string;
  deliveryTime: string;
  minOrder: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  area: '',
  city: '',
  phone: '',
  deliveryTime: '15',
  minOrder: '99',
};

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded-lg animate-pulse" style={{ width: i === 0 ? '70%' : '60%' }} />
        </td>
      ))}
    </tr>
  );
}

export default function GroceryStores() {
  const [stores, setStores] = useState<GroceryStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<GroceryStore | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'groceryStores'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setStores(snap.docs.map(d => ({ id: d.id, ...d.data() } as GroceryStore)));
      setLoading(false);
    }, () => {
      toast.error('Failed to load grocery stores');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const openAdd = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (store: GroceryStore) => {
    setEditTarget(store);
    setForm({
      name: store.name,
      area: store.area,
      city: store.city,
      phone: store.phone,
      deliveryTime: String(store.deliveryTime),
      minOrder: String(store.minOrder),
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Store name is required'); return; }
    if (!form.area.trim()) { toast.error('Area is required'); return; }
    if (!form.city.trim()) { toast.error('City is required'); return; }
    const deliveryTime = Number(form.deliveryTime);
    const minOrder = Number(form.minOrder);
    if (!deliveryTime || deliveryTime <= 0) { toast.error('Enter a valid delivery time'); return; }
    if (isNaN(minOrder) || minOrder < 0) { toast.error('Enter a valid minimum order'); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        area: form.area.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        deliveryTime,
        minOrder,
        updatedAt: serverTimestamp(),
      };

      if (editTarget) {
        await updateDoc(doc(db, 'groceryStores', editTarget.id), payload);
        toast.success('Store updated');
      } else {
        await addDoc(collection(db, 'groceryStores'), {
          ...payload,
          isActive: true,
          createdAt: serverTimestamp(),
        });
        toast.success('Store added');
      }
      setShowModal(false);
    } catch {
      toast.error('Failed to save store');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (store: GroceryStore) => {
    try {
      await updateDoc(doc(db, 'groceryStores', store.id), { isActive: !store.isActive });
      toast.success(`Store ${!store.isActive ? 'activated' : 'deactivated'}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'groceryStores', id));
      toast.success('Store deleted');
      setDeleteConfirmId(null);
    } catch {
      toast.error('Failed to delete store');
    }
  };

  const f = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between mb-8"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-900">🛒 Grocery Stores</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage dark stores and warehouses</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={openAdd}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Store
        </motion.button>
      </motion.div>

      {/* Table Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Store Name</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Area / City</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Delivery</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Min Order</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : stores.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <span className="text-5xl mb-3">🏪</span>
                      <p className="font-bold text-gray-500">No stores yet</p>
                      <p className="text-xs mt-1">Click "+ Add Store" to create your first dark store</p>
                    </div>
                  </td>
                </tr>
              ) : (
                stores.map((store, i) => (
                  <AnimatePresence key={store.id}>
                    {deleteConfirmId === store.id ? (
                      <motion.tr
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-b border-red-100 bg-red-50"
                      >
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-red-700">
                              Delete <span className="underline">{store.name}</span>? This cannot be undone.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDelete(store.id)}
                                className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" /> Confirm Delete
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <X className="w-3.5 h-3.5" /> Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    ) : (
                      <motion.tr
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors"
                      >
                        {/* Store Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Store className="w-4 h-4 text-orange-500" />
                            </div>
                            <span className="font-bold text-gray-800">{store.name}</span>
                          </div>
                        </td>

                        {/* Area / City */}
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-700">{store.area}</p>
                          <p className="text-xs text-gray-400">{store.city}</p>
                        </td>

                        {/* Phone */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <Phone className="w-3.5 h-3.5 text-gray-400" />
                            <span>{store.phone || '—'}</span>
                          </div>
                        </td>

                        {/* Delivery Time */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            <span>{store.deliveryTime} min</span>
                          </div>
                        </td>

                        {/* Min Order */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <ShoppingBag className="w-3.5 h-3.5 text-gray-400" />
                            <span>₹{store.minOrder}</span>
                          </div>
                        </td>

                        {/* Status Toggle */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleStatus(store)}
                            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${
                              store.isActive
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {store.isActive
                              ? <><ToggleRight className="w-3.5 h-3.5" /> Active</>
                              : <><ToggleLeft className="w-3.5 h-3.5" /> Inactive</>
                            }
                          </button>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEdit(store)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(store.id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <h2 className="font-black text-gray-900 text-lg">
                  {editTarget ? 'Edit Store' : 'Add Store'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4">
                {/* Store Name */}
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    Store Name *
                  </label>
                  <input
                    {...f('name')}
                    placeholder="e.g. ManaBites Dark Store — Kukatpally"
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                  />
                </div>

                {/* Area + City */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Area / Locality *
                    </label>
                    <input
                      {...f('area')}
                      placeholder="Kukatpally"
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      City *
                    </label>
                    <input
                      {...f('city')}
                      placeholder="Hyderabad"
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    Phone Number
                  </label>
                  <input
                    {...f('phone')}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                  />
                </div>

                {/* Delivery Time + Min Order */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Delivery Time (min)
                    </label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        {...f('deliveryTime')}
                        type="number"
                        min="1"
                        placeholder="15"
                        className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 pl-9 pr-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Min Order (₹)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">₹</span>
                      <input
                        {...f('minOrder')}
                        type="number"
                        min="0"
                        placeholder="99"
                        className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 pl-8 pr-4 py-3 text-sm font-bold text-gray-800 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex gap-3 px-6 pb-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 rounded-xl border-2 border-gray-100 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><Check className="w-4 h-4" /> {editTarget ? 'Update Store' : 'Save Store'}</>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
