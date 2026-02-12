import { useState, useEffect } from 'react';

export default function Clock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;

  return (
    <div className="text-center select-none">
      <span className="text-4xl font-bold tracking-widest">
        {h12}
        <span className="animate-pulse">:</span>
        {m}
      </span>
      <span className="text-2xl text-gray-500 ml-0.5">{s}</span>
      <span className="text-base text-gray-600 ml-1.5">{ampm}</span>
    </div>
  );
}
