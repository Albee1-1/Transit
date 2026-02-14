import { useEffect } from 'react';

export function useKeyboard(handlers) {
  useEffect(() => {
    function onKeyDown(e) {
      // Don't intercept if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const handler = handlers[key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
