import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Plus, Edit2, Trash2, Check, X,
  ToggleLeft, ToggleRight, Package, Tag, Percent,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface GroceryProduct {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  mrp: number;
  unit: string;
  image: string;
  stock: number;
  isActive: boolean;
  storeId: string;
  createdAt: any;
}

interface FormState {
  name: string;
  category: string;
  brand: string;
  price: string;
  mrp: string;
  unit: string;
  image: string;
  stock: string;
  storeId: string;
}

// ── Constants ─────────────────────────────────────────────────────

const CATEGORIES = [
  'Fruits & Veg',
  'Dairy & Eggs',
  'Snacks',
  'Beverages',
  'Staples',
  'Personal Care',
  'Household',
  'Baby',
  'Frozen',
  'Bakery',
];

const CATEGORY_EMOJIS: Record<string, string> = {
  'Fruits & Veg': '🥦',
  'Dairy & Eggs': '🥛',
  'Snacks': '🍿',
  'Beverages': '🧃',
  'Staples': '🌾',
  'Personal Care': '🧴',
  'Household': '🧹',
  'Baby': '🍼',
  'Frozen': '🧊',
  'Bakery': '🥐',
};

const EMPTY_FORM: FormState = {
  name: '',
  category: CATEGORIES[0],
  brand: '',
  price: '',
  mrp: '',
  unit: '',
  image: '',
  stock: '0',
  storeId: '',
};

// ── Helpers ───────────────────────────────────────────────────────

function calcDiscount(mrp: number, price: number): number | null {
  if (!mrp || !price || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 bg-gray-100 rounded-lg animate-pulse"
            style={{ width: i === 0 ? '40px' : i === 1 ? '70%' : '55%' }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function GroceryProducts() {
  const [products, setProducts] = useState<GroceryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<GroceryProduct | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'groceryProducts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GroceryProduct)));
      setLoading(false);
    }, () => {
      toast.error('Failed to load products');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (activeCategory === 'All') return products;
    return products.filter(p => p.category === activeCategory);
  }, [products, activeCategory]);

  const openAdd = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (product: GroceryProduct) => {
    setEditTarget(product);
    setForm({
      name: product.name,
      category: product.category,
      brand: product.brand || '',
      price: String(product.price),
      mrp: String(product.mrp),
      unit: product.unit,
      image: product.image || '',
      stock: String(product.stock),
      storeId: product.storeId || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    const price = Number(form.price);
    const mrp = Number(form.mrp);
    const stock = Number(form.stock);
    if (!price || price <= 0) { toast.error('Enter a valid selling price'); return; }
    if (!mrp || mrp <= 0) { toast.error('Enter a valid MRP'); return; }
    if (!form.unit.trim()) { toast.error('Unit is required (e.g. 500g, 1L)'); return; }
    if (isNaN(stock) || stock < 0) { toast.error('Enter a valid stock quantity'); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        brand: form.brand.trim(),
        price,
        mrp,
        unit: form.unit.trim(),
        image: form.image.trim(),
        stock,
        storeId: form.storeId.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editTarget) {
        await updateDoc(doc(db, 'groceryProducts', editTarget.id), payload);
        toast.success('Product updated');
      } else {
        await addDoc(collection(db, 'groceryProducts'), {
          ...payload,
          isActive: true,
          createdAt: serverTimestamp(),
        });
        toast.success('Product added');
      }
      setShowModal(false);
    } catch {
      toast.error('Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (product: GroceryProduct) => {
    try {
      await updateDoc(doc(db, 'groceryProducts', product.id), { isActive: !product.isActive });
      toast.success(`Product ${!product.isActive ? 'activated' : 'deactivated'}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'groceryProducts', id));
      toast.success('Product deleted');
      setDeleteConfirmId(null);
    } catch {
      toast.error('Failed to delete product');
    }
  };

  const setField = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between mb-6"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-2xl font-black text-gray-900">🥦 Grocery Products</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${products.length} product${products.length !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={openAdd}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Product
        </motion.button>
      </motion.div>

      {/* Category Filter Chips */}
      <div className="flex gap-2 flex-wrap mb-6">
        {['All', ...CATEGORIES].map(cat => (
          <motion.button
            key={cat}
            whileTap={{ scale: 0.95 }}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeCategory === cat
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600'
            }`}
          >
            {cat !== 'All' && <span className="mr-1">{CATEGORY_EMOJIS[cat]}</span>}
            {cat}
            {cat !== 'All' && activeCategory !== cat && (
              <span className="ml-1 text-gray-400 text-[10px]">
                ({products.filter(p => p.category === cat).length})
              </span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider w-12">Image</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Name / Brand</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Category</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Price / MRP</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Unit</th>
                <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-wider">Stock</th>
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
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <span className="text-5xl mb-3">🛒</span>
                      <p className="font-bold text-gray-500">No products found</p>
                      <p className="text-xs mt-1">
                        {activeCategory !== 'All'
                          ? `No products in "${activeCategory}". Try a different category.`
                          : 'Click "+ Add Product" to add your first product.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((product, i) => {
                  const discount = calcDiscount(product.mrp, product.price);
                  return (
                    <AnimatePresence key={product.id}>
                      {deleteConfirmId === product.id ? (
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-red-100 bg-red-50"
                        >
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-bold text-red-700">
                                Delete <span className="underline">{product.name}</span>? This cannot be undone.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleDelete(product.id)}
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
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors"
                        >
                          {/* Image */}
                          <td className="px-4 py-3">
                            {product.image ? (
                              <img
                                src={product.image}
                                alt={product.name}
                                className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-lg">
                                {CATEGORY_EMOJIS[product.category] ?? '📦'}
                              </div>
                            )}
                          </td>

                          {/* Name / Brand */}
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-800">{product.name}</p>
                            {product.brand && (
                              <p className="text-xs text-gray-400">{product.brand}</p>
                            )}
                          </td>

                          {/* Category */}
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-xs font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                              <span>{CATEGORY_EMOJIS[product.category]}</span>
                              {product.category}
                            </span>
                          </td>

                          {/* Price / MRP + Discount */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-gray-900">₹{product.price}</span>
                              {product.mrp > product.price && (
                                <span className="text-xs text-gray-400 line-through">₹{product.mrp}</span>
                              )}
                            </div>
                            {discount && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full mt-0.5">
                                <Percent className="w-2.5 h-2.5" />
                                {discount}% off
                              </span>
                            )}
                          </td>

                          {/* Unit */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-gray-600">
                              <Tag className="w-3 h-3 text-gray-400" />
                              <span className="text-xs font-semibold">{product.unit}</span>
                            </div>
                          </td>

                          {/* Stock */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Package className="w-3.5 h-3.5 text-gray-400" />
                              <span className={`font-bold text-sm ${
                                product.stock === 0
                                  ? 'text-red-500'
                                  : product.stock < 10
                                  ? 'text-amber-500'
                                  : 'text-gray-700'
                              }`}>
                                {product.stock}
                              </span>
                              {product.stock === 0 && (
                                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full ml-1">
                                  Out
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Status Toggle */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleStatus(product)}
                              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${
                                product.isActive
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {product.isActive
                                ? <><ToggleRight className="w-3.5 h-3.5" /> Active</>
                                : <><ToggleLeft className="w-3.5 h-3.5" /> Inactive</>
                              }
                            </button>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEdit(product)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(product.id)}
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
                  );
                })
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
              className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50 flex-shrink-0">
                <h2 className="font-black text-gray-900 text-lg">
                  {editTarget ? 'Edit Product' : 'Add Product'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Modal Body (scrollable) */}
              <div className="p-6 space-y-4 overflow-y-auto">
                {/* Name */}
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    Product Name *
                  </label>
                  <input
                    value={form.name}
                    onChange={setField('name')}
                    placeholder="e.g. Amul Full Cream Milk"
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                  />
                </div>

                {/* Category + Brand */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Category *
                    </label>
                    <select
                      value={form.category}
                      onChange={setField('category')}
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors bg-white"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{CATEGORY_EMOJIS[cat]} {cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Brand
                    </label>
                    <input
                      value={form.brand}
                      onChange={setField('brand')}
                      placeholder="e.g. Amul"
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Selling Price + MRP */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Selling Price (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">₹</span>
                      <input
                        value={form.price}
                        onChange={setField('price')}
                        type="number"
                        min="0"
                        placeholder="55"
                        className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 pl-8 pr-4 py-3 text-sm font-bold text-gray-800 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      MRP (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">₹</span>
                      <input
                        value={form.mrp}
                        onChange={setField('mrp')}
                        type="number"
                        min="0"
                        placeholder="60"
                        className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 pl-8 pr-4 py-3 text-sm font-bold text-gray-800 focus:outline-none transition-colors"
                      />
                    </div>
                    {form.mrp && form.price && Number(form.mrp) > Number(form.price) && (
                      <p className="text-[10px] text-green-600 font-bold mt-1 flex items-center gap-0.5">
                        <Percent className="w-2.5 h-2.5" />
                        {calcDiscount(Number(form.mrp), Number(form.price))}% discount
                      </p>
                    )}
                  </div>
                </div>

                {/* Unit + Stock */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Unit *
                    </label>
                    <input
                      value={form.unit}
                      onChange={setField('unit')}
                      placeholder="500g / 1L / dozen"
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Stock Qty *
                    </label>
                    <input
                      value={form.stock}
                      onChange={setField('stock')}
                      type="number"
                      min="0"
                      placeholder="100"
                      className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Image URL */}
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    Image URL (optional)
                  </label>
                  <input
                    value={form.image}
                    onChange={setField('image')}
                    placeholder="https://..."
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                  />
                  {form.image && (
                    <div className="mt-2 flex items-center gap-2">
                      <img
                        src={form.image}
                        alt="preview"
                        className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                        onError={e => { (e.target as HTMLImageElement).src = ''; }}
                      />
                      <span className="text-xs text-gray-400">Preview</span>
                    </div>
                  )}
                </div>

                {/* Store ID (optional) */}
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5">
                    Store ID (optional)
                  </label>
                  <input
                    value={form.storeId}
                    onChange={setField('storeId')}
                    placeholder="Leave blank for all stores"
                    className="w-full rounded-xl border-2 border-gray-100 focus:border-orange-400 px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex gap-3 px-6 pb-6 flex-shrink-0 border-t border-gray-100 pt-4">
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
                    <><Check className="w-4 h-4" /> {editTarget ? 'Update Product' : 'Save Product'}</>
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
