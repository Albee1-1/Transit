import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SUBWAY_LINES, ALL_ROUTES } from '../subwayLines';

const PRESETS_KEY = 'nyc-transit-presets';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; }
}

function SavedPresets({ onLoad }) {
  const [presets, setPresets] = useState(loadPresets());
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  function savePreset() {
    if (!name.trim()) return;
    try {
      const raw = localStorage.getItem('nyc-subway-cfg');
      if (!raw) return;
      const cfg = JSON.parse(raw);
      const updated = [...presets.filter((p) => p.name !== name.trim()), { name: name.trim(), ...cfg }];
      localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
      setPresets(updated);
      setSaving(false);
      setName('');
    } catch {}
  }

  function deletePreset(n) {
    const updated = presets.filter((p) => p.name !== n);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    setPresets(updated);
  }

  if (!presets.length && !saving) {
    return (
      <div className="px-5 pt-3 pb-1">
        <button
          onClick={() => setSaving(true)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Save current as preset
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-3 pb-1">
      <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
        Saved Locations
      </label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <div key={p.name} className="flex items-center gap-1">
            <button
              onClick={() => onLoad(p)}
              className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs"
            >
              {p.name}
            </button>
            <button onClick={() => deletePreset(p.name)} className="text-gray-600 hover:text-red-400 text-xs">&times;</button>
          </div>
        ))}
      </div>
      {saving ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && savePreset()}
            placeholder="e.g. Home, Work"
            className="flex-1 bg-white/5 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none"
            autoFocus
          />
          <button onClick={savePreset} className="px-2 py-1 bg-blue-600 rounded text-xs text-white">Save</button>
          <button onClick={() => setSaving(false)} className="text-gray-500 text-xs">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="mt-1.5 text-xs text-blue-400 hover:text-blue-300"
        >
          + Save current as preset
        </button>
      )}
    </div>
  );
}

function sortRoutes(routes) {
  return [...routes].sort((a, b) => {
    const ai = ALL_ROUTES.indexOf(a);
    const bi = ALL_ROUTES.indexOf(b);
    const av = ai === -1 ? 999 : ai;
    const bv = bi === -1 ? 999 : bi;
    if (av !== bv) return av - bv;
    return a.localeCompare(b);
  });
}

export default function SettingsDrawer({
  open,
  onClose,
  currentLat,
  currentLon,
  currentRoutes,
  currentBusRoutes,
  onSave,
}) {
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);
  const [address, setAddress] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [geoStatus, setGeoStatus] = useState('');
  const [pickedRoutes, setPickedRoutes] = useState([]);
  const [pickedBusRoutes, setPickedBusRoutes] = useState([]);
  const [allBusRoutes, setAllBusRoutes] = useState([]);
  const [busRoutesLoading, setBusRoutesLoading] = useState(false);
  const [busFilter, setBusFilter] = useState('');
  const [addressResults, setAddressResults] = useState([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [activeAddressIndex, setActiveAddressIndex] = useState(-1);
  const [addressError, setAddressError] = useState('');
  const searchReqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setLat(currentLat || null);
    setLon(currentLon || null);
    setPickedRoutes(currentRoutes || []);
    setPickedBusRoutes(currentBusRoutes || []);
    setGeoStatus('');
    setAddress('');
    setLocationLabel('');
    setAddressResults([]);
    setSearchingAddress(false);
    setActiveAddressIndex(-1);
    setAddressError('');
  }, [open, currentLat, currentLon, currentRoutes, currentBusRoutes]);

  // Fetch all MTA bus routes when drawer opens
  useEffect(() => {
    if (!open) return;
    if (allBusRoutes.length) return; // already loaded
    let cancelled = false;
    setBusRoutesLoading(true);
    fetch('/api/bus-routes')
      .then((r) => r.json())
      .then((routes) => {
        if (!cancelled && Array.isArray(routes)) setAllBusRoutes(routes);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBusRoutesLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Filtered bus routes based on search
  const filteredBusRoutes = useMemo(() => {
    if (!busFilter.trim()) return allBusRoutes;
    const q = busFilter.trim().toLowerCase();
    return allBusRoutes.filter(
      (r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [allBusRoutes, busFilter]);

  // Debounced address search
  useEffect(() => {
    if (!open) return;
    const q = address.trim();
    if (q.length < 2) {
      setAddressResults([]);
      setSearchingAddress(false);
      setActiveAddressIndex(-1);
      setAddressError('');
      return;
    }

    const reqId = ++searchReqRef.current;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearchingAddress(true);
      setAddressError('');
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const results = await res.json();
        if (reqId !== searchReqRef.current) return;
        const list = Array.isArray(results) ? results : [];
        setAddressResults(list);
        setActiveAddressIndex(list.length ? 0 : -1);
        if (!list.length) setAddressError('No matching addresses found');
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (reqId !== searchReqRef.current) return;
        setAddressResults([]);
        setActiveAddressIndex(-1);
        setAddressError('Address lookup failed');
      } finally {
        if (reqId === searchReqRef.current) setSearchingAddress(false);
      }
    }, 300);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [address, open]);

  const geolocate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('Geolocation not available');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLon(pos.coords.longitude);
        setLocationLabel('Current Location');
        setAddressResults([]);
        setGeoStatus('');
      },
      (err) => {
        setGeoStatus(
          err.code === 1
            ? 'Location permission denied'
            : 'Could not get location',
        );
      },
      { timeout: 10000 },
    );
  }, []);

  function applyAddressResult(result) {
    setLat(result.lat);
    setLon(result.lon);
    setLocationLabel(result.label || result.name || '');
    setAddress(result.label || result.name || '');
    setAddressResults([]);
    setActiveAddressIndex(-1);
    setAddressError('');
    setGeoStatus('');
  }

  async function geocodeAddress() {
    if (!address.trim()) return;
    if (addressResults.length > 0) {
      const picked = activeAddressIndex >= 0
        ? addressResults[activeAddressIndex]
        : addressResults[0];
      applyAddressResult(picked);
      return;
    }
    setGeoStatus('searching');
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address.trim())}`);
      const results = await res.json();
      if (results.length > 0) {
        applyAddressResult(results[0]);
      } else {
        setGeoStatus('No results found');
      }
    } catch {
      setGeoStatus('Search failed');
    }
  }

  function handleAddressKeyDown(e) {
    if (!addressResults.length) {
      if (e.key === 'Enter') geocodeAddress();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveAddressIndex((i) => (i + 1) % addressResults.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveAddressIndex((i) =>
        i <= 0 ? addressResults.length - 1 : i - 1,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeAddressIndex >= 0 ? activeAddressIndex : 0;
      applyAddressResult(addressResults[idx]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAddressResults([]);
      setActiveAddressIndex(-1);
    }
  }

  function toggleRoute(r) {
    setPickedRoutes((prev) => {
      if (prev.includes(r)) return prev.filter((x) => x !== r);
      return [...prev, r];
    });
  }

  function toggleBusRoute(id) {
    setPickedBusRoutes((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  const hasLocation = lat != null && lon != null && lat !== 0 && lon !== 0;
  const canSave = hasLocation && (pickedRoutes.length >= 1 || pickedBusRoutes.length >= 1);

  function handleSave() {
    if (!canSave) return;
    onSave({
      lat,
      lon,
      locationLabel: locationLabel || 'NYC Transit',
      routes: pickedRoutes,
      busRoutes: pickedBusRoutes,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex cursor-default">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <aside className="w-96 max-w-[90vw] bg-[#111] border-l border-gray-700 flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-base font-bold tracking-wide">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Saved presets ──────────────────────────────────── */}
          <SavedPresets onLoad={(cfg) => {
            setLat(cfg.lat);
            setLon(cfg.lon);
            setLocationLabel(cfg.locationLabel || '');
            setPickedRoutes(cfg.routes || []);
            setPickedBusRoutes(cfg.busRoutes || []);
          }} />

          {/* ── Location ─────────────────────────────────────── */}
          <div className="px-5 pt-4 pb-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Your Location
            </label>

            <button
              onClick={geolocate}
              disabled={geoStatus === 'locating'}
              className="mt-2 w-full flex items-center justify-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg px-3 py-2.5 text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {geoStatus === 'locating' ? 'Locating...' : 'Use My Location'}
            </button>

            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={handleAddressKeyDown}
                placeholder="Type your address"
                className="flex-1 bg-white/5 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
              <button
                onClick={geocodeAddress}
                disabled={geoStatus === 'searching'}
                className="px-3 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-gray-300 border border-gray-700 transition-colors shrink-0"
              >
                Go
              </button>
            </div>

            {(searchingAddress || addressResults.length > 0) && (
              <div className="mt-1.5 rounded-lg border border-gray-800 bg-black/30 max-h-56 overflow-y-auto">
                {searchingAddress && (
                  <div className="px-3 py-2 text-xs text-gray-500">Searching...</div>
                )}
                {!searchingAddress && addressResults.map((r, i) => (
                  <button
                    key={`${r.lat}-${r.lon}-${i}`}
                    onMouseEnter={() => setActiveAddressIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyAddressResult(r)}
                    className={`w-full text-left px-3 py-2 text-xs border-b border-gray-800/70 last:border-b-0 ${
                      i === activeAddressIndex
                        ? 'bg-blue-600/20 text-white'
                        : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    {r.label || r.name}
                  </button>
                ))}
              </div>
            )}

            {!searchingAddress && addressError && (
              <p className="text-xs text-gray-500 mt-1.5">{addressError}</p>
            )}

            {geoStatus && geoStatus !== 'locating' && geoStatus !== 'searching' && (
              <p className="text-xs text-red-400 mt-1.5">{geoStatus}</p>
            )}

            {hasLocation && (
              <p className="text-xs text-green-400/70 mt-1.5">Location set</p>
            )}
          </div>

          {/* ── Train lines ──────────────────────────────────── */}
          <div className="px-5 pt-3 pb-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Choose Trains ({pickedRoutes.length} selected)
            </label>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setPickedRoutes(sortRoutes(ALL_ROUTES))}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 border border-gray-700 text-xs text-gray-300"
              >
                Select All
              </button>
              <button
                onClick={() => setPickedRoutes([])}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 border border-gray-700 text-xs text-gray-300"
              >
                Clear
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_ROUTES.map((r) => {
                const li = SUBWAY_LINES[r];
                const on = pickedRoutes.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => toggleRoute(r)}
                    className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      on
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111] scale-110'
                        : 'opacity-40 hover:opacity-80 hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: li?.color || '#555',
                      color: li?.text || '#FFF',
                    }}
                  >
                    {li?.name || r}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Nearest station for each line will be used automatically.
            </p>
          </div>

          {/* ── Bus lines ─────────────────────────────────────── */}
          <div className="px-5 pt-3 pb-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Bus Lines ({pickedBusRoutes.length} selected)
            </label>
            {busRoutesLoading ? (
              <p className="text-xs text-gray-500 mt-2">Loading bus routes...</p>
            ) : allBusRoutes.length === 0 ? (
              <p className="text-xs text-gray-600 mt-2">No bus routes available.</p>
            ) : (
              <>
                <input
                  type="text"
                  value={busFilter}
                  onChange={(e) => setBusFilter(e.target.value)}
                  placeholder="Search buses (e.g. B46, Flatbush)"
                  className="mt-2 w-full bg-white/5 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setPickedBusRoutes([])}
                    className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 border border-gray-700 text-xs text-gray-300"
                  >
                    Clear
                  </button>
                </div>
                {/* Selected bus pills (always visible) */}
                {pickedBusRoutes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pickedBusRoutes.map((id) => {
                      const r = allBusRoutes.find((b) => b.id === id);
                      return (
                        <button
                          key={id}
                          onClick={() => toggleBusRoute(id)}
                          title={r?.name || id}
                          className="h-8 px-2 rounded-lg flex items-center justify-center text-xs font-bold ring-2 ring-white ring-offset-1 ring-offset-[#111] scale-105"
                          style={{
                            backgroundColor: r?.color || '#0039A6',
                            color: r?.textColor || '#FFF',
                          }}
                        >
                          {id}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Filtered routes list */}
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-800 bg-black/20">
                  {filteredBusRoutes.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-3">No matches</p>
                  ) : (
                    filteredBusRoutes.map((r) => {
                      const on = pickedBusRoutes.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          onClick={() => toggleBusRoute(r.id)}
                          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 border-b border-gray-800/50 last:border-b-0 transition-colors ${
                            on ? 'bg-white/10' : 'hover:bg-white/5'
                          }`}
                        >
                          <span
                            className="shrink-0 h-7 px-2 rounded flex items-center justify-center text-[11px] font-bold"
                            style={{
                              backgroundColor: r.color || '#0039A6',
                              color: r.textColor || '#FFF',
                            }}
                          >
                            {r.id}
                          </span>
                          <span className="text-xs text-gray-400 truncate flex-1">{r.name}</span>
                          {on && <span className="text-green-400 text-xs shrink-0">&#10003;</span>}
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Nearest stop for each bus will be used automatically.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-700 shrink-0">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`w-full py-3 rounded-lg font-bold text-sm tracking-wide transition-colors ${
              canSave
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {!hasLocation
              ? 'Set your location first'
              : (pickedRoutes.length === 0 && pickedBusRoutes.length === 0)
                ? 'Pick at least 1 line'
                : 'Save & Close'}
          </button>
        </div>
      </aside>
    </div>
  );
}
