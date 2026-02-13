import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 15_000;

export function useBusArrivals(lat, lon, busRoutes) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const fetchBus = useCallback(async () => {
    if (!lat || !lon || !busRoutes?.length) return;

    try {
      const url = `/api/bus-arrivals?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&routes=${busRoutes.join(',')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json();

      // Normalize: backend uses "stop" but ArrivalColumn expects "station"
      if (json.arrivals) {
        for (const route of Object.keys(json.arrivals)) {
          const entry = json.arrivals[route];
          if (entry.stop && !entry.station) {
            entry.station = entry.stop;
          }
        }
      }

      setData(json);
      setError(json.errors?.length ? json.errors.join('; ') : null);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [lat, lon, busRoutes]);

  useEffect(() => {
    if (!lat || !lon || !busRoutes?.length) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchBus();
    timer.current = setInterval(fetchBus, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [fetchBus]);

  return { data, loading, error };
}
