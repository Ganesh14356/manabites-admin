import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, addDoc, serverTimestamp, onSnapshot,
  query, orderBy, getDocs, limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Bell, Send, Users, Bike, Store, CheckCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';

type Audience = 'all_customers' | 'all_riders' | 'all_restaurants' | 'all';

interface SentNotification {
  id: string;
  title: string;
  message: string;
  audience: Audience;
  sentCount: number;
  createdAt: any;
}

const AUDIENCE_OPTIONS: { id: Audience; label: string; sub: string; icon: React.ElementType; color: string }[] = [
  { id: 'all_customers',    label: 'All Customers',    sub: 'Every registered customer',  icon: Users, color: 'text-blue-600 bg-blue-50'   },
  { id: 'all_riders',       label: 'All Riders',       sub: 'Every approved rider',        icon: Bike,  color: 'text-green-600 bg-green-50' },
  { id: 'all_restaurants',  label: 'All Restaurants',  sub: 'All restaurant owners',       icon: Store, color: 'text-orange-600 bg-orange-50'},
  { id: 'all',              label: 'Everyone',         sub: 'Customers + Riders + Owners', icon: Bell,  color: 'text-purple-600 bg-purple-50' },
];

const QUICK_TEMPLATES = [
  { title: '🎉 Special Offer!',         message: 'Use code SPECIAL20 for 20% off your next order. Limited time!' },
  { title: '🛵 New Riders Needed',      message: 'Join our delivery team and earn ₹500+ per day. Apply now!' },
  { title: '🍔 New Restaurant Added',   message: 'Check out the newest restaurant on Mana Bites — amazing food!' },
  { title: '⚠️ Scheduled Maintenance', message: 'The app will be briefly down for maintenance on Sunday 2 AM–3 AM.' },
  { title: '🌟 Rate Your Last Order',   message: 'How was your last order? Share your experience and help others!' },
];

export default function NotificationsBroadcast() {
  const [audience, setAudience]     = useState<Audience>('all_customers');
  const [title, setTitle]           = useState('');
  const [message, setMessage]       = useState('');
  const [sending, setSending]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [history, setHistory]       = useState<SentNotification[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'broadcastNotifications'),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    return onSnapshot(q, snap => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as SentNotification)));
      setHistoryLoading(false);
    }, () => setHistoryLoading(false));
  }, []);

  const getRecipients = async (): Promise<{ uid: string }[]> => {
    const snap_customers = audience === 'all_customers' || audience === 'all'
      ? await getDocs(collection(db, 'users')) : null;
    const snap_riders = audience === 'all_riders' || audience === 'all'
      ? await getDocs(collection(db, 'riders')) : null;
    const snap_restaurants = audience === 'all_restaurants' || audience === 'all'
      ? await getDocs(collection(db, 'restaurants')) : null;

    const uids = new Set<string>();
    snap_customers?.docs.forEach(d => { if (d.data().uid || d.id) uids.add(d.data().uid || d.id); });
    snap_riders?.docs.forEach(d => { if (d.data().uid || d.id) uids.add(d.data().uid || d.id); });
    snap_restaurants?.docs.forEach(d => { const oid = d.data().ownerId; if (oid) uids.add(oid); });
    return Array.from(uids).map(uid => ({ uid }));
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error('Fill in title and message');
      return;
    }
    setSending(true);
    setShowConfirm(false);
    try {
      const recipients = await getRecipients();

      // 1. Write in-app notification docs (shown when app is open)
      const CHUNK = 50;
      for (let i = 0; i < recipients.length; i += CHUNK) {
        await Promise.all(
          recipients.slice(i, i + CHUNK).map(r =>
            addDoc(collection(db, 'notifications'), {
              userId:    r.uid,
              title:     title.trim(),
              message:   message.trim(),
              type:      'broadcast',
              isRead:    false,
              createdAt: serverTimestamp(),
            })
          )
        );
      }

      // 2. Log the broadcast
      await addDoc(collection(db, 'broadcastNotifications'), {
        title:     title.trim(),
        message:   message.trim(),
        audience,
        sentCount: recipients.length,
        createdAt: serverTimestamp(),
      });

      // 3. Send real FCM push notifications to mobile devices
      let pushResult = { success: 0, failed: 0, total: 0 };
      try {
        const resp = await fetch('/api/send-fcm', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ title: title.trim(), message: message.trim(), audience }),
        });
        if (resp.ok) {
          pushResult = await resp.json();
        }
      } catch {
        // Push failure is non-critical — in-app notifications already sent
      }

      const pushInfo = pushResult.total > 0
        ? ` · 📱 Push sent to ${pushResult.success}/${pushResult.total} devices`
        : '';
      toast.success(`Sent to ${recipients.length} recipients!${pushInfo}`);
      setTitle('');
      setMessage('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const formatDate = (ts: any) => {
    if (!ts) return '—';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const audienceLabel: Record<Audience, string> = {
    all_customers:   'All Customers',
    all_riders:      'All Riders',
    all_restaurants: 'All Restaurant Owners',
    all:             'Everyone',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">Broadcast Notifications</h1>
        <p className="text-sm text-gray-500 font-medium mt-0.5">Send in-app notifications to customers, riders, or restaurants</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        {/* Compose panel */}
        <div className="space-y-5">
          {/* Audience */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Send To</h2>
            <div className="grid grid-cols-2 gap-3">
              {AUDIENCE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const selected = audience === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setAudience(opt.id)}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                      selected ? 'border-brand bg-brand/5' : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${opt.color}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 text-sm leading-tight">{opt.label}</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{opt.sub}</p>
                    </div>
                    {selected && <div className="ml-auto w-2 h-2 rounded-full bg-brand flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick templates */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Quick Templates</h2>
            <div className="space-y-2">
              {QUICK_TEMPLATES.map(t => (
                <button
                  key={t.title}
                  onClick={() => { setTitle(t.title); setMessage(t.message); }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-100 hover:border-brand/30 hover:bg-brand/5 transition-colors group"
                >
                  <p className="font-black text-gray-900 text-sm group-hover:text-brand transition-colors">{t.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{t.message}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Compose */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400">Compose Message</h2>
            <div>
              <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5">Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={80}
                placeholder="Notification title…"
                className="w-full rounded-xl border-2 border-gray-100 focus:border-brand px-4 py-3 text-sm font-bold outline-none"
              />
              <p className="text-[10px] text-gray-400 text-right mt-1">{title.length}/80</p>
            </div>
            <div>
              <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5">Message</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={200}
                rows={4}
                placeholder="Notification body…"
                className="w-full rounded-xl border-2 border-gray-100 focus:border-brand px-4 py-3 text-sm font-bold outline-none resize-none"
              />
              <p className="text-[10px] text-gray-400 text-right mt-1">{message.length}/200</p>
            </div>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={!title.trim() || !message.trim() || sending}
              className="w-full flex items-center justify-center gap-2 bg-brand text-white font-black py-3.5 rounded-xl disabled:opacity-50 text-sm uppercase tracking-widest"
            >
              {sending ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
              ) : (
                <><Send size={16} /> Send Notification</>
              )}
            </button>
          </div>
        </div>

        {/* History sidebar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Sent History</h2>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No broadcasts yet</p>
          ) : (
            <div className="space-y-3">
              {history.map(n => (
                <div key={n.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black text-gray-900 text-sm leading-tight">{n.title}</p>
                    <span className="text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full flex-shrink-0">
                      {n.sentCount} sent
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{n.message}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-gray-400">{audienceLabel[n.audience]}</span>
                    <span className="text-[10px] text-gray-400">{formatDate(n.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirm modal */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                  <Bell size={20} className="text-brand" />
                </div>
                <h3 className="font-black text-gray-900 text-lg">Confirm Broadcast</h3>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-2">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest">To: {audienceLabel[audience]}</p>
                <p className="font-black text-gray-900">{title}</p>
                <p className="text-sm text-gray-600">{message}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)} className="flex-1 py-3 rounded-xl border-2 border-gray-100 font-black text-gray-500 text-sm">
                  Cancel
                </button>
                <button onClick={handleSend} className="flex-1 py-3 rounded-xl bg-brand text-white font-black text-sm flex items-center justify-center gap-2">
                  <Send size={15} /> Send Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
