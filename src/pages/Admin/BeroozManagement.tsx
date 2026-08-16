import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import toast from 'react-hot-toast';
import { Car, Users, CheckCircle, Clock, IndianRupee } from 'lucide-react';

type SubTab = 'rides' | 'drivers';

const TYPE_EMOJI: Record<string, string> = { bike: '🏍️', auto: '🛺', cab: '🚗' };

const RIDE_STATUS_COLOR: Record<string, string> = {
  searching:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  accepted:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  arriving:    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  in_progress: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  completed:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function BeroozManagement() {
  const [subTab, setSubTab]   = useState<SubTab>('rides');
  const [rides,   setRides]   = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rideFilter, setRideFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    if (subTab === 'rides') {
      const q = query(collection(db, 'berooz_rides'), orderBy('createdAt', 'desc'), limit(300));
      const unsub = onSnapshot(q, snap => {
        setRides(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }, () => setLoading(false));
      return unsub;
    } else {
      const q = query(collection(db, 'berooz_drivers'), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, snap => {
        setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }, () => setLoading(false));
      return unsub;
    }
  }, [subTab]);

  const totalFare      = rides.filter(r => r.status === 'completed').reduce((s, r) => s + (r.fare ?? 0), 0);
  const completedRides = rides.filter(r => r.status === 'completed').length;
  const activeRides    = rides.filter(r => ['accepted','arriving','in_progress'].includes(r.status)).length;
  const onlineDrivers  = drivers.filter(d => d.isOnline).length;

  const filteredRides = rideFilter === 'all' ? rides : rides.filter(r => r.status === rideFilter);

  async function cancelRide(rideId: string) {
    if (!confirm('Cancel this ride?')) return;
    await updateDoc(doc(db, 'berooz_rides', rideId), { status: 'cancelled', cancelledBy: 'admin' });
    toast.success('Ride cancelled');
  }

  async function toggleBlock(driverId: string, blocked: boolean) {
    await updateDoc(doc(db, 'berooz_drivers', driverId), { isBlocked: !blocked });
    toast.success(blocked ? 'Driver unblocked' : 'Driver blocked');
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="text-3xl">🛺</div>
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Berooz Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Ride-hailing platform — rides, drivers, earnings</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Rides',    value: rides.length,    icon: Car,          color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20'   },
          { label: 'Completed',      value: completedRides,  icon: CheckCircle,  color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
          { label: 'Active Now',     value: activeRides,     icon: Clock,        color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
          { label: 'Drivers Online', value: onlineDrivers,   icon: Users,        color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-5 flex items-center gap-4`}>
            <s.icon className={`${s.color} shrink-0`} size={28} />
            <div>
              <p className={`font-black text-2xl ${s.color}`}>{s.value}</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Total Earnings */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IndianRupee className="text-amber-600" size={24} />
          <p className="font-bold text-gray-700 dark:text-gray-300">Total Completed Fare (Platform GMV)</p>
        </div>
        <p className="text-amber-700 dark:text-amber-400 font-black text-2xl">₹{totalFare.toLocaleString('en-IN')}</p>
      </div>

      {/* Sub-tab toggle */}
      <div className="flex gap-2">
        {(['rides', 'drivers'] as const).map(t => (
          <button key={t} onClick={() => { setSubTab(t); setLoading(true); }}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm capitalize transition-all ${
              subTab === t
                ? 'bg-brand text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
            }`}>
            {t === 'rides' ? `🛺 Rides (${rides.length})` : `🏍️ Drivers (${drivers.length})`}
          </button>
        ))}
      </div>

      {/* ── RIDES ── */}
      {subTab === 'rides' && (
        <div className="space-y-4">
          {/* Status filter chips */}
          <div className="flex gap-2 flex-wrap">
            {['all','searching','accepted','arriving','in_progress','completed','cancelled'].map(s => (
              <button key={s} onClick={() => setRideFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${
                  rideFilter === s
                    ? 'bg-brand text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700'
                }`}>
                {s === 'all'
                  ? `All (${rides.length})`
                  : `${s.replace(/_/g,' ')} (${rides.filter(r => r.status === s).length})`}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredRides.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No rides found</div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Ride</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Route</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Driver</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Fare</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredRides.map(ride => (
                    <tr key={ride.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-bold text-gray-900 dark:text-white text-xs">
                          #{ride.id.slice(-6).toUpperCase()}
                        </p>
                        <p className="text-gray-400 text-xs">
                          {TYPE_EMOJI[ride.vehicleType] ?? '🚗'} {ride.vehicleType}
                        </p>
                        <p className="text-gray-400 text-xs">
                          {ride.createdAt?.toDate?.()?.toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) ?? '—'}
                        </p>
                      </td>
                      <td className="px-5 py-4 max-w-[200px]">
                        <p className="text-gray-700 dark:text-gray-300 text-xs truncate">📍 {ride.pickup?.name}</p>
                        <p className="text-gray-700 dark:text-gray-300 text-xs truncate mt-0.5">🏁 {ride.drop?.name}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-gray-700 dark:text-gray-300 text-xs">{ride.driverName ?? '—'}</p>
                        <p className="text-gray-400 text-xs">{ride.vehicleNumber ?? ''}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${RIDE_STATUS_COLOR[ride.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {ride.status?.replace(/_/g,' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <p className="font-black text-amber-600 dark:text-amber-400">₹{ride.fare}</p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {['searching','accepted','arriving','in_progress'].includes(ride.status) && (
                          <button onClick={() => cancelRide(ride.id)}
                            className="text-xs text-red-500 font-bold border border-red-200 px-3 py-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DRIVERS ── */}
      {subTab === 'drivers' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : drivers.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No drivers yet</div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Driver</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Vehicle</th>
                    <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Rides</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Earnings</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Rating</th>
                    <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {drivers.map(driver => (
                    <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center text-lg shrink-0">
                            {TYPE_EMOJI[driver.vehicleType] ?? '🏍️'}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white">{driver.name || 'Unnamed'}</p>
                            <p className="text-gray-400 text-xs">{driver.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-gray-700 dark:text-gray-300 text-xs capitalize">{driver.vehicleType}</p>
                        <p className="text-gray-400 text-xs">{driver.vehicleNumber || '—'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          driver.isBlocked
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : driver.isOnline
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {driver.isBlocked ? '🚫 Blocked' : driver.isOnline ? '🟢 Online' : '⚫ Offline'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-gray-700 dark:text-gray-300">
                        {driver.totalRides ?? 0}
                      </td>
                      <td className="px-5 py-4 text-right font-black text-green-600 dark:text-green-400">
                        ₹{(driver.totalEarnings ?? 0).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-4 text-right text-amber-500 font-bold">
                        ⭐ {driver.rating?.toFixed(1) ?? '5.0'}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => toggleBlock(driver.id, driver.isBlocked ?? false)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
                            driver.isBlocked
                              ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                          {driver.isBlocked ? 'Unblock' : 'Block'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
