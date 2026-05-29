import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import {
  MapPin,
  Plus,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Globe,
  Building2,
  X,
  Check,
  Map as MapIcon,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Zone {
  name: string;
  areas: string;
  isActive: boolean;
  deliveryRadiusKm: number;
}

interface City {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
  deliveryFeeBase: number;
  minOrderValue: number;
  launchDate: string;
  estimatedRestaurants: number;
  zones: Zone[];
}

type CityFormData = Omit<City, 'id' | 'zones'>;

interface ZoneFormData {
  name: string;
  areas: string;
  isActive: boolean;
  deliveryRadiusKm: number;
}

const EMPTY_CITY_FORM: CityFormData = {
  name: '',
  state: '',
  isActive: true,
  deliveryFeeBase: 30,
  minOrderValue: 99,
  launchDate: '',
  estimatedRestaurants: 0,
};

const EMPTY_ZONE_FORM: ZoneFormData = {
  name: '',
  areas: '',
  isActive: true,
  deliveryRadiusKm: 5,
};

// ── City Modal ─────────────────────────────────────────────────────────────────

interface CityModalProps {
  initial?: CityFormData;
  onSave: (data: CityFormData) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  title: string;
}

function CityModal({ initial, onSave, onClose, saving, title }: CityModalProps) {
  const [form, setForm] = useState<CityFormData>(initial ?? EMPTY_CITY_FORM);

  function set<K extends keyof CityFormData>(key: K, value: CityFormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('City name is required'); return; }
    if (!form.state.trim()) { toast.error('State is required'); return; }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        initial={{ opacity: 0, scale: 0.93, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 20 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* City name */}
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                City Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Hyderabad"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* State */}
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                State <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.state}
                onChange={e => set('state', e.target.value)}
                placeholder="e.g. Telangana"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Delivery fee */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Base Delivery Fee (₹)
              </label>
              <input
                type="number"
                value={form.deliveryFeeBase}
                onChange={e => set('deliveryFeeBase', Number(e.target.value))}
                min={0}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Min order */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Min Order Value (₹)
              </label>
              <input
                type="number"
                value={form.minOrderValue}
                onChange={e => set('minOrderValue', Number(e.target.value))}
                min={0}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Launch date */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Launch Date
              </label>
              <input
                type="date"
                value={form.launchDate}
                onChange={e => set('launchDate', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Estimated restaurants */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Est. Restaurants
              </label>
              <input
                type="number"
                value={form.estimatedRestaurants}
                onChange={e => set('estimatedRestaurants', Number(e.target.value))}
                min={0}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Active toggle */}
            <div className="col-span-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => set('isActive', !form.isActive)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300"
              >
                {form.isActive
                  ? <ToggleRight className="w-6 h-6 text-green-500" />
                  : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                City is {form.isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-black hover:bg-orange-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save City
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Zone Modal ─────────────────────────────────────────────────────────────────

interface ZoneModalProps {
  cityName: string;
  initial?: ZoneFormData & { index?: number };
  onSave: (data: ZoneFormData) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

function ZoneModal({ cityName, initial, onSave, onClose, saving }: ZoneModalProps) {
  const [form, setForm] = useState<ZoneFormData>({
    name: initial?.name ?? '',
    areas: initial?.areas ?? '',
    isActive: initial?.isActive ?? true,
    deliveryRadiusKm: initial?.deliveryRadiusKm ?? 5,
  });

  function set<K extends keyof ZoneFormData>(key: K, value: ZoneFormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Zone name is required'); return; }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        initial={{ opacity: 0, scale: 0.93, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 20 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-brand" />
            {initial?.name ? 'Edit Zone' : 'Add Zone'}
            <span className="text-gray-400 font-normal text-sm">— {cityName}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Zone name */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
              Zone Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. North Hyderabad"
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>

          {/* Areas */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
              Areas (comma-separated)
            </label>
            <textarea
              value={form.areas}
              onChange={e => set('areas', e.target.value)}
              rows={3}
              placeholder="e.g. Banjara Hills, Jubilee Hills, Madhapur"
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
            />
          </div>

          {/* Delivery radius */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
              Delivery Radius — <span className="text-brand">{form.deliveryRadiusKm} km</span>
            </label>
            <input
              type="range"
              min={1}
              max={30}
              step={0.5}
              value={form.deliveryRadiusKm}
              onChange={e => set('deliveryRadiusKm', Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>1 km</span><span>15 km</span><span>30 km</span>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set('isActive', !form.isActive)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300"
            >
              {form.isActive
                ? <ToggleRight className="w-6 h-6 text-green-500" />
                : <ToggleLeft className="w-6 h-6 text-gray-400" />}
              Zone is {form.isActive ? 'Active' : 'Inactive'}
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-black hover:bg-orange-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save Zone
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Zone Row ───────────────────────────────────────────────────────────────────

interface ZoneRowProps {
  zone: Zone;
  index: number;
  city: City;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

function ZoneRow({ zone, onEdit, onDelete, onToggle }: ZoneRowProps) {
  const areaList = zone.areas
    ? zone.areas.split(',').map(a => a.trim()).filter(Boolean)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm text-gray-800 dark:text-gray-100">{zone.name}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
            zone.isActive
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {zone.isActive ? 'Active' : 'Inactive'}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {zone.deliveryRadiusKm} km
          </span>
        </div>
        {areaList.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {areaList.slice(0, 4).map((area, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] text-gray-600 dark:text-gray-300"
              >
                {area}
              </span>
            ))}
            {areaList.length > 4 && (
              <span className="px-2 py-0.5 text-[10px] text-gray-400">+{areaList.length - 4} more</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onToggle}
          title={zone.isActive ? 'Deactivate zone' : 'Activate zone'}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-white dark:hover:bg-gray-700 transition-colors"
        >
          {zone.isActive
            ? <ToggleRight className="w-5 h-5 text-green-500" />
            : <ToggleLeft className="w-5 h-5 text-gray-400" />}
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-orange-50 hover:text-brand dark:hover:bg-orange-950/30 transition-colors"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// ── City Card ──────────────────────────────────────────────────────────────────

interface CityCardProps {
  city: City;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onAddZone: () => void;
  onEditZone: (zoneIndex: number) => void;
  onDeleteZone: (zoneIndex: number) => void;
  onToggleZone: (zoneIndex: number) => void;
}

function CityCard({
  city,
  index,
  onEdit,
  onDelete,
  onToggleActive,
  onAddZone,
  onEditZone,
  onDeleteZone,
  onToggleZone,
}: CityCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`bg-white dark:bg-gray-900 rounded-2xl shadow-card border-2 overflow-hidden transition-colors ${
        city.isActive ? 'border-orange-100 dark:border-orange-900/30' : 'border-gray-100 dark:border-gray-800'
      }`}
    >
      {/* Card header */}
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Icon + info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            city.isActive ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-gray-100 dark:bg-gray-800'
          }`}>
            <Building2 className={`w-5 h-5 ${city.isActive ? 'text-brand' : 'text-gray-400'}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-gray-800 dark:text-gray-100">{city.name}</h3>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                {city.state}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${
                city.isActive
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {city.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
              <span>₹{city.deliveryFeeBase} delivery</span>
              <span>·</span>
              <span>₹{city.minOrderValue} min</span>
              <span>·</span>
              <span>{city.zones?.length ?? 0} zones</span>
              {city.estimatedRestaurants > 0 && (
                <>
                  <span>·</span>
                  <span>~{city.estimatedRestaurants} restaurants</span>
                </>
              )}
              {city.launchDate && (
                <>
                  <span>·</span>
                  <span>Launch: {city.launchDate}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Active toggle */}
          <button
            onClick={onToggleActive}
            title={city.isActive ? 'Deactivate city' : 'Activate city'}
            className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {city.isActive
              ? <ToggleRight className="w-6 h-6 text-green-500" />
              : <ToggleLeft className="w-6 h-6 text-gray-400" />}
          </button>

          {/* Add zone */}
          <button
            onClick={onAddZone}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 dark:bg-orange-950/30 text-brand text-xs font-bold rounded-xl hover:bg-orange-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Zone
          </button>

          {/* Edit */}
          <button
            onClick={onEdit}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-orange-50 hover:text-brand dark:hover:bg-orange-950/30 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Expand */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {expanded
              ? <ChevronDown className="w-5 h-5" />
              : <ChevronRight className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Zones panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-800">
              <div className="pt-4 space-y-2">
                {(!city.zones || city.zones.length === 0) ? (
                  <div className="text-center py-8 text-gray-400">
                    <MapIcon className="w-8 h-8 mx-auto mb-2 text-gray-200 dark:text-gray-700" />
                    <p className="text-sm font-semibold">No zones yet</p>
                    <p className="text-xs mt-0.5">Click "+ Add Zone" to create the first zone</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {city.zones.map((zone, zIdx) => (
                      <ZoneRow
                        key={`${zone.name}-${zIdx}`}
                        zone={zone}
                        index={zIdx}
                        city={city}
                        onEdit={() => onEditZone(zIdx)}
                        onDelete={() => onDeleteZone(zIdx)}
                        onToggle={() => onToggleZone(zIdx)}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function CityManager() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);

  // City modal state
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [savingCity, setSavingCity] = useState(false);

  // Zone modal state
  const [zoneModalCityId, setZoneModalCityId] = useState<string | null>(null);
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [savingZone, setSavingZone] = useState(false);

  // Load cities from Firestore
  useEffect(() => {
    const q = query(collection(db, 'cities'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setCities(snap.docs.map(d => ({ id: d.id, ...d.data() } as City)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const activeCities = cities.filter(c => c.isActive).length;
    const totalZones = cities.reduce((s, c) => s + (c.zones?.length ?? 0), 0);
    const states = new Set(cities.map(c => c.state).filter(Boolean));
    return { activeCities, totalZones, stateCount: states.size };
  }, [cities]);

  // ── City CRUD ──────────────────────────────────────────────────────────────

  function openAddCity() {
    setEditingCity(null);
    setCityModalOpen(true);
  }

  function openEditCity(city: City) {
    setEditingCity(city);
    setCityModalOpen(true);
  }

  function closeCityModal() {
    setCityModalOpen(false);
    setEditingCity(null);
  }

  async function saveCity(data: CityFormData) {
    setSavingCity(true);
    try {
      if (editingCity) {
        await updateDoc(doc(db, 'cities', editingCity.id), {
          ...data,
          updatedAt: serverTimestamp(),
        });
        toast.success(`${data.name} updated`);
      } else {
        await addDoc(collection(db, 'cities'), {
          ...data,
          zones: [],
          createdAt: serverTimestamp(),
        });
        toast.success(`${data.name} added`);
      }
      closeCityModal();
    } catch (e: any) {
      toast.error('Failed to save: ' + e.message);
    } finally {
      setSavingCity(false);
    }
  }

  async function deleteCity(city: City) {
    if (!window.confirm(`Delete ${city.name}? This will remove all zones too.`)) return;
    try {
      await deleteDoc(doc(db, 'cities', city.id));
      toast.success(`${city.name} deleted`);
    } catch (e: any) {
      toast.error('Failed to delete: ' + e.message);
    }
  }

  async function toggleCityActive(city: City) {
    try {
      await updateDoc(doc(db, 'cities', city.id), {
        isActive: !city.isActive,
        updatedAt: serverTimestamp(),
      });
      toast.success(`${city.name} is now ${!city.isActive ? 'active' : 'inactive'}`);
    } catch (e: any) {
      toast.error('Failed to update: ' + e.message);
    }
  }

  // ── Zone CRUD ──────────────────────────────────────────────────────────────

  function openAddZone(cityId: string) {
    setZoneModalCityId(cityId);
    setEditingZoneIndex(null);
  }

  function openEditZone(cityId: string, zoneIndex: number) {
    setZoneModalCityId(cityId);
    setEditingZoneIndex(zoneIndex);
  }

  function closeZoneModal() {
    setZoneModalCityId(null);
    setEditingZoneIndex(null);
  }

  async function saveZone(data: ZoneFormData) {
    if (!zoneModalCityId) return;
    const city = cities.find(c => c.id === zoneModalCityId);
    if (!city) return;

    setSavingZone(true);
    try {
      const zones = [...(city.zones ?? [])];
      if (editingZoneIndex !== null) {
        zones[editingZoneIndex] = data;
      } else {
        zones.push(data);
      }
      await updateDoc(doc(db, 'cities', city.id), {
        zones,
        updatedAt: serverTimestamp(),
      });
      toast.success(editingZoneIndex !== null ? 'Zone updated' : 'Zone added');
      closeZoneModal();
    } catch (e: any) {
      toast.error('Failed to save zone: ' + e.message);
    } finally {
      setSavingZone(false);
    }
  }

  async function deleteZone(city: City, zoneIndex: number) {
    const zoneName = city.zones[zoneIndex]?.name ?? 'this zone';
    if (!window.confirm(`Delete zone "${zoneName}"?`)) return;
    try {
      const zones = city.zones.filter((_, i) => i !== zoneIndex);
      await updateDoc(doc(db, 'cities', city.id), {
        zones,
        updatedAt: serverTimestamp(),
      });
      toast.success('Zone deleted');
    } catch (e: any) {
      toast.error('Failed to delete zone: ' + e.message);
    }
  }

  async function toggleZoneActive(city: City, zoneIndex: number) {
    try {
      const zones = city.zones.map((z, i) =>
        i === zoneIndex ? { ...z, isActive: !z.isActive } : z,
      );
      await updateDoc(doc(db, 'cities', city.id), {
        zones,
        updatedAt: serverTimestamp(),
      });
      const zone = city.zones[zoneIndex];
      toast.success(`${zone.name} is now ${!zone.isActive ? 'active' : 'inactive'}`);
    } catch (e: any) {
      toast.error('Failed to update zone: ' + e.message);
    }
  }

  // ── Derived zone modal data ────────────────────────────────────────────────

  const zoneModalCity = zoneModalCityId ? cities.find(c => c.id === zoneModalCityId) : null;
  const zoneModalInitial =
    zoneModalCity && editingZoneIndex !== null
      ? { ...zoneModalCity.zones[editingZoneIndex], index: editingZoneIndex }
      : undefined;

  // ── Grouped by state ───────────────────────────────────────────────────────

  const groupedByState = useMemo(() => {
    const map = new Map<string, City[]>();
    for (const city of cities) {
      const state = city.state || 'Unknown';
      if (!map.has(state)) map.set(state, []);
      map.get(state)!.push(city);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [cities]);

  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  function toggleState(state: string) {
    setExpandedStates(prev => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 pb-16 space-y-6">
      {/* Header */}
      <motion.div
        className="flex flex-col sm:flex-row sm:items-center gap-4"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex-1">
          <h1 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Globe className="w-7 h-7 text-brand" />
            Multi-City Expansion
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Manage states, cities, zones and delivery areas
          </p>
        </div>
        <button
          onClick={openAddCity}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white font-black rounded-xl hover:bg-orange-600 transition-colors shadow-md shadow-orange-200 dark:shadow-none"
        >
          <Plus className="w-5 h-5" />
          Add City
        </button>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'Active Cities',
            value: stats.activeCities,
            icon: Building2,
            color: 'border-green-400',
            iconBg: 'bg-green-50 dark:bg-green-900/20',
            iconColor: 'text-green-600',
          },
          {
            label: 'Total Zones',
            value: stats.totalZones,
            icon: MapIcon,
            color: 'border-blue-400',
            iconBg: 'bg-blue-50 dark:bg-blue-900/20',
            iconColor: 'text-blue-600',
          },
          {
            label: 'States Covered',
            value: stats.stateCount,
            icon: MapPin,
            color: 'border-brand',
            iconBg: 'bg-orange-50 dark:bg-orange-900/20',
            iconColor: 'text-brand',
          },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className={`bg-white dark:bg-gray-900 rounded-2xl shadow-card p-5 border-l-4 ${s.color}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
            whileHover={{ y: -3 }}
          >
            <div className={`w-9 h-9 ${s.iconBg} rounded-xl flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.iconColor}`} />
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className="text-2xl font-black text-gray-800 dark:text-gray-100 mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* City List */}
      {loading ? (
        <div className="py-20 text-center text-gray-400">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-9 h-9 border-4 border-brand border-t-transparent rounded-full mx-auto mb-3"
          />
          Loading cities...
        </div>
      ) : cities.length === 0 ? (
        <motion.div
          className="py-20 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Globe className="w-14 h-14 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 font-bold text-lg">No cities yet</p>
          <p className="text-gray-400 text-sm mt-1 mb-5">
            Start expanding by adding your first city
          </p>
          <button
            onClick={openAddCity}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white font-black rounded-xl hover:bg-orange-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add First City
          </button>
        </motion.div>
      ) : (
        <div className="space-y-6">
          <AnimatePresence>
            {groupedByState.map(([state, stateCities]) => (
              <motion.div
                key={state}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* State header */}
                <button
                  onClick={() => toggleState(state)}
                  className="w-full flex items-center gap-3 text-left group"
                >
                  <div className="flex items-center gap-2 flex-1">
                    <MapPin className="w-4 h-4 text-brand" />
                    <span className="font-black text-gray-700 dark:text-gray-200 text-sm uppercase tracking-wider">
                      {state}
                    </span>
                    <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-brand rounded-full text-[10px] font-black">
                      {stateCities.length} {stateCities.length === 1 ? 'city' : 'cities'}
                    </span>
                  </div>
                  <div className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
                    {expandedStates.has(state)
                      ? <ChevronRight className="w-4 h-4" />
                      : <ChevronDown className="w-4 h-4" />}
                  </div>
                  <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
                </button>

                {/* Cities in this state */}
                <AnimatePresence>
                  {(!expandedStates.has(state)) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden space-y-3 pl-2"
                    >
                      {stateCities.map((city, idx) => (
                        <CityCard
                          key={city.id}
                          city={city}
                          index={idx}
                          onEdit={() => openEditCity(city)}
                          onDelete={() => deleteCity(city)}
                          onToggleActive={() => toggleCityActive(city)}
                          onAddZone={() => openAddZone(city.id)}
                          onEditZone={zIdx => openEditZone(city.id, zIdx)}
                          onDeleteZone={zIdx => deleteZone(city, zIdx)}
                          onToggleZone={zIdx => toggleZoneActive(city, zIdx)}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* City Modal */}
      <AnimatePresence>
        {cityModalOpen && (
          <CityModal
            title={editingCity ? `Edit ${editingCity.name}` : 'Add New City'}
            initial={
              editingCity
                ? {
                    name: editingCity.name,
                    state: editingCity.state,
                    isActive: editingCity.isActive,
                    deliveryFeeBase: editingCity.deliveryFeeBase,
                    minOrderValue: editingCity.minOrderValue,
                    launchDate: editingCity.launchDate,
                    estimatedRestaurants: editingCity.estimatedRestaurants,
                  }
                : undefined
            }
            onSave={saveCity}
            onClose={closeCityModal}
            saving={savingCity}
          />
        )}
      </AnimatePresence>

      {/* Zone Modal */}
      <AnimatePresence>
        {zoneModalCity && (
          <ZoneModal
            cityName={zoneModalCity.name}
            initial={zoneModalInitial}
            onSave={saveZone}
            onClose={closeZoneModal}
            saving={savingZone}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
