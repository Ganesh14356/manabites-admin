import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, orderBy,
  getDocs, deleteDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Star, Trash2, EyeOff, Eye, Search, Flag, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

interface Review {
  id: string;
  restaurantId: string;
  restaurantName?: string;
  orderId?: string;
  userId?: string;
  userName?: string;
  rating: number;
  comment?: string;
  tags?: string[];
  isFlagged?: boolean;
  isHidden?: boolean;
  createdAt: any;
}

interface Restaurant {
  id: string;
  name: string;
}

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={13} className={i <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'} />
      ))}
    </span>
  );
}

export default function ReviewsManagement() {
  const [reviews, setReviews]         = useState<Review[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [flagFilter, setFlagFilter]   = useState<'all' | 'flagged' | 'hidden'>('all');
  const [restFilter, setRestFilter]   = useState('all');
  const [actionTarget, setActionTarget] = useState<Review | null>(null);

  // Load all restaurants to get their names
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'restaurants'), snap => {
      setRestaurants(snap.docs.map(d => ({ id: d.id, name: d.data().name || 'Unknown' })));
    });
    return unsub;
  }, []);

  // Load reviews from all restaurants/{id}/reviews subcollections
  useEffect(() => {
    if (restaurants.length === 0) return;

    const allReviews: Review[] = [];
    let loaded = 0;
    const unsubFns: (() => void)[] = [];

    for (const rest of restaurants) {
      const q = query(
        collection(db, 'restaurants', rest.id, 'reviews'),
        orderBy('createdAt', 'desc'),
      );
      const unsub = onSnapshot(q, snap => {
        // Replace this restaurant's reviews in the list
        const restReviews = snap.docs.map(d => ({
          id: d.id,
          restaurantId: rest.id,
          restaurantName: rest.name,
          ...d.data(),
        } as Review));
        setReviews(prev => [
          ...prev.filter(r => r.restaurantId !== rest.id),
          ...restReviews,
        ].sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        }));
        loaded++;
        if (loaded >= restaurants.length) setLoading(false);
      }, () => { loaded++; if (loaded >= restaurants.length) setLoading(false); });
      unsubFns.push(unsub);
    }

    if (restaurants.length === 0) setLoading(false);
    return () => unsubFns.forEach(f => f());
  }, [restaurants.length]);

  const filtered = useMemo(() => {
    let list = reviews;
    if (flagFilter === 'flagged') list = list.filter(r => r.isFlagged);
    if (flagFilter === 'hidden')  list = list.filter(r => r.isHidden);
    if (ratingFilter !== 'all')   list = list.filter(r => r.rating === ratingFilter);
    if (restFilter !== 'all')     list = list.filter(r => r.restaurantId === restFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.comment?.toLowerCase().includes(q) ||
        r.userName?.toLowerCase().includes(q) ||
        r.restaurantName?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [reviews, flagFilter, ratingFilter, restFilter, search]);

  const toggleFlag = async (review: Review) => {
    try {
      await updateDoc(doc(db, 'restaurants', review.restaurantId, 'reviews', review.id), {
        isFlagged: !review.isFlagged,
      });
      toast.success(review.isFlagged ? 'Flag removed' : 'Review flagged');
    } catch { toast.error('Failed'); }
  };

  const toggleHide = async (review: Review) => {
    try {
      await updateDoc(doc(db, 'restaurants', review.restaurantId, 'reviews', review.id), {
        isHidden: !review.isHidden,
      });
      toast.success(review.isHidden ? 'Review visible' : 'Review hidden');
    } catch { toast.error('Failed'); }
  };

  const deleteReview = async (review: Review) => {
    try {
      await deleteDoc(doc(db, 'restaurants', review.restaurantId, 'reviews', review.id));
      toast.success('Review deleted');
      setActionTarget(null);
    } catch { toast.error('Failed'); }
  };

  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '—';
  const flaggedCount = reviews.filter(r => r.isFlagged).length;
  const lowRatings   = reviews.filter(r => r.rating <= 2).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Reviews Management</h1>
        <p className="text-sm text-gray-500 font-medium mt-0.5">Moderate customer reviews across all restaurants</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reviews', value: reviews.length, icon: '⭐', color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Avg Rating',    value: avgRating + ' ★', icon: '📊', color: 'text-brand bg-brand/10'  },
          { label: 'Flagged',       value: flaggedCount, icon: '🚩', color: 'text-red-600 bg-red-50'      },
          { label: 'Low (≤ 2★)',    value: lowRatings,   icon: '⚠️', color: 'text-orange-600 bg-orange-50'},
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 text-sm ${c.color}`}>
              {c.icon}
            </div>
            <p className="text-2xl font-black text-gray-900">{c.value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reviews…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-gray-100 focus:border-brand text-sm font-bold outline-none"
          />
        </div>

        {/* Restaurant filter */}
        <select
          value={restFilter}
          onChange={e => setRestFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl border-2 border-gray-100 focus:border-brand text-xs font-black outline-none bg-white text-gray-700"
        >
          <option value="all">All Restaurants</option>
          {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        {/* Rating filter */}
        <div className="flex gap-1.5">
          {(['all', 1, 2, 3, 4, 5] as const).map(r => (
            <button
              key={r}
              onClick={() => setRatingFilter(r)}
              className={`px-3 py-2 rounded-full text-xs font-black transition-colors ${
                ratingFilter === r ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {r === 'all' ? 'All ★' : `${r}★`}
            </button>
          ))}
        </div>

        {/* Flag filter */}
        {(['all', 'flagged', 'hidden'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFlagFilter(f)}
            className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              flagFilter === f
                ? f === 'flagged' ? 'bg-red-500 text-white' : f === 'hidden' ? 'bg-gray-600 text-white' : 'bg-brand text-white'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Reviews list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <Star size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="font-black text-gray-500">No reviews found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(review => (
            <motion.div
              key={`${review.restaurantId}-${review.id}`}
              layout
              className={`bg-white rounded-2xl shadow-sm border p-5 transition-all ${
                review.isHidden ? 'opacity-50 border-gray-100' :
                review.isFlagged ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center text-brand font-black flex-shrink-0">
                  {(review.userName || 'U').charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-black text-gray-900 text-sm">{review.userName || 'Anonymous'}</span>
                      <span className="text-gray-400 text-xs font-bold ml-2">· {review.restaurantName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StarRow value={review.rating} />
                      <span className="text-xs text-gray-400">{formatDate(review.createdAt)}</span>
                    </div>
                  </div>

                  {review.tags && review.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {review.tags.map(tag => (
                        <span key={tag} className="text-[10px] font-black px-2 py-0.5 rounded-full bg-brand/10 text-brand uppercase tracking-widest">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {review.comment && (
                    <p className="text-sm text-gray-700 mt-2 leading-relaxed">{review.comment}</p>
                  )}

                  {/* Status badges */}
                  <div className="flex items-center gap-2 mt-2">
                    {review.isFlagged && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 uppercase">🚩 Flagged</span>
                    )}
                    {review.isHidden && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 uppercase">Hidden</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleFlag(review)}
                    title={review.isFlagged ? 'Remove flag' : 'Flag review'}
                    className={`p-2 rounded-lg transition-colors ${
                      review.isFlagged ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-400 hover:text-red-500'
                    }`}
                  >
                    <Flag size={14} />
                  </button>
                  <button
                    onClick={() => toggleHide(review)}
                    title={review.isHidden ? 'Show review' : 'Hide review'}
                    className={`p-2 rounded-lg transition-colors ${
                      review.isHidden ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    {review.isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    onClick={() => setActionTarget(review)}
                    className="p-2 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete review"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <AnimatePresence>
        {actionTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
            >
              <div className="text-center mb-5">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Trash2 size={22} className="text-red-500" />
                </div>
                <h3 className="font-black text-gray-900">Delete Review?</h3>
                <p className="text-sm text-gray-500 mt-1">This action cannot be undone.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setActionTarget(null)} className="flex-1 py-3 rounded-xl border-2 border-gray-100 font-black text-gray-500 text-sm">
                  Cancel
                </button>
                <button onClick={() => deleteReview(actionTarget)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-black text-sm">
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
