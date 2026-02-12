require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const config = require('./config');
const { getStations, getArrivals, getArrivalsByLocation, getVehiclePositions } = require('./feedManager');

const app = express();
app.use(cors());

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

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

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('  NYC Subway Transit Display');
  console.log(`  Port    : ${config.port}`);
  console.log(`  API key : ${config.apiKey ? 'set' : 'not set (public feeds)'}`);
  console.log(`  LocationIQ: ${config.locationIqToken ? 'set' : 'not set'}`);
  console.log('');
});
