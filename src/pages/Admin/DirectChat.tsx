/**
 * Admin → Direct Chat
 * Admin can chat directly with any Customer, Rider, or Restaurant.
 * Uses adminDirectChats/{chatId}/messages collection.
 * chatId format: admin_{type}_{targetId}  e.g. admin_customer_uid123
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc,
  doc, setDoc, serverTimestamp, increment, orderBy,
  limit, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  MessageCircle, Send, Search, ChevronLeft,
  Users, Bike, Store, Headphones,
} from 'lucide-react';

type TabKey = 'customer' | 'rider' | 'restaurant';

interface Person {
  id:     string;
  name:   string;
  phone?: string;
  avatar?: string;
}

interface DirectMessage {
  id:         string;
  senderId:   string;
  senderRole: string;
  senderName: string;
  text:       string;
  createdAt:  any;
  readBy:     string[];
}

interface DirectChat {
  id:          string;
  lastMessage?: string;
  lastAt?:     any;
  unreadCount?: Record<string, number>;
  targetId:    string;
  targetName:  string;
  targetType:  string;
}

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode; color: string; collection: string }[] = [
  { key: 'customer',   label: 'Customers',   icon: <Users  size={14} />, color: 'blue',   collection: 'users'       },
  { key: 'rider',      label: 'Riders',      icon: <Bike   size={14} />, color: 'green',  collection: 'riders'      },
  { key: 'restaurant', label: 'Restaurants', icon: <Store  size={14} />, color: 'purple', collection: 'restaurants' },
];

function timeLabel(ts: any) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (now.getTime() - d.getTime() < 86_400_000) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function DirectChat() {
  const { user, profile } = useAuth();
  const adminUid  = user?.uid ?? '';
  const adminName = profile?.name || 'ManaBites Support';

  const [tab,          setTab]          = useState<TabKey>('customer');
  const [people,       setPeople]       = useState<Person[]>([]);
  const [search,       setSearch]       = useState('');
  const [recentChats,  setRecentChats]  = useState<DirectChat[]>([]);
  const [selected,     setSelected]     = useState<{ person: Person; chatId: string } | null>(null);
  const [messages,     setMessages]     = useState<DirectMessage[]>([]);
  const [text,         setText]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [loadPeople,   setLoadPeople]   = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Load people for selected tab ─────────────────────────────────────────
  useEffect(() => {
    setLoadPeople(true);
    setSearch('');
    const cfg = TAB_CONFIG.find(t => t.key === tab)!;
    const constraints = tab === 'rider'
      ? [where('approved', '==', true), limit(100)]
      : tab === 'restaurant'
      ? [where('approved', '==', true), limit(100)]
      : [limit(100)];
    const q = query(collection(db, cfg.collection), ...constraints);
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => {
        const data = d.data();
        return {
          id:    d.id,
          name:  data.name || data.ownerName || data.restaurantName || data.displayName || 'Unknown',
          phone: data.phone || '',
          avatar: data.profileImage || data.logo || '',
        } as Person;
      }).sort((a, b) => a.name.localeCompare(b.name));
      setPeople(list);
      setLoadPeople(false);
    }, () => setLoadPeople(false));
  }, [tab]);

  // ── Load recent direct chats for this admin ──────────────────────────────
  useEffect(() => {
    if (!adminUid) return;
    const q = query(
      collection(db, 'adminDirectChats'),
      where('adminId', '==', adminUid),
      limit(50),
    );
    return onSnapshot(q, snap => {
      const chats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DirectChat)
        .filter(c => c.lastMessage)
        .sort((a, b) => (b.lastAt?.toMillis?.() ?? 0) - (a.lastAt?.toMillis?.() ?? 0));
      setRecentChats(chats);
    }, () => {});
  }, [adminUid]);

  // ── Subscribe to messages ────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const q = query(
      collection(db, 'adminDirectChats', selected.chatId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(150),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage));
    }, () => {});
  }, [selected?.chatId]);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Open a chat with a person ────────────────────────────────────────────
  const openChat = useCallback(async (person: Person) => {
    if (!adminUid) return;
    const chatId = `admin_${tab}_${person.id}`;
    // Ensure conversation doc exists
    await setDoc(doc(db, 'adminDirectChats', chatId), {
      adminId:     adminUid,
      adminName,
      targetId:    person.id,
      targetName:  person.name,
      targetType:  tab,
      updatedAt:   serverTimestamp(),
    }, { merge: true });
    // Mark admin unread as 0
    await updateDoc(doc(db, 'adminDirectChats', chatId), {
      'unreadCount.admin': 0,
    }).catch(() => {});
    setSelected({ person, chatId });
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [adminUid, adminName, tab]);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const msg = text.trim();
    if (!msg || !selected || !adminUid || sending) return;
    setSending(true);
    setText('');
    try {
      await addDoc(collection(db, 'adminDirectChats', selected.chatId, 'messages'), {
        senderId:   adminUid,
        senderRole: 'admin',
        senderName: adminName,
        text:       msg,
        type:       'text',
        readBy:     [adminUid],
        createdAt:  serverTimestamp(),
      });
      await updateDoc(doc(db, 'adminDirectChats', selected.chatId), {
        lastMessage:  msg,
        lastSenderId: adminUid,
        lastAt:       serverTimestamp(),
        'unreadCount.target': increment(1),
      });
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [text, selected, adminUid, adminName, sending]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const filtered = people.filter(p => {
    if (!search) return true;
    return p.name.toLowerCase().includes(search.toLowerCase()) ||
           (p.phone || '').includes(search);
  });

  // Recent chat unread for this tab
  const tabUnread = recentChats
    .filter(c => c.targetType === tab)
    .reduce((s, c) => s + (c.unreadCount?.admin ?? 0), 0);

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">

      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <div className="w-80 min-w-[280px] border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
              <Headphones size={16} className="text-orange-500" />
            </div>
            <div>
              <p className="font-black text-gray-900 text-sm">ManaBites Support</p>
              <p className="text-xs text-gray-400">Direct Chat</p>
            </div>
          </div>

          {/* Tab selector */}
          <div className="flex rounded-xl bg-gray-100 p-0.5 gap-0.5">
            {TAB_CONFIG.map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSelected(null); }}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all
                  ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-50">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
              placeholder={`Search ${TAB_CONFIG.find(t => t.key === tab)?.label.toLowerCase()}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* People list */}
        <div className="flex-1 overflow-y-auto">
          {loadPeople ? (
            <div className="p-8 text-center text-gray-400">
              <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <MessageCircle size={32} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm font-semibold">No results</p>
            </div>
          ) : (
            filtered.map(person => {
              const recentChat = recentChats.find(c => c.targetId === person.id && c.targetType === tab);
              const unread     = recentChat?.unreadCount?.admin ?? 0;
              const isActive   = selected?.person.id === person.id;
              const initials   = person.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

              return (
                <button
                  key={person.id}
                  onClick={() => openChat(person)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 flex items-center gap-3 transition-colors
                    ${isActive
                      ? 'bg-orange-50 border-l-[3px] border-l-orange-500'
                      : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                    }`}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center">
                    {person.avatar ? (
                      <img src={person.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-gray-500">{initials || '?'}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">{person.name}</p>
                    {recentChat?.lastMessage ? (
                      <p className="text-xs text-gray-400 truncate">{recentChat.lastMessage}</p>
                    ) : (
                      <p className="text-xs text-gray-300">{person.phone}</p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {recentChat?.lastAt && (
                      <span className="text-[10px] text-gray-400">{timeLabel(recentChat.lastAt)}</span>
                    )}
                    {unread > 0 && (
                      <span className="min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right panel: chat ─────────────────────────────────────────────── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="px-5 py-3 border-b border-gray-200 bg-white flex items-center gap-3 shadow-sm flex-shrink-0">
            <button
              onClick={() => setSelected(null)}
              className="md:hidden text-gray-400 hover:text-gray-600 mr-1"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {selected.person.avatar ? (
                <img src={selected.person.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-gray-500">
                  {selected.person.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">{selected.person.name}</p>
              <p className="text-xs text-gray-400 capitalize">{tab} · {selected.person.phone}</p>
            </div>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
            style={{ background: 'linear-gradient(135deg,#fef7f0 0%,#fff8f5 100%)' }}
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                <MessageCircle size={40} className="opacity-15" />
                <p className="text-sm font-semibold">No messages yet</p>
                <p className="text-xs">Start the conversation below</p>
              </div>
            )}
            {messages.map(msg => {
              const isMine = msg.senderId === adminUid;
              const time   = msg.createdAt?.toDate
                ? msg.createdAt.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <div key={msg.id} className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar for other side */}
                  {!isMine && (
                    <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-gray-600 flex-shrink-0 mb-0.5">
                      {selected.person.name[0].toUpperCase()}
                    </div>
                  )}
                  <div className={`max-w-xs lg:max-w-md flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-3 py-2 rounded-2xl text-sm shadow-sm
                        ${isMine
                          ? 'bg-orange-500 text-white rounded-br-sm'
                          : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                        }`}
                    >
                      <p className="break-words leading-relaxed">{msg.text}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-0.5">{time}</span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
                placeholder={`Message ${selected.person.name}...`}
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
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center">
            <Headphones size={36} className="text-orange-400" />
          </div>
          <p className="font-black text-gray-700 text-lg">ManaBites Support</p>
          <p className="text-sm">Select a {tab} to start chatting</p>
          <div className="flex gap-3 mt-2 text-xs text-gray-300">
            <span>{people.length} {TAB_CONFIG.find(t => t.key === tab)?.label.toLowerCase()}</span>
            {recentChats.filter(c => c.targetType === tab).length > 0 && (
              <span>· {recentChats.filter(c => c.targetType === tab).length} recent chats</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
