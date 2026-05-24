import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, doc, updateDoc, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { CheckCircle, XCircle, Clock, Star } from 'lucide-react';
import toast from 'react-hot-toast';

interface Appeal {
  id: string;
  riderId: string;
  riderName: string;
  riderRating: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
  adminNote?: string;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_COLORS = {
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

export default function RatingAppeals() {
  const [appeals, setAppeals]   = useState<Appeal[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<Appeal | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [saving, setSaving]     = useState(false);
  const [filter, setFilter]     = useState<'pending' | 'all'>('pending');

  useEffect(() => {
    const q = query(collection(db, 'ratingAppeals'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setAppeals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Appeal)));
      setLoading(false);
    });
  }, []);

  const resolve = async (status: 'approved' | 'rejected') => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'ratingAppeals', selected.id), {
        status,
        adminNote: adminNote.trim() || null,
        resolvedAt: Date.now(),
      });
      toast.success(status === 'approved' ? 'Appeal approved â€” rating will be reviewed' : 'Appeal rejected');
      setSelected(null);
      setAdminNote('');
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const displayed = filter === 'pending' ? appeals.filter(a => a.status === 'pending') : appeals;
  const pendingCount = appeals.filter(a => a.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Rating Appeals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Rider-submitted rating disputes</p>
        </div>
        <div className="flex gap-2">
          {(['pending', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-black capitalize transition-colors ${
                filter === f ? 'bg-brand text-white' : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              {f === 'pending' ? `Pending (${pendingCount})` : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">Loadingâ€¦</div>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <div className="text-5xl mb-3">â­</div>
          <p className="font-black text-gray-600 text-lg">No {filter === 'pending' ? 'pending ' : ''}appeals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(appeal => (
            <motion.div
              key={appeal.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => { setSelected(appeal); setAdminNote(appeal.adminNote || ''); }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-black text-gray-900">{appeal.riderName || '(Unknown)'}</span>
                    {appeal.riderRating != null && (
                      <span className="flex items-center gap-1 text-xs font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                        <Star size={10} className="fill-yellow-500 text-yellow-500" />
                        {Number(appeal.riderRating).toFixed(1)}
                      </span>
                    )}
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border capitalize ${STATUS_COLORS[appeal.status]}`}>
                      {appeal.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">{appeal.reason}</p>
                  <p className="text-[11px] text-gray-400 font-medium mt-1">{formatDate(appeal.createdAt)}</p>
                </div>
                {appeal.status === 'pending' && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setSelected(appeal); setAdminNote(''); }}
                      className="p-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100"
                    >
                      Review
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Review modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-black text-lg mb-1">Review Appeal</h3>
              <p className="text-xs text-gray-400 mb-4">Rider: <span className="font-bold text-gray-700">{selected.riderName}</span></p>

              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm text-gray-700 leading-relaxed">
                "{selected.reason}"
              </div>

              <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1">Admin Note (optional)</label>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Add a note for the rider..."
                rows={3}
                className="w-full border-2 border-gray-100 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand resize-none mb-5"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => resolve('rejected')}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 text-red-600 font-black text-sm hover:bg-red-100 disabled:opacity-60"
                >
                  <XCircle size={16} /> Reject
                </button>
                <button
                  onClick={() => resolve('approved')}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-50 text-green-700 font-black text-sm hover:bg-green-100 disabled:opacity-60"
                >
                  <CheckCircle size={16} /> Approve
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
