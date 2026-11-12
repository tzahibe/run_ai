// Entry point: static file host + WebSocket endpoint + matchmaking + the
// 60 Hz authoritative loop that drives every running room.
//
//   node server/index.js [--port 8080] [--rtt 80] [--jitter 25] [--loss 1.5] [--bots 3]
//
// --rtt/--jitter/--loss are DEFAULTS applied to every new connection; each
// client can override its own conditions live from the in-page Network panel.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from '../shared/constants.js';
import { Room } from './room.js';
import { NetSim } from './netsim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const PORT = +arg('port', 8080);
const DEFAULT_NET = { rtt: +arg('rtt', 0), jitter: +arg('jitter', 0), loss: +arg('loss', 0) };
const FILL_BOTS = +arg('bots', 3);
const QUEUE_WAIT_MS = +arg('wait', 5000);

// ---------------------------------------------------------------- static
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {   // redirect, not rewrite, so the
    res.writeHead(302, { location: '/client/index.html' });  // page's relative
    return res.end();                                        // imports resolve
  }
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});

// ---------------------------------------------------------------- sockets
const wss = new WebSocketServer({ server });
let nextId = 1;
const conns = new Set();
const queue = [];
const rooms = new Set();
let queueTimer = null;
let roomSeq = 1;
const startedAt = Date.now();
const now = () => Date.now() - startedAt;

// Snapshots are the only lossy traffic; everything else is control and must
// arrive. Both are still subject to the simulated latency and jitter.
const UNRELIABLE = new Set(['snap']);
function send(conn, obj) {
  const msg = JSON.stringify(obj);
  conn.sim.deliver(() => { if (conn.ws.readyState === 1) { conn.ws.send(msg); conn.bytesOut += msg.length; } },
    !UNRELIABLE.has(obj.t));
}

wss.on('connection', ws => {
  const conn = { id: 'p' + (nextId++), ws, sim: new NetSim(DEFAULT_NET), rttMs: 0,
    name: 'Racer', charIdx: Math.floor(Math.random() * C.CHARS.length), room: null, entry: null,
    bytesIn: 0, bytesOut: 0 };
  conns.add(ws); ws.conn = conn;
  send(conn, { t: 'welcome', id: conn.id, tickHz: C.TICK_HZ, snapEvery: C.SNAP_EVERY, net: conn.sim.summary,
    chars: C.CHARS, items: C.ITEMS, tracks: C.TRACKS.map(t => ({ id: t.id, name: t.name, len: t.len })) });

  ws.on('message', raw => {
    conn.bytesIn += raw.length;
    // Inbound is delayed by the same simulator, so a client's own packets
    // experience the full round trip rather than half of it.
    let parsed; try { parsed = JSON.parse(raw); } catch { return; }
    conn.sim.deliver(() => handle(conn, parsed), parsed.t !== 'in');
  });
  ws.on('close', () => {
    conns.delete(ws);
    const qi = queue.indexOf(conn); if (qi >= 0) queue.splice(qi, 1);
    if (conn.entry) {                       // dropped mid-race: hand the racer to a bot
      conn.entry.conn = null;
      conn.entry.bot = conn.entry.bot || { skill: 0.75, blink: 0, stuckT: 0, atkWait: 2, progX: -1e9, progT: 0, useIn: 0 };
      conn.entry.name += ' (dropped)';
    }
    log(`- ${conn.id} left`);
  });
});

function handle(conn, m) {
  switch (m.t) {
    case 'hello':
      conn.name = String(m.name || 'Racer').slice(0, 16);
      conn.charIdx = Math.max(0, Math.min(C.CHARS.length - 1, m.charIdx | 0));
      break;
    case 'queue':
      if (conn.room || queue.includes(conn)) break;
      conn.trackIdx = Math.max(0, Math.min(C.TRACKS.length - 1, m.trackIdx | 0));
      queue.push(conn);
      send(conn, { t: 'queued', n: queue.length, waitMs: QUEUE_WAIT_MS });
      broadcastQueue();
      if (queue.length >= C.MAX_PLAYERS) startMatch();
      else if (!queueTimer) queueTimer = setTimeout(startMatch, QUEUE_WAIT_MS);
      break;
    case 'in':
      if (conn.entry && conn.room && conn.room.state === 'running') conn.room.onInput(conn.entry, m);
      break;
    case 'ping': send(conn, { t: 'pong', c: m.c, s: now() }); break;
    case 'rtt': conn.rttMs = Math.max(0, Math.min(1000, +m.ms || 0)); break;
    case 'net': conn.sim.set(m); send(conn, { t: 'net', ...conn.sim.summary }); log(`~ ${conn.id} net ${JSON.stringify(conn.sim.summary)}`); break;
  }
}

function broadcastQueue() { for (const c of queue) send(c, { t: 'queued', n: queue.length, waitMs: QUEUE_WAIT_MS }); }

function startMatch() {
  clearTimeout(queueTimer); queueTimer = null;
  if (!queue.length) return;
  const group = queue.splice(0, C.MAX_PLAYERS);
  const trackIdx = group[0].trackIdx || 0;
  const room = new Room('r' + (roomSeq++), trackIdx, (Math.random() * 1e9) | 0, finishRoom);
  for (const c of group) room.addHuman(c, c.name, c.charIdx);
  const used = new Set(group.map(c => c.charIdx));
  let fill = Math.min(FILL_BOTS, C.MAX_PLAYERS - room.players.length);
  for (let i = 0; i < C.CHARS.length && fill > 0; i++) {
    if (used.has(i)) continue;
    used.add(i); room.addBot(i, 0.68 + Math.random() * 0.3); fill--;
  }
  rooms.add(room);
  room.start();
  const msg = room.matchMessage();
  for (const e of room.players) if (e.conn) send(e.conn, msg);
  log(`+ ${room.id} start: ${room.players.map(e => e.name).join(', ')} on ${C.TRACKS[trackIdx].name}`);
  if (queue.length) { if (queue.length >= C.MAX_PLAYERS) startMatch(); else queueTimer = setTimeout(startMatch, QUEUE_WAIT_MS); }
}

function finishRoom(room) {
  const res = room.results();
  for (const e of room.players) if (e.conn) { send(e.conn, { t: 'end', results: res }); e.conn.room = null; e.conn.entry = null; }
  rooms.delete(room);
  log(`= ${room.id} done in ${room.time.toFixed(1)}s: ${res.map(r => `${r.place}.${r.name}`).join(' ')}`);
}

// ---------------------------------------------------------------- the loop
let acc = 0, last = process.hrtime.bigint(), ticks = 0;
setInterval(() => {
  const nowHr = process.hrtime.bigint();
  let dt = Number(nowHr - last) / 1e9; last = nowHr;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let guard = 0;
  while (acc >= C.DT && guard++ < 8) {
    acc -= C.DT; ticks++;
    for (const room of [...rooms]) {
      if (room.state !== 'running') continue;
      room.step();
      if (room.state === 'running' && room.tick % C.SNAP_EVERY === 0) {
        const snap = room.snapshot();
        for (const e of room.players) {
          if (!e.conn) continue;
          snap.ack = e.nextSeq - 1;          // last input this player's racer consumed
          snap.buf = e.inputs.size;          // lets the client pace its input production
          snap.stv = e.starved || 0;         // how often we ran dry
          snap.srv = now();
          send(e.conn, snap);
        }
      }
    }
  }
}, 1000 / C.TICK_HZ);

function log(s) { console.log(`[${(now() / 1000).toFixed(1)}s] ${s}`); }

server.listen(PORT, () => {
  console.log(`\n  Turbo Dash — authoritative server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  tick ${C.TICK_HZ}Hz · snapshots ${C.TICK_HZ / C.SNAP_EVERY}Hz · fill bots ${FILL_BOTS} · queue wait ${QUEUE_WAIT_MS}ms`);
  console.log(`  default link conditions: ${JSON.stringify(DEFAULT_NET)}  (each client can override live)\n`);
});
