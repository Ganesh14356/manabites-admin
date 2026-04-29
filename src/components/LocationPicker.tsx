import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Loader, X, Check } from 'lucide-react';

interface LocationResult {
  address: string;
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  lat: number | null;
  lng: number | null;
  address: string;
  onChange: (result: LocationResult) => void;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export function LocationPicker({ lat, lng, address, onChange }: LocationPickerProps) {
  const [query, setQuery] = useState(address || '');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(address || '');
  }, [address]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q, format: 'json', limit: '5', countrycodes: 'in',
        viewbox: '78.28,17.27,78.65,17.60', bounded: '0',
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        signal: abortRef.current.signal,
        headers: { 'Accept-Language': 'en' },
      });
      const data: NominatimResult[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
    } catch (e: any) {
      if (e.name !== 'AbortError') { setSuggestions([]); setOpen(false); }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 400);
  };

  const handleSelect = (item: NominatimResult) => {
    const result: LocationResult = {
      address: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    };
    setQuery(item.display_name);
    setSuggestions([]);
    setOpen(false);
    onChange(result);
  };

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => () => {
    debounceRef.current && clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const hasCoords = lat != null && lng != null && lat !== 0 && lng !== 0;

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search restaurant location (e.g. Banjara Hills, Hyderabad)"
          className="input-field pl-9 pr-9"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setQuery(''); setSuggestions([]); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map(item => {
            const parts = item.display_name.split(', ');
            return (
              <li
                key={item.place_id}
                onMouseDown={e => { e.preventDefault(); handleSelect(item); }}
                className="flex items-start gap-2.5 px-4 py-3 cursor-pointer hover:bg-gray-50 text-sm border-b last:border-b-0 border-gray-50"
              >
                <MapPin className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{parts.slice(0, 2).join(', ')}</p>
                  <p className="text-xs text-gray-400 truncate">{parts.slice(2).join(', ')}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasCoords && (
        <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Location pinned: {lat!.toFixed(5)}, {lng!.toFixed(5)}</span>
        </div>
      )}
      {!hasCoords && (
        <p className="text-xs text-orange-600">Search and select a location to pin coordinates for nearby filtering.</p>
      )}
    </div>
  );
}
