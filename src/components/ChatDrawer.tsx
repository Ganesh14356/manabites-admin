import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { X, Send, MessageCircle, Bike } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRole: 'admin' | 'rider';
  createdAt: any;
}

interface Rider { id: string; name: string; phone: string; profileImage?: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatDrawer({ isOpen, onClose }: Props) {
  const { user, profile } = useAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load riders
  useEffect(() => {
    if (!isOpen) return;
    return onSnapshot(collection(db, 'riders'), snap => {
      setRiders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Rider)).filter(r => (r as any).approved));
    }, () => {});
  }, [isOpen]);

  // Load messages for selected rider
  useEffect(() => {
    if (!selectedRider) return;
    const chatId = ['admin', selectedRider.id].sort().join('_');
    const q = query(collection(db, 'adminChats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(100));
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    }, () => {});
  }, [selectedRider]);

  // Auto-scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    if (!text.trim() || !selectedRider || !user) return;
    setSending(true);
    try {
      const chatId = ['admin', selectedRider.id].sort().join('_');
      await addDoc(collection(db, 'adminChats', chatId, 'messages'), {
        text: text.trim(),
        senderId: user.uid,
        senderName: profile?.name || 'Admin',
        senderRole: 'admin',
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch { } finally { setSending(false); }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={onClose} />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 bg-white">
              <MessageCircle className="w-5 h-5 text-brand" />
              <div className="flex-1">
                <h3 className="font-black text-gray-900 text-sm">Rider Chat</h3>
                {selectedRider && <p className="text-xs text-gray-400">{selectedRider.name}</p>}
              </div>
              {selectedRider && <button onClick={() => setSelectedRider(null)} className="text-xs text-gray-400 hover:text-brand mr-2">← Back</button>}
              <button onClick={onClose} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {!selectedRider ? (
              /* Rider list */
              <div className="flex-1 overflow-y-auto">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest px-4 py-3">Select a Rider</p>
                {riders.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Bike className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-semibold">No approved riders</p>
                  </div>
                ) : riders.map(r => (
                  <button key={r.id} onClick={() => setSelectedRider(r)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50">
                    <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {r.profileImage ? <img src={r.profileImage} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">🛵</span>}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.phone}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              /* Chat area */
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No messages yet. Say hello!</p>
                    </div>
                  )}
                  {messages.map(m => {
                    const isAdmin = m.senderRole === 'admin';
                    return (
                      <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${isAdmin ? 'bg-brand text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'}`}>
                          <p>{m.text}</p>
                          <p className={`text-[10px] mt-0.5 ${isAdmin ? 'text-white/60' : 'text-gray-400'}`}>
                            {m.createdAt?.toDate?.()?.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) ?? ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
                <div className="p-3 border-t border-gray-100">
                  <div className="flex gap-2">
                    <input
                      value={text} onChange={e => setText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand"
                    />
                    <button onClick={sendMessage} disabled={sending || !text.trim()}
                      className="w-9 h-9 bg-brand text-white rounded-xl flex items-center justify-center disabled:opacity-50">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
