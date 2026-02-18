const express = require('express');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.SHELL_PORT || 3000;
const TRANSIT_PORT = process.env.TRANSIT_PORT || 3001;

// Paths
const ROOT = path.join(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'packs');
const CONFIG_DIR = path.join(ROOT, 'config');
const ACTIVE_PACK_FILE = path.join(__dirname, 'activePack.json');
const ADMIN_DIR = path.join(__dirname, 'admin');

// Ensure config dir exists
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

app.use(express.json());

// ── SSE clients ──────────────────────────────────────────────
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// ── Helper: read active pack ─────────────────────────────────
function getActivePack() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_PACK_FILE, 'utf8'));
  } catch {
    return { activePackId: 'transit' };
  }
}

function setActivePack(packId) {
  const data = { activePackId: packId };
  fs.writeFileSync(ACTIVE_PACK_FILE, JSON.stringify(data, null, 2) + '\n');
  return data;
}

// ── Helper: list packs ───────────────────────────────────────
function listPacks() {
  const packs = [];
  try {
    const dirs = fs.readdirSync(PACKS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const manifestPath = path.join(PACKS_DIR, d.name, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        packs.push({ id: d.name, ...manifest });
      } catch {
        packs.push({ id: d.name, name: d.name, description: '' });
      }
    }
  } catch {}
  return packs;
}

// ── API: active pack ─────────────────────────────────────────
app.get('/api/activePack', (_req, res) => {
  res.json(getActivePack());
});

app.post('/api/activePack', (req, res) => {
  const { packId } = req.body;
  if (!packId) return res.status(400).json({ error: 'packId required' });

  const packDir = path.join(PACKS_DIR, packId);
  if (!fs.existsSync(packDir)) {
    return res.status(404).json({ error: `pack "${packId}" not found` });
  }

  const data = setActivePack(packId);
  broadcast('packChanged', data);
  console.log(`  Pack switched → ${packId}`);
  res.json(data);
});

// ── API: list all packs ──────────────────────────────────────
app.get('/api/packs', (_req, res) => {
  res.json(listPacks());
});

// ── API: per-pack config ─────────────────────────────────────
app.get('/api/config/:packId', (req, res) => {
  const filePath = path.join(CONFIG_DIR, `${req.params.packId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch {
    res.json({});
  }
});

app.post('/api/config/:packId', (req, res) => {
  const filePath = path.join(CONFIG_DIR, `${req.params.packId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2) + '\n');
  res.json({ ok: true });
});

// ── Reverse proxy: /api/* → transit backend ──────────────────
// Shell's own /api/ routes (activePack, packs, config, events) are
// registered above as exact route handlers, so Express matches them
// first. Everything else falls through to this proxy.
// Mount with pathFilter so the full /api/* path is preserved when proxying.
app.use(createProxyMiddleware({
  target: `http://localhost:${TRANSIT_PORT}`,
  changeOrigin: true,
  pathFilter: (pathname) => {
    if (!pathname.startsWith('/api/')) return false;
    const shellRoutes = ['/api/activePack', '/api/packs', '/api/config', '/api/events'];
    return !shellRoutes.some(r => pathname.startsWith(r));
  },
}));

// ── Cleanup service worker ────────────────────────────────────
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// ── Admin page ───────────────────────────────────────────────
app.use('/admin', express.static(ADMIN_DIR));

// ── Serve packs as static files ──────────────────────────────
app.use('/packs', express.static(PACKS_DIR, {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ── Root: nuke service workers first, then show display ──────
app.get('/', (_req, res) => {
  const { activePackId } = getActivePack();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Display</title>
<style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:#000}
iframe{width:100%;height:100%;border:none;display:none}
.loading{color:#333;font-family:monospace;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)}</style>
</head><body>
<div class="loading" id="loader">Loading...</div>
<iframe id="pack"></iframe>
<script>
(function(){
  // Step 1: Nuke ALL service workers and caches before doing anything
  var ready = Promise.resolve();
  if(navigator.serviceWorker){
    ready = navigator.serviceWorker.getRegistrations().then(function(regs){
      return Promise.all(regs.map(function(r){ return r.unregister(); }));
    }).then(function(){
      return caches.keys();
    }).then(function(keys){
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).then(function(){
      // Register a no-op SW to replace any stale ones that might reinstall
      return navigator.serviceWorker.register('/sw.js', {scope: '/'});
    }).catch(function(){});
  }

  ready.then(function(){
    // Step 2: Show the active pack
    var iframe = document.getElementById('pack');
    var loader = document.getElementById('loader');
    iframe.src = '/packs/${activePackId}/index.html';
    iframe.style.display = 'block';
    loader.style.display = 'none';

    // Step 3: Listen for pack switches via SSE
    var es = new EventSource('/api/events');
    es.addEventListener('packChanged', function(e){
      var d = JSON.parse(e.data);
      iframe.src = '/packs/' + d.activePackId + '/index.html';
    });
    es.onerror = function(){
      es.close();
      setTimeout(function(){ location.reload(); }, 5000);
    };
  });
})();
</script>
</body></html>`);
});

// ── Catch-all for SPA packs (transit uses client-side routing) ─
app.get('/packs/:packId/*', (req, res) => {
  const { packId } = req.params;
  const filePath = path.join(PACKS_DIR, packId, req.params[0]);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  // Fall back to pack's index.html for SPA routing
  const indexPath = path.join(PACKS_DIR, packId, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send('Not found');
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  const { activePackId } = getActivePack();
  console.log('');
  console.log('  Display Shell');
  console.log('  ─────────────────────────────────');
  console.log(`  Shell     : http://localhost:${PORT}/`);
  console.log(`  Admin     : http://localhost:${PORT}/admin`);
  console.log(`  Active    : ${activePackId}`);
  console.log(`  Packs     : ${listPacks().map(p => p.id).join(', ')}`);
  console.log(`  Transit BE: http://localhost:${TRANSIT_PORT}/`);
  console.log('');
});

// ── Graceful shutdown ────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('  SIGTERM → shutting down...');
  for (const c of sseClients) { try { c.end(); } catch {} }
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('  SIGINT → shutting down...');
  for (const c of sseClients) { try { c.end(); } catch {} }
  process.exit(0);
});
