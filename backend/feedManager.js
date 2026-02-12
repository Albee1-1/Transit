const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ── Feed cache ───────────────────────────────────────────────
const feedCache = {};

// ── Static data ──────────────────────────────────────────────
let stationsData = [];
let stationsById = {};
let stopsLookup = null;
let stopsGeo = null;      // stop_id → { name, lat, lon }

function loadData() {
  const dir = path.join(__dirname, 'data');

  const stationsPath = path.join(dir, 'stations.json');
  if (fs.existsSync(stationsPath)) {
    stationsData = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
    stationsById = {};
    for (const s of stationsData) stationsById[s.id] = s;
    console.log(`  Loaded ${stationsData.length} station complexes`);
  } else {
    console.warn('  stations.json missing — run "npm run download-stops"');
  }

  const stopsPath = path.join(dir, 'stops.json');
  if (fs.existsSync(stopsPath)) {
    stopsLookup = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));
    console.log(`  Loaded ${Object.keys(stopsLookup).length} stop names`);
  }

  const geoPath = path.join(dir, 'stops-geo.json');
  if (fs.existsSync(geoPath)) {
    stopsGeo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    console.log(`  Loaded ${Object.keys(stopsGeo).length} stop coordinates`);
  } else {
    console.log('  stops-geo.json missing — train map will not work');
  }
}
loadData();

// ── Helpers ──────────────────────────────────────────────────

function toNum(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

function getStopName(sid) {
  if (!stopsLookup) return null;
  return stopsLookup[sid] || stopsLookup[sid.replace(/[NS]$/, '')] || null;
}

function getStopGeo(sid) {
  if (!stopsGeo) return null;
  return stopsGeo[sid] || stopsGeo[sid.replace(/[NS]$/, '')] || null;
}

async function fetchFeed(feedKey) {
  const now = Date.now();
  const cached = feedCache[feedKey];
  if (cached && now - cached.timestamp < config.cacheTTL) return cached.data;

  const url = config.feedEndpoints[feedKey];
  if (!url) throw new Error(`Unknown feed: ${feedKey}`);

  const headers = {};
  if (config.apiKey) headers['x-api-key'] = config.apiKey;

  const res = await fetch(url, { headers, timeout: 8000 });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Feed "${feedKey}" ${res.status}. ` +
      (config.apiKey ? 'API key invalid.' : 'Set MTA_API_KEY env var.'),
    );
  }
  if (!res.ok) throw new Error(`Feed "${feedKey}" HTTP ${res.status}`);

  const buffer = await res.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer),
  );
  feedCache[feedKey] = { data: feed, timestamp: now };
  return feed;
}

function feedsForRoutes(routes) {
  const s = new Set();
  for (const r of routes) {
    const fk = config.routeToFeed[r];
    if (fk !== undefined) s.add(fk);
  }
  return [...s];
}

async function fetchFeeds(feedKeys) {
  const results = await Promise.allSettled(
    feedKeys.map(async (fk) => ({ fk, feed: await fetchFeed(fk) })),
  );
  const feeds = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') feeds.push(r.value);
    else errors.push(r.reason.message);
  }
  return { feeds, errors };
}

// ── Public: station list ─────────────────────────────────────
function getStations() { return stationsData; }

// ── Public: arrivals (both directions) ───────────────────────
async function getArrivals(complexId, routes) {
  const station = stationsById[complexId];
  if (!station) throw new Error(`Unknown station: ${complexId}`);

  const routeMeta = {};
  for (const route of routes) {
    const plat = station.platforms.find((p) => p.routes.includes(route));
    if (!plat) continue;
    routeMeta[route] = {
      stopIdsN: new Set([`${plat.stopId}N`]),
      stopIdsS: new Set([`${plat.stopId}S`]),
      north: plat.north,
      south: plat.south,
    };
  }

  const { feeds, errors } = await fetchFeeds(feedsForRoutes(routes));
  const now = Math.floor(Date.now() / 1000);
  const routeSet = new Set(routes);
  const arrivals = {};

  for (const r of routes) {
    const m = routeMeta[r];
    arrivals[r] = {
      N: { label: m?.north || 'Northbound', trains: [] },
      S: { label: m?.south || 'Southbound', trains: [] },
    };
  }

  for (const { feed } of feeds) {
    for (const entity of feed.entity) {
      if (!entity.tripUpdate) continue;
      const tu = entity.tripUpdate;
      const rid = tu.trip?.routeId;
      if (!rid || !routeSet.has(rid)) continue;
      const meta = routeMeta[rid];
      if (!meta) continue;

      const stus = tu.stopTimeUpdate || [];
      let destName = stus.length
        ? getStopName(stus[stus.length - 1].stopId)
        : null;

      for (const stu of stus) {
        let dir = null;
        if (meta.stopIdsN.has(stu.stopId)) dir = 'N';
        else if (meta.stopIdsS.has(stu.stopId)) dir = 'S';
        if (!dir) continue;

        const raw = stu.arrival?.time ?? stu.departure?.time;
        if (!raw) continue;
        const epoch = toNum(raw);
        if (epoch <= now) continue;

        arrivals[rid][dir].trains.push({
          minutes: Math.round((epoch - now) / 60),
          destination: destName || (dir === 'N' ? meta.north : meta.south),
          arrivalTime: epoch,
          tripId: tu.trip?.tripId || '',
        });
      }
    }
  }

  for (const r of routes) {
    for (const d of ['N', 'S']) {
      arrivals[r][d].trains = arrivals[r][d].trains
        .sort((a, b) => a.arrivalTime - b.arrivalTime)
        .slice(0, config.maxArrivalsPerRoute);
    }
  }

  return { station: { id: station.id, name: station.name }, arrivals, timestamp: now, errors };
}

// ── Haversine distance (miles) ───────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
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

// ── Find nearest station serving a route ─────────────────────
function findNearestStation(lat, lon, route) {
  let best = null;
  let bestDist = Infinity;
  for (const s of stationsData) {
    if (!s.allRoutes.includes(route)) continue;
    const d = haversine(lat, lon, s.lat, s.lon);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

// ── Public: arrivals by location (auto-finds stations) ───────
async function getArrivalsByLocation(lat, lon, routes) {
  // For each route, find the nearest station that serves it
  const routeStationMap = {};
  for (const route of routes) {
    const station = findNearestStation(lat, lon, route);
    if (station) routeStationMap[route] = station;
  }

  // Group routes by station to minimize feed fetches
  const stationGroups = {};
  for (const [route, station] of Object.entries(routeStationMap)) {
    if (!stationGroups[station.id]) stationGroups[station.id] = { station, routes: [] };
    stationGroups[station.id].routes.push(route);
  }

  // Fetch arrivals for each station group in parallel
  const allArrivals = {};
  const allErrors = [];
  const results = await Promise.allSettled(
    Object.values(stationGroups).map(async ({ station, routes: groupRoutes }) => {
      const result = await getArrivals(station.id, groupRoutes);
      return { station, arrivals: result.arrivals, errors: result.errors };
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { station, arrivals, errors } = r.value;
      for (const [route, data] of Object.entries(arrivals)) {
        allArrivals[route] = { ...data, station: station.name };
      }
      allErrors.push(...errors);
    } else {
      allErrors.push(r.reason.message);
    }
  }

  // Include routes that had no matching station
  for (const route of routes) {
    if (!allArrivals[route]) {
      allArrivals[route] = {
        N: { label: 'Northbound', trains: [] },
        S: { label: 'Southbound', trains: [] },
        station: null,
      };
    }
  }

  return { arrivals: allArrivals, timestamp: Math.floor(Date.now() / 1000), errors: allErrors };
}

// ── Public: vehicle positions (for live map) ─────────────────
async function getVehiclePositions(routes) {
  if (!stopsGeo) return { vehicles: [], timestamp: Math.floor(Date.now() / 1000), errors: ['Stop coordinates not loaded'] };

  const { feeds, errors } = await fetchFeeds(feedsForRoutes(routes));
  const now = Math.floor(Date.now() / 1000);
  const routeSet = new Set(routes);

  // Collect trip updates keyed by tripId (for interpolation)
  const tripStops = {};
  // Collect vehicle entities
  const rawVehicles = [];

  for (const { feed } of feeds) {
    for (const entity of feed.entity) {
      const rid =
        entity.tripUpdate?.trip?.routeId || entity.vehicle?.trip?.routeId;
      if (!rid || !routeSet.has(rid)) continue;

      if (entity.tripUpdate) {
        const tid = entity.tripUpdate.trip?.tripId;
        if (tid) tripStops[tid] = entity.tripUpdate.stopTimeUpdate || [];
      }
      if (entity.vehicle) {
        rawVehicles.push(entity.vehicle);
      }
    }
  }

  const vehicles = [];

  for (const veh of rawVehicles) {
    const rid = veh.trip?.routeId;
    const tid = veh.trip?.tripId;
    const sid = veh.stopId;
    if (!rid || !sid) continue;

    const status = veh.currentStatus; // 0=INCOMING_AT 1=STOPPED_AT 2=IN_TRANSIT_TO
    const direction = sid.endsWith('N') ? 'N' : sid.endsWith('S') ? 'S' : null;
    let lat, lon;

    if (status === 1) {
      // STOPPED_AT — use the stop's exact coordinates
      const g = getStopGeo(sid);
      if (g) { lat = g.lat; lon = g.lon; }
    } else {
      // IN_TRANSIT_TO or INCOMING_AT — interpolate between stops
      const stus = tripStops[tid];
      if (stus) {
        const pos = interpolate(stus, sid, status, now);
        if (pos) { lat = pos.lat; lon = pos.lon; }
      }
      // Fallback: place at target stop
      if (lat === undefined) {
        const g = getStopGeo(sid);
        if (g) { lat = g.lat; lon = g.lon; }
      }
    }

    if (lat !== undefined && lon !== undefined) {
      vehicles.push({
        vehicleId: veh.vehicle?.id || tid || `${rid}-${sid}`,
        tripId: tid || '',
        routeId: rid,
        lat,
        lon,
        direction,
        nextStop: getStopName(sid) || sid,
        status: ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'][status] || 'UNKNOWN',
      });
    }
  }

  return { vehicles, timestamp: now, errors };
}

function interpolate(stus, targetSid, status, now) {
  let idx = -1;
  for (let i = 0; i < stus.length; i++) {
    if (stus[i].stopId === targetSid) { idx = i; break; }
  }
  if (idx < 0) return null;

  // Need the previous stop to interpolate between
  if (idx === 0) return getStopGeo(targetSid);

  const prev = stus[idx - 1];
  const curr = stus[idx];

  const prevGeo = getStopGeo(prev.stopId);
  const currGeo = getStopGeo(curr.stopId);
  if (!prevGeo || !currGeo) return null;

  const t0 = toNum(prev.departure?.time || prev.arrival?.time);
  const t1 = toNum(curr.arrival?.time || curr.departure?.time);
  if (!t0 || !t1 || t1 <= t0) return null;

  let p = (now - t0) / (t1 - t0);
  p = Math.max(0, Math.min(1, p));
  // INCOMING_AT means very close — push progress ≥ 85%
  if (status === 0) p = Math.max(p, 0.85);

  return {
    lat: prevGeo.lat + (currGeo.lat - prevGeo.lat) * p,
    lon: prevGeo.lon + (currGeo.lon - prevGeo.lon) * p,
  };
}

module.exports = { getStations, getArrivals, getArrivalsByLocation, getVehiclePositions };
