import { useState, useEffect, useRef } from 'react';
import { SUBWAY_LINES } from '../subwayLines';

// ── Live countdown: ticks every second using arrivalTime epoch ──
function useCountdown(arrivalTime) {
  const [secs, setSecs] = useState(() => Math.max(0, arrivalTime - Math.floor(Date.now() / 1000)));
  const raf = useRef(null);

  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, arrivalTime - Math.floor(Date.now() / 1000));
      setSecs(s);
      if (s > 0) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [arrivalTime]);

  return secs;
}

function CountdownDisplay({ arrivalTime }) {
  const secs = useCountdown(arrivalTime);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;

  if (secs <= 30) {
    return <span className="text-red-400 text-lg font-black countdown-pulse">NOW</span>;
  }
  if (secs <= 90) {
    return (
      <span className="text-orange-400 text-base font-bold tabular-nums">
        {secs}s
      </span>
    );
  }
  if (mins <= 5) {
    return (
      <span className="text-white text-base font-bold tabular-nums">
        {mins}:{String(remSecs).padStart(2, '0')}
      </span>
    );
  }
  return (
    <span className="text-gray-300 text-sm font-semibold tabular-nums">
      {mins} min
    </span>
  );
}

// ── Skeleton loader ──────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-2 py-2 animate-pulse">
      <div className="h-3 w-20 bg-gray-800 rounded" />
      <div className="h-4 w-12 bg-gray-800 rounded" />
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-1 py-1">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

// ── Train/bus arrival row ────────────────────────────────────
function ArrivalRow({ train, index, isBus, walkTime }) {
  const secs = train.arrivalTime - Math.floor(Date.now() / 1000);
  const minsUntil = secs / 60;
  const isFirst = index === 0;
  const isNow = secs <= 30;
  const missed = walkTime != null && walkTime > 0 && minsUntil > 0 && walkTime > minsUntil;

  return (
    <div
      className={`arrival-row fade-in flex items-center justify-between px-2 py-1.5 rounded transition-all ${
        missed ? 'opacity-40' : isFirst ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
      } ${isNow && !missed ? 'arriving' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span className="text-gray-400 text-[11px] truncate flex-1 pr-2">
        {train.destination}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        {missed && (
          <span className="text-red-500 text-[9px] font-bold uppercase tracking-wide">MISSED</span>
        )}
        {train.arrivalTime ? (
          <CountdownDisplay arrivalTime={train.arrivalTime} />
        ) : (
          <span className="text-gray-500 text-sm">---</span>
        )}
      </div>
    </div>
  );
}

function TrainList({ trains, emptyMsg, isBus, walkTime }) {
  if (!trains || trains.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <p className="text-gray-700 text-[11px]">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {trains.map((t, i) => (
        <ArrivalRow key={`${t.tripId}-${i}`} train={t} index={i} isBus={isBus} walkTime={walkTime} />
      ))}
    </div>
  );
}

// ── Walk time calculator ─────────────────────────────────────
function walkMinutes(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((miles / 3) * 60);
}

// ── Main ArrivalColumn component ─────────────────────────────
export default function ArrivalColumn({ route, arrivalData, loading, isBus, userLat, userLon }) {
  const subwayInfo = SUBWAY_LINES[route];
  const info = subwayInfo || {
    color: isBus ? '#0039A6' : '#808183',
    text: '#FFF',
    name: route,
  };

  const northTrains = arrivalData?.N?.trains || [];
  const southTrains = arrivalData?.S?.trains || [];
  const noData = loading && !northTrains.length && !southTrains.length;
  const emptyLabel = isBus ? 'No buses' : 'No trains';
  const walk = walkMinutes(userLat, userLon, arrivalData?.stationLat, arrivalData?.stationLon);

  const northLabel = arrivalData?.N?.label || (isBus ? 'Direction 1' : 'Northbound');
  const southLabel = arrivalData?.S?.label || (isBus ? 'Direction 2' : 'Southbound');

  return (
    <div className="flex flex-col h-full border-r border-gray-800/60 last:border-r-0 overflow-hidden">
      {/* ── Route badge + station name ──────────────────── */}
      <div className="flex flex-col items-center justify-center py-3 border-b border-gray-800/60 shrink-0 relative">
        {isBus ? (
          <div
            className="h-9 px-3 rounded-lg flex items-center justify-center text-sm font-bold shadow-lg shadow-black/40"
            style={{ backgroundColor: info.color, color: info.text }}
          >
            {info.name}
          </div>
        ) : (
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-xl font-bold shadow-lg shadow-black/40 ring-1 ring-white/10"
            style={{ backgroundColor: info.color, color: info.text }}
          >
            {info.name}
          </div>
        )}
        {arrivalData?.station && (
          <div className="flex items-center gap-1.5 mt-1.5 max-w-full px-2">
            <span className="text-[10px] text-gray-500 truncate">
              {arrivalData.station}
            </span>
            {walk != null && walk > 0 && (
              <span className="text-[9px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded-full shrink-0">
                {walk}m walk
              </span>
            )}
          </div>
        )}
      </div>

      {noData ? (
        <div className="flex-1 grid grid-cols-2 min-h-0">
          <div className="border-r border-gray-800/40 px-1"><SkeletonList /></div>
          <div className="px-1"><SkeletonList /></div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 min-h-0 overflow-hidden">
          {/* North / Direction 1 */}
          <div className="flex flex-col border-r border-gray-800/40 overflow-hidden">
            <div className="px-2 py-1.5 border-b border-gray-800/40 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-green-400 text-[10px]">&#9650;</span>
                <span className="text-gray-400 text-[9px] font-semibold truncate uppercase tracking-wider">
                  {northLabel}
                </span>
              </div>
            </div>
            <div className="flex-1 px-0.5 py-0.5 overflow-hidden">
              <TrainList trains={northTrains} emptyMsg={emptyLabel} isBus={isBus} walkTime={walk} />
            </div>
          </div>

          {/* South / Direction 2 */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-2 py-1.5 border-b border-gray-800/40 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-orange-400 text-[10px]">&#9660;</span>
                <span className="text-gray-400 text-[9px] font-semibold truncate uppercase tracking-wider">
                  {southLabel}
                </span>
              </div>
            </div>
            <div className="flex-1 px-0.5 py-0.5 overflow-hidden">
              <TrainList trains={southTrains} emptyMsg={emptyLabel} isBus={isBus} walkTime={walk} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
