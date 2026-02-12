import { SUBWAY_LINES } from '../subwayLines';

function fmt(min) {
  if (min <= 0) return 'NOW';
  return `${min} min`;
}

function TrainList({ trains, emptyMsg }) {
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
              {fmt(t.minutes)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ArrivalColumn({ route, arrivalData, loading }) {
  const info = SUBWAY_LINES[route] || {
    color: '#808183',
    text: '#FFF',
    name: route,
  };

  const northLabel = arrivalData?.N?.label || 'Northbound';
  const southLabel = arrivalData?.S?.label || 'Southbound';
  const northTrains = arrivalData?.N?.trains || [];
  const southTrains = arrivalData?.S?.trains || [];
  const noData = loading && !northTrains.length && !southTrains.length;

  return (
    <div className="flex flex-col h-full border-r border-gray-800/60 last:border-r-0 overflow-hidden">
      {/* ── Route badge + station name ────────────────────── */}
      <div className="flex flex-col items-center justify-center py-3 border-b border-gray-800/60 shrink-0">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg shadow-black/40"
          style={{ backgroundColor: info.color, color: info.text }}
        >
          {info.name}
        </div>
        {arrivalData?.station && (
          <span className="text-[10px] text-gray-500 mt-1 truncate max-w-full px-2">
            {arrivalData.station}
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
          {/* Northbound */}
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
              <TrainList trains={northTrains} emptyMsg="No trains" />
            </div>
          </div>

          {/* Southbound */}
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
              <TrainList trains={southTrains} emptyMsg="No trains" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
