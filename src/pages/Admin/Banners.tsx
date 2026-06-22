import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection, onSnapshot, query, orderBy,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import {
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X, GripVertical,
  BarChart2, Clock, Calendar, MousePointer, ShoppingBag, Upload, ImageIcon, VideoIcon, Link2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Banner {
  id: string;
  title: string;
  subtitle: string;
  code: string;
  emoji: string;
  gradient: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  discountPercent?: number;
  discountMax?: number;
  minOrder?: number;
  isActive: boolean;
  order: number;
  createdAt: any;
  startAt?: Timestamp | null;
  endAt?: Timestamp | null;
}

interface BannerAnalytics {
  totalClicks: number;
  totalConversions: number;
}

const GRADIENT_OPTIONS = [
  { label: 'Green',  value: 'from-green-500 to-emerald-700' },
  { label: 'Orange', value: 'from-orange-400 to-red-500' },
  { label: 'Purple', value: 'from-purple-500 to-indigo-600' },
  { label: 'Pink',   value: 'from-pink-500 to-rose-600' },
  { label: 'Blue',   value: 'from-blue-500 to-cyan-600' },
  { label: 'Yellow', value: 'from-yellow-400 to-orange-500' },
];

const EMOJI_OPTIONS = ['🎉', '🛵', '🌟', '🍕', '🔥', '💰', '🎁', '🍔', '🍜', '🥗'];

function getBannerStatus(banner: Banner): 'scheduled' | 'active' | 'expired' | 'inactive' {
  if (!banner.isActive) return 'inactive';
  const now = Date.now();
  const startMs = banner.startAt?.toMillis?.() ?? null;
  const endMs   = banner.endAt?.toMillis?.()   ?? null;
  if (endMs && now > endMs)   return 'expired';
  if (startMs && now < startMs) return 'scheduled';
  return 'active';
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:    { label: '● Live',      cls: 'bg-green-100 text-green-700' },
  scheduled: { label: '⏰ Scheduled', cls: 'bg-blue-100 text-blue-700' },
  expired:   { label: '✕ Expired',   cls: 'bg-red-100 text-red-600' },
  inactive:  { label: '◌ Hidden',    cls: 'bg-gray-100 text-gray-500' },
};

type FormData = {
  title: string; subtitle: string; code: string;
  emoji: string; gradient: string; order: string;
  startAt: string; endAt: string;
  discountPercent: string; discountMax: string; minOrder: string;
  mediaUrl: string;
};

// ── Media Uploader ─────────────────────────────────────────────────────────────

function MediaUploader({
  value, onChange,
}: {
  value: string;
  onChange: (url: string, type: 'image' | 'video') => void;
}) {
  const [mode, setMode]         = useState<'url' | 'upload'>('upload');
  const [urlInput, setUrlInput] = useState(value || '');
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const compressImage = (file: File): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
      img.src = objectUrl;
    });

  const [uploadSpeed, setUploadSpeed] = useState('');
  const speedRef = useRef<{ bytes: number; time: number } | null>(null);

  const doUpload = useCallback((blob: Blob, mimeType: string, ext: string, isVideo: boolean) => {
    const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, blob, { contentType: mimeType });
    speedRef.current = { bytes: 0, time: Date.now() };

    setProgress(0);
    task.on(
      'state_changed',
      snap => {
        const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
        setProgress(pct);
        const now = Date.now();
        const elapsed = (now - speedRef.current!.time) / 1000;
        const bytesDelta = snap.bytesTransferred - speedRef.current!.bytes;
        if (elapsed > 0.5) {
          const kbps = bytesDelta / elapsed / 1024;
          setUploadSpeed(kbps > 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`);
          speedRef.current = { bytes: snap.bytesTransferred, time: now };
        }
      },
      () => { toast.error('Upload failed — check Firebase Storage rules'); setProgress(null); setUploadSpeed(''); },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        onChange(url, isVideo ? 'video' : 'image');
        setProgress(null); setUploadSpeed('');
        toast.success('Uploaded!');
      },
    );
  }, [onChange]);

  const upload = useCallback(async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) { toast.error('Only images and videos allowed'); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error('Max file size: 50 MB'); return; }

    const ext = file.name.split('.').pop() ?? (isVideo ? 'mp4' : 'jpg');

    if (isImage && !file.type.includes('gif')) {
      setProgress(0);
      const before = (file.size / 1024).toFixed(0);
      const blob = await compressImage(file);
      const after = (blob.size / 1024).toFixed(0);
      toast(`Compressed ${before}KB → ${after}KB`, { icon: '⚡' });
      doUpload(blob, 'image/jpeg', 'jpg', false);
    } else {
      doUpload(file, file.type, ext, isVideo);
    }
  }, [doUpload]);

  const handleFiles = (files: FileList | null) => {
    if (files?.[0]) upload(files[0]).catch(() => {});
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const applyUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(url);
    onChange(url, isVideo ? 'video' : 'image');
    toast.success('URL set!');
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button type="button" onClick={() => setMode('upload')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'upload' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
          <Upload className="w-3.5 h-3.5" /> Upload File
        </button>
        <button type="button" onClick={() => setMode('url')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'url' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
          <Link2 className="w-3.5 h-3.5" /> Paste URL
        </button>
      </div>

      {mode === 'upload' ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${dragOver ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-brand/50 hover:bg-gray-50'}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          {progress !== null ? (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <motion.div
                  className="bg-brand h-2.5 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: 'linear', duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between items-center">
                <p className="text-sm font-bold text-brand">Uploading... {progress}%</p>
                {uploadSpeed && <p className="text-xs text-gray-400 font-semibold">{uploadSpeed}</p>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-center gap-3 mb-3">
                <ImageIcon className="w-6 h-6 text-gray-300" />
                <VideoIcon className="w-6 h-6 text-gray-300" />
              </div>
              <p className="text-sm font-bold text-gray-600">Drop image / video here</p>
              <p className="text-xs text-gray-400 mt-1">or click to browse · JPG, PNG, GIF, MP4, WebM · max 50 MB</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="https://... (image, GIF, or video URL)"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), applyUrl())}
          />
          <button type="button" onClick={applyUrl}
            className="px-3 py-2 bg-brand text-white text-sm font-bold rounded-xl hover:bg-brand/90 transition-colors">
            Set
          </button>
        </div>
      )}

      {/* Preview */}
      {value && (
        <div className="relative rounded-xl overflow-hidden bg-black group">
          {/\.(mp4|webm|mov)(\?|$)/i.test(value) || value.includes('firebasestorage') && /video/.test(value) ? (
            <video src={value} className="w-full h-32 object-cover" muted loop autoPlay playsInline />
          ) : (
            <img src={value} alt="preview" className="w-full h-32 object-cover"
              onError={e => (e.currentTarget.parentElement!.style.display = 'none')} />
          )}
          <button
            type="button"
            onClick={() => onChange('', 'image')}
            className="absolute top-2 right-2 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sortable banner row ───────────────────────────────────────────────────────

function SortableBannerRow({
  banner, analytics, onEdit, onDelete, onToggle,
}: {
  banner: Banner;
  analytics: BannerAnalytics | undefined;
  onEdit: (b: Banner) => void;
  onDelete: (b: Banner) => void;
  onToggle: (b: Banner) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: banner.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined };
  const status = getBannerStatus(banner);
  const { label, cls } = STATUS_BADGE[status];
  const convRate = analytics && analytics.totalClicks > 0
    ? ((analytics.totalConversions / analytics.totalClicks) * 100).toFixed(1)
    : '0.0';

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: isDragging ? 0.85 : 1, y: 0, scale: isDragging ? 1.02 : 1 }}
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 ${isDragging ? 'shadow-xl' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-500 touch-none">
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Preview thumbnail */}
        {banner.mediaUrl ? (
          banner.mediaType === 'video' ? (
            <video src={banner.mediaUrl} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" muted autoPlay loop playsInline />
          ) : (
            <img src={banner.mediaUrl} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
          )
        ) : (
          <div className={`w-12 h-12 bg-gradient-to-br ${banner.gradient} rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>
            {banner.emoji}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-gray-900 text-sm truncate">{banner.title}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
            {banner.code && <span className="text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full">{banner.code}</span>}
            {banner.discountPercent ? <span className="text-[10px] font-black text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">{banner.discountPercent}% OFF</span> : null}
          </div>
          <p className="text-xs text-gray-500 truncate">{banner.subtitle}</p>
          {analytics && (
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-[10px] text-gray-400 font-bold">
                <MousePointer className="w-3 h-3" /> {analytics.totalClicks} clicks
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400 font-bold">
                <ShoppingBag className="w-3 h-3" /> {analytics.totalConversions} orders
              </span>
              <span className="text-[10px] font-black text-brand">{convRate}% CVR</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggle(banner)} className="p-2 text-gray-400 hover:text-brand transition-colors" title={banner.isActive ? 'Deactivate' : 'Activate'}>
            {banner.isActive ? <ToggleRight className="w-5 h-5 text-brand" /> : <ToggleLeft className="w-5 h-5" />}
          </button>
          <button onClick={() => onEdit(banner)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(banner)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Schedule info */}
      {(banner.startAt || banner.endAt) && (
        <div className="mt-2 ml-11 flex items-center gap-3 text-[11px] text-gray-400">
          {banner.startAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Starts: {banner.startAt.toDate().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
          {banner.endAt   && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Ends: {banner.endAt.toDate().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
        </div>
      )}
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Banners() {
  const [banners, setBanners]     = useState<Banner[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, BannerAnalytics>>({});
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Banner | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [mediaUrl, setMediaUrl]   = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      gradient: GRADIENT_OPTIONS[0].value, emoji: '🎉', order: '0',
      startAt: '', endAt: '', discountPercent: '', discountMax: '', minOrder: '', mediaUrl: '',
    },
  });

  const watchGradient = watch('gradient');
  const watchEmoji    = watch('emoji');
  const watchTitle    = watch('title');
  const watchSubtitle = watch('subtitle');
  const watchCode     = watch('code');

  useEffect(() => {
    const q = query(collection(db, 'banners'), orderBy('order', 'asc'));
    return onSnapshot(q, snap => {
      setBanners(snap.docs.map(d => ({ id: d.id, ...d.data() } as Banner)));
      setLoading(false);
    }, () => { toast.error('Failed to load banners'); setLoading(false); });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'bannerAnalytics'), snap => {
      const map: Record<string, BannerAnalytics> = {};
      snap.docs.forEach(d => { map[d.id] = d.data() as BannerAnalytics; });
      setAnalytics(map);
    }, () => {});
  }, []);

  const toTimestamp = (val: string) => val ? Timestamp.fromDate(new Date(val)) : null;
  const toDatetimeLocal = (ts?: Timestamp | null) => {
    if (!ts) return '';
    const d = ts.toDate();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const openAdd = () => {
    setEditTarget(null);
    setMediaUrl(''); setMediaType('image');
    reset({
      title: '', subtitle: '', code: '', emoji: '🎉',
      gradient: GRADIENT_OPTIONS[0].value, order: String(banners.length),
      startAt: '', endAt: '', discountPercent: '', discountMax: '', minOrder: '', mediaUrl: '',
    });
    setShowModal(true);
  };

  const openEdit = (b: Banner) => {
    setEditTarget(b);
    setMediaUrl(b.mediaUrl || '');
    setMediaType(b.mediaType || 'image');
    reset({
      title: b.title, subtitle: b.subtitle, code: b.code || '', emoji: b.emoji,
      gradient: b.gradient, order: String(b.order),
      startAt: toDatetimeLocal(b.startAt), endAt: toDatetimeLocal(b.endAt),
      discountPercent: b.discountPercent ? String(b.discountPercent) : '',
      discountMax: b.discountMax ? String(b.discountMax) : '',
      minOrder: b.minOrder ? String(b.minOrder) : '',
      mediaUrl: b.mediaUrl || '',
    });
    setShowModal(true);
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const payload: any = {
        title: data.title.trim(), subtitle: data.subtitle.trim(),
        code: data.code.trim().toUpperCase(), emoji: data.emoji,
        gradient: data.gradient, order: parseInt(data.order) || 0,
        isActive: editTarget?.isActive ?? true,
        startAt: toTimestamp(data.startAt),
        endAt:   toTimestamp(data.endAt),
        mediaUrl:        mediaUrl || null,
        mediaType:       mediaUrl ? mediaType : null,
        discountPercent: data.discountPercent ? Number(data.discountPercent) : null,
        discountMax:     data.discountMax ? Number(data.discountMax) : null,
        minOrder:        data.minOrder ? Number(data.minOrder) : null,
      };
      if (editTarget) {
        await updateDoc(doc(db, 'banners', editTarget.id), payload);
        toast.success('Banner updated!');
      } else {
        await addDoc(collection(db, 'banners'), { ...payload, createdAt: serverTimestamp() });
        toast.success('Banner created!');
      }
      setShowModal(false);
    } catch { toast.error('Failed to save banner'); }
    finally { setIsSubmitting(false); }
  };

  const toggleActive = async (b: Banner) => { await updateDoc(doc(db, 'banners', b.id), { isActive: !b.isActive }); };
  const deleteBanner = async (b: Banner) => {
    if (!confirm(`Delete "${b.title}"?`)) return;
    await deleteDoc(doc(db, 'banners', b.id));
    toast.success('Banner deleted');
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = banners.findIndex(b => b.id === active.id);
    const newIdx = banners.findIndex(b => b.id === over.id);
    const reordered = arrayMove(banners, oldIdx, newIdx);
    setBanners(reordered);
    const batch = writeBatch(db);
    reordered.forEach((b, i) => batch.update(doc(db, 'banners', b.id), { order: i }));
    await batch.commit();
    toast.success('Order saved');
  }, [banners]);

  const totalClicks = Object.values(analytics).reduce((s, a) => s + (a.totalClicks ?? 0), 0);
  const totalConversions = Object.values(analytics).reduce((s, a) => s + (a.totalConversions ?? 0), 0);
  const overallCVR = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : '0.0';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div className="flex items-center justify-between mb-6" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1 className="text-2xl font-black text-gray-900">Offer Banners</h1>
          <p className="text-sm text-gray-500 mt-0.5">Drag to reorder · Schedule · Track performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAnalytics(!showAnalytics)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-all ${showAnalytics ? 'bg-brand text-white border-brand' : 'border-gray-200 text-gray-600 hover:border-brand hover:text-brand'}`}>
            <BarChart2 className="w-4 h-4" /> Analytics
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Banner</button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showAnalytics && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-5">
            <div className="grid grid-cols-3 gap-3 mb-2">
              <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
                <p className="text-2xl font-black text-gray-900">{totalClicks.toLocaleString()}</p>
                <p className="text-xs text-gray-400 font-bold mt-0.5 flex items-center justify-center gap-1"><MousePointer className="w-3 h-3" />Total Clicks</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
                <p className="text-2xl font-black text-gray-900">{totalConversions.toLocaleString()}</p>
                <p className="text-xs text-gray-400 font-bold mt-0.5 flex items-center justify-center gap-1"><ShoppingBag className="w-3 h-3" />Conversions</p>
              </div>
              <div className="bg-brand/5 rounded-2xl border border-brand/20 p-4 text-center">
                <p className="text-2xl font-black text-brand">{overallCVR}%</p>
                <p className="text-xs text-gray-400 font-bold mt-0.5">Overall CVR</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : banners.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎨</div>
          <h3 className="text-lg font-black text-gray-700">No banners yet</h3>
          <button onClick={openAdd} className="btn-primary mt-4">Add Banner</button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={banners.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {banners.map(b => (
                <SortableBannerRow
                  key={b.id} banner={b}
                  analytics={showAnalytics ? analytics[b.id] : undefined}
                  onEdit={openEdit} onDelete={deleteBanner} onToggle={toggleActive}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowModal(false)} />
            <motion.div
              initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-black text-gray-800">{editTarget ? 'Edit Banner' : 'New Banner'}</h2>
                <button onClick={() => setShowModal(false)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">

                {/* Live preview */}
                <div className={`h-28 bg-gradient-to-br ${watchGradient} rounded-2xl relative overflow-hidden`}>
                  {mediaUrl && (
                    mediaType === 'video'
                      ? <video src={mediaUrl} className="absolute inset-0 w-full h-full object-cover" muted autoPlay loop playsInline />
                      : <img src={mediaUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 p-5 flex flex-col justify-between">
                    <p className="text-white text-[10px] font-black uppercase tracking-widest opacity-80">{watchSubtitle || 'Subtitle'}</p>
                    <div>
                      <p className="text-white text-xl font-black">{watchTitle || 'Offer Title'}</p>
                      {watchCode && <span className="text-[9px] font-black text-white/80 border border-dashed border-white/50 px-2 py-0.5 rounded">{watchCode}</span>}
                    </div>
                  </div>
                  <span className="absolute -right-3 -bottom-3 text-7xl opacity-20 rotate-12">{watchEmoji}</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Offer Title *</label>
                  <input {...register('title', { required: true })} placeholder="50% OFF up to ₹100" className={`input-field ${errors.title ? 'border-red-400' : ''}`} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtitle *</label>
                  <input {...register('subtitle', { required: true })} placeholder="First order special" className={`input-field ${errors.subtitle ? 'border-red-400' : ''}`} />
                </div>

                {/* Media upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Banner Image / Video
                  </label>
                  <MediaUploader
                    value={mediaUrl}
                    onChange={(url, type) => { setMediaUrl(url); setMediaType(type); setValue('mediaUrl', url); }}
                  />
                </div>

                {/* Discount */}
                <div className="border border-dashed border-orange-200 rounded-2xl p-4 bg-orange-50/50 space-y-3">
                  <p className="font-black text-sm text-orange-700">🏷️ Offer / Discount (optional)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Discount %</label>
                      <input {...register('discountPercent')} type="number" min="0" max="100" placeholder="50"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Max ₹</label>
                      <input {...register('discountMax')} type="number" min="0" placeholder="100"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Min Order</label>
                      <input {...register('minOrder')} type="number" min="0" placeholder="199"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand bg-white" />
                    </div>
                  </div>
                  <p className="text-[10px] text-orange-500">e.g. 50% OFF up to ₹100 on orders above ₹199</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Coupon Code (optional)</label>
                  <input {...register('code')} placeholder="NEWUSER50" className="input-field" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Emoji</label>
                  <div className="flex gap-2 flex-wrap">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} type="button" onClick={() => setValue('emoji', e)}
                        className={`w-10 h-10 text-xl rounded-xl border-2 transition-all ${watchEmoji === e ? 'border-brand bg-brand/10' : 'border-gray-100 hover:border-gray-300'}`}
                      >{e}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Color</label>
                  <div className="grid grid-cols-3 gap-2">
                    {GRADIENT_OPTIONS.map(g => (
                      <button key={g.value} type="button" onClick={() => setValue('gradient', g.value)}
                        className={`h-10 bg-gradient-to-r ${g.value} rounded-xl border-2 transition-all ${watchGradient === g.value ? 'border-gray-900 scale-105' : 'border-transparent'}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-black text-blue-700 uppercase tracking-wider flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Schedule (optional)</p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Go Live At</label>
                    <input {...register('startAt')} type="datetime-local" className="input-field text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Leave empty to go live immediately when active</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Expire At</label>
                    <input {...register('endAt')} type="datetime-local" className="input-field text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Leave empty to never expire</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Display Order</label>
                  <input {...register('order')} type="number" min="0" placeholder="0" className="input-field" />
                  <p className="text-xs text-gray-400 mt-1">Drag to reorder from the list instead</p>
                </div>
                <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:opacity-60 flex items-center justify-center gap-2">
                  {isSubmitting ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving...</> : editTarget ? 'Save Changes' : 'Create Banner'}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
