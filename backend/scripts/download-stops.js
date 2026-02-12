#!/usr/bin/env node
// Downloads MTA station metadata and GTFS stop names + coordinates.
// Run once after install:  cd backend && npm run download-stops
//
// Produces three files in backend/data/:
//   stations.json   — station complexes with platforms, routes, direction labels
//   stops.json      — stop_id → station name (for destination resolution)
//   stops-geo.json  — stop_id → { name, lat, lon } (for train map positions)

const fetch = require('node-fetch');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATIONS_CSV_URL =
  'http://web.mta.info/developers/data/nyct/subway/Stations.csv';
const GTFS_ZIP_URL =
  'http://web.mta.info/developers/data/nyct/subway/google_transit.zip';

const dataDir = path.join(__dirname, '..', 'data');

function csvSplit(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function csvParse(text) {
  const lines = text.trim().split('\n');
  const headers = csvSplit(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = csvSplit(lines[i]);
    const row = {};
    headers.forEach((h, idx) => (row[h] = vals[idx] || ''));
    rows.push(row);
  }
  return rows;
}

// ── 1. Build stations.json from Stations.csv ─────────────────
async function buildStations() {
  console.log('Downloading Stations.csv...');
  const res = await fetch(STATIONS_CSV_URL);
  if (!res.ok) throw new Error(`Stations.csv failed: HTTP ${res.status}`);
  const text = await res.text();
  const rows = csvParse(text);
  console.log(`  Parsed ${rows.length} platform rows`);

  const complexes = {};
  for (const r of rows) {
    const cid = r['Complex ID'];
    if (!cid) continue;
    if (!complexes[cid]) {
      complexes[cid] = {
        id: cid,
        name: r['Stop Name'],
        borough: r['Borough'] || '',
        lat: parseFloat(r['GTFS Latitude']) || 0,
        lon: parseFloat(r['GTFS Longitude']) || 0,
        platforms: [],
        allRoutes: [],
      };
    }
    const routes = (r['Daytime Routes'] || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((rt) => rt.replace(/X$/, ''));
    const uniqueRoutes = [...new Set(routes)];

    complexes[cid].platforms.push({
      stopId: r['GTFS Stop ID'],
      routes: uniqueRoutes,
      north: r['North Direction Label'] || 'Northbound',
      south: r['South Direction Label'] || 'Southbound',
    });
    for (const rt of uniqueRoutes) {
      if (!complexes[cid].allRoutes.includes(rt)) complexes[cid].allRoutes.push(rt);
    }
  }

  const routeOrder = '1234567ACEBDFMGJZLNQRWSSH'.split('');
  for (const c of Object.values(complexes)) {
    c.allRoutes.sort(
      (a, b) => (routeOrder.indexOf(a) ?? 99) - (routeOrder.indexOf(b) ?? 99),
    );
  }

  const list = Object.values(complexes).sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(dataDir, 'stations.json'), JSON.stringify(list, null, 2));
  console.log(`  Wrote ${list.length} station complexes → data/stations.json`);
}

// ── 2. Build stops.json + stops-geo.json from GTFS static ────
async function buildStops() {
  console.log('Downloading GTFS static data...');
  const res = await fetch(GTFS_ZIP_URL);
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const buf = await res.buffer();
  const zipPath = path.join(dataDir, 'google_transit.zip');
  fs.writeFileSync(zipPath, buf);
  console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  console.log('  Extracting stops.txt...');
  const raw = execSync(`unzip -p "${zipPath}" stops.txt`).toString();
  const lines = raw.trim().split('\n');
  const hdr = lines[0].split(',');
  const iId = hdr.indexOf('stop_id');
  const iName = hdr.indexOf('stop_name');
  const iLat = hdr.indexOf('stop_lat');
  const iLon = hdr.indexOf('stop_lon');

  const stops = {};
  const stopsGeo = {};

  for (let i = 1; i < lines.length; i++) {
    const row = csvSplit(lines[i]);
    const id = row[iId];
    const name = row[iName];
    const lat = parseFloat(row[iLat]);
    const lon = parseFloat(row[iLon]);
    if (!id || !name) continue;

    stops[id] = name;
    const base = id.replace(/[NS]$/, '');
    if (!stops[base]) stops[base] = name;

    if (lat && lon) {
      stopsGeo[id] = { name, lat, lon };
      if (!stopsGeo[base]) stopsGeo[base] = { name, lat, lon };
    }
  }

  fs.writeFileSync(path.join(dataDir, 'stops.json'), JSON.stringify(stops, null, 2));
  console.log(`  Wrote ${Object.keys(stops).length} entries → data/stops.json`);

  fs.writeFileSync(path.join(dataDir, 'stops-geo.json'), JSON.stringify(stopsGeo));
  console.log(`  Wrote ${Object.keys(stopsGeo).length} geo entries → data/stops-geo.json`);

  fs.unlinkSync(zipPath);
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  await buildStations();
  await buildStops();
  console.log('\nDone! Restart the server to load the new data.');
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
