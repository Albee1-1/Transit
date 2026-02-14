import { useOnlineStatus } from '../hooks/useOnlineStatus';

export default function StatusBar({ lastUpdated, error, loading }) {
  const online = useOnlineStatus();

  const ts = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--:--:--';

  const stale = lastUpdated && (Date.now() - lastUpdated.getTime()) > 60_000;

  const dotColor = !online
    ? 'bg-gray-500'
    : error
      ? 'bg-red-500 animate-pulse'
      : loading
        ? 'bg-yellow-500 animate-pulse'
        : stale
          ? 'bg-yellow-600'
          : 'bg-green-500';

  const label = !online
    ? 'Offline'
    : error
      ? 'Connection issue'
      : loading
        ? 'Updating...'
        : stale
          ? 'Stale'
          : 'Live';

  return (
    <footer className="flex items-center justify-between px-4 sm:px-6 py-1.5 border-t border-gray-800/60 text-[10px] select-none shrink-0 bg-[#0a0a0a]">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className="text-gray-500">{label}</span>
      </div>

      {error && (
        <span className="text-red-400/70 truncate max-w-[200px] sm:max-w-sm px-2">{error}</span>
      )}

      <div className="flex items-center gap-3 text-gray-600">
        <span className="hidden sm:inline">Updated {ts}</span>
        <span className="sm:hidden">{ts}</span>
        <kbd className="hidden sm:inline-block text-[9px] bg-gray-800/50 px-1.5 py-0.5 rounded border border-gray-700/50 text-gray-500">
          S settings
        </kbd>
        <kbd className="hidden sm:inline-block text-[9px] bg-gray-800/50 px-1.5 py-0.5 rounded border border-gray-700/50 text-gray-500">
          F fullscreen
        </kbd>
      </div>
    </footer>
  );
}
