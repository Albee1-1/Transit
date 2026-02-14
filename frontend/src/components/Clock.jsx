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

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = dayNames[now.getDay()];
  const month = monthNames[now.getMonth()];
  const date = now.getDate();

  return (
    <div className="text-center select-none">
      <div className="flex items-baseline justify-center gap-0.5">
        <span className="text-3xl sm:text-4xl font-bold tracking-widest tabular-nums">
          {h12}
          <span className="clock-colon">:</span>
          {m}
        </span>
        <span className="text-xl sm:text-2xl text-gray-500 tabular-nums">{s}</span>
        <span className="text-sm sm:text-base text-gray-600 ml-1">{ampm}</span>
      </div>
      <div className="text-[10px] text-gray-600 tracking-wider mt-0.5">
        {day} {month} {date}
      </div>
    </div>
  );
}
