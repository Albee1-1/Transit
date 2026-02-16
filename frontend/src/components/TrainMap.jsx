import { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { divIcon } from 'leaflet';
import { SUBWAY_LINES } from '../subwayLines';

// Blinking blue dot for user location
function UserLocationDot({ lat, lon }) {
  const [pulseRadius, setPulseRadius] = useState(8);
  const [pulseOpacity, setPulseOpacity] = useState(0.4);
  const raf = useRef(null);

  useEffect(() => {
    const tick = () => {
      const t = (performance.now() % 2000) / 2000;
      // ease in-out sine
      const p = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      setPulseRadius(8 + p * 14);
      setPulseOpacity(0.45 - p * 0.35);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return (
    <>
      <CircleMarker
        center={[lat, lon]}
        radius={pulseRadius}
        pathOptions={{
          color: 'transparent',
          fillColor: '#3b82f6',
          fillOpacity: pulseOpacity,
          weight: 0,
        }}
      />
      <CircleMarker
        center={[lat, lon]}
        radius={7}
        pathOptions={{
          color: '#fff',
          fillColor: '#3b82f6',
          fillOpacity: 1,
          weight: 2.5,
        }}
      >
        <Tooltip
          direction="top"
          offset={[0, -10]}
          className="!bg-gray-900 !border-gray-700 !text-blue-400 !text-[10px] !px-1.5 !py-0.5 !rounded"
        >
          Your location
        </Tooltip>
      </CircleMarker>
    </>
  );
}

// Recenter map when station changes
function Recenter({ lat, lon }) {
  const map = useMap();
  const prev = useRef('');
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (key !== prev.current) {
      map.setView([lat, lon], 14, { animate: true });
      prev.current = key;
    }
  }, [lat, lon, map]);
  return null;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lam1 = toRad(lon1);
  const lam2 = toRad(lon2);
  const y = Math.sin(lam2 - lam1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lam2 - lam1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function useAnimatedVehicles(rawVehicles, durationMs = 9000) {
  const [animated, setAnimated] = useState(rawVehicles || []);
  const rafRef = useRef(null);
  const stateRef = useRef(new Map());

  useEffect(() => {
    const now = performance.now();
    const prev = stateRef.current;
    const next = new Map();

    for (const v of rawVehicles || []) {
      const id = v.vehicleId || `${v.routeId}-${v.direction || 'X'}-${v.tripId || v.nextStop}`;
      const current = prev.get(id);
      if (!current || !Number.isFinite(current.lat) || !Number.isFinite(current.lon)) {
        next.set(id, {
          baseLat: v.lat,
          baseLon: v.lon,
          targetLat: v.lat,
          targetLon: v.lon,
          heading: 0,
          startTime: now,
          meta: v,
        });
      } else {
        const moved =
          Math.abs(current.lat - v.lat) > 0.00001 ||
          Math.abs(current.lon - v.lon) > 0.00001;
        const heading = moved
          ? bearingDeg(current.lat, current.lon, v.lat, v.lon)
          : current.heading || 0;
        next.set(id, {
          baseLat: current.lat,
          baseLon: current.lon,
          targetLat: v.lat,
          targetLon: v.lon,
          heading,
          startTime: now,
          meta: v,
        });
      }
    }

    stateRef.current = next;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const t = performance.now();
      const out = [];
      for (const [id, st] of stateRef.current.entries()) {
        const p = Math.max(0, Math.min(1, (t - st.startTime) / durationMs));
        const lat = st.baseLat + (st.targetLat - st.baseLat) * p;
        const lon = st.baseLon + (st.targetLon - st.baseLon) * p;
        out.push({ ...st.meta, vehicleId: id, lat, lon, heading: st.heading || 0 });
        st.lat = lat;
        st.lon = lon;
      }
      setAnimated(out);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [rawVehicles, durationMs]);

  return animated;
}

function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

export default function TrainMap({ stationLat, stationLon, vehicles, nearbyStations, citibikeStations }) {
  const center = [
    Number.isFinite(stationLat) ? stationLat : 40.7484,
    Number.isFinite(stationLon) ? stationLon : -73.9967,
  ];

  // Filter out vehicles with invalid coordinates before animation
  const safeVehicles = (vehicles || []).filter((v) => validCoord(v.lat, v.lon));
  const animatedVehicles = useAnimatedVehicles(safeVehicles, 9000);

  return (
    <MapContainer
      center={center}
      zoom={14}
      className="w-full h-full"
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <Recenter lat={center[0]} lon={center[1]} />

      {/* Nearby station dots (small white) */}
      {nearbyStations?.filter((s) => validCoord(s.lat, s.lon)).map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lon]}
          radius={4}
          pathOptions={{
            color: '#555',
            fillColor: '#fff',
            fillOpacity: 0.7,
            weight: 1,
          }}
        >
          <Tooltip
            direction="top"
            offset={[0, -6]}
            className="!bg-gray-900 !border-gray-700 !text-gray-300 !text-[10px] !px-1.5 !py-0.5 !rounded"
          >
            {s.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {/* User location (blinking blue dot) */}
      {validCoord(stationLat, stationLon) && (
        <UserLocationDot lat={stationLat} lon={stationLon} />
      )}

      {/* Citibike station markers */}
      {citibikeStations?.filter((s) => validCoord(s.lat, s.lon)).map((s) => {
        const bikeIcon = divIcon({
          className: 'citibike-icon-wrapper',
          html: `<div style="background:#0052FF;color:#fff;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);">${s.bikes}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        return (
          <Marker
            key={`citi-${s.id}`}
            position={[s.lat, s.lon]}
            icon={bikeIcon}
            zIndexOffset={800}
          >
            <Tooltip
              direction="top"
              offset={[0, -8]}
              className="!bg-gray-900 !border-gray-700 !text-white !text-[10px] !px-1.5 !py-0.5 !rounded"
            >
              <span className="font-bold text-blue-400">{s.name}</span>
              <br />
              {s.bikes} bikes {s.ebikes > 0 && `(${s.ebikes} e-bikes)`} · {s.docks} docks
            </Tooltip>
          </Marker>
        );
      })}

      {/* Vehicle markers (subway trains + buses) */}
      {animatedVehicles.filter((v) => validCoord(v.lat, v.lon)).map((v, i) => {
        const line = SUBWAY_LINES[v.routeId];
        const isBus = !line && v.color;
        const color = v.color || line?.color || '#808183';
        const textColor = v.textColor || line?.text || '#fff';
        const emoji = isBus ? '🚌' : '🚆';
        const vehicleIcon = divIcon({
          className: 'train-icon-wrapper',
          html: `<div class="train-icon-core" style="background:${color};color:${textColor};transform: rotate(${Math.round(v.heading || v.bearing || 0)}deg);">${emoji}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        return (
          <Marker
            key={v.vehicleId || `${v.routeId}-${v.direction}-${i}`}
            position={[v.lat, v.lon]}
            icon={vehicleIcon}
            zIndexOffset={1200}
            opacity={1}
          >
            <Tooltip
              direction="top"
              offset={[0, -8]}
              className="!bg-gray-900 !border-gray-700 !text-white !text-[10px] !px-1.5 !py-0.5 !rounded !font-bold"
            >
              <span
                className="inline-flex items-center justify-center h-4 px-1 rounded mr-1.5 text-[9px] font-bold"
                style={{ backgroundColor: color, color: textColor }}
              >
                {line?.name || v.routeId}
              </span>
              {v.routeId} → {v.destination || v.nextStop}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
