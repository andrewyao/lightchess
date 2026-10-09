#!/usr/bin/env node
// Local dev server: serves the app's static files and runs Claude analysis
// on demand. Binds to 127.0.0.1 only, since the API spends your Claude usage.
//
//   POST /api/games {game}          ->  {id}; downloads the game if needed
//   POST /api/games/<id>/analysis  ->  analysis JSON (takes a minute or two)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { GAMES_DIR, readGame } = require('./lib/store');
const { fetchGame, parseGameInput } = require('./lib/fetch');
const { analyzeGame } = require('./lib/analyze');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || require('./package.json').config.port;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// One Claude run per game at a time; a second click joins the first run.
const inFlight = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Body must be JSON')); }
    });
    req.on('error', reject);
  });
}

async function handleLoadGame(req, res) {
  let input;
  try {
    input = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  const parsed = parseGameInput(input.game);
  if (!parsed) return sendJson(res, 400, { error: 'Paste a chess.com game id or game link' });
  const { id, kind } = parsed;
  if (fs.existsSync(path.join(GAMES_DIR, `${id}.json`))) return sendJson(res, 200, { id, cached: true });

  try {
    const { record } = await fetchGame(id, kind);
    console.log(`Downloaded ${id} (${record.white} vs ${record.black})`);
    sendJson(res, 200, { id });
  } catch (err) {
    sendJson(res, 404, { error: err.message });
  }
}

async function handleAnalysis(res, id) {
  let game;
  try {
    game = readGame(id);
  } catch (err) {
    return sendJson(res, 404, { error: err.message });
  }
  if (!inFlight.has(id)) {
    console.log(`Analyzing ${id} (${game.white} vs ${game.black})...`);
    inFlight.set(id, analyzeGame(game).finally(() => inFlight.delete(id)));
  }
  try {
    const analysis = await inFlight.get(id);
    analysis.warnings.forEach((w) => console.warn(`  ${id}: ${w}`));
    console.log(`Analyzed ${id} ($${analysis.costUsd?.toFixed(2)})`);
    sendJson(res, 200, analysis);
  } catch (err) {
    console.error(`Analysis of ${id} failed: ${err.message}`);
    sendJson(res, 502, { error: err.message });
  }
}

function serveStatic(res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  } catch {
    return sendJson(res, 400, { error: 'Bad URL' });
  }
  const file = path.join(ROOT, rel);
  const inside = file.startsWith(ROOT + path.sep);
  const hidden = rel.split('/').some((part) => part.startsWith('.') || part === 'node_modules');
  if (!inside || hidden) return sendJson(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname.startsWith('/api/')) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST' });
    // Other sites open in the browser can POST to localhost too; only accept
    // calls from this app's own pages (also blocks DNS-rebinding hosts).
    const self = [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`];
    if (!self.includes(`http://${req.headers.host}`) || !self.includes(req.headers.origin)) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }
    if (pathname === '/api/games') return handleLoadGame(req, res);
    const analysis = pathname.match(/^\/api\/games\/(\d+)\/analysis$/);
    if (analysis) return handleAnalysis(res, analysis[1]);
    return sendJson(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
  serveStatic(res, pathname);
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use. Stop the other server (lsof -i :${PORT}) or run with PORT=<n>.`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`LightChess running at http://${HOST}:${PORT}/`);
});
