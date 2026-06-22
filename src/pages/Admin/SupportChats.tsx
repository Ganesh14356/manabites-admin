import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, where, onSnapshot, limit,
  addDoc, updateDoc, doc, setDoc, serverTimestamp,
  increment, arrayUnion, orderBy,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { MessageCircle, Send, Search, Headphones, Clock, CheckCheck } from 'lucide-react';

interface SupportMessage {
  id: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  text?: string;
  createdAt: any;
  readBy: string[];
}

interface SupportConversation {
  id: string;
  orderId: string;
  lastMessage?: string;
  lastSenderId?: string;
  lastAt?: any;
  updatedAt?: any;
  unreadCount?: Record<string, number>;
  roles?: Record<string, string>;
  participantIds?: string[];
}

function timeLabel(ts: any): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function SupportChats() {
  const { user, profile } = useAuth();
  const adminUid = user?.uid ?? null;
  const adminName = profile?.name || 'ManaBites Support';

  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selected, setSelected] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to all support conversations
  useEffect(() => {
    const q = query(
      collection(db, 'chatConversations'),
      where('conversationType', '==', 'support'),
      limit(200),
    );
    const unsub = onSnapshot(q, snap => {
      const convs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as SupportConversation)
        .sort((a, b) => {
          const ta = a.lastAt?.toMillis?.() ?? a.updatedAt?.toMillis?.() ?? 0;
          const tb = b.lastAt?.toMillis?.() ?? b.updatedAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setConversations(convs);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // Subscribe to messages of selected conversation
  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const q = query(
      collection(db, 'chatConversations', selected.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(150),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SupportMessage));
    }, () => {});
  }, [selected?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open a conversation — join as support participant and clear unread
  const openConversation = useCallback(async (conv: SupportConversation) => {
    setSelected(conv);
    setMessages([]);
    inputRef.current?.focus();
    if (!adminUid) return;
    // Register admin as 'support' participant so the customer's useChatList can find admin's UID
    await setDoc(doc(db, 'chatConversations', conv.id), {
      participantIds: arrayUnion(adminUid),
      roles: { support: adminUid },
    }, { merge: true }).catch(() => {});
    // Clear unread count for support
    await updateDoc(doc(db, 'chatConversations', conv.id), {
      'unreadCount.support': 0,
    }).catch(() => {});
  }, [adminUid]);

  // Send a message as 'support'
  const sendMessage = useCallback(async () => {
    const msg = text.trim();
    if (!msg || !selected || !adminUid || sending) return;
    setSending(true);
    setText('');
    try {
      await addDoc(collection(db, 'chatConversations', selected.id, 'messages'), {
        senderId:   adminUid,
        senderRole: 'support',
        senderName: adminName,
        text:       msg,
        type:       'text',
        readBy:     [adminUid],
        createdAt:  serverTimestamp(),
      });
      await updateDoc(doc(db, 'chatConversations', selected.id), {
        lastMessage:  msg,
        lastSenderId: adminUid,
        lastAt:       serverTimestamp(),
        'unreadCount.customer': increment(1),
      });
      // FCM push to customer
      fetch('/api/notify-rider', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:           'chat_message',
          conversationId: selected.id,
          orderId:        selected.orderId,
          senderId:       adminUid,
          senderName:     'ManaBites Support',
          senderRole:     'support',
          text:           msg,
        }),
      }).catch(() => {});
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [text, selected, adminUid, adminName, sending]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const filtered = conversations.filter(c => {
    if (!search) return true;
    return (
      c.orderId?.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">

      {/* ── Left: conversation list ─────────────────────────────────────────── */}
      <div className="w-80 min-w-[280px] border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <Headphones size={18} className="text-orange-500" />
            <h2 className="font-black text-gray-900">Support Chats</h2>
            {conversations.length > 0 && (
              <span className="ml-auto text-xs bg-orange-100 text-orange-600 font-bold px-2 py-0.5 rounded-full">
                {conversations.length}
              </span>
            )}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
              placeholder="Search order ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-gray-400">
              <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading chats...</p>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-gray-400">
              <MessageCircle size={36} className="mx-auto mb-2 opacity-25" />
              <p className="text-sm font-semibold">No support chats</p>
              <p className="text-xs mt-1">Customers can open support chat from the order page</p>
            </div>
          )}
          {filtered.map(conv => {
            const unread = conv.unreadCount?.support ?? 0;
            const isActive = selected?.id === conv.id;
            const shortOrder = conv.orderId?.slice(-6).toUpperCase() || conv.id.slice(-6).toUpperCase();
            return (
              <button
                key={conv.id}
                onClick={() => openConversation(conv)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors
                  ${isActive
                    ? 'bg-orange-50 border-l-[3px] border-l-orange-500'
                    : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                      {shortOrder[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">#{shortOrder}</p>
                      <p className="text-xs text-gray-400 truncate">{conv.lastMessage || 'No messages'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">{timeLabel(conv.lastAt || conv.updatedAt)}</span>
                    {unread > 0 && (
                      <span className="bg-orange-500 text-white text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: chat window ──────────────────────────────────────────────── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-5 py-3 border-b border-gray-200 bg-white flex items-center gap-3 shadow-sm">
            <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white">
              <Headphones size={16} />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">
                Order #{selected.orderId?.slice(-6).toUpperCase() || selected.id.slice(-6).toUpperCase()}
              </p>
              <p className="text-xs text-gray-400">Customer Support Chat</p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-xs text-gray-400">
              <Clock size={12} />
              <span>{timeLabel(selected.lastAt)}</span>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
            style={{ background: 'linear-gradient(135deg, #fef7f0 0%, #fff8f5 100%)' }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                <MessageCircle size={40} className="opacity-20" />
                <p className="text-sm font-semibold">No messages yet</p>
                <p className="text-xs">Start the conversation below</p>
              </div>
            )}
            {messages.map(msg => {
              const isMine = msg.senderId === adminUid;
              const time = msg.createdAt?.toDate
                ? msg.createdAt.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <div key={msg.id} className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar */}
                  {!isMine && (
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mb-0.5">
                      C
                    </div>
                  )}
                  <div className={`max-w-xs lg:max-w-md xl:max-w-lg ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                    {!isMine && (
                      <span className="text-[10px] text-gray-400 mb-0.5 ml-1">{msg.senderName}</span>
                    )}
                    <div className={`px-3 py-2 rounded-2xl text-sm shadow-sm
                      ${isMine
                        ? 'bg-orange-500 text-white rounded-br-sm'
                        : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                      }`}
                    >
                      <p className="leading-relaxed break-words">{msg.text}</p>
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="text-[10px] text-gray-400">{time}</span>
                      {isMine && <CheckCheck size={12} className="text-orange-300" />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="px-4 py-3 border-t border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
                placeholder="Type a reply..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKey}
                disabled={sending}
              />
              <button
                onClick={sendMessage}
                disabled={!text.trim() || sending}
                className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-1">
              Replying as ManaBites Support · Enter to send
            </p>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mb-4">
            <Headphones size={36} className="text-orange-400" />
          </div>
          <p className="font-black text-gray-700 text-lg">Customer Support</p>
          <p className="text-sm mt-1">Select a conversation to reply</p>
          <p className="text-xs mt-3 text-gray-300">
            {conversations.length === 0
              ? 'No support requests yet'
              : `${conversations.length} conversation${conversations.length > 1 ? 's' : ''} active`
            }
          </p>
        </div>
      )}
    </div>
  );
}
