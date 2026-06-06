import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Loader, X, Check, LocateFixed } from 'lucide-react';

// Fix default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface LocationResult {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;     // Google Place ID — undefined for map-clicks/drags/Nominatim matches
  locationName?: string; // short label e.g. "Nakkala Gutta, Hanamkonda"
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

// Unified suggestion shape — backed by either Google Places (typo-tolerant,
// understands shop names/landmarks) or Nominatim/OpenStreetMap (free fallback).
interface Suggestion {
  id: string;
  mainText: string;
  secondaryText: string;
  source: 'google' | 'nominatim';
  placeId?: string;          // google
  lat?: number; lng?: number; // nominatim (resolved immediately)
  fullText: string;           // nominatim (used as display_name on select)
}

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// ── Load Google Maps Places library once (script tag, shared across instances) ──
let mapsScriptState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const mapsReadyCallbacks: Array<() => void> = [];

function loadGoogleMaps(): Promise<void> {
  if (mapsScriptState === 'ready') return Promise.resolve();
  if (mapsScriptState === 'failed') return Promise.reject(new Error('Google Maps unavailable'));

  return new Promise((resolve, reject) => {
    mapsReadyCallbacks.push(resolve);
    if (mapsScriptState === 'loading') return;
    mapsScriptState = 'loading';

    if (!MAPS_KEY) {
      console.warn('[LocationPicker] VITE_GOOGLE_MAPS_API_KEY missing — using Nominatim only.');
      mapsScriptState = 'failed'; mapsReadyCallbacks.forEach(cb => cb()); reject(new Error('No API key')); return;
    }

    const w = window as any;
    if (w.google?.maps?.places) {
      mapsScriptState = 'ready';
      mapsReadyCallbacks.forEach(cb => cb());
      return;
    }

    // Google calls this global when the key/referrer/billing is invalid
    // (RefererNotAllowedMapError, InvalidKeyMapError, ApiNotActivatedMapError, etc).
    // Surfacing it makes an otherwise-silent fallback-to-Nominatim debuggable.
    w.gm_authFailure = () => {
      console.error('[LocationPicker] Google Maps auth failure — likely the API key is not allowed for this domain (' + window.location.hostname + ') or Places API/billing is not enabled. Falling back to Nominatim.');
      mapsScriptState = 'failed';
      mapsReadyCallbacks.forEach(cb => cb());
    };

    w.__lp_gm_init = () => {
      mapsScriptState = 'ready';
      mapsReadyCallbacks.forEach(cb => cb());
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&callback=__lp_gm_init`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      console.error('[LocationPicker] Failed to load the Google Maps script (network/CSP). Falling back to Nominatim.');
      mapsScriptState = 'failed'; reject(new Error('Failed to load Google Maps'));
    };
    document.head.appendChild(script);
  });
}

const DEFAULT_CENTER: [number, number] = [17.4483, 78.3915]; // Hyderabad

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMapEvents({});
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export function LocationPicker({ lat, lng, address, onChange }: LocationPickerProps) {
  const [query, setQuery] = useState(address || '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const hasCoords = lat != null && lng != null && lat !== 0 && lng !== 0;
  const markerPos: [number, number] | null = hasCoords ? [lat!, lng!] : null;
  const mapCenter: [number, number] = hasCoords ? [lat!, lng!] : DEFAULT_CENTER;

  useEffect(() => {
    setQuery(address || '');
  }, [address]);

  // Load Google Places (typo-tolerant, knows shop names/landmarks) once.
  // Falls back silently to Nominatim if the key is missing or the script fails.
  useEffect(() => {
    loadGoogleMaps()
      .then(() => {
        const w = window as any;
        autocompleteRef.current = new w.google.maps.places.AutocompleteService();
        geocoderRef.current = new w.google.maps.Geocoder();
        setMapsReady(true);
      })
      .catch(() => { /* stay on Nominatim */ });
  }, []);

  const updateDropdownRect = useCallback(() => {
    const el = inputWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownRect();
    window.addEventListener('scroll', updateDropdownRect, true);
    window.addEventListener('resize', updateDropdownRect);
    return () => {
      window.removeEventListener('scroll', updateDropdownRect, true);
      window.removeEventListener('resize', updateDropdownRect);
    };
  }, [open, updateDropdownRect]);

  const googleSearch = useCallback((q: string): Promise<Suggestion[]> => {
    return new Promise((resolve) => {
      if (!autocompleteRef.current) { resolve([]); return; }
      autocompleteRef.current.getPlacePredictions(
        // NOTE: 'geocode' and 'establishment' are mutually-exclusive type
        // collections — passing both makes Google return INVALID_REQUEST and
        // the search silently falls through to Nominatim every time. Omitting
        // `types` returns a mix of addresses + places (shop names), which is
        // what an address picker needs.
        { input: q, componentRestrictions: { country: 'in' } },
        (preds: any[] | null, status: string) => {
          if (status !== 'OK' || !preds?.length) {
            if (status !== 'ZERO_RESULTS') console.warn('[LocationPicker] Google Places Autocomplete status:', status, '— falling back to Nominatim for query:', q);
            resolve([]);
            return;
          }
          resolve(preds.map((p): Suggestion => ({
            id: `g_${p.place_id}`,
            mainText: p.structured_formatting?.main_text || p.description,
            secondaryText: p.structured_formatting?.secondary_text || '',
            fullText: p.description,
            source: 'google',
            placeId: p.place_id,
          })));
        },
      );
    });
  }, []);

  const nominatimSearch = useCallback(async (q: string, signal: AbortSignal): Promise<Suggestion[]> => {
    const params = new URLSearchParams({
      q, format: 'json', limit: '6', countrycodes: 'in', dedupe: '1', addressdetails: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal,
      headers: { 'Accept-Language': 'en' },
    });
    const data: NominatimResult[] = await res.json();
    return data.map((r): Suggestion => {
      const parts = r.display_name.split(', ');
      return {
        id: `n_${r.place_id}`,
        mainText: parts.slice(0, 2).join(', '),
        secondaryText: parts.slice(2).join(', '),
        fullText: r.display_name,
        source: 'nominatim',
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      };
    });
  }, []);

  const handleSelect = useCallback((item: Suggestion) => {
    setSuggestions([]);
    setOpen(false);

    if (item.source === 'nominatim') {
      setQuery(item.fullText);
      onChange({ address: item.fullText, lat: item.lat!, lng: item.lng!, locationName: item.mainText });
      return;
    }

    // Already-resolved Google result (e.g. forward-geocoded from a pasted address) — use directly, no extra round-trip.
    if (item.lat != null && item.lng != null) {
      setQuery(item.fullText);
      onChange({ address: item.fullText, lat: item.lat, lng: item.lng, placeId: item.placeId, locationName: item.mainText });
      return;
    }

    // Google prediction — resolve place_id → lat/lng/formatted address via Geocoder.
    setQuery(item.fullText);
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ placeId: item.placeId }, (results: any[] | null, status: string) => {
      if (status !== 'OK' || !results?.[0]) return;
      const r = results[0];
      const loc = r.geometry.location;
      const result: LocationResult = {
        address: r.formatted_address || item.fullText,
        lat: loc.lat(),
        lng: loc.lng(),
        placeId: item.placeId,
        locationName: item.mainText,
      };
      setQuery(result.address);
      onChange(result);
    });
  }, [onChange]);

  // Reverse-geocode a manually-pinned point (map click / marker drag) into an
  // address. A custom pin is no longer "the" Google place, so placeId is cleared.
  const reverseGeocode = useCallback(async (rLat: number, rLng: number): Promise<LocationResult> => {
    const fallback: LocationResult = { address: `${rLat.toFixed(5)}, ${rLng.toFixed(5)}`, lat: rLat, lng: rLng };

    if (mapsReady && geocoderRef.current) {
      const fromGoogle = await new Promise<LocationResult | null>((resolve) => {
        geocoderRef.current.geocode({ location: { lat: rLat, lng: rLng } }, (results: any[] | null, status: string) => {
          if (status !== 'OK' || !results?.[0]) { resolve(null); return; }
          const r = results[0];
          resolve({ address: r.formatted_address || fallback.address, lat: rLat, lng: rLng });
        });
      });
      if (fromGoogle) return fromGoogle;
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${rLat}&lon=${rLng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data?.display_name) return { address: data.display_name, lat: rLat, lng: rLng };
    } catch { /* keep fallback */ }

    return fallback;
  }, [mapsReady]);

  const handlePinMove = useCallback(async (newLat: number, newLng: number) => {
    const result = await reverseGeocode(newLat, newLng);
    setQuery(result.address);
    onChange(result);
  }, [reverseGeocode, onChange]);

  // Forward-geocode a complete address string straight to coordinates.
  // Places Autocomplete is built for incremental-typing predictions and often
  // returns ZERO_RESULTS for long pasted addresses with embedded landmarks —
  // the Geocoding API is purpose-built for resolving full address strings and
  // handles them far more precisely (verified: resolves "H No 1, 23/1, ... near
  // Raj Hotel ... Subedari, Hanamkonda 506001" to an exact rooftop point, while
  // Autocomplete returns nothing for the same string).
  const geocodeAddress = useCallback((q: string): Promise<Suggestion | null> => {
    return new Promise((resolve) => {
      if (!geocoderRef.current) { resolve(null); return; }
      geocoderRef.current.geocode({ address: q, componentRestrictions: { country: 'IN' } }, (results: any[] | null, status: string) => {
        if (status !== 'OK' || !results?.[0]) { resolve(null); return; }
        const r = results[0];
        const loc = r.geometry.location;
        resolve({
          id: `geo_${r.place_id}`,
          mainText: r.formatted_address,
          secondaryText: '',
          fullText: r.formatted_address,
          source: 'google',
          placeId: r.place_id,
          lat: loc.lat(),
          lng: loc.lng(),
        });
      });
    });
  }, []);

  // Pasted Google-style addresses often include shop names, "near X / opposite Y"
  // landmarks and house numbers that OpenStreetMap's Nominatim database doesn't
  // recognise as a single string. If the full query returns nothing, progressively
  // drop the leading comma-separated segments (the most specific/landmark parts)
  // and retry — this usually lands on a matching area/locality/city.
  //
  // `autoSelect` (set when the text was pasted, not typed) skips the dropdown and
  // pins the top match straight away — pasting a full address means "find this
  // exact place", not "let me browse suggestions".
  const fetchSuggestions = useCallback(async (q: string, autoSelect = false) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) { setSuggestions([]); setOpen(false); setNotFound(false); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setNotFound(false);
    try {
      let results: Suggestion[] = [];

      // Pasted full address → resolve directly with the Geocoding API (built for
      // complete-address strings; Autocomplete frequently returns ZERO_RESULTS
      // for long landmark-laden pasted addresses).
      if (autoSelect && mapsReady && geocoderRef.current) {
        const geocoded = await geocodeAddress(trimmed);
        if (geocoded) {
          handleSelect(geocoded);
          return;
        }
      }

      // Google Places understands shop names, landmarks & typos directly — try it first.
      if (mapsReady && autocompleteRef.current) {
        results = await googleSearch(trimmed);
      }

      // Fall back to Nominatim with progressive query simplification.
      if (results.length === 0) {
        const segments = trimmed.split(',').map(s => s.trim()).filter(Boolean);
        const candidates = [trimmed, ...segments.map((_, i) => segments.slice(i + 1).join(', ')).filter(s => s.length >= 3)];
        for (const candidate of candidates) {
          results = await nominatimSearch(candidate, controller.signal);
          if (results.length > 0) break;
        }
      }

      if (autoSelect && results.length > 0) {
        handleSelect(results[0]);
        return;
      }
      setSuggestions(results);
      setOpen(true);
      setNotFound(results.length === 0);
    } catch (e: any) {
      if (e.name !== 'AbortError') { setSuggestions([]); setOpen(true); setNotFound(true); }
    } finally {
      setLoading(false);
    }
  }, [mapsReady, googleSearch, nominatimSearch, handleSelect, geocodeAddress]);

  const pastedRef = useRef(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    const autoSelect = pastedRef.current;
    pastedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val, autoSelect), autoSelect ? 50 : 300);
  };

  const handlePaste = () => { pastedRef.current = true; };

  // Map click / marker drag both move the pin to a custom point — reverse-geocode
  // it so the address field stays in sync with where the marker actually sits.
  const handleMapClick = useCallback((clickLat: number, clickLng: number) => {
    handlePinMove(clickLat, clickLng);
  }, [handlePinMove]);

  const handleMarkerDragEnd = useCallback((e: any) => {
    const { lat: newLat, lng: newLng } = e.target.getLatLng();
    handlePinMove(newLat, newLng);
  }, [handlePinMove]);

  const handleDetectLocation = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: dLat, longitude: dLng } = pos.coords;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${dLat}&lon=${dLng}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          );
          const data = await res.json();
          const addr = data.display_name || `${dLat.toFixed(5)}, ${dLng.toFixed(5)}`;
          setQuery(addr);
          onChange({ address: addr, lat: dLat, lng: dLng });
        } catch {
          const addr = `${dLat.toFixed(5)}, ${dLng.toFixed(5)}`;
          setQuery(addr);
          onChange({ address: addr, lat: dLat, lng: dLng });
        } finally {
          setDetecting(false);
        }
      },
      () => setDetecting(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
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

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Search input */}
      <div className="relative" ref={inputWrapRef}>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
        </div>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => { if (suggestions.length > 0) { updateDropdownRect(); setOpen(true); } }}
          onPaste={handlePaste}
          placeholder="Search restaurant location (e.g. Banjara Hills, Hyderabad)"
          className="input-field pl-9 pr-9"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setQuery(''); setSuggestions([]); setOpen(false); setNotFound(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Suggestions dropdown — portaled to body so it escapes the scrollable drawer's clipping */}
      {open && dropdownRect && createPortal(
        <ul
          className="fixed bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto"
          style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width, zIndex: 99999 }}
        >
          {suggestions.length > 0 ? suggestions.map(item => (
            <li
              key={item.id}
              onMouseDown={e => { e.preventDefault(); handleSelect(item); }}
              className="flex items-start gap-2.5 px-4 py-3 cursor-pointer hover:bg-gray-50 text-sm border-b last:border-b-0 border-gray-50"
            >
              <MapPin className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{item.mainText}</p>
                {item.secondaryText && <p className="text-xs text-gray-400 truncate">{item.secondaryText}</p>}
              </div>
            </li>
          )) : notFound && (
            <li className="px-4 py-3 text-sm text-gray-400 text-center">Location not found</li>
          )}
        </ul>,
        document.body
      )}

      {/* Detect current location */}
      <button
        type="button"
        onClick={handleDetectLocation}
        disabled={detecting}
        className="flex items-center gap-2 text-sm font-medium text-brand hover:text-brand/80 disabled:opacity-50 transition-colors"
      >
        {detecting
          ? <Loader className="w-4 h-4 animate-spin" />
          : <LocateFixed className="w-4 h-4" />}
        {detecting ? 'Detecting location...' : 'Use my current location'}
      </button>

      {/* Map box */}
      <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 200 }}>
        <MapContainer
          center={mapCenter}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapClickHandler onMapClick={handleMapClick} />
          <RecenterMap center={mapCenter} />
          {markerPos && (
            <Marker
              position={markerPos}
              draggable
              eventHandlers={{ dragend: handleMarkerDragEnd }}
            />
          )}
        </MapContainer>
      </div>

      {hasCoords ? (
        <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Pinned: {lat!.toFixed(5)}, {lng!.toFixed(5)} — click map or drag the marker to adjust</span>
        </div>
      ) : (
        <p className="text-xs text-orange-600">Search for a location or click on the map to pin coordinates.</p>
      )}
    </div>
  );
}
