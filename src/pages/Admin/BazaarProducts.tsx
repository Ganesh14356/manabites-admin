import { useEffect, useState } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, orderBy, query, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ShoppingBag, Plus, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
  category?: string;
  active: boolean;
  createdAt?: number;
}

const EMPTY_FORM = { name: '', description: '', imageUrl: '', price: '', category: '', active: true };

export default function BazaarProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'riderBazaarProducts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const openAdd = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (p: Product) => {
    setEditTarget(p);
    setForm({
      name: p.name, description: p.description ?? '', imageUrl: p.imageUrl ?? '',
      price: String(p.price), category: p.category ?? '', active: p.active,
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) { toast.error('Enter a valid price'); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        price,
        category: form.category.trim() || null,
        active: form.active,
      };
      if (editTarget) {
        await updateDoc(doc(db, 'riderBazaarProducts', editTarget.id), { ...payload, updatedAt: serverTimestamp() });
        toast.success('Product updated');
      } else {
        await addDoc(collection(db, 'riderBazaarProducts'), { ...payload, createdAt: Date.now() });
        toast.success('Product added');
      }
      closeModal();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: Product) => {
    try {
      await updateDoc(doc(db, 'riderBazaarProducts', p.id), { active: !p.active, updatedAt: serverTimestamp() });
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'riderBazaarProducts', deleteTarget.id));
      toast.success('Product deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete product');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <ShoppingBag size={24} /> Bazaar Products
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Vouchers & perks riders can buy with their wallet balance</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-green-600 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-green-700 transition-colors"
        >
          <Plus size={18} /> Add Product
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <ShoppingBag size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No products yet — add your first one</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                {p.imageUrl
                  ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                  : <ShoppingBag size={28} className="text-gray-300" />}
              </div>
              <div className="p-3">
                <p className="font-bold text-gray-800 text-sm truncate">{p.name}</p>
                {p.category && <p className="text-[10px] text-gray-400 uppercase tracking-wide">{p.category}</p>}
                <p className="font-black text-green-600 mt-1">₹{p.price}</p>
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => toggleActive(p)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                      p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {p.active ? 'Active' : 'Hidden'}
                  </button>
                  <div className="flex gap-1.5">
                    <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-gray-800">{editTarget ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={closeModal}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="e.g. ₹500 Fuel Voucher"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Image URL</label>
                <input
                  value={form.imageUrl}
                  onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="https://…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Price (₹) *</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Category</label>
                  <input
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                    placeholder="Fuel, Vouchers…"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                />
                Active (visible to riders)
              </label>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full mt-5 bg-green-600 text-white font-bold py-3 rounded-xl hover:bg-green-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-gray-800 text-lg mb-2">Delete Product?</h3>
            <p className="text-sm text-gray-500 mb-5">"{deleteTarget.name}" will be permanently removed.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-2.5 rounded-xl">
                Cancel
              </button>
              <button onClick={handleDelete} className="flex-1 bg-red-600 text-white font-bold py-2.5 rounded-xl">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
