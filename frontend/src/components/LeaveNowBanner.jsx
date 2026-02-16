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
    const t = setInterval(() => setNow(Date.now()), 3000);
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
        // Only check the next train in each direction
        const t = trains[0];
        if (!t || !t.arrivalTime) continue;

        const secsUntil = t.arrivalTime - Math.floor(now / 1000);
        const minsUntil = secsUntil / 60;
        const timeToLeave = minsUntil - walk;

        // Skip if already missed (walk time exceeds time until arrival)
        if (walk > minsUntil) continue;

        // Show if you need to leave within 5 minutes, and train hasn't left yet
        if (timeToLeave <= 5 && minsUntil > 0) {
          const key = `${route}-${dir}-${t.tripId}`;
          if (!dismissed.has(key)) {
            let urgency = 'soon'; // 3-5 min to leave
            if (timeToLeave <= 0) urgency = 'now';      // you should already be walking
            else if (timeToLeave <= 2) urgency = 'hurry'; // 0-2 min to leave

            results.push({
              key,
              route,
              isBus,
              direction: data[dir]?.label || dir,
              destination: t.destination,
              minsUntil: Math.round(minsUntil),
              walk,
              timeToLeave: Math.round(timeToLeave),
              urgency,
            });
          }
        }
      }
    }

    return results.sort((a, b) => a.timeToLeave - b.timeToLeave).slice(0, 4);
  }, [routes, busRoutes, arrivalData, busArrivalData, userLat, userLon, now, dismissed]);

  if (!catchable.length) return null;

  return (
    <div className="border-b border-blue-900/50 shrink-0">
      {catchable.map((c) => {
        const li = SUBWAY_LINES[c.route];
        const color = li?.color || '#0039A6';
        const text = li?.text || '#fff';

        const bgClass =
          c.urgency === 'now'
            ? 'bg-red-950/50 border-l-4 border-l-red-500'
            : c.urgency === 'hurry'
              ? 'bg-orange-950/40 border-l-4 border-l-orange-500'
              : 'bg-blue-950/30 border-l-4 border-l-blue-500';

        const message =
          c.urgency === 'now'
            ? 'LEAVE NOW'
            : c.urgency === 'hurry'
              ? `Leave in ${c.timeToLeave} min`
              : `Leave in ~${c.timeToLeave} min`;

        const icon =
          c.urgency === 'now' ? '!!' : c.urgency === 'hurry' ? '!' : '^';

        return (
          <div
            key={c.key}
            className={`flex items-center gap-2.5 px-4 py-2 text-xs ${bgClass} ${c.urgency === 'now' ? 'animate-pulse' : ''}`}
          >
            <span className={`text-base font-black ${
              c.urgency === 'now' ? 'text-red-400' : c.urgency === 'hurry' ? 'text-orange-400' : 'text-blue-400'
            }`}>
              {icon}
            </span>
            <span
              className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ backgroundColor: color, color: text }}
            >
              {li?.name || c.route}
            </span>
            <div className="flex-1 min-w-0">
              <span className={`font-bold ${
                c.urgency === 'now' ? 'text-red-300' : c.urgency === 'hurry' ? 'text-orange-300' : 'text-blue-300'
              }`}>
                {message}
              </span>
              <span className="text-gray-400 ml-1.5">
                to catch the {c.isBus ? 'bus' : ''} {c.route} to {c.destination}
              </span>
            </div>
            <span className="text-gray-500 shrink-0 tabular-nums text-[10px]">
              {c.minsUntil}m train &middot; {c.walk}m walk
            </span>
            <button
              onClick={() => setDismissed((s) => new Set([...s, c.key]))}
              className="text-gray-600 hover:text-gray-400 shrink-0 ml-1 text-base"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
