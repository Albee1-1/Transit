import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 30_000;

export function useCitibike(lat, lon) {
  const [stations, setStations] = useState([]);
  const timer = useRef(null);

  const fetchStations = useCallback(async () => {
    if (!lat || !lon) return;
    try {
      const res = await fetch(`/api/citibike?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (Array.isArray(data)) setStations(data);
    } catch { /* ignore */ }
  }, [lat, lon]);

  useEffect(() => {
    if (!lat || !lon) { setStations([]); return; }
    fetchStations();
    timer.current = setInterval(fetchStations, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [fetchStations]);

  return stations;
}
