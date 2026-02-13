import { SUBWAY_LINES } from '../subwayLines';

function fmt(min) {
  if (min <= 0) return 'NOW';
  return `${min} min`;
}

function fmtBus(t) {
  if (t.minutes <= 0) return 'NOW';
  if (t.minutes < 99) return `${t.minutes} min`;
  return '---';
}

function TrainList({ trains, emptyMsg, isBus }) {
  if (!trains || trains.length === 0) {
    return (
      <p className="text-gray-600 text-[11px] text-center py-4">{emptyMsg}</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {trains.map((t, i) => {
        const isNow = t.minutes <= 1;
        const isSoon = t.minutes <= 5;
        return (
          <div
            key={`${t.tripId}-${i}`}
            className={`arrival-row fade-in flex items-center justify-between px-2 py-1.5 rounded ${
              i === 0 ? 'bg-white/[0.06]' : ''
            } ${isNow ? 'arriving' : ''}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className="text-gray-400 text-[11px] truncate flex-1 pr-1">
              {t.destination}
            </span>
            <span
              className={`font-bold whitespace-nowrap ${
                isNow
                  ? 'text-yellow-400 text-lg'
                  : isSoon
                    ? 'text-white text-base'
                    : 'text-gray-300 text-sm'
              }`}
            >
              {isBus ? fmtBus(t) : fmt(t.minutes)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function walkMinutes(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((miles / 3) * 60); // ~3 mph walking
}

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
      {/* ── Route badge + station/stop name ──────────────── */}
      <div className="flex flex-col items-center justify-center py-3 border-b border-gray-800/60 shrink-0">
        {isBus ? (
          <div
            className="h-10 px-3 rounded-lg flex items-center justify-center text-sm font-bold shadow-lg shadow-black/40"
            style={{ backgroundColor: info.color, color: info.text }}
          >
            {info.name}
          </div>
        ) : (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg shadow-black/40"
            style={{ backgroundColor: info.color, color: info.text }}
          >
            {info.name}
          </div>
        )}
        {arrivalData?.station && (
          <span className="text-[10px] text-gray-500 mt-1 truncate max-w-full px-2">
            {arrivalData.station}
            {walk != null && walk > 0 && (
              <span className="text-gray-600 ml-1">({walk} min walk)</span>
            )}
          </span>
        )}
      </div>

      {noData ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600 text-xs">Loading...</p>
        </div>
      ) : (
        /* ── Two direction sub-columns side by side ───────── */
        <div className="flex-1 grid grid-cols-2 min-h-0 overflow-hidden">
          <div className="flex flex-col border-r border-gray-800/40 overflow-hidden">
            <div className="px-2 py-2 border-b border-gray-800/40 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-green-400 text-xs">&#9650;</span>
                <span className="text-gray-400 text-[10px] font-semibold truncate uppercase tracking-wide">
                  {northLabel}
                </span>
              </div>
            </div>
            <div className="flex-1 px-1 py-1 overflow-hidden">
              <TrainList trains={northTrains} emptyMsg={emptyLabel} isBus={isBus} />
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="px-2 py-2 border-b border-gray-800/40 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-orange-400 text-xs">&#9660;</span>
                <span className="text-gray-400 text-[10px] font-semibold truncate uppercase tracking-wide">
                  {southLabel}
                </span>
              </div>
            </div>
            <div className="flex-1 px-1 py-1 overflow-hidden">
              <TrainList trains={southTrains} emptyMsg={emptyLabel} isBus={isBus} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
