import { useState, useEffect } from 'react';
import { SUBWAY_LINES } from '../subwayLines';

export default function AlertsBanner({ routes, busRoutes }) {
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const fetchAlerts = () => {
      fetch('/api/alerts')
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setAlerts(data); })
        .catch(() => {});
    };
    fetchAlerts();
    const t = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(t);
  }, []);

  const allRoutes = new Set([...(routes || []), ...(busRoutes || [])]);
  const relevant = alerts.filter(
    (a) => a.routes.some((r) => allRoutes.has(r)) && !dismissed.has(a.id),
  );

  if (!relevant.length) return null;

  return (
    <div className="border-b border-yellow-900/40 bg-gradient-to-r from-yellow-950/30 to-orange-950/20 px-4 py-1.5 space-y-1 shrink-0 max-h-32 overflow-y-auto">
      {relevant.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-[11px] group">
          <div className="flex gap-0.5 shrink-0 pt-0.5">
            {a.routes.filter((r) => allRoutes.has(r)).slice(0, 4).map((r) => {
              const li = SUBWAY_LINES[r];
              return (
                <span
                  key={r}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold shadow-sm"
                  style={{ backgroundColor: li?.color || '#0039A6', color: li?.text || '#fff' }}
                >
                  {li?.name || r}
                </span>
              );
            })}
          </div>
          <button
            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            className="flex-1 text-left text-yellow-200/80 hover:text-yellow-100 transition-colors truncate"
          >
            {a.header}
          </button>
          <button
            onClick={() => setDismissed((s) => new Set([...s, a.id]))}
            className="text-gray-600 hover:text-gray-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            &times;
          </button>
        </div>
      ))}
      {expanded && (() => {
        const alert = alerts.find((a) => a.id === expanded);
        if (!alert) return null;
        return (
          <div className="bg-black/20 rounded-lg px-3 py-2 mt-1 border border-yellow-900/30">
            <p className="text-[10px] text-yellow-200/60 leading-relaxed">
              {alert.description}
            </p>
          </div>
        );
      })()}
    </div>
  );
}
