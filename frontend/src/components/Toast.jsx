import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="fixed bottom-16 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-xl text-xs font-medium cursor-pointer transition-all duration-300 max-w-xs ${
              t.exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
            } ${
              t.type === 'error' ? 'bg-red-900/90 text-red-200 border border-red-700/50' :
              t.type === 'success' ? 'bg-green-900/90 text-green-200 border border-green-700/50' :
              t.type === 'warning' ? 'bg-yellow-900/90 text-yellow-200 border border-yellow-700/50' :
              'bg-gray-800/95 text-gray-200 border border-gray-700/50'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
