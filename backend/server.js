require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const config = require('./config');
const { getStations, getArrivals, getArrivalsByLocation, getVehiclePositions } = require('./feedManager');

const app = express();
app.use(compression());
app.use(cors());

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist, {
  maxAge: '7d',
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ── Health check ──────────────────────────────────────────────
const startTime = Date.now();
app.get('/api/health', (_req, res) => {
  const uptimeMs = Date.now() - startTime;
  const stations = getStations();
  res.json({
    status: 'ok',
    uptime: `${Math.floor(uptimeMs / 60000)}m`,
    stations: stations.length,
    busKey: !!config.busApiKey,
    subwayKey: !!config.apiKey,
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  });
});

// ── Service status (all lines at a glance) ───────────────────
let serviceStatusCache = { data: null, ts: 0 };
const SERVICE_STATUS_TTL = 60_000;

app.get('/api/service-status', async (_req, res) => {
  if (serviceStatusCache.data && Date.now() - serviceStatusCache.ts < SERVICE_STATUS_TTL) {
    return res.json(serviceStatusCache.data);
  }
  try {
    const url = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json';
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    const entities = data?.entity || [];
    const now = Math.floor(Date.now() / 1000);
    const routeAlerts = {};

    for (const e of entities) {
      const alert = e.alert;
      if (!alert) continue;
      const periods = alert.active_period || [];
      const active = periods.some((p) => (!p.start || p.start <= now) && (!p.end || p.end >= now));
      if (!active) continue;

      const headerText = (alert.header_text?.translation?.[0]?.text || '').toLowerCase();
      const alertType = alert.transit_realtime?.mercury_alert?.alert_type || '';
      let severity = 'info';
      if (/suspend|no.*service/i.test(headerText)) severity = 'suspended';
      else if (/delay|slow/i.test(headerText)) severity = 'delays';
      else if (/planned|schedule|change/i.test(headerText) || alertType === 'Planned Work') severity = 'planned';

      for (const ie of (alert.informed_entity || [])) {
        const rid = ie.route_id;
        if (!rid) continue;
        if (!routeAlerts[rid] || severityRank(severity) > severityRank(routeAlerts[rid])) {
          routeAlerts[rid] = severity;
        }
      }
    }

    const allRoutes = ['1','2','3','4','5','6','7','A','C','E','B','D','F','M','G','J','Z','L','N','Q','R','W','S','SI'];
    const result = {};
    for (const r of allRoutes) {
      result[r] = routeAlerts[r] || 'good';
    }
    serviceStatusCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (e) {
    res.json({});
  }
});

function severityRank(s) {
  return { good: 0, info: 1, planned: 2, delays: 3, suspended: 4 }[s] || 0;
}

// ── Elevator / Escalator status ──────────────────────────────
let elevatorCache = { data: [], ts: 0 };
const ELEVATOR_TTL = 5 * 60_000;

app.get('/api/elevator-status', async (_req, res) => {
  if (elevatorCache.data.length && Date.now() - elevatorCache.ts < ELEVATOR_TTL) {
    return res.json(elevatorCache.data);
  }
  try {
    const url = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_equipments.json';
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    const outages = (data || [])
      .filter((e) => !e.isactive || e.isactive === 'N')
      .map((e) => ({
        station: e.station,
        borough: e.borough,
        type: e.equipmenttype === 'EL' ? 'elevator' : 'escalator',
        serving: e.serving,
        reason: e.reason || 'Out of service',
        outageDate: e.outagedate,
        estimatedReturn: e.estimatedreturntoservice,
        routes: (e.trainno || '').split('/').filter(Boolean),
      }))
      .slice(0, 50);
    elevatorCache = { data: outages, ts: Date.now() };
    res.json(outages);
  } catch (e) {
    res.json([]);
  }
});

// ── SSE: real-time event stream ──────────────────────────────
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(type, payload) {
  const msg = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// Periodically broadcast service status to SSE clients
setInterval(async () => {
  if (!sseClients.size) return;
  try {
    const status = serviceStatusCache.data;
    if (status) broadcastSSE('service-status', { status });
  } catch {}
}, 30_000);

// ── Stations list (for picker) ───────────────────────────────
app.get('/api/stations', (_req, res) => {
  const s = getStations();
  if (!s.length) return res.status(503).json({ error: 'Run: npm run download-stops' });
  res.json(s);
});

// ── Arrivals (both directions) ───────────────────────────────
app.get('/api/arrivals', async (req, res) => {
  const { complex, lat, lon, routes: rp } = req.query;
  if (!rp) return res.status(400).json({ error: 'Need ?routes=' });
  const routes = rp.split(',').filter(Boolean);
  try {
    if (lat && lon) {
      res.json(await getArrivalsByLocation(parseFloat(lat), parseFloat(lon), routes));
    } else if (complex) {
      res.json(await getArrivals(complex, routes));
    } else {
      return res.status(400).json({ error: 'Need ?lat=&lon= or ?complex=' });
    }
  } catch (e) {
    console.error('Arrivals:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Vehicle positions (for live map) ─────────────────────────
app.get('/api/vehicles', async (req, res) => {
  const rp = req.query.routes;
  if (!rp) return res.status(400).json({ error: 'Need ?routes=' });
  const routes = rp.split(',').filter(Boolean);
  try {
    res.json(await getVehiclePositions(routes));
  } catch (e) {
    console.error('Vehicles:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const NYC_BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten island'];

function nycGeocodeUrl(query, bounded = true) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'us',
    limit: '14',
    dedupe: '1',
    // NYC bounds: west,south,east,north
    viewbox: '-74.25909,40.477399,-73.700272,40.917577',
    bounded: bounded ? '1' : '0',
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

function photonGeocodeUrl(query, bounded = true) {
  const params = new URLSearchParams({
    q: query,
    limit: '14',
    lang: 'en',
  });
  if (bounded) {
    params.set('bbox', '-74.25909,40.477399,-73.700272,40.917577');
  }
  return `https://photon.komoot.io/api/?${params.toString()}`;
}

function locationIqUrl(query, bounded = true) {
  const params = new URLSearchParams({
    key: config.locationIqToken || '',
    q: query,
    format: 'json',
    addressdetails: '1',
    dedupe: '1',
    limit: '20',
    countrycodes: 'us',
    normalizecity: '1',
  });
  if (bounded) {
    params.set('viewbox', '-74.25909,40.917577,-73.700272,40.477399');
    params.set('bounded', '1');
  }
  return `https://us1.locationiq.com/v1/search?${params.toString()}`;
}

function structuredNominatimUrl({ street, city = '', state = 'New York', country = 'United States' }, bounded = true) {
  const params = new URLSearchParams({
    street,
    city,
    state,
    country,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '10',
    dedupe: '1',
    countrycodes: 'us',
    viewbox: '-74.25909,40.477399,-73.700272,40.917577',
    bounded: bounded ? '1' : '0',
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

function parseHouseStreetQuery(query) {
  const m = query.trim().match(/^(\d+[a-zA-Z\-]*)\s+(.+)$/);
  if (!m) return null;
  const house = m[1].trim();
  const street = m[2].trim();
  if (!house || street.length < 2) return null;
  return { house, street };
}

function normalizeNominatimResult(d) {
  const addr = d.address || {};
  let primary = d.name || '';
  if (!primary) {
    if (addr.house_number || addr.road) {
      primary = `${addr.house_number || ''} ${addr.road || ''}`.trim();
    } else {
      primary =
        addr.road ||
        addr.pedestrian ||
        addr.neighbourhood ||
        d.display_name?.split(',')[0] ||
        'Unknown';
    }
  }
  const secondary = [
    addr.neighbourhood || addr.suburb,
    addr.city || addr.town || addr.village || addr.borough || 'New York City',
  ]
    .filter(Boolean)
    .join(', ');

  return {
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    name: d.display_name,
    label: secondary ? `${primary} - ${secondary}` : primary,
    displayName: d.display_name || '',
    importance: Number(d.importance || 0),
    placeRank: Number(d.place_rank || 0),
    source: 'nominatim',
  };
}

function normalizePhotonResult(f) {
  const p = f.properties || {};
  const lon = Number(f.geometry?.coordinates?.[0]);
  const lat = Number(f.geometry?.coordinates?.[1]);
  const primary = [
    p.housenumber,
    p.street || p.name || p.locality || p.district,
  ]
    .filter(Boolean)
    .join(' ')
    .trim() || p.name || 'Unknown';
  const secondary = [p.district, p.city, p.state].filter(Boolean).join(', ');

  return {
    lat,
    lon,
    name: [primary, secondary].filter(Boolean).join(', '),
    label: secondary ? `${primary} - ${secondary}` : primary,
    displayName: p.name || primary,
    importance: Number(p.osm_value === 'house' ? 1 : 0.6),
    placeRank: Number(p.type === 'house' ? 18 : 24),
    source: 'photon',
  };
}

function normalizeLocationIqResult(d) {
  const addr = d.address || {};
  const lat = Number(d.lat);
  const lon = Number(d.lon);
  const primary =
    [
      addr.house_number,
      addr.road || addr.pedestrian || addr.neighbourhood || d.display_place,
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || d.display_name?.split(',')[0] || 'Unknown';
  const secondary = [
    addr.suburb || addr.neighbourhood || addr.hamlet,
    addr.city || addr.town || addr.village || addr.county,
    addr.state || 'New York',
  ]
    .filter(Boolean)
    .join(', ');

  return {
    lat,
    lon,
    name: d.display_name || primary,
    label: secondary ? `${primary} - ${secondary}` : primary,
    displayName: d.display_name || '',
    importance: Number(d.importance || 0.8),
    placeRank: Number(d.place_rank || 18),
    source: 'locationiq',
  };
}

function censusGeocodeUrl(query) {
  const params = new URLSearchParams({
    address: query,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  return `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params.toString()}`;
}

function normalizeCensusResult(m) {
  const lat = Number(m.coordinates?.y);
  const lon = Number(m.coordinates?.x);
  const name = String(m.matchedAddress || '');
  return {
    lat,
    lon,
    name,
    label: name,
    displayName: name,
    importance: 0.9,
    placeRank: 18,
    source: 'census',
  };
}

function scoreGeocodeResult(r, q) {
  const query = q.toLowerCase();
  const name = `${r.label} ${r.name}`.toLowerCase();
  const queryTokens = query.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const houseNum = (query.match(/\b\d{1,6}\b/) || [null])[0];
  const stopWords = new Set([
    'new', 'york', 'city', 'nyc', 'ny', 'st', 'street', 'ave', 'avenue',
    'blvd', 'boulevard', 'rd', 'road', 'dr', 'drive', 'ln', 'lane',
    'pl', 'place', 'ct', 'court', 'terrace', 'way',
  ]);
  const streetTokens = queryTokens.filter((t) => !stopWords.has(t) && !/^\d+$/.test(t));
  let score = 0;

  if (houseNum) {
    const exactNum = new RegExp(`\\b${houseNum}\\b`).test(name);
    if (exactNum) score += 12;
  }

  // Strong street matching: all meaningful street tokens present.
  if (streetTokens.length) {
    const matched = streetTokens.filter((t) => name.includes(t)).length;
    if (matched === streetTokens.length) score += 10;
    else score += (matched / streetTokens.length) * 4;
  }

  if (houseNum && streetTokens.length) {
    const exactNum = new RegExp(`\\b${houseNum}\\b`).test(name);
    const allStreet = streetTokens.every((t) => name.includes(t));
    if (exactNum && allStreet) score += 16;
  }

  if (name.startsWith(query)) score += 6;
  else if (name.includes(query)) score += 3;
  for (const b of NYC_BOROUGHS) {
    if (name.includes(b)) {
      score += 1.5;
      break;
    }
  }
  if (/\d/.test(query) && /\d/.test(name)) score += 1.2;
  score += r.importance * 4;
  score += Math.max(0, (30 - r.placeRank) / 30);
  if (r.source === 'nominatim') score += 0.35;
  if (r.source === 'locationiq') score += 0.6;
  if (r.source === 'census') score += 5; // Census is most accurate for exact addresses
  return score;
}

async function fetchJsonArray(url, headers) {
  const r = await fetch(url, { headers, timeout: 5000 });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function fetchPhotonFeatures(url, headers) {
  const r = await fetch(url, { headers, timeout: 5000 });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data?.features) ? data.features : [];
}

async function fetchCensusMatches(url, headers) {
  const r = await fetch(url, { headers, timeout: 5000 });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data?.result?.addressMatches) ? data.result.addressMatches : [];
}

// ── Geocode proxy (LocationIQ + Census for addresses) ────────
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json([]);
  try {
    const headers = { 'User-Agent': 'NYC-Subway-Display/1.0' };
    const hasHouseNumber = /\b\d{1,6}\b/.test(q);

    // Run providers in parallel for speed
    const promises = [];

    // LocationIQ (always)
    if (config.locationIqToken) {
      promises.push(
        fetchJsonArray(locationIqUrl(q, true), headers)
          .then((r) => r.map(normalizeLocationIqResult))
          .catch(() => []),
      );
    }

    // Census geocoder (when query has a house number — best for exact US addresses)
    if (hasHouseNumber) {
      promises.push(
        fetchCensusMatches(censusGeocodeUrl(q), headers)
          .then((r) => r.map(normalizeCensusResult))
          .catch(() => []),
      );
    }

    const results = await Promise.all(promises);
    let all = results.flat();

    // If too few results, try LocationIQ unbounded + Nominatim fallback
    if (all.length < 3) {
      const fallbacks = [];
      if (config.locationIqToken) {
        fallbacks.push(
          fetchJsonArray(locationIqUrl(q, false), headers)
            .then((r) => r.map(normalizeLocationIqResult))
            .catch(() => []),
        );
      }
      fallbacks.push(
        fetchJsonArray(nycGeocodeUrl(q, true), headers)
          .then((r) => r.map(normalizeNominatimResult))
          .catch(() => []),
      );
      const extra = await Promise.all(fallbacks);
      all = all.concat(extra.flat());
    }

    const seen = new Set();
    const ranked = all
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon))
      .filter((d) => {
        const key = `${d.lat.toFixed(5)}:${d.lon.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => ({ ...d, score: scoreGeocodeResult(d, q) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ displayName, importance, placeRank, source, score, ...publicFields }) => publicFields);

    res.json(ranked);
  } catch (e) {
    console.error('Geocode:', e.message);
    res.status(500).json([]);
  }
});

// ── Bus: all routes + nearby stops ───────────────────────────
const busStopsCache = {};
const BUS_CACHE_TTL = 60_000; // 1 minute

async function fetchNearbyBusStops(lat, lon) {
  const key = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const cached = busStopsCache[key];
  if (cached && Date.now() - cached.ts < BUS_CACHE_TTL) return cached.data;

  const params = new URLSearchParams({
    key: config.busApiKey,
    lat: String(lat),
    lon: String(lon),
    latSpan: '0.02',
    lonSpan: '0.02',
  });
  const url = `https://bustime.mta.info/api/where/stops-for-location.json?${params}`;
  const r = await fetch(url, { timeout: 8000 });
  if (!r.ok) throw new Error(`Bus stops API ${r.status}`);
  const data = await r.json();
  const stops = data?.data?.stops || [];
  busStopsCache[key] = { data: stops, ts: Date.now() };
  return stops;
}

// Cache all MTA bus routes (refreshed every 24h)
let allBusRoutesCache = { data: [], ts: 0 };
const ALL_ROUTES_TTL = 24 * 60 * 60_000;

async function fetchAllBusRoutes() {
  if (allBusRoutesCache.data.length && Date.now() - allBusRoutesCache.ts < ALL_ROUTES_TTL) {
    return allBusRoutesCache.data;
  }
  const agencies = ['MTA%20NYCT', 'MTABC'];
  const all = [];
  const seen = new Set();
  await Promise.all(
    agencies.map(async (agency) => {
      try {
        const url = `https://bustime.mta.info/api/where/routes-for-agency/${agency}.json?key=${config.busApiKey}`;
        const r = await fetch(url, { timeout: 10000 });
        if (!r.ok) return;
        const data = await r.json();
        for (const route of (data?.data?.list || [])) {
          const id = route.shortName || route.id;
          if (seen.has(id)) continue;
          seen.add(id);
          all.push({
            id,
            fullId: route.id, // e.g. "MTA NYCT_Q18"
            name: route.longName || id,
            color: route.color ? `#${route.color}` : '#0039A6',
            textColor: route.textColor ? `#${route.textColor}` : '#FFF',
          });
        }
      } catch { /* skip agency on error */ }
    }),
  );
  all.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  allBusRoutesCache = { data: all, ts: Date.now() };
  return all;
}

app.get('/api/bus-routes', async (req, res) => {
  if (!config.busApiKey) return res.json([]);
  try {
    const routes = await fetchAllBusRoutes();
    res.json(routes);
  } catch (e) {
    console.error('Bus routes:', e.message);
    res.json([]);
  }
});

// ── Bus: stops-for-route fallback ────────────────────────────
const routeStopsCache = {};

async function fetchStopsForRoute(fullRouteId) {
  if (!fullRouteId) return [];
  const cached = routeStopsCache[fullRouteId];
  if (cached && Date.now() - cached.ts < BUS_CACHE_TTL * 5) return cached.data;

  const url = `https://bustime.mta.info/api/where/stops-for-route/${encodeURIComponent(fullRouteId)}.json?key=${config.busApiKey}&includePolylines=false&version=2`;
  const r = await fetch(url, { timeout: 10000 });
  if (!r.ok) return [];
  const data = await r.json();
  const stops = data?.data?.references?.stops || [];
  routeStopsCache[fullRouteId] = { data: stops, ts: Date.now() };
  return stops;
}

// ── Bus: arrivals ────────────────────────────────────────────
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/api/bus-arrivals', async (req, res) => {
  const { lat, lon, routes: rp } = req.query;
  if (!lat || !lon || !rp || !config.busApiKey) {
    return res.status(400).json({ arrivals: {}, timestamp: Math.floor(Date.now() / 1000), errors: ['Missing params or bus API key'] });
  }
  const requestedRoutes = rp.split(',').filter(Boolean);
  const userLat = parseFloat(lat);
  const userLon = parseFloat(lon);

  try {
    const allRoutes = await fetchAllBusRoutes();
    const routeInfoMap = {};
    for (const r of allRoutes) routeInfoMap[r.id] = r;

    const now = Date.now();
    const allArrivals = {};
    const allVehicles = [];
    const errors = [];

    // Step 1: Find nearest stop to user for each route
    // First try nearby stops (most reliable IDs), then fall back to stops-for-route
    const nearbyStops = await fetchNearbyBusStops(userLat, userLon);
    const routeNearestStop = {};

    // Check nearby stops first
    for (const route of requestedRoutes) {
      let best = null, bestDist = Infinity;
      for (const stop of nearbyStops) {
        const serves = (stop.routes || []).some((r) => (r.shortName || r.id) === route);
        if (!serves) continue;
        const d = haversineMiles(userLat, userLon, stop.lat, stop.lon);
        if (d < bestDist) { bestDist = d; best = stop; }
      }
      if (best) routeNearestStop[route] = best;
    }

    // Fallback for routes not found nearby: use stops-for-route
    const missingRoutes = requestedRoutes.filter((r) => !routeNearestStop[r]);
    if (missingRoutes.length) {
      await Promise.allSettled(
        missingRoutes.map(async (route) => {
          const info = routeInfoMap[route];
          if (!info?.fullId) return;
          const stops = await fetchStopsForRoute(info.fullId);
          if (!stops.length) return;
          let best = null, bestDist = Infinity;
          for (const s of stops) {
            const d = haversineMiles(userLat, userLon, s.lat, s.lon);
            if (d < bestDist) { bestDist = d; best = s; }
          }
          if (best) routeNearestStop[route] = best;
        }),
      );
    }

    // Step 2: Fetch stop-monitoring (real ETAs at user's stop) + vehicle-monitoring (bus positions) in parallel
    const stopMonitorPromises = [];
    const vehicleMonitorPromises = [];

    // Dedupe stops — multiple routes may share a stop
    const uniqueMonitorStops = {};
    for (const [route, stop] of Object.entries(routeNearestStop)) {
      if (!uniqueMonitorStops[stop.id]) uniqueMonitorStops[stop.id] = { stop, routes: new Set() };
      uniqueMonitorStops[stop.id].routes.add(route);
    }

    // Stop-monitoring: ETAs at user's nearest stop
    for (const { stop, routes: stopRoutes } of Object.values(uniqueMonitorStops)) {
      stopMonitorPromises.push(
        (async () => {
          const params = new URLSearchParams({
            key: config.busApiKey,
            MonitoringRef: stop.id,
            MaximumStopVisits: '12',
          });
          const r = await fetch(`https://bustime.mta.info/api/siri/stop-monitoring.json?${params}`, { timeout: 10000 });
          if (!r.ok) throw new Error(`Stop-monitoring ${r.status}`);
          const data = await r.json();
          const deliveries = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery || [];
          const visits = deliveries.flatMap((d) => d.MonitoredStopVisit || []);

          for (const visit of visits) {
            const j = visit.MonitoredVehicleJourney || {};
            const line = j.PublishedLineName || '';
            if (!stopRoutes.has(line)) continue;

            const dest = j.DestinationName || 'Unknown';
            const dirRef = String(j.DirectionRef || '0');
            const dir = dirRef === '1' ? 'S' : 'N';
            const call = j.MonitoredCall || {};
            const eta = call.ExpectedArrivalTime;
            const ext = call.Extensions?.Distances || {};
            const stopsAway = ext.StopsFromCall ?? null;

            let minutes = null;
            if (eta) {
              minutes = Math.round((new Date(eta).getTime() - now) / 60000);
              if (minutes < 0) minutes = 0;
            }

            if (!allArrivals[line]) {
              allArrivals[line] = {
                N: { label: '', trains: [] },
                S: { label: '', trains: [] },
                stop: stop.name,
                stationLat: stop.lat,
                stationLon: stop.lon,
              };
            }
            if (!allArrivals[line][dir].label) allArrivals[line][dir].label = dest;

            // Only include arrivals with a real ETA
            if (minutes != null) {
              allArrivals[line][dir].trains.push({
                minutes,
                destination: dest,
                arrivalTime: Math.floor(new Date(eta).getTime() / 1000),
                tripId: j.VehicleRef || '',
                stopsAway,
              });
            }
          }
        })().catch((e) => errors.push(e.message)),
      );
    }

    // Vehicle-monitoring: bus positions for the map
    for (const route of requestedRoutes) {
      const info = routeInfoMap[route];
      if (!info?.fullId) continue;
      vehicleMonitorPromises.push(
        (async () => {
          const params = new URLSearchParams({
            key: config.busApiKey,
            LineRef: info.fullId,
          });
          const r = await fetch(`https://bustime.mta.info/api/siri/vehicle-monitoring.json?${params}`, { timeout: 10000 });
          if (!r.ok) return;
          const data = await r.json();
          const deliveries = data?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery || [];
          const activities = deliveries.flatMap((d) => d.VehicleActivity || []);

          for (const activity of activities) {
            const j = activity.MonitoredVehicleJourney || {};
            const loc = j.VehicleLocation || {};
            if (!loc.Latitude || !loc.Longitude) continue;
            const dest = j.DestinationName || '';
            const dirRef = String(j.DirectionRef || '0');
            const nextStop = j.MonitoredCall?.StopPointName || '';

            allVehicles.push({
              routeId: route,
              vehicleId: j.VehicleRef || '',
              lat: loc.Latitude,
              lon: loc.Longitude,
              direction: dirRef === '1' ? 'S' : 'N',
              destination: dest,
              nextStop,
              bearing: Number(loc.Bearing || 0),
              color: info.color,
              textColor: info.textColor,
            });
          }
        })().catch(() => {}),
      );
    }

    await Promise.all([...stopMonitorPromises, ...vehicleMonitorPromises]);

    // Sort, dedupe, cap at 4 per direction, fill labels
    for (const route of requestedRoutes) {
      const info = routeInfoMap[route];
      const longName = info?.name || '';
      const nameParts = longName.split(/\s*[-–—]\s*/);
      const defaultN = nameParts[0] || route;
      const defaultS = nameParts[1] || route;

      if (!allArrivals[route]) {
        allArrivals[route] = {
          N: { label: defaultN, trains: [] },
          S: { label: defaultS, trains: [] },
          stop: routeNearestStop[route]?.name || null,
          stationLat: routeNearestStop[route]?.lat || null,
          stationLon: routeNearestStop[route]?.lon || null,
        };
      }
      for (const dir of ['N', 'S']) {
        if (!allArrivals[route][dir].label) {
          allArrivals[route][dir].label = dir === 'N' ? defaultN : defaultS;
        }
        allArrivals[route][dir].trains.sort((a, b) => a.arrivalTime - b.arrivalTime);
        const seen = new Set();
        allArrivals[route][dir].trains = allArrivals[route][dir].trains.filter((t) => {
          if (!t.tripId || !seen.has(t.tripId)) { seen.add(t.tripId); return true; }
          return false;
        });
        allArrivals[route][dir].trains = allArrivals[route][dir].trains.slice(0, 4);
      }
    }

    res.json({ arrivals: allArrivals, vehicles: allVehicles, timestamp: Math.floor(now / 1000), errors });
  } catch (e) {
    console.error('Bus arrivals:', e.message);
    res.status(500).json({ arrivals: {}, timestamp: Math.floor(Date.now() / 1000), errors: [e.message] });
  }
});

// ── Weather (Open-Meteo, free, no key) ──────────────────────
let weatherCache = { data: null, ts: 0 };
const WEATHER_TTL = 10 * 60_000; // 10 min

app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.json({});
  const key = `${parseFloat(lat).toFixed(2)}:${parseFloat(lon).toFixed(2)}`;
  if (weatherCache.data && weatherCache.key === key && Date.now() - weatherCache.ts < WEATHER_TTL) {
    return res.json(weatherCache.data);
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York`;
    const r = await fetch(url, { timeout: 5000 });
    const data = await r.json();
    const c = data?.current || {};
    const result = {
      temp: Math.round(c.temperature_2m || 0),
      feelsLike: Math.round(c.apparent_temperature || 0),
      code: c.weather_code || 0,
      wind: Math.round(c.wind_speed_10m || 0),
    };
    weatherCache = { data: result, ts: Date.now(), key };
    res.json(result);
  } catch (e) {
    res.json({});
  }
});

// ── MTA Service Alerts ──────────────────────────────────────
let alertsCache = { data: [], ts: 0 };
const ALERTS_TTL = 60_000; // 1 min

app.get('/api/alerts', async (_req, res) => {
  if (alertsCache.data.length && Date.now() - alertsCache.ts < ALERTS_TTL) {
    return res.json(alertsCache.data);
  }
  try {
    const url = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json';
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    const entities = data?.entity || [];
    const now = Math.floor(Date.now() / 1000);
    const alerts = [];
    for (const e of entities) {
      const alert = e.alert;
      if (!alert) continue;
      const periods = alert.active_period || [];
      const active = periods.some((p) => (!p.start || p.start <= now) && (!p.end || p.end >= now));
      if (!active) continue;
      const routes = (alert.informed_entity || [])
        .map((ie) => ie.route_id)
        .filter(Boolean);
      const headerText = alert.header_text?.translation?.[0]?.text || '';
      const descText = alert.description_text?.translation?.[0]?.text || '';
      if (!headerText && !descText) continue;
      alerts.push({
        id: e.id,
        routes: [...new Set(routes)],
        header: headerText,
        description: descText.slice(0, 300),
        type: alert.transit_realtime?.mercury_alert?.alert_type || 'alert',
      });
    }
    alertsCache = { data: alerts, ts: Date.now() };
    res.json(alerts);
  } catch (e) {
    console.error('Alerts:', e.message);
    res.json([]);
  }
});

// ── Citibike stations ───────────────────────────────────────
let citibikeCache = { data: [], ts: 0 };
const CITIBIKE_TTL = 30_000;

app.get('/api/citibike', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.json([]);
  const userLat = parseFloat(lat);
  const userLon = parseFloat(lon);
  try {
    // Fetch station info + status in parallel
    if (!citibikeCache.data.length || Date.now() - citibikeCache.ts > CITIBIKE_TTL) {
      const [infoRes, statusRes] = await Promise.all([
        fetch('https://gbfs.citibikenyc.com/gbfs/en/station_information.json', { timeout: 5000 }),
        fetch('https://gbfs.citibikenyc.com/gbfs/en/station_status.json', { timeout: 5000 }),
      ]);
      const info = await infoRes.json();
      const status = await statusRes.json();
      const statusMap = {};
      for (const s of (status?.data?.stations || [])) statusMap[s.station_id] = s;
      const stations = (info?.data?.stations || []).map((s) => {
        const st = statusMap[s.station_id] || {};
        return {
          id: s.station_id,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          bikes: st.num_bikes_available || 0,
          ebikes: st.num_ebikes_available || 0,
          docks: st.num_docks_available || 0,
          active: st.is_renting === 1,
        };
      });
      citibikeCache = { data: stations, ts: Date.now() };
    }
    // Return nearby stations (within ~0.5 mi)
    const nearby = citibikeCache.data
      .filter((s) => Math.abs(s.lat - userLat) + Math.abs(s.lon - userLon) < 0.015)
      .sort((a, b) => {
        const da = Math.abs(a.lat - userLat) + Math.abs(a.lon - userLon);
        const db = Math.abs(b.lat - userLat) + Math.abs(b.lon - userLon);
        return da - db;
      })
      .slice(0, 10);
    res.json(nearby);
  } catch (e) {
    res.json([]);
  }
});

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('  NYC Transit Display');
  console.log(`  Port       : ${config.port}`);
  console.log(`  Subway key : ${config.apiKey ? 'set' : 'not set (public feeds)'}`);
  console.log(`  Bus key    : ${config.busApiKey ? 'set' : 'not set'}`);
  console.log(`  LocationIQ : ${config.locationIqToken ? 'set' : 'not set'}`);
  console.log(`  Compression: enabled`);
  console.log(`  SSE stream : /api/stream`);
  console.log('');
});

// ── Graceful shutdown ────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n  ${signal} received — shutting down gracefully...`);
  for (const client of sseClients) {
    try { client.end(); } catch {}
  }
  sseClients.clear();
  server.close(() => {
    console.log('  Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
