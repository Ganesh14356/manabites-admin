import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  collection, query, orderBy, limit, onSnapshot, Timestamp, startAfter, getDocs, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Activity, Search, Download, Filter, UserPlus, Edit2, PauseCircle,
  CheckCircle2, Trash2, Key, ShieldCheck, Store, RefreshCw, DollarSign,
  LogIn, LogOut, ChevronRight, ChevronLeft, Clock,
} from 'lucide-react';
import type { AuditAction } from '../../services/auditLog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityName: string;
  adminUid: string;
  adminName: string;
  adminEmail: string;
  details: Record<string, unknown>;
  timestamp: Timestamp;
  userAgent?: string;
}

// ── Action Config ─────────────────────────────────────────────────────────────

const ACTION_CONFIG: Partial<Record<AuditAction, { label: string; color: string; bg: string; icon: React.ReactNode }>> = {
  SUBADMIN_CREATED:            { label: 'Sub-Admin Created',    color: 'text-green-700',  bg: 'bg-green-100',  icon: <UserPlus className="w-3.5 h-3.5" /> },
  SUBADMIN_EDITED:             { label: 'Sub-Admin Edited',     color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <Edit2 className="w-3.5 h-3.5" /> },
  SUBADMIN_SUSPENDED:          { label: 'Sub-Admin Suspended',  color: 'text-yellow-700', bg: 'bg-yellow-100', icon: <PauseCircle className="w-3.5 h-3.5" /> },
  SUBADMIN_ACTIVATED:          { label: 'Sub-Admin Activated',  color: 'text-green-700',  bg: 'bg-green-100',  icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  SUBADMIN_DELETED:            { label: 'Sub-Admin Deleted',    color: 'text-red-700',    bg: 'bg-red-100',    icon: <Trash2 className="w-3.5 h-3.5" /> },
  SUBADMIN_PASSWORD_RESET:     { label: 'Password Reset',       color: 'text-purple-700', bg: 'bg-purple-100', icon: <Key className="w-3.5 h-3.5" /> },
  SUBADMIN_PERMISSIONS_CHANGED:{ label: 'Permissions Changed',  color: 'text-indigo-700', bg: 'bg-indigo-100', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  RIDER_CREATED:               { label: 'Rider Created',        color: 'text-teal-700',   bg: 'bg-teal-100',   icon: <UserPlus className="w-3.5 h-3.5" /> },
  RIDER_APPROVED:              { label: 'Rider Approved',       color: 'text-green-700',  bg: 'bg-green-100',  icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  RIDER_REJECTED:              { label: 'Rider Rejected',       color: 'text-red-700',    bg: 'bg-red-100',    icon: <Trash2 className="w-3.5 h-3.5" /> },
  RIDER_SUSPENDED:             { label: 'Rider Suspended',      color: 'text-yellow-700', bg: 'bg-yellow-100', icon: <PauseCircle className="w-3.5 h-3.5" /> },
  RIDER_DELETED:               { label: 'Rider Deleted',        color: 'text-red-700',    bg: 'bg-red-100',    icon: <Trash2 className="w-3.5 h-3.5" /> },
  RESTAURANT_APPROVED:         { label: 'Restaurant Approved',  color: 'text-green-700',  bg: 'bg-green-100',  icon: <Store className="w-3.5 h-3.5" /> },
  RESTAURANT_REJECTED:         { label: 'Restaurant Rejected',  color: 'text-red-700',    bg: 'bg-red-100',    icon: <Store className="w-3.5 h-3.5" /> },
  REFUND_PROCESSED:            { label: 'Refund Processed',     color: 'text-orange-700', bg: 'bg-orange-100', icon: <RefreshCw className="w-3.5 h-3.5" /> },
  PAYOUT_RELEASED:             { label: 'Payout Released',      color: 'text-green-700',  bg: 'bg-green-100',  icon: <DollarSign className="w-3.5 h-3.5" /> },
  COMMISSION_CHANGED:          { label: 'Commission Changed',   color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <DollarSign className="w-3.5 h-3.5" /> },
  ADMIN_LOGIN:                 { label: 'Admin Login',          color: 'text-gray-700',   bg: 'bg-gray-100',   icon: <LogIn className="w-3.5 h-3.5" /> },
  ADMIN_LOGOUT:                { label: 'Admin Logout',         color: 'text-gray-700',   bg: 'bg-gray-100',   icon: <LogOut className="w-3.5 h-3.5" /> },
};

const ACTION_GROUPS: Record<string, AuditAction[]> = {
  'Sub-Admin': ['SUBADMIN_CREATED','SUBADMIN_EDITED','SUBADMIN_SUSPENDED','SUBADMIN_ACTIVATED','SUBADMIN_DELETED','SUBADMIN_PASSWORD_RESET','SUBADMIN_PERMISSIONS_CHANGED'],
  'Riders': ['RIDER_CREATED','RIDER_APPROVED','RIDER_REJECTED','RIDER_SUSPENDED','RIDER_DELETED'],
  'Restaurants': ['RESTAURANT_APPROVED','RESTAURANT_REJECTED','RESTAURANT_SUSPENDED'],
  'Finance': ['REFUND_PROCESSED','PAYOUT_RELEASED','COMMISSION_CHANGED'],
  'Auth': ['ADMIN_LOGIN','ADMIN_LOGOUT'],
};

function fmtTs(ts?: Timestamp): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function relativeTime(ts?: Timestamp): string {
  if (!ts) return '';
  const diff = Date.now() - ts.toDate().getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function downloadCSV(logs: AuditLog[]) {
  const H = ['Time','Action','Admin','Admin Email','Entity Type','Entity','Details'];
  const rows = logs.map(l => [
    fmtTs(l.timestamp),
    ACTION_CONFIG[l.action]?.label ?? l.action,
    l.adminName || '—', l.adminEmail || '—',
    l.entityType, l.entityName,
    JSON.stringify(l.details ?? {}),
  ]);
  const csv = [H, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `activity-logs-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── Component ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function ActivityLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<AuditAction | ''>('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterAdmin, setFilterAdmin] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(500));
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const groupActions = filterGroup ? ACTION_GROUPS[filterGroup] ?? [] : [];
    return logs.filter(l => {
      if (q && !l.adminName?.toLowerCase().includes(q) && !l.adminEmail?.toLowerCase().includes(q) && !l.entityName?.toLowerCase().includes(q)) return false;
      if (filterAction && l.action !== filterAction) return false;
      if (filterGroup && !groupActions.includes(l.action)) return false;
      if (filterAdmin && !l.adminEmail?.toLowerCase().includes(filterAdmin.toLowerCase())) return false;
      if (dateFrom && l.timestamp) {
        if (l.timestamp.toDate() < new Date(dateFrom)) return false;
      }
      if (dateTo && l.timestamp) {
        const end = new Date(dateTo); end.setDate(end.getDate() + 1);
        if (l.timestamp.toDate() > end) return false;
      }
      return true;
    });
  }, [logs, search, filterAction, filterGroup, filterAdmin, dateFrom, dateTo]);

  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageLogs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const allAdmins = useMemo(() => [...new Set(logs.map(l => l.adminEmail).filter(Boolean))], [logs]);

  // Today's count
  const todayCount = useMemo(() => {
    const midnight = new Date(); midnight.setHours(0,0,0,0);
    return logs.filter(l => l.timestamp && l.timestamp.toDate() >= midnight).length;
  }, [logs]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 pb-16 space-y-5">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Activity className="w-7 h-7 text-brand" />
              Activity Logs
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Complete audit trail of all admin actions — {logs.length.toLocaleString()} total records
            </p>
          </div>
          <button onClick={() => downloadCSV(filtered)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Logs', value: logs.length.toLocaleString(), color: 'text-gray-700', bg: 'bg-gray-100' },
          { label: 'Today', value: todayCount, color: 'text-blue-700', bg: 'bg-blue-100' },
          { label: 'Unique Admins', value: allAdmins.length, color: 'text-purple-700', bg: 'bg-purple-100' },
          { label: 'Filtered', value: filtered.length.toLocaleString(), color: 'text-orange-700', bg: 'bg-orange-100' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4">
            <div className="text-2xl font-black text-gray-800 dark:text-gray-100">{s.value}</div>
            <div className="text-xs text-gray-400 font-semibold">{s.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search admin, entity…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>

          {/* Group filter */}
          <select value={filterGroup} onChange={e => { setFilterGroup(e.target.value); setFilterAction(''); }}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none">
            <option value="">All Categories</option>
            {Object.keys(ACTION_GROUPS).map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          {/* Admin filter */}
          {allAdmins.length > 0 && (
            <select value={filterAdmin} onChange={e => setFilterAdmin(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none">
              <option value="">All Admins</option>
              {allAdmins.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          {/* Date range */}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none" />

          {(search || filterGroup || filterAction || filterAdmin || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(''); setFilterGroup(''); setFilterAction(''); setFilterAdmin(''); setDateFrom(''); setDateTo(''); setPage(0); }}
              className="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Log Table */}
      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card py-16 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">Loading activity logs…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card py-16 text-center">
          <Activity className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No activity logs found</p>
          <p className="text-gray-300 text-sm mt-1">Actions by admins will appear here</p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="table-header">Time</th>
                    <th className="table-header">Action</th>
                    <th className="table-header">Admin</th>
                    <th className="table-header">Entity</th>
                    <th className="table-header">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLogs.map((log, i) => {
                    const cfg = ACTION_CONFIG[log.action];
                    return (
                      <motion.tr key={log.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.015 }}
                        className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="table-cell whitespace-nowrap">
                          <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{fmtTs(log.timestamp)}</div>
                          <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5" />{relativeTime(log.timestamp)}
                          </div>
                        </td>
                        <td className="table-cell">
                          {cfg ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black ${cfg.color} ${cfg.bg}`}>
                              {cfg.icon}{cfg.label}
                            </span>
                          ) : (
                            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{log.action}</span>
                          )}
                        </td>
                        <td className="table-cell">
                          {log.adminName ? (
                            <div>
                              <div className="font-bold text-gray-700 dark:text-gray-200 text-xs">{log.adminName}</div>
                              <div className="text-[10px] text-gray-400">{log.adminEmail}</div>
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs">System</span>
                          )}
                        </td>
                        <td className="table-cell">
                          <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{log.entityName || '—'}</div>
                          {log.entityType && (
                            <div className="text-[10px] text-gray-400 capitalize">{log.entityType}</div>
                          )}
                        </td>
                        <td className="table-cell">
                          {log.details && Object.keys(log.details).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(log.details).slice(0, 3).map(([k, v]) => (
                                <span key={k} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono text-gray-500">
                                  {k}: {String(v).slice(0, 20)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-300 text-[11px]">—</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-2xl shadow-card px-5 py-3">
              <span className="text-sm text-gray-400 font-medium">
                Page {page + 1} of {pages} — {filtered.length} records
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 disabled:opacity-40 hover:bg-gray-200 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                  const p = Math.max(0, Math.min(pages - 5, page - 2)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                        p === page ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {p + 1}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
                  className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 disabled:opacity-40 hover:bg-gray-200 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
