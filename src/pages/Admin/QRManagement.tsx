import { useState, useEffect } from 'react';
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc,
  updateDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  QrCode, Download, Trash2, Plus, RefreshCw, Table2, Store,
  ToggleLeft, ToggleRight, Copy, Eye, EyeOff, Printer,
} from 'lucide-react';
import QRCodeLib from 'qrcode';

const BASE_URL = 'https://manabites.in/dine-in';

function generateQRDataURL(text: string, size = 300): Promise<string> {
  return QRCodeLib.toDataURL(text, { width: size, margin: 2 });
}

function randomOTP(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

interface TableDoc {
  id: string;
  tableNumber: string;
  label?: string;
  restaurantId: string;
  isActive: boolean;
  otp: string;
  createdAt?: any;
}

interface Restaurant {
  id: string;
  name: string;
  qrOrderingEnabled?: boolean;
}

export default function QRManagement() {
  const [restaurants, setRestaurants]     = useState<Restaurant[]>([]);
  const [selectedRest, setSelectedRest]   = useState<Restaurant | null>(null);
  const [tables, setTables]               = useState<TableDoc[]>([]);
  const [loadingRest, setLoadingRest]     = useState(true);
  const [loadingTables, setLoadingTables] = useState(false);
  const [newTableNum, setNewTableNum]     = useState('');
  const [bulkCount, setBulkCount]         = useState(10);
  const [generating, setGenerating]       = useState(false);
  const [restaurantQR, setRestaurantQR]   = useState<string>('');
  const [loadingQR, setLoadingQR]         = useState(false);
  const [visibleOTPs, setVisibleOTPs]     = useState<Record<string, boolean>>({});

  // Load restaurants
  useEffect(() => {
    getDocs(collection(db, 'restaurants')).then(snap => {
      setRestaurants(snap.docs.map(d => ({ id: d.id, ...d.data() } as Restaurant)));
      setLoadingRest(false);
    });
  }, []);

  // Load tables when restaurant selected
  useEffect(() => {
    if (!selectedRest) return;
    setLoadingTables(true);
    setRestaurantQR('');
    const q = query(collection(db, 'qr_tables'), where('restaurantId', '==', selectedRest.id));
    const unsub = onSnapshot(
      q,
      snap => {
        const t = snap.docs.map(d => ({ id: d.id, ...d.data() } as TableDoc));
        setTables(t.sort((a, b) => (parseInt(a.tableNumber) || 0) - (parseInt(b.tableNumber) || 0)));
        setLoadingTables(false);
      },
      err => {
        toast.error('Tables load failed: ' + err.message);
        setLoadingTables(false);
      },
    );
    // Generate the single restaurant QR
    setLoadingQR(true);
    const qrUrl = `${BASE_URL}/${selectedRest.id}`;
    generateQRDataURL(qrUrl, 320).then(url => {
      setRestaurantQR(url);
      setLoadingQR(false);
    });
    return unsub;
  }, [selectedRest?.id]);

  const addTable = async () => {
    if (!selectedRest || !newTableNum.trim()) return;
    const num     = newTableNum.trim();
    const tableId = `${selectedRest.id}_T${num}`;
    try {
      await setDoc(doc(db, 'qr_tables', tableId), {
        tableNumber:  num,
        label:        `Table ${num}`,
        restaurantId: selectedRest.id,
        isActive:     true,
        otp:          randomOTP(),
        createdAt:    serverTimestamp(),
      });
      setNewTableNum('');
      toast.success(`Table ${num} added`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const addBulkTables = async () => {
    if (!selectedRest || bulkCount < 1 || generating) return;
    setGenerating(true);
    const existing = new Set(tables.map(t => t.tableNumber));
    let added = 0;
    try {
      for (let i = 1; i <= bulkCount; i++) {
        const num = String(i);
        if (existing.has(num)) continue;
        await setDoc(doc(db, 'qr_tables', `${selectedRest.id}_T${num}`), {
          tableNumber:  num,
          label:        `Table ${num}`,
          restaurantId: selectedRest.id,
          isActive:     true,
          otp:          randomOTP(),
          createdAt:    serverTimestamp(),
        });
        added++;
      }
      toast.success(`${added} tables added`);
    } catch (e: any) {
      toast.error('Bulk generate failed: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const deleteTable = async (tableId: string) => {
    if (!confirm('Delete this table?')) return;
    try {
      await deleteDoc(doc(db, 'qr_tables', tableId));
      toast.success('Table deleted');
    } catch (e: any) {
      toast.error('Delete failed: ' + e.message);
    }
  };

  const toggleTable = async (table: TableDoc) => {
    try {
      await updateDoc(doc(db, 'qr_tables', table.id), { isActive: !table.isActive });
    } catch (e: any) {
      toast.error('Toggle failed: ' + e.message);
    }
  };

  const regenerateOTP = async (table: TableDoc) => {
    const otp = randomOTP();
    try {
      await updateDoc(doc(db, 'qr_tables', table.id), { otp });
      toast.success(`New OTP for Table ${table.tableNumber}: ${otp}`);
    } catch (e: any) {
      toast.error('OTP regenerate failed: ' + e.message);
    }
  };

  const toggleRestQR = async () => {
    if (!selectedRest) return;
    const newVal = !selectedRest.qrOrderingEnabled;
    try {
      await updateDoc(doc(db, 'restaurants', selectedRest.id), { qrOrderingEnabled: newVal });
      setSelectedRest(prev => prev ? { ...prev, qrOrderingEnabled: newVal } : null);
      setRestaurants(prev => prev.map(r => r.id === selectedRest.id ? { ...r, qrOrderingEnabled: newVal } : r));
      toast.success(`QR Ordering ${newVal ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      toast.error('Toggle failed: ' + e.message);
    }
  };

  const downloadRestaurantQR = () => {
    if (!restaurantQR) return;
    const a = document.createElement('a');
    a.href = restaurantQR;
    a.download = `QR_${selectedRest?.name?.replace(/\s+/g, '_') || 'restaurant'}.png`;
    a.click();
  };

  const copyRestUrl = () => {
    if (!selectedRest) return;
    navigator.clipboard.writeText(`${BASE_URL}/${selectedRest.id}`);
    toast.success('QR URL copied!');
  };

  const toggleOTPVisibility = (tableId: string) => {
    setVisibleOTPs(prev => ({ ...prev, [tableId]: !prev[tableId] }));
  };

  const printTableCards = () => {
    if (!selectedRest || tables.length === 0) return;
    const cards = tables
      .filter(t => t.isActive)
      .map(t => `
        <div class="card">
          <div class="rest-name">${selectedRest.name}</div>
          <div class="table-num">Table ${t.tableNumber}</div>
          <div class="otp-label">Order OTP</div>
          <div class="otp">${t.otp}</div>
          <div class="hint">Scan QR at entrance → Enter table number &amp; OTP to order</div>
        </div>
      `)
      .join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Table Cards — ${selectedRest.name}</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px; }
  .card {
    background: #fff; border: 2px solid #22c55e; border-radius: 16px;
    padding: 20px; text-align: center; page-break-inside: avoid;
  }
  .rest-name { font-size: 11px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .table-num { font-size: 28px; font-weight: 900; color: #111827; margin-bottom: 8px; }
  .otp-label { font-size: 10px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .otp { font-size: 36px; font-weight: 900; color: #22c55e; letter-spacing: 0.15em; margin-bottom: 8px; }
  .hint { font-size: 9px; color: #9ca3af; line-height: 1.4; }
  @media print {
    body { background: white; }
    .grid { padding: 10px; }
  }
</style>
</head>
<body>
<div class="grid">${cards}</div>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`);
    win.document.close();
  };

  if (loadingRest)
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-green-600" size={32} />
      </div>
    );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
          <QrCode size={22} className="text-green-600" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900">QR Ordering</h1>
          <p className="text-sm text-gray-500">One QR per restaurant — customers scan &amp; order at their table</p>
        </div>
      </div>

      {/* Restaurant picker */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <p className="text-sm font-black text-gray-600 mb-3 flex items-center gap-2">
          <Store size={16} /> Select Restaurant
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {restaurants.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedRest(r)}
              className={`text-left p-4 rounded-2xl border-2 transition-all ${
                selectedRest?.id === r.id
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-100 bg-gray-50 hover:border-gray-200'
              }`}
            >
              <p className="font-black text-gray-900 text-sm">{r.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {r.qrOrderingEnabled ? '🟢 QR Active' : '🔴 QR Disabled'}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selectedRest && (
        <>
          {/* Restaurant QR + toggle */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              {/* QR preview */}
              <div className="flex flex-col items-center gap-3 flex-shrink-0">
                <div className="w-40 h-40 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center overflow-hidden">
                  {loadingQR ? (
                    <RefreshCw size={24} className="text-gray-300 animate-spin" />
                  ) : restaurantQR ? (
                    <img src={restaurantQR} alt="Restaurant QR" className="w-full h-full object-contain p-1" />
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={downloadRestaurantQR}
                    disabled={!restaurantQR}
                    className="flex items-center gap-1.5 text-xs font-black bg-green-500 text-white px-3 py-2 rounded-xl disabled:opacity-50"
                  >
                    <Download size={13} /> Download QR
                  </button>
                  <button
                    onClick={copyRestUrl}
                    className="flex items-center gap-1.5 text-xs font-black bg-gray-100 text-gray-600 px-3 py-2 rounded-xl"
                  >
                    <Copy size={13} /> Copy URL
                  </button>
                </div>
              </div>

              {/* Info + toggle */}
              <div className="flex-1 space-y-4">
                <div>
                  <p className="font-black text-gray-900 text-lg">{selectedRest.name}</p>
                  <p className="text-xs text-gray-400 mt-1 break-all">
                    {BASE_URL}/{selectedRest.id}
                  </p>
                </div>

                <div
                  className={`flex items-center justify-between p-4 rounded-2xl border-2 ${
                    selectedRest.qrOrderingEnabled ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
                  }`}
                >
                  <div>
                    <p className="font-black text-gray-900 text-sm">QR Ordering</p>
                    <p className="text-xs text-gray-400">Enable dine-in ordering via QR scan</p>
                  </div>
                  <button onClick={toggleRestQR}>
                    {selectedRest.qrOrderingEnabled ? (
                      <ToggleRight size={28} className="text-green-600" />
                    ) : (
                      <ToggleLeft size={28} className="text-gray-400" />
                    )}
                  </button>
                </div>

                <div className="bg-blue-50 rounded-2xl p-4 text-sm text-blue-700 space-y-1">
                  <p className="font-black text-blue-800">How it works</p>
                  <p>1. Print &amp; place this QR anywhere visible at your restaurant entrance</p>
                  <p>2. Customer scans → enters table number + OTP from their table card → browses menu</p>
                  <p>3. Online payment only (UPI / Card) — orders go directly to kitchen</p>
                </div>
              </div>
            </div>
          </div>

          {/* Table management */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-black text-gray-600 flex items-center gap-2">
                <Table2 size={16} /> Tables &amp; OTPs ({tables.length})
              </p>
              {tables.filter(t => t.isActive).length > 0 && (
                <button
                  onClick={printTableCards}
                  className="flex items-center gap-2 text-xs font-black text-purple-600 bg-purple-50 px-3 py-2 rounded-xl hover:bg-purple-100"
                >
                  <Printer size={14} /> Print Table Cards
                </button>
              )}
            </div>

            {/* Add single table */}
            <div className="flex gap-3 mb-4">
              <input
                value={newTableNum}
                onChange={e => setNewTableNum(e.target.value)}
                placeholder="Table number (e.g. 12)"
                type="number"
                min="1"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-green-400"
              />
              <button
                onClick={addTable}
                className="flex items-center gap-2 bg-green-500 text-white font-black text-sm px-4 py-2.5 rounded-xl"
              >
                <Plus size={16} /> Add
              </button>
            </div>

            {/* Bulk generate */}
            <div className="flex gap-3 mb-6 p-3 bg-blue-50 rounded-2xl items-center">
              <span className="text-sm font-black text-blue-700">Bulk Generate:</span>
              <input
                value={bulkCount}
                onChange={e => setBulkCount(Number(e.target.value))}
                type="number"
                min="1"
                max="200"
                className="w-20 border border-blue-200 rounded-xl px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-blue-400 bg-white"
              />
              <span className="text-sm text-blue-600">tables</span>
              <button
                onClick={addBulkTables}
                disabled={generating}
                className="ml-auto flex items-center gap-2 bg-blue-600 text-white font-black text-sm px-4 py-2 rounded-xl disabled:opacity-60"
              >
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
                {generating ? 'Generating…' : 'Generate All'}
              </button>
            </div>

            {/* Tables list */}
            {loadingTables ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="animate-spin text-gray-400" size={24} />
              </div>
            ) : tables.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Table2 size={48} className="mx-auto mb-3 opacity-30" />
                <p className="font-bold">No tables yet</p>
                <p className="text-sm">Add tables above — each gets a unique 4-digit OTP</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tables.map(table => (
                  <div
                    key={table.id}
                    className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${
                      table.isActive ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                    }`}
                  >
                    {/* Table number */}
                    <div className="w-14 h-14 flex-shrink-0 bg-green-50 rounded-2xl flex items-center justify-center">
                      <span className="font-black text-green-700 text-lg">{table.tableNumber}</span>
                    </div>

                    {/* Label + status */}
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-gray-900 text-sm">{table.label || `Table ${table.tableNumber}`}</p>
                      <p className="text-xs text-gray-400">{table.isActive ? '🟢 Active' : '🔴 Disabled'}</p>
                    </div>

                    {/* OTP */}
                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 flex-shrink-0">
                      <span className="font-black text-gray-900 text-lg tracking-widest">
                        {visibleOTPs[table.id] ? table.otp : '••••'}
                      </span>
                      <button
                        onClick={() => toggleOTPVisibility(table.id)}
                        className="text-gray-400 hover:text-gray-600"
                        title={visibleOTPs[table.id] ? 'Hide OTP' : 'Show OTP'}
                      >
                        {visibleOTPs[table.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => regenerateOTP(table)}
                        title="Regenerate OTP"
                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => toggleTable(table)}
                        title="Toggle active"
                        className={`p-2 rounded-xl ${
                          table.isActive
                            ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {table.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      </button>
                      <button
                        onClick={() => deleteTable(table.id)}
                        title="Delete table"
                        className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
