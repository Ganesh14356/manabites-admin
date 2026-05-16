import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDoc
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { uploadToImgBB } from '../../lib/imgbb';
import {
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight,
  ArrowLeft, X, Search, Image as ImageIcon, Camera
} from 'lucide-react';

const menuItemSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  description: z.string().optional(),
  price: z.string().refine(v => !isNaN(Number(v)) && Number(v) >= 0, 'Invalid price'),
  category: z.string().min(2, 'Category is required'),
  isVeg: z.boolean().optional(),
});

type MenuFormData = z.infer<typeof menuItemSchema>;

export default function MenuManagement() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [restaurantName, setRestaurantName] = useState('');
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<MenuFormData>({
    resolver: zodResolver(menuItemSchema),
  });

  useEffect(() => {
    if (!authLoading && profile?.role !== 'admin') {
      navigate('/unauthorized', { replace: true });
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    if (!restaurantId) return;

    // Fetch restaurant name
    getDoc(doc(db, 'restaurants', restaurantId)).then(snap => {
      if (snap.exists()) {
        setRestaurantName(snap.data().name);
      }
    });

    // Listen to menu items (top-level collection filtered by restaurantId)
    const q = query(
      collection(db, 'menuItems'),
      where('restaurantId', '==', restaurantId),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, snapshot => {
      setMenuItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      toast.error('Failed to load menu items');
      setLoading(false);
    });

    return () => unsub();
  }, [restaurantId]);

  const filteredItems = useMemo(() => {
    return menuItems.filter(item =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.category ?? item.categoryId ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [menuItems, searchQuery]);

  const onSubmit = async (data: MenuFormData) => {
    if (!restaurantId) return;
    setIsSubmitting(true);

    let imageUrl = editTarget?.imageUrl || '';
    if (imageFile) {
      setUploadingImage(true);
      try {
        imageUrl = await uploadToImgBB(imageFile);
      } catch {
        toast.error('Image upload failed. Please try again.');
        setIsSubmitting(false);
        setUploadingImage(false);
        return;
      }
      setUploadingImage(false);
    } else if (!previewUrl) {
      imageUrl = '';
    }

    try {
      if (editTarget) {
        await updateDoc(doc(db, 'menuItems', editTarget.id), {
          name: data.name,
          description: data.description || '',
          price: Number(data.price),
          category: data.category,
          isVeg: data.isVeg ?? false,
          imageUrl,
          updatedAt: serverTimestamp(),
        });
        toast.success('Menu item updated');
      } else {
        await addDoc(collection(db, 'menuItems'), {
          restaurantId,
          name: data.name,
          description: data.description || '',
          price: Number(data.price),
          category: data.category,
          isVeg: data.isVeg ?? false,
          imageUrl,
          isAvailable: true,
          createdAt: serverTimestamp(),
        });
        toast.success('Menu item added');
      }
      closeModal();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save menu item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (item: any) => {
    try {
      await updateDoc(doc(db, 'menuItems', item.id), {
        isAvailable: !item.isAvailable
      });
      toast.success(`Item ${item.isAvailable ? 'disabled' : 'enabled'}`);
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (item: any) => {
    try {
      await deleteDoc(doc(db, 'menuItems', item.id));
      toast.success('Item deleted successfully');
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const openEditModal = (item: any) => {
    setEditTarget(item);
    reset({
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      category: item.category,
      isVeg: item.isVeg ?? false,
    });
    setPreviewUrl(item.imageUrl || null);
    setImageFile(null);
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditTarget(null);
    setImageFile(null);
    setPreviewUrl(null);
    reset({ name: '', description: '', price: '', category: '', isVeg: false });
  };

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16">
      {/* Header */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Link to="/admin/restaurants" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-brand mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Restaurants
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
              🍽️ Menu Management
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {restaurantName ? `Managing menu for ${restaurantName}` : 'Loading...'}
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAddModal(true)}
            className="btn-primary w-auto px-5"
          >
            <Plus className="w-5 h-5" /> Add Item
          </motion.button>
        </div>
      </motion.div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search menu items..."
          className="input-field pl-10"
        />
      </div>

      {/* Menu Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading menu...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-card">
          <span className="text-5xl">🍕</span>
          <p className="mt-3 text-gray-400 font-body">No menu items found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {filteredItems.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.93, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05, duration: 0.28 }}
                whileHover={{ y: -4, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                className={`bg-white rounded-2xl shadow-card p-4 border-2 transition-colors ${
                  item.isAvailable ? 'border-transparent' : 'border-gray-200 opacity-75'
                }`}
              >
                <div className="flex gap-4">
                  {/* Image Placeholder */}
                  <div className="w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-300" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-gray-800 truncate pr-2">{item.name}</h3>
                      <span className="font-black text-brand">₹{item.price}</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2 truncate">{item.category}</p>
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">
                      {item.description || 'No description'}
                    </p>
                    
                    <div className="flex items-center justify-between mt-auto">
                      <span className={`badge ${item.isAvailable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {item.isAvailable ? 'Available' : 'Disabled'}
                      </span>
                      
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            item.isAvailable ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                          }`}
                          title={item.isAvailable ? 'Disable item' : 'Enable item'}
                        >
                          {item.isAvailable ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button
                          onClick={() => openEditModal(item)}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-lg font-black text-gray-800">
                  {editTarget ? 'Edit Menu Item' : 'Add Menu Item'}
                </h2>
                <button onClick={closeModal} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
                {/* Image upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Item Photo (Optional)</label>
                  <label className="cursor-pointer block">
                    <div className={`w-full h-36 border-2 border-dashed rounded-xl flex items-center justify-center overflow-hidden transition-colors ${previewUrl ? 'border-transparent' : 'border-gray-200 hover:border-brand'}`}>
                      {previewUrl ? (
                        <img src={previewUrl} className="w-full h-full object-cover rounded-xl" alt="preview" />
                      ) : (
                        <div className="text-center">
                          <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-xs text-gray-400">Click to upload photo</p>
                        </div>
                      )}
                    </div>
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setImageFile(file);
                      setPreviewUrl(URL.createObjectURL(file));
                    }} />
                  </label>
                  {previewUrl && (
                    <button type="button" onClick={() => { setImageFile(null); setPreviewUrl(null); }}
                      className="mt-1.5 text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                      <X className="w-3 h-3" /> Remove photo
                    </button>
                  )}
                  {uploadingImage && (
                    <p className="text-xs text-brand mt-1 flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin inline-block" />
                      Uploading...
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Item Name *</label>
                  <input {...register('name')} className={`input-field ${errors.name ? 'border-red-400' : ''}`} placeholder="Chicken Biryani" />
                  {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Price (₹) *</label>
                    <input {...register('price')} type="number" className={`input-field ${errors.price ? 'border-red-400' : ''}`} placeholder="250" />
                    {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Category *</label>
                    <input {...register('category')} className={`input-field ${errors.category ? 'border-red-400' : ''}`} placeholder="Main Course" />
                    {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                  <textarea {...register('description')} rows={3} className="input-field resize-none" placeholder="Delicious spicy chicken biryani..." />
                </div>

                {/* Veg / Non-veg */}
                <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Vegetarian</p>
                    <p className="text-xs text-gray-400">Show green dot on customer app</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" {...register('isVeg')} className="sr-only peer" />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                  </label>
                </div>

                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  whileTap={{ scale: 0.97 }}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> Saving...</>
                  ) : editTarget ? 'Save Changes' : 'Add Item'}
                </motion.button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
