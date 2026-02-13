import { useState, useEffect, useMemo } from 'react';
import Clock from './components/Clock';
import ArrivalColumn from './components/ArrivalColumn';
import TrainMap from './components/TrainMap';
import SettingsDrawer from './components/SettingsDrawer';
import StatusBar from './components/StatusBar';
import WeatherStrip from './components/WeatherStrip';
import AlertsBanner from './components/AlertsBanner';
import { useArrivals } from './hooks/useArrivals';
import { useBusArrivals } from './hooks/useBusArrivals';
import { useVehicles } from './hooks/useVehicles';
import { useCitibike } from './hooks/useCitibike';

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

export default function App() {
  const saved = loadSaved();
  const [userLat, setUserLat] = useState(saved?.lat || 0);
  const [userLon, setUserLon] = useState(saved?.lon || 0);
  const [locationLabel, setLocationLabel] = useState(saved?.locationLabel || '');
  const [routes, setRoutes] = useState(saved?.routes || []);
  const [busRoutes, setBusRoutes] = useState(saved?.busRoutes || []);
  const [drawerOpen, setDrawerOpen] = useState(!saved);
  const [stations, setStations] = useState([]);

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

  function handleSave(cfg) {
    setUserLat(cfg.lat);
    setUserLon(cfg.lon);
    setLocationLabel(cfg.locationLabel);
    setRoutes(cfg.routes);
    setBusRoutes(cfg.busRoutes || []);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setDrawerOpen(false);
  }

  const configured = userLat && userLon && (routes.length >= 1 || busRoutes.length >= 1);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white font-mono select-none">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2 border-b border-gray-800/60 shrink-0">
        <div className="flex items-center gap-3 truncate max-w-[50%]">
          <h1 className="text-xs font-semibold tracking-widest text-gray-500 uppercase truncate">
            {locationLabel || 'NYC Transit'}
          </h1>
          <WeatherStrip lat={userLat} lon={userLon} />
        </div>
        <Clock />
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
      </header>

      {configured && <AlertsBanner routes={routes} busRoutes={busRoutes} />}

      {configured ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* ── Live train map ─────────────────────────────── */}
          {!drawerOpen && (
            <div className="h-[38%] shrink-0 border-b border-gray-800/60">
              <TrainMap
                stationLat={userLat}
                stationLon={userLon}
                vehicles={vehicles}
                nearbyStations={nearbyStations}
                citibikeStations={citibikeStations}
              />
            </div>
          )}

          {/* ── Arrival columns ─────────────────────────────── */}
          <div
            className="flex-1 grid min-h-0 overflow-y-auto"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
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
          <div className="text-center text-gray-500 space-y-3 px-8">
            <p className="text-lg">NYC Subway Transit Display</p>
            <p className="text-sm">
              Tap the gear icon to set your location.
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
