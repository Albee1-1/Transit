import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 15_000;

export function useArrivals(lat, lon, selectedRoutes) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const timer = useRef(null);

  const fetchArrivals = useCallback(async () => {
    if (!lat || !lon || !selectedRoutes?.length) return;

    try {
      const url = `/api/arrivals?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&routes=${selectedRoutes.join(',')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
      setError(json.errors?.length ? json.errors.join('; ') : null);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [lat, lon, selectedRoutes]);

  useEffect(() => {
    if (!lat || !lon || !selectedRoutes?.length) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchArrivals();
    timer.current = setInterval(fetchArrivals, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [fetchArrivals]);

  return { data, loading, error, lastUpdated, refresh: fetchArrivals };
}
