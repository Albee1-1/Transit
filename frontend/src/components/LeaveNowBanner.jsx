import { useState, useEffect, useMemo } from 'react';
import { SUBWAY_LINES } from '../subwayLines';

function walkMinutes(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.ceil((miles / 3) * 60);
}

export default function LeaveNowBanner({ routes, busRoutes, arrivalData, busArrivalData, userLat, userLon }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const catchable = useMemo(() => {
    const results = [];
    const allRoutes = [...(routes || []), ...(busRoutes || [])];

    for (const route of allRoutes) {
      const isBus = busRoutes?.includes(route);
      const data = isBus ? busArrivalData?.[route] : arrivalData?.[route];
      if (!data) continue;

      const walk = walkMinutes(userLat, userLon, data.stationLat, data.stationLon);
      if (!walk || walk < 1) continue;

      for (const dir of ['N', 'S']) {
        const trains = data[dir]?.trains || [];
        for (const t of trains) {
          const secsUntil = t.arrivalTime - Math.floor(now / 1000);
          const minsUntil = secsUntil / 60;
          const buffer = 1; // 1 min buffer
          const timeToLeave = minsUntil - walk;

          if (timeToLeave <= buffer && timeToLeave > -2 && minsUntil > 0) {
            const key = `${route}-${dir}-${t.tripId}`;
            if (!dismissed.has(key)) {
              results.push({
                key,
                route,
                isBus,
                direction: data[dir]?.label || dir,
                destination: t.destination,
                minsUntil: Math.round(minsUntil),
                walk,
                urgent: timeToLeave <= 0,
              });
            }
          }
        }
      }
    }

    return results.sort((a, b) => a.minsUntil - b.minsUntil).slice(0, 3);
  }, [routes, busRoutes, arrivalData, busArrivalData, userLat, userLon, now, dismissed]);

  if (!catchable.length) return null;

  return (
    <div className="border-b border-blue-900/50 bg-blue-950/30 shrink-0">
      {catchable.map((c) => {
        const li = SUBWAY_LINES[c.route];
        const color = li?.color || '#0039A6';
        const text = li?.text || '#fff';
        return (
          <div
            key={c.key}
            className={`flex items-center gap-2.5 px-4 py-2 text-xs ${c.urgent ? 'bg-red-950/40 animate-pulse' : ''}`}
          >
            <span className="text-lg">{c.urgent ? '!' : '^'}</span>
            <span
              className="shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{ backgroundColor: color, color: text }}
            >
              {li?.name || c.route}
            </span>
            <span className="text-blue-200 font-medium">
              {c.urgent ? 'Leave NOW' : 'Leave soon'} for the {c.route} to {c.destination}
            </span>
            <span className="text-blue-400/70 ml-auto shrink-0">
              {c.minsUntil}m train / {c.walk}m walk
            </span>
            <button
              onClick={() => setDismissed((s) => new Set([...s, c.key]))}
              className="text-gray-600 hover:text-gray-400 shrink-0 ml-1"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
