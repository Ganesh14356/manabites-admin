import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, doc, onSnapshot, query, orderBy,
  setDoc, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  MessageCircle, Check, X, Edit2, Save, Eye, EyeOff,
  Bell, ShoppingBag, Bike, CheckCircle, AlertTriangle, Info,
  RefreshCw, Send,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageProvider = 'gallabox' | 'twilio' | 'msg91';

interface AutomationConfig {
  provider: MessageProvider;
  gallaboxApiKey?: string;
  gallaboxChannelId?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFrom?: string;
  msg91AuthKey?: string;
  msg91SenderId?: string;
  enabled: boolean;
  updatedAt?: Timestamp;
}

type TriggerKey =
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_ready'
  | 'order_picked_up'
  | 'order_delivered'
  | 'order_cancelled'
  | 'rider_assigned';

interface MessageTemplate {
  key: TriggerKey;
  enabled: boolean;
  message: string;
}

interface SentMessage {
  id: string;
  phone: string;
  message: string;
  trigger: TriggerKey;
  orderId?: string;
  status: 'sent' | 'failed';
  createdAt: Timestamp;
}

const TRIGGER_META: Record<TriggerKey, { label: string; icon: React.ReactNode; color: string; desc: string }> = {
  order_confirmed:  { label: 'Order Confirmed',  icon: <ShoppingBag className="w-4 h-4" />, color: 'text-green-700 bg-green-100',  desc: 'Sent when customer places order' },
  order_preparing:  { label: 'Preparing',         icon: <RefreshCw className="w-4 h-4" />,   color: 'text-yellow-700 bg-yellow-100', desc: 'Restaurant starts cooking' },
  order_ready:      { label: 'Ready for Pickup',  icon: <Bell className="w-4 h-4" />,         color: 'text-blue-700 bg-blue-100',    desc: 'Food is ready, rider en route' },
  order_picked_up:  { label: 'Picked Up',         icon: <Bike className="w-4 h-4" />,         color: 'text-orange-700 bg-orange-100',desc: 'Rider has picked up the food' },
  order_delivered:  { label: 'Delivered',          icon: <CheckCircle className="w-4 h-4" />, color: 'text-emerald-700 bg-emerald-100', desc: 'Order delivered successfully' },
  order_cancelled:  { label: 'Cancelled',          icon: <X className="w-4 h-4" />,            color: 'text-red-700 bg-red-100',      desc: 'Order was cancelled' },
  rider_assigned:   { label: 'Rider Assigned',     icon: <Bike className="w-4 h-4" />,         color: 'text-purple-700 bg-purple-100',desc: 'Rider assigned to order' },
};

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  { key: 'order_confirmed',  enabled: true, message: 'Hi {name}! ✅ Your order #{orderId} has been confirmed. Estimated delivery: {eta} mins. Track here: {trackingUrl}' },
  { key: 'order_preparing',  enabled: false, message: 'Hi {name}! 👨‍🍳 {restaurantName} is now preparing your order #{orderId}.' },
  { key: 'order_ready',      enabled: false, message: 'Hi {name}! 📦 Your order #{orderId} is ready and waiting for pickup by your rider.' },
  { key: 'order_picked_up',  enabled: true,  message: 'Hi {name}! 🛵 Your order #{orderId} has been picked up and is on the way! Track live: {trackingUrl}' },
  { key: 'order_delivered',  enabled: true,  message: 'Hi {name}! ✨ Your order #{orderId} has been delivered. Enjoy your meal! Rate your experience in the app.' },
  { key: 'order_cancelled',  enabled: true,  message: 'Hi {name}! ❌ Your order #{orderId} has been cancelled. Refund (if applicable) will reflect in 3-5 days.' },
  { key: 'rider_assigned',   enabled: false, message: 'Hi {name}! 🏍️ Rider {riderName} ({riderPhone}) is assigned to your order #{orderId}.' },
];

const VARIABLES = ['{name}', '{orderId}', '{restaurantName}', '{riderName}', '{riderPhone}', '{eta}', '{trackingUrl}'];

const DEFAULT_CONFIG: AutomationConfig = {
  provider: 'gallabox',
  enabled: false,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppAutomation() {
  const [config, setConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const [templates, setTemplates] = useState<MessageTemplate[]>(DEFAULT_TEMPLATES);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [editingKey, setEditingKey] = useState<TriggerKey | null>(null);
  const [editMsg, setEditMsg] = useState('');

  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);

  const [activeTab, setActiveTab] = useState<'config' | 'templates' | 'history'>('config');

  // Load config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'appSettings', 'whatsappConfig'), snap => {
      if (snap.exists()) setConfig({ ...DEFAULT_CONFIG, ...(snap.data() as AutomationConfig) });
    });
    return () => unsub();
  }, []);

  // Load templates
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'appSettings', 'whatsappTemplates'), snap => {
      if (snap.exists()) {
        const data = snap.data() as { templates: MessageTemplate[] };
        if (data.templates) setTemplates(data.templates);
      }
    });
    return () => unsub();
  }, []);

  // Load sent message history
  useEffect(() => {
    const q = query(collection(db, 'whatsappLog'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, snap => {
      setSentMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as SentMessage)));
      setLoadingMsgs(false);
    }, () => setLoadingMsgs(false));
    return () => unsub();
  }, []);

  async function saveConfig() {
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'appSettings', 'whatsappConfig'), { ...config, updatedAt: serverTimestamp() });
      toast.success('Configuration saved');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSavingConfig(false);
    }
  }

  async function saveTemplates() {
    setSavingTemplates(true);
    try {
      await setDoc(doc(db, 'appSettings', 'whatsappTemplates'), { templates, updatedAt: serverTimestamp() });
      toast.success('Templates saved');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSavingTemplates(false);
    }
  }

  function toggleTemplate(key: TriggerKey) {
    setTemplates(ts => ts.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t));
  }

  function startEditTemplate(t: MessageTemplate) {
    setEditingKey(t.key);
    setEditMsg(t.message);
  }

  function saveTemplateEdit() {
    if (!editingKey) return;
    setTemplates(ts => ts.map(t => t.key === editingKey ? { ...t, message: editMsg } : t));
    setEditingKey(null);
  }

  function insertVariable(v: string) {
    setEditMsg(m => m + v);
  }

  function formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const enabledCount = templates.filter(t => t.enabled).length;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <MessageCircle className="w-7 h-7 text-green-500" />
              WhatsApp / SMS Automation
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Auto-send order updates via WhatsApp (Gallabox) or SMS (Twilio / MSG91)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-black ${config.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {config.enabled ? '● Active' : '○ Inactive'}
            </span>
            <span className="text-xs text-gray-400">{enabledCount}/{templates.length} triggers on</span>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {[
          { key: 'config',    label: '⚙️ Provider' },
          { key: 'templates', label: '💬 Templates' },
          { key: 'history',   label: '📋 Log' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === t.key
                ? 'bg-white dark:bg-gray-900 text-brand shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Provider Config ── */}
        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-6 space-y-6"
          >
            {/* Enable toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div>
                <p className="font-bold text-gray-800 dark:text-gray-100">Enable WhatsApp/SMS Automation</p>
                <p className="text-xs text-gray-400 mt-0.5">Messages will be sent automatically on order status changes</p>
              </div>
              <button
                onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                className="relative inline-flex h-7 w-12 cursor-pointer items-center rounded-full transition-colors"
                style={{ backgroundColor: config.enabled ? '#22c55e' : '#d1d5db' }}
              >
                <motion.span
                  layout
                  className="inline-block h-5 w-5 rounded-full bg-white shadow"
                  animate={{ x: config.enabled ? 24 : 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            {/* Provider select */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Provider</label>
              <div className="grid grid-cols-3 gap-3">
                {(['gallabox', 'twilio', 'msg91'] as MessageProvider[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setConfig(c => ({ ...c, provider: p }))}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-bold transition-all capitalize ${
                      config.provider === p
                        ? 'border-green-400 bg-green-50 text-green-700 dark:bg-green-950/30'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {p === 'gallabox' ? 'Gallabox' : p === 'msg91' ? 'MSG91' : 'Twilio'}
                  </button>
                ))}
              </div>
            </div>

            {/* Credentials */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Credentials</label>
                <button
                  onClick={() => setShowSecrets(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showSecrets ? 'Hide' : 'Show'} secrets
                </button>
              </div>

              {config.provider === 'gallabox' && (
                <>
                  <CredField label="API Key" value={config.gallaboxApiKey || ''} show={showSecrets}
                    onChange={v => setConfig(c => ({ ...c, gallaboxApiKey: v }))} placeholder="gbox_..." />
                  <CredField label="Channel ID" value={config.gallaboxChannelId || ''} show={showSecrets}
                    onChange={v => setConfig(c => ({ ...c, gallaboxChannelId: v }))} placeholder="Channel ID" />
                </>
              )}

              {config.provider === 'twilio' && (
                <>
                  <CredField label="Account SID" value={config.twilioAccountSid || ''} show={showSecrets}
                    onChange={v => setConfig(c => ({ ...c, twilioAccountSid: v }))} placeholder="AC..." />
                  <CredField label="Auth Token" value={config.twilioAuthToken || ''} show={showSecrets}
                    onChange={v => setConfig(c => ({ ...c, twilioAuthToken: v }))} placeholder="Auth token" />
                  <CredField label="From Number" value={config.twilioFrom || ''} show={true}
                    onChange={v => setConfig(c => ({ ...c, twilioFrom: v }))} placeholder="+1415..." />
                </>
              )}

              {config.provider === 'msg91' && (
                <>
                  <CredField label="Auth Key" value={config.msg91AuthKey || ''} show={showSecrets}
                    onChange={v => setConfig(c => ({ ...c, msg91AuthKey: v }))} placeholder="MSG91 auth key" />
                  <CredField label="Sender ID" value={config.msg91SenderId || ''} show={true}
                    onChange={v => setConfig(c => ({ ...c, msg91SenderId: v }))} placeholder="MANAB" />
                </>
              )}
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-xs text-amber-700 dark:text-amber-300">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              These credentials are stored in Firestore and read by your Firebase Cloud Function. Keep them secure and never commit to version control.
            </div>

            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {savingConfig ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Configuration
            </button>
          </motion.div>
        )}

        {/* ── Templates ── */}
        {activeTab === 'templates' && (
          <motion.div
            key="templates"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Message Templates</p>
                <button
                  onClick={saveTemplates}
                  disabled={savingTemplates}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-xl text-xs font-bold hover:bg-orange-600 disabled:opacity-60 transition-colors"
                >
                  {savingTemplates ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save All
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VARIABLES.map(v => (
                  <button
                    key={v}
                    onClick={() => editingKey && insertVariable(v)}
                    disabled={!editingKey}
                    className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-[11px] font-bold rounded hover:bg-blue-100 disabled:opacity-40 transition-colors"
                  >
                    {v}
                  </button>
                ))}
                {!editingKey && <span className="text-xs text-gray-400 self-center">Click Edit on a template to use variables</span>}
              </div>
            </div>

            <div className="space-y-3">
              {templates.map(t => {
                const meta = TRIGGER_META[t.key];
                const isEditing = editingKey === t.key;
                return (
                  <motion.div
                    key={t.key}
                    layout
                    className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
                  >
                    <div className="px-5 py-4 flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-800 dark:text-gray-100">{meta.label}</p>
                        <p className="text-xs text-gray-400">{meta.desc}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button
                          onClick={() => toggleTemplate(t.key)}
                          className="relative inline-flex h-6 w-10 cursor-pointer items-center rounded-full transition-colors"
                          style={{ backgroundColor: t.enabled ? '#f97316' : '#d1d5db' }}
                        >
                          <motion.span
                            layout
                            className="inline-block h-4 w-4 rounded-full bg-white shadow"
                            animate={{ x: t.enabled ? 20 : 4 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                        </button>
                        <button
                          onClick={() => isEditing ? saveTemplateEdit() : startEditTemplate(t)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            isEditing
                              ? 'bg-green-600 text-white hover:bg-green-700'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-orange-50 hover:text-brand'
                          }`}
                        >
                          {isEditing ? <><Check className="w-3.5 h-3.5" />Save</> : <><Edit2 className="w-3.5 h-3.5" />Edit</>}
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isEditing && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-5">
                            <textarea
                              value={editMsg}
                              onChange={e => setEditMsg(e.target.value)}
                              rows={4}
                              className="w-full px-4 py-3 border border-brand rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none font-mono"
                            />
                            <p className="text-xs text-gray-400 mt-1.5">{editMsg.length} characters</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {!isEditing && (
                      <div className="px-5 pb-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-800 rounded-lg p-3 leading-relaxed">
                          {t.message}
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Log ── */}
        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-black text-gray-800 dark:text-gray-100">Message Log</h3>
              <p className="text-xs text-gray-400 mt-0.5">Last 50 WhatsApp/SMS messages sent</p>
            </div>
            {loadingMsgs ? (
              <div className="py-16 text-center text-gray-400">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full mx-auto mb-3" />
                Loading...
              </div>
            ) : sentMessages.length === 0 ? (
              <div className="py-16 text-center">
                <MessageCircle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-semibold">No messages sent yet</p>
                <p className="text-gray-300 text-sm mt-1">Messages appear here once automation is active</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="table-header">Phone</th>
                      <th className="table-header">Trigger</th>
                      <th className="table-header">Order</th>
                      <th className="table-header">Message</th>
                      <th className="table-header">Status</th>
                      <th className="table-header">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentMessages.map(msg => {
                      const meta = TRIGGER_META[msg.trigger];
                      return (
                        <tr key={msg.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <td className="table-cell font-mono text-xs text-gray-600 dark:text-gray-300">{msg.phone}</td>
                          <td className="table-cell">
                            <span className={`flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[11px] font-bold ${meta?.color || 'bg-gray-100 text-gray-500'}`}>
                              {meta?.icon}
                              {meta?.label || msg.trigger}
                            </span>
                          </td>
                          <td className="table-cell font-mono text-xs text-gray-400">{msg.orderId ? msg.orderId.slice(0, 8).toUpperCase() : '—'}</td>
                          <td className="table-cell max-w-xs">
                            <p className="text-xs text-gray-500 truncate">{msg.message}</p>
                          </td>
                          <td className="table-cell">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${msg.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {msg.status}
                            </span>
                          </td>
                          <td className="table-cell text-xs text-gray-400">{formatDate(msg.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function CredField({ label, value, show, onChange, placeholder }: {
  label: string; value: string; show: boolean;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">{label}</label>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </div>
  );
}
