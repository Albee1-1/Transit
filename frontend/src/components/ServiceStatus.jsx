import { useState, useEffect } from 'react';
import { SUBWAY_LINES, ALL_ROUTES } from '../subwayLines';

const STATUS_COLORS = {
  good: 'ring-green-500/60',
  info: 'ring-blue-400/60',
  planned: 'ring-yellow-500/60',
  delays: 'ring-orange-500/80 animate-pulse',
  suspended: 'ring-red-600/80 animate-pulse',
};

const STATUS_LABELS = {
  good: 'Good Service',
  info: 'Service Notice',
  planned: 'Planned Work',
  delays: 'Delays',
  suspended: 'Suspended',
};

export default function ServiceStatus({ selectedRoutes }) {
  const [status, setStatus] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () => {
      fetch('/api/service-status')
        .then((r) => r.json())
        .then((d) => { if (d && typeof d === 'object') setStatus(d); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!status) return null;

  // Check if any selected routes have issues
  const issues = (selectedRoutes || []).filter((r) => status[r] && status[r] !== 'good');
  const hasIssues = issues.length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] transition-all ${
          hasIssues
            ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30'
            : 'bg-green-500/10 text-green-500 border border-green-500/20'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${hasIssues ? 'bg-orange-400 animate-pulse' : 'bg-green-500'}`} />
        {hasIssues ? `${issues.length} alert${issues.length > 1 ? 's' : ''}` : 'All clear'}
      </button>
    );
  }

  return (
    <div className="border-b border-gray-800/60 bg-black/30 px-4 py-2 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">System Status</span>
        <button onClick={() => setExpanded(false)} className="text-gray-600 hover:text-gray-400 text-xs">&times;</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_ROUTES.filter((r) => r !== 'SI').map((r) => {
          const li = SUBWAY_LINES[r];
          const s = status[r] || 'good';
          return (
            <div
              key={r}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 ${STATUS_COLORS[s]} transition-all`}
              style={{ backgroundColor: li?.color, color: li?.text }}
              title={`${r}: ${STATUS_LABELS[s]}`}
            >
              {li?.name || r}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[9px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full ring-1 ring-green-500/60" /> Good</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full ring-1 ring-yellow-500/60" /> Planned</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full ring-1 ring-orange-500/80" /> Delays</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full ring-1 ring-red-600/80" /> Suspended</span>
      </div>
    </div>
  );
}
