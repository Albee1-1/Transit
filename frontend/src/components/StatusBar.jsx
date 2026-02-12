export default function StatusBar({ lastUpdated, error, loading }) {
  const ts = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--:--:--';

  const dotColor = error
    ? 'bg-red-500'
    : loading
      ? 'bg-yellow-500 animate-pulse'
      : 'bg-green-500';

  const label = error ? 'Connection issue' : loading ? 'Updating...' : 'Live';

  return (
    <footer className="flex items-center justify-between px-6 py-2 border-t border-gray-800/60 text-xs select-none">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-gray-500">{label}</span>
      </div>

      {error && (
        <span className="text-red-400/80 truncate max-w-sm px-4">{error}</span>
      )}

      <span className="text-gray-600">Updated {ts}</span>
    </footer>
  );
}
