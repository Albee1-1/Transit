import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 10_000;

export function useVehicles(selectedRoutes) {
  const [vehicles, setVehicles] = useState([]);
  const timer = useRef(null);

  const fetchVehicles = useCallback(async () => {
    if (!selectedRoutes?.length) return;
    try {
      const res = await fetch(
        `/api/vehicles?routes=${selectedRoutes.join(',')}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.vehicles)) setVehicles(data.vehicles);
    } catch {
      /* swallow — map is supplementary */
    }
  }, [selectedRoutes]);

  useEffect(() => {
    if (!selectedRoutes?.length) { setVehicles([]); return; }
    fetchVehicles();
    timer.current = setInterval(fetchVehicles, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [fetchVehicles]);

  return vehicles;
}
