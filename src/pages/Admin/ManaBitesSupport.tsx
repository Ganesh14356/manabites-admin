/**
 * ManaBites Support — unified chat hub for admin.
 * Tab 1: Customer Support  — order-based chats where customers asked for help
 * Tab 2: Direct Chat       — admin initiates chat with any Customer / Rider / Restaurant
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, where, onSnapshot, limit,
  addDoc, updateDoc, doc, setDoc, serverTimestamp,
  increment, arrayUnion, orderBy, documentId,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Headphones, MessageCircle, Send, Search,
  Users, Bike, Store, ChevronLeft, Clock, CheckCheck,
} from 'lucide-react';

// ── Shared types ──────────────────────────────────────────────────────────────
interface Msg {
  id:         string;
  senderId:   string;
  senderRole: string;
  senderName: string;
  text:       string;
  createdAt:  any;
  readBy?:    string[];
}

function tLabel(ts: any) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000)       return 'now';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function Bubble({ msg, isMine }: { msg: Msg; isMine: boolean }) {
  const time = msg.createdAt?.toDate
    ? msg.createdAt.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isMine && (
        <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-gray-600 flex-shrink-0 mb-0.5">
          {(msg.senderName || '?')[0].toUpperCase()}
        </div>
      )}
      <div className={`max-w-xs lg:max-w-md flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
        <div className={`px-3 py-2 rounded-2xl text-sm shadow-sm
          ${isMine
            ? 'bg-orange-500 text-white rounded-br-sm'
            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
          }`}>
          <p className="break-words leading-relaxed">{msg.text}</p>
        </div>
        <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-gray-400">{time}</span>
          {isMine && <CheckCheck size={11} className="text-orange-300" />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Customer Support (order-based support chats)
// ═══════════════════════════════════════════════════════════════════════════════
interface SupportConv {
  id: string; orderId: string; lastMessage?: string;
  lastAt?: any; updatedAt?: any; unreadCount?: Record<string, number>;
}

function CustomerSupportTab({ adminUid, adminName }: { adminUid: string; adminName: string }) {
  const [convs,    setConvs]    = useState<SupportConv[]>([]);
  const [selected, setSelected] = useState<SupportConv | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text,     setText]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'chatConversations'), where('conversationType', '==', 'support'), limit(200));
    return onSnapshot(q, snap => {
      setConvs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SupportConv)
        .sort((a, b) => (b.lastAt?.toMillis?.() ?? b.updatedAt?.toMillis?.() ?? 0) - (a.lastAt?.toMillis?.() ?? a.updatedAt?.toMillis?.() ?? 0)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const q = query(collection(db, 'chatConversations', selected.id, 'messages'), orderBy('createdAt', 'asc'), limit(150));
    return onSnapshot(q, snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Msg)), () => {});
  }, [selected?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const open = useCallback(async (conv: SupportConv) => {
    setSelected(conv); setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 80);
    if (!adminUid) return;
    await setDoc(doc(db, 'chatConversations', conv.id), { participantIds: arrayUnion(adminUid), roles: { support: adminUid } }, { merge: true }).catch(() => {});
    await updateDoc(doc(db, 'chatConversations', conv.id), { 'unreadCount.support': 0 }).catch(() => {});
  }, [adminUid]);

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg || !selected || !adminUid || sending) return;
    setSending(true); setText('');
    try {
      await addDoc(collection(db, 'chatConversations', selected.id, 'messages'), {
        senderId: adminUid, senderRole: 'support', senderName: adminName,
        text: msg, type: 'text', readBy: [adminUid], createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'chatConversations', selected.id), {
        lastMessage: msg, lastSenderId: adminUid, lastAt: serverTimestamp(), 'unreadCount.customer': increment(1),
      });
      fetch('/api/notify-rider', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'chat_message', conversationId: selected.id, orderId: selected.orderId,
          senderId: adminUid, senderName: 'ManaBites Support', senderRole: 'support', text: msg }) }).catch(() => {});
    } finally { setSending(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [text, selected, adminUid, adminName, sending]);

  const filtered = convs.filter(c => !search || c.orderId?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* List */}
      <div className="w-72 border-r border-gray-100 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-50">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Search order..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-gray-400 text-xs">Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-gray-400">
              <MessageCircle size={28} className="mx-auto mb-1 opacity-20" />
              <p className="text-xs font-semibold">No support chats</p>
              <p className="text-[10px] mt-1">Customers ask for help from the order page</p>
            </div>
          )}
          {filtered.map(conv => {
            const unread = conv.unreadCount?.support ?? 0;
            const isActive = selected?.id === conv.id;
            return (
              <button key={conv.id} onClick={() => open(conv)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 flex items-center gap-2.5 transition-colors
                  ${isActive ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'}`}>
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold flex-shrink-0">
                  {(conv.orderId || conv.id).slice(-2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-gray-900">Order #{(conv.orderId || conv.id).slice(-6).toUpperCase()}</p>
                  <p className="text-[10px] text-gray-400 truncate">{conv.lastMessage || 'No messages'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[9px] text-gray-400">{tLabel(conv.lastAt || conv.updatedAt)}</span>
                  {unread > 0 && <span className="min-w-[16px] h-4 bg-orange-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5">{unread > 9 ? '9+' : unread}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 md:hidden"><ChevronLeft size={18} /></button>
            <Headphones size={15} className="text-orange-500" />
            <div>
              <p className="font-bold text-sm text-gray-900">Order #{selected.orderId?.slice(-6).toUpperCase()}</p>
              <p className="text-xs text-gray-400">Customer Support</p>
            </div>
            <span className="ml-auto text-xs text-gray-400 flex items-center gap-1"><Clock size={11} />{tLabel(selected.lastAt)}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ background: 'linear-gradient(135deg,#fef7f0,#fff8f5)' }}>
            {messages.length === 0 && <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-1"><MessageCircle size={32} className="opacity-15" /><p className="text-sm">No messages yet</p></div>}
            {messages.map(msg => <Bubble key={msg.id} msg={msg} isMine={msg.senderId === adminUid} />)}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 py-2.5 border-t border-gray-100 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <input ref={inputRef} className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Reply as ManaBites Support..." value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} disabled={sending} />
              <button onClick={send} disabled={!text.trim() || sending}
                className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center disabled:opacity-40">
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
          <Headphones size={40} className="opacity-15" />
          <p className="text-sm font-semibold">Select a support chat</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Direct Chat (admin → customer / rider / restaurant)
// ═══════════════════════════════════════════════════════════════════════════════
type DTab = 'customer' | 'rider' | 'restaurant';

interface Person { id: string; name: string; phone?: string; avatar?: string; }
interface DChat {
  id: string; targetId: string; targetName: string; targetType: string;
  lastMessage?: string; lastAt?: any; unreadCount?: Record<string, number>;
}

const DTABS: { key: DTab; label: string; icon: React.ReactNode; col: string }[] = [
  { key: 'customer',   label: 'Customers',   icon: <Users  size={13} />, col: 'users'       },
  { key: 'rider',      label: 'Riders',      icon: <Bike   size={13} />, col: 'riders'      },
  { key: 'restaurant', label: 'Restaurants', icon: <Store  size={13} />, col: 'restaurants' },
];

function DirectChatTab({ adminUid, adminName }: { adminUid: string; adminName: string }) {
  const [dtab,    setDtab]    = useState<DTab>('customer');
  const [people,  setPeople]  = useState<Person[]>([]);
  const [recent,  setRecent]  = useState<DChat[]>([]);
  const [search,  setSearch]  = useState('');
  const [sel,     setSel]     = useState<{ person: Person; chatId: string } | null>(null);
  const [msgs,    setMsgs]    = useState<Msg[]>([]);
  const [text,    setText]    = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true); setSearch('');
    const cfg = DTABS.find(t => t.key === dtab)!;
    const q = query(collection(db, cfg.col), limit(150));
    return onSnapshot(q, snap => {
      setPeople(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, name: data.name || data.ownerName || data.displayName || 'Unknown', phone: data.phone || '', avatar: data.profileImage || data.logo || '' };
      }).sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, () => setLoading(false));
  }, [dtab]);

  useEffect(() => {
    if (!adminUid) return;
    const q = query(collection(db, 'adminDirectChats'), where('adminId', '==', adminUid), limit(100));
    return onSnapshot(q, snap => setRecent(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DChat).filter(c => c.lastMessage)), () => {});
  }, [adminUid]);

  useEffect(() => {
    if (!sel) { setMsgs([]); return; }
    const q = query(collection(db, 'adminDirectChats', sel.chatId, 'messages'), orderBy('createdAt', 'asc'), limit(150));
    return onSnapshot(q, snap => setMsgs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Msg)), () => {});
  }, [sel?.chatId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const openChat = useCallback(async (person: Person) => {
    if (!adminUid) return;
    const chatId = `admin_${dtab}_${person.id}`;
    await setDoc(doc(db, 'adminDirectChats', chatId), {
      adminId: adminUid, adminName, targetId: person.id, targetName: person.name, targetType: dtab, updatedAt: serverTimestamp(),
    }, { merge: true });
    await updateDoc(doc(db, 'adminDirectChats', chatId), { 'unreadCount.admin': 0 }).catch(() => {});
    setSel({ person, chatId }); setMsgs([]);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [adminUid, adminName, dtab]);

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg || !sel || !adminUid || sending) return;
    setSending(true); setText('');
    try {
      await addDoc(collection(db, 'adminDirectChats', sel.chatId, 'messages'), {
        senderId: adminUid, senderRole: 'admin', senderName: adminName,
        text: msg, type: 'text', readBy: [adminUid], createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'adminDirectChats', sel.chatId), {
        lastMessage: msg, lastSenderId: adminUid, lastAt: serverTimestamp(), 'unreadCount.target': increment(1),
      });
    } finally { setSending(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [text, sel, adminUid, adminName, sending]);

  const filtered = people.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.phone || '').includes(search));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: people list */}
      <div className="w-72 border-r border-gray-100 flex flex-col flex-shrink-0">
        {/* Sub-tabs */}
        <div className="p-2 border-b border-gray-100">
          <div className="flex rounded-xl bg-gray-100 p-0.5 gap-0.5">
            {DTABS.map(t => (
              <button key={t.key} onClick={() => { setDtab(t.key); setSel(null); }}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition-all
                  ${dtab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Search */}
        <div className="px-2 py-1.5 border-b border-gray-50">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder={`Search ${dtab}s...`} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-6 text-center text-gray-400 text-xs">Loading...</div>
          : filtered.length === 0 ? <div className="p-6 text-center text-gray-400 text-xs">No results</div>
          : filtered.map(person => {
            const rc = recent.find(c => c.targetId === person.id && c.targetType === dtab);
            const unread = rc?.unreadCount?.admin ?? 0;
            const isActive = sel?.person.id === person.id;
            const initials = person.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
            return (
              <button key={person.id} onClick={() => openChat(person)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 flex items-center gap-2.5 transition-colors
                  ${isActive ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'}`}>
                <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {person.avatar ? <img src={person.avatar} alt="" className="w-full h-full object-cover" />
                    : <span className="text-[10px] font-bold text-gray-500">{initials || '?'}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-gray-900 truncate">{person.name}</p>
                  {rc?.lastMessage
                    ? <p className="text-[10px] text-gray-400 truncate">{rc.lastMessage}</p>
                    : <p className="text-[10px] text-gray-300">{person.phone}</p>}
                </div>
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  {rc?.lastAt && <span className="text-[9px] text-gray-400">{tLabel(rc.lastAt)}</span>}
                  {unread > 0 && <span className="min-w-[16px] h-4 bg-orange-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5">{unread > 9 ? '9+' : unread}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      {sel ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2.5 flex-shrink-0">
            <button onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-600 md:hidden"><ChevronLeft size={18} /></button>
            <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              {sel.person.avatar ? <img src={sel.person.avatar} alt="" className="w-full h-full object-cover" />
                : <span className="text-xs font-bold text-gray-500">{sel.person.name.slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
              <p className="font-bold text-sm text-gray-900">{sel.person.name}</p>
              <p className="text-xs text-gray-400 capitalize">{dtab} · {sel.person.phone}</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ background: 'linear-gradient(135deg,#fef7f0,#fff8f5)' }}>
            {msgs.length === 0 && <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-1"><MessageCircle size={32} className="opacity-15" /><p className="text-sm">Start the conversation</p></div>}
            {msgs.map(msg => <Bubble key={msg.id} msg={msg} isMine={msg.senderId === adminUid} />)}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 py-2.5 border-t border-gray-100 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <input ref={inputRef} className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder={`Message ${sel.person.name}...`} value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} disabled={sending} />
              <button onClick={send} disabled={!text.trim() || sending}
                className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center disabled:opacity-40">
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
          <MessageCircle size={40} className="opacity-15" />
          <p className="text-sm font-semibold">Select a {dtab} to chat</p>
          <p className="text-xs">{people.length} {dtab}s available</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════
export default function ManaBitesSupport() {
  const { user, profile } = useAuth();
  const adminUid  = user?.uid ?? '';
  const adminName = profile?.name || 'ManaBites Support';

  const [tab, setTab] = useState<'support' | 'direct'>('support');

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100">
      {/* Top header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-shrink-0 bg-gradient-to-r from-orange-50 to-white">
        <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center">
          <Headphones size={18} className="text-white" />
        </div>
        <div>
          <h1 className="font-black text-gray-900 text-base">ManaBites Support</h1>
          <p className="text-xs text-gray-400">Chat with customers, riders and restaurants</p>
        </div>

        {/* Main tabs */}
        <div className="ml-auto flex gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab('support')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
              ${tab === 'support' ? 'bg-white shadow text-orange-500' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Headphones size={13} />Customer Support
          </button>
          <button
            onClick={() => setTab('direct')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
              ${tab === 'direct' ? 'bg-white shadow text-orange-500' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MessageCircle size={13} />Direct Chat
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {tab === 'support'
          ? <CustomerSupportTab adminUid={adminUid} adminName={adminName} />
          : <DirectChatTab      adminUid={adminUid} adminName={adminName} />
        }
      </div>
    </div>
  );
}
