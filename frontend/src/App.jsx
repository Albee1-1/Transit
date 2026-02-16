import { useState, useEffect, useMemo, useCallback } from 'react';
import Clock from './components/Clock';
import ArrivalColumn from './components/ArrivalColumn';
import TrainMap from './components/TrainMap';
import SettingsDrawer from './components/SettingsDrawer';
import StatusBar from './components/StatusBar';
import WeatherStrip from './components/WeatherStrip';
import AlertsBanner from './components/AlertsBanner';
import ServiceStatus from './components/ServiceStatus';
import LeaveNowBanner from './components/LeaveNowBanner';
import { useArrivals } from './hooks/useArrivals';
import { useBusArrivals } from './hooks/useBusArrivals';
import { useVehicles } from './hooks/useVehicles';
import { useCitibike } from './hooks/useCitibike';
import { useKeyboard } from './hooks/useKeyboard';
import { useToast } from './components/Toast';

const STORAGE_KEY = 'nyc-subway-cfg';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (
        cfg.lat &&
        cfg.lon &&
        ((Array.isArray(cfg.routes) && cfg.routes.length >= 1) ||
         (Array.isArray(cfg.busRoutes) && cfg.busRoutes.length >= 1))
      ) {
        return cfg;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

export default function App() {
  const saved = loadSaved();
  const [userLat, setUserLat] = useState(saved?.lat || 0);
  const [userLon, setUserLon] = useState(saved?.lon || 0);
  const [locationLabel, setLocationLabel] = useState(saved?.locationLabel || '');
  const [routes, setRoutes] = useState(saved?.routes || []);
  const [busRoutes, setBusRoutes] = useState(saved?.busRoutes || []);
  const [drawerOpen, setDrawerOpen] = useState(!saved);
  const [stations, setStations] = useState([]);
  const [mapCollapsed, setMapCollapsed] = useState(false);

  const addToast = useToast();

  const { data, loading, error, lastUpdated } = useArrivals(userLat, userLon, routes);
  const { data: busData, loading: busLoading, error: busError } = useBusArrivals(userLat, userLon, busRoutes);
  const subwayVehicles = useVehicles(routes);
  const citibikeStations = useCitibike(userLat, userLon);

  // Merge subway + bus vehicles for the map
  const busVehicles = busData?.vehicles || [];
  const vehicles = useMemo(() => {
    return [...(subwayVehicles || []), ...busVehicles];
  }, [subwayVehicles, busVehicles]);

  useEffect(() => {
    fetch('/api/stations')
      .then((r) => r.json())
      .then((list) => { if (Array.isArray(list)) setStations(list); })
      .catch(() => {});
  }, []);

  // Nearby stations for the map overlay (within ~2 miles)
  const nearbyStations = useMemo(() => {
    if (!userLat || !userLon) return [];
    return stations.filter((s) => {
      const d = Math.abs(s.lat - userLat) + Math.abs(s.lon - userLon);
      return d < 0.04;
    });
  }, [stations, userLat, userLon]);

  const handleSave = useCallback((cfg) => {
    setUserLat(cfg.lat);
    setUserLon(cfg.lon);
    setLocationLabel(cfg.locationLabel);
    setRoutes(cfg.routes);
    setBusRoutes(cfg.busRoutes || []);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setDrawerOpen(false);
    if (addToast) addToast('Settings saved', 'success', 2000);
  }, [addToast]);

  // Keyboard shortcuts
  useKeyboard(useMemo(() => ({
    s: () => setDrawerOpen((o) => !o),
    f: toggleFullscreen,
    m: () => setMapCollapsed((c) => !c),
    escape: () => setDrawerOpen(false),
  }), []));

  const configured = userLat && userLon && (routes.length >= 1 || busRoutes.length >= 1);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white font-mono select-none">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 sm:px-5 py-2 border-b border-gray-800/60 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 truncate min-w-0 flex-1">
          <h1 className="text-[10px] sm:text-xs font-semibold tracking-widest text-gray-500 uppercase truncate">
            {locationLabel || 'NYC Transit'}
          </h1>
          <WeatherStrip lat={userLat} lon={userLon} />
          {configured && <ServiceStatus selectedRoutes={routes} />}
        </div>
        <div className="shrink-0 mx-2 sm:mx-4">
          <Clock />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="text-gray-600 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 hidden sm:block"
            aria-label="Fullscreen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          {/* Settings */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-gray-600 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
            aria-label="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {configured && <AlertsBanner routes={routes} busRoutes={busRoutes} />}

      {configured && (
        <LeaveNowBanner
          routes={routes}
          busRoutes={busRoutes}
          arrivalData={data?.arrivals}
          busArrivalData={busData?.arrivals}
          userLat={userLat}
          userLon={userLon}
        />
      )}

      {configured ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* ── Live map ─────────────────────────────────────── */}
          {!drawerOpen && !mapCollapsed && (
            <div className="h-[35%] sm:h-[38%] shrink-0 border-b border-gray-800/60 relative">
              <TrainMap
                stationLat={userLat}
                stationLon={userLon}
                vehicles={vehicles}
                nearbyStations={nearbyStations}
                citibikeStations={citibikeStations}
              />
              {/* Map collapse button */}
              <button
                onClick={() => setMapCollapsed(true)}
                className="absolute top-2 right-2 z-[500] bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white rounded-lg px-2 py-1 text-[10px] backdrop-blur-sm border border-gray-700/50 transition-colors"
              >
                Hide Map
              </button>
            </div>
          )}

          {/* Map expand bar when collapsed */}
          {mapCollapsed && (
            <button
              onClick={() => setMapCollapsed(false)}
              className="shrink-0 flex items-center justify-center gap-2 py-2.5 text-xs text-blue-400 hover:text-blue-300 border-b border-gray-800/60 bg-blue-950/20 hover:bg-blue-950/40 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Show Live Map
            </button>
          )}

          {/* ── Arrival columns ───────────────────────────────── */}
          <div
            className="flex-1 grid min-h-0 overflow-y-auto"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${routes.length + busRoutes.length > 4 ? '180' : '220'}px, 1fr))` }}
          >
            {routes.map((r) => (
              <ArrivalColumn
                key={r}
                route={r}
                arrivalData={data?.arrivals?.[r]}
                loading={loading}
                userLat={userLat}
                userLon={userLon}
              />
            ))}
            {busRoutes.map((r) => (
              <ArrivalColumn
                key={`bus-${r}`}
                route={r}
                arrivalData={busData?.arrivals?.[r]}
                loading={busLoading}
                isBus
                userLat={userLat}
                userLon={userLon}
              />
            ))}
          </div>
        </div>
      ) : (
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 space-y-4 px-8 max-w-md">
            <div className="text-5xl opacity-40">&#128647;</div>
            <p className="text-xl font-semibold text-gray-300">NYC Transit Display</p>
            <p className="text-sm leading-relaxed">
              Real-time subway, bus, and bike information at a glance.
              <br />
              Tap the gear icon or press <kbd className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 text-xs">S</kbd> to get started.
            </p>
          </div>
        </main>
      )}

      <StatusBar lastUpdated={lastUpdated} error={error || busError} loading={loading || busLoading} />

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        currentLat={userLat}
        currentLon={userLon}
        currentRoutes={routes}
        currentBusRoutes={busRoutes}
        onSave={handleSave}
      />
    </div>
  );
}
