import { useState, useEffect } from 'react';

const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌧️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

export default function WeatherStrip({ lat, lon }) {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    if (!lat || !lon) return;
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
      .then((r) => r.json())
      .then((d) => { if (d.temp != null) setWeather(d); })
      .catch(() => {});
    const t = setInterval(() => {
      fetch(`/api/weather?lat=${lat}&lon=${lon}`)
        .then((r) => r.json())
        .then((d) => { if (d.temp != null) setWeather(d); })
        .catch(() => {});
    }, 10 * 60_000);
    return () => clearInterval(t);
  }, [lat, lon]);

  if (!weather) return null;

  const icon = WMO_ICONS[weather.code] || '🌡️';

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400">
      <span>{icon}</span>
      <span className="text-white font-semibold">{weather.temp}°F</span>
      {weather.temp !== weather.feelsLike && (
        <span className="text-gray-500">feels {weather.feelsLike}°</span>
      )}
      {weather.wind > 10 && (
        <span className="text-gray-500">💨{weather.wind}mph</span>
      )}
    </div>
  );
}
