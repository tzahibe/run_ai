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
import { verifyGoogleToken } from './google.js';
import { Limits, clientIp } from './limits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const PORT = +arg('port', process.env.PORT || 8080);
const TRUST_PROXY = argv.includes('--trust-proxy') || process.env.TRUST_PROXY === '1';
const limits = new Limits();
const DEFAULT_NET = { rtt: +arg('rtt', 0), jitter: +arg('jitter', 0), loss: +arg('loss', 0) };
const FILL_BOTS = +arg('bots', 0);   // bots pre-added when a room is created
const LEN_OVERRIDE = +arg('len', 0);  // dev: short tracks make the end-of-race path quick to test
if (LEN_OVERRIDE) C.TRACKS.forEach(t => { t.len = LEN_OVERRIDE; });
const QUEUE_WAIT_MS = +arg('wait', 10000);
// Public by design: a client ID identifies the app, it is not a secret.
const GOOGLE_CLIENT_ID = arg('google-client-id', process.env.GOOGLE_CLIENT_ID || '');

// ---------------------------------------------------------------- static
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') {
    const body = JSON.stringify({ ok: true, uptime: Math.round(process.uptime()),
      connections: conns.size, lobbies: lobbies.size, races: rooms.size, ...limits.stats() });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(body);
  }
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
const conns = new Set();          // every live connection
const lobbies = new Map();        // code -> lobby
const rooms = new Set();          // races currently running
const queue = [];                 // quick-match waiting room
let queueTimer = null, queueOpenedAt = 0, queueStartsAt = 0;
const QUEUE_MAX_WAIT_MS = 15000, LOAD_TIMEOUT_MS = 8000, BOT_OFFER_MS = 3000;
const CHAT_KEEP = 60, CHAT_MAX = 220, IDLE_KICK_MS = 60000;
const startedAt = Date.now();
const now = () => Date.now() - startedAt;

const UNRELIABLE = new Set(['snap']);
function send(conn, obj) {
  const msg = JSON.stringify(obj);
  conn.sim.deliver(() => { if (conn.ws.readyState === 1) { conn.ws.send(msg); conn.bytesOut += msg.length; } },
    !UNRELIABLE.has(obj.t));
}

// ---------------------------------------------------------------- lobbies
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join(''); }
  while (lobbies.has(c));
  return c;
}

const cleanName = (s, fallback) => {
  const t = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return t || fallback;
};

function createLobby(host, pass, name) {
  const lobby = { code: newCode(), hostId: host.id, trackIdx: 0, members: [], bots: [], race: null,
    name: cleanName(name, host.name + "'s room"),
    pass: (pass ? String(pass).slice(0, 24) : ''), quick: false, createdAt: now() };
  lobbies.set(lobby.code, lobby);
  joinLobby(host, lobby, lobby.pass);   // the host knows their own password
  if (FILL_BOTS) { for (let i = 0; i < FILL_BOTS; i++) addBot(lobby); pushLobby(lobby); pushRoomList(); }
  return lobby;
}

function joinLobby(conn, lobby, pass) {
  if (lobby.pass && String(pass || '') !== lobby.pass) { send(conn, { t: 'err', msg: 'Wrong password', code: lobby.code, needPass: true }); return false; }
  if (conn.lobby) leaveLobby(conn);
  if (lobby.members.length + lobby.bots.length >= C.MAX_PLAYERS) { send(conn, { t: 'err', msg: 'Room is full' }); return false; }
  if (lobby.race) { send(conn, { t: 'err', msg: 'That race has already started' }); return false; }
  conn.lobby = lobby; conn.ready = false;
  lobby.members.push(conn);
  send(conn, { t: 'chatlog', list: lobby.chat || [] });
  sysChat(lobby, conn.name + ' joined');
  pushLobby(lobby); pushRoomList(); pushWho();
  return true;
}

function leaveLobby(conn) {
  const lobby = conn.lobby;
  if (!lobby) return;
  conn.lobby = null; conn.ready = false;
  const i = lobby.members.indexOf(conn);
  if (i >= 0) lobby.members.splice(i, 1);
  if (!lobby.members.length) { lobbies.delete(lobby.code); if (lobby.ownerIp) limits.closeRoom(lobby.ownerIp); }
  else {
    sysChat(lobby, conn.name + ' left');
    if (lobby.hostId === conn.id) {                                     // host passes on
      lobby.hostId = lobby.members[0].id;
      sysChat(lobby, lobby.members[0].name + ' is now the host');
    }
    pushLobby(lobby);
  }
  pushRoomList(); pushWho();
}

function addBot(lobby) {
  if (lobby.members.length + lobby.bots.length >= C.MAX_PLAYERS) return;
  const used = new Set([...lobby.members.map(m => m.charIdx), ...lobby.bots.map(b => b.charIdx)]);
  let charIdx = lobby.bots.length % C.CHARS.length;   // fall back to a repeat
  for (let i = 0; i < C.CHARS.length; i++) if (!used.has(i)) { charIdx = i; break; }
  lobby.bots.push({ charIdx, skill: 0.68 + Math.random() * 0.3 });
}

function lobbyState(lobby) {
  return {
    t: 'room', code: lobby.code, name: lobby.name || '', hostId: lobby.hostId, trackIdx: lobby.trackIdx,
    max: C.MAX_PLAYERS, locked: !!lobby.pass, quick: !!lobby.quick,
    players: [
      // The host never presses Ready -- pressing Start IS their readiness --
      // so they are shown as ready to everyone. canStart below is what decides.
      ...lobby.members.map(m => ({ id: m.id, name: m.name, charIdx: m.charIdx,
        ready: m.id === lobby.hostId ? true : !!m.ready,
        host: m.id === lobby.hostId, bot: false, verified: !!m.account })),
      ...lobby.bots.map((b, i) => ({ id: 'bot' + i, name: C.CHARS[b.charIdx].name + ' (bot)', charIdx: b.charIdx, ready: true, host: false, bot: true }))
    ],
    canStart: lobby.members.every(m => m.id === lobby.hostId || m.ready)
              && (lobby.members.length + lobby.bots.length) >= 2
  };
}
function pushLobby(lobby) { const st = lobbyState(lobby); for (const m of lobby.members) send(m, st); }

function roomListMessage() {
  return {
    t: 'rooms', online: conns.size,
    list: [...lobbies.values()].filter(l => !l.quick).map(l => ({
      code: l.code, name: l.name || '', track: l.trackIdx, running: !!l.race, locked: !!l.pass,
      n: l.members.length + l.bots.length, max: C.MAX_PLAYERS, humans: l.members.length,
      players: [...l.members.map(m => m.name), ...l.bots.map(b => C.CHARS[b.charIdx].name + ' (bot)')]
    }))
  };
}
function sendAll(obj) { for (const ws of conns) if (ws.conn) send(ws.conn, obj); }

function whereOf(c) {
  if (c.room) return 'racing';
  if (c.lobby) return 'room ' + c.lobby.code;
  if (queue.includes(c)) return 'matchmaking';
  return 'lobby';
}
function whoMessage() {
  return { t: 'who', list: [...conns].filter(ws => ws.conn).map(ws => ({
    id: ws.conn.id, name: ws.conn.name, charIdx: ws.conn.charIdx, verified: !!ws.conn.account, where: whereOf(ws.conn) })) };
}
function pushWho() { sendAll(whoMessage()); }

function pushChat(lobby, msg) {
  lobby.chat = lobby.chat || [];
  lobby.chat.push(msg);
  if (lobby.chat.length > CHAT_KEEP) lobby.chat.shift();
  for (const m of lobby.members) send(m, msg);
}
function sysChat(lobby, text) { pushChat(lobby, { t: 'chat', sys: true, text, at: now() }); }

function chat(conn, text) {
  const lobby = conn.lobby;
  if (!lobby) { send(conn, { t: 'err', msg: 'Join a room to chat' }); return; }
  const t = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX);
  if (!t) return;
  const nowMs = Date.now();
  conn.chatHits = (conn.chatHits || []).filter(x => nowMs - x < 10000);
  if (conn.chatHits.length >= 8 || (conn.lastChat && nowMs - conn.lastChat < 500)) {
    send(conn, { t: 'err', msg: 'Slow down a moment' });
    return;
  }
  conn.chatHits.push(nowMs); conn.lastChat = nowMs;
  pushChat(lobby, { t: 'chat', from: conn.id, name: conn.name, text: t, at: now() });
}

function pushRoomList() {
  const msg = roomListMessage();
  for (const ws of conns) { const c = ws.conn; if (c && !c.lobby) send(c, msg); }
}

function startRace(lobby) {
  const st = lobbyState(lobby);
  if (!st.canStart || lobby.race) return;
  const room = new Room('r' + lobby.code + '_' + (now() % 100000), lobby.trackIdx, (Math.random() * 1e9) | 0, finishRace);
  for (const m of lobby.members) room.addHuman(m, m.name, m.charIdx);
  for (const b of lobby.bots) room.addBot(b.charIdx, b.skill);
  lobby.race = room; room.lobby = lobby;
  rooms.add(room);
  // Hand the match out first and let every client build the track and warm up
  // its clock. Starting the simulation before they are ready is how one player
  // ends up a second behind from the first tick.
  room.state = 'loading';
  const msg = room.matchMessage(); msg.loading = true;
  for (const e of room.players) if (e.conn) { e.loaded = false; send(e.conn, msg); }
  room.loadTimer = setTimeout(() => beginRace(room), LOAD_TIMEOUT_MS);
  sysChat(lobby, 'race started');
  log(`+ ${room.id} start: ${room.players.map(e => e.name).join(', ')} on ${C.TRACKS[lobby.trackIdx].name}`);
  for (const m of lobby.members) m.lastActive = Date.now();
  pushRoomList(); pushWho();
}

function startQuickMatch() {
  clearTimeout(queueTimer); queueTimer = null;
  if (!queue.length) return;
  // Nobody else turned up. Say so, and give them three seconds to back out
  // rather than dropping them into a race against bots unannounced.
  if (queue.length === 1 && !queue[0].botOffer) {
    const c = queue[0];
    c.botOffer = true;
    send(c, { t: 'botoffer', inMs: BOT_OFFER_MS });
    // Leave botOffer set: it means "already asked". Clearing it here made the
    // next call offer again instead of starting, forever.
    queueTimer = setTimeout(() => { if (queue.includes(c)) startQuickMatch(); }, BOT_OFFER_MS);
    return;
  }
  for (const c of queue) c.botOffer = false;
  const group = queue.splice(0, C.MAX_PLAYERS);
  const lobby = { code: newCode(), hostId: group[0].id, trackIdx: group[0].trackIdx || 0,
    members: [], bots: [], race: null, pass: '', quick: true, name: 'Quick match', createdAt: now() };
  lobbies.set(lobby.code, lobby);
  for (const c of group) { if (c.lobby) leaveLobby(c); c.lobby = lobby; c.ready = true; lobby.members.push(c); }
  while (lobby.members.length + lobby.bots.length < C.MAX_PLAYERS) addBot(lobby);
  startRace(lobby);
  if (queue.length) { queueOpenedAt = Date.now(); for (const c of queue) c.botOffer = false;
    queueTimer = setTimeout(startQuickMatch, QUEUE_WAIT_MS); }
}

function beginRace(room) {
  if (room.state !== 'loading') return;
  clearTimeout(room.loadTimer); room.loadTimer = null;
  room.start();
  for (const e of room.players) if (e.conn) send(e.conn, { t: 'go' });
  log(`  ${room.id} everyone loaded — countdown`);
}

function finishRace(room) {
  const res = room.results();
  for (const e of room.players) if (e.conn) { send(e.conn, { t: 'end', results: res }); e.conn.room = null; e.conn.entry = null; }
  rooms.delete(room);
  const lobby = room.lobby;
  if (lobby) {
    lobby.race = null;
    lobby.racedOnce = true;
    for (const m of lobby.members) m.lastActive = Date.now();
    if (lobby.quick) {                                  // quick matches dissolve afterwards
      // Tell them the room is gone, but do NOT move them: they are reading the
      // results. The client decides when to leave that screen.
      for (const m of [...lobby.members]) { m.lobby = null; m.ready = false;
        send(m, { t: 'leftroom' }); send(m, roomListMessage()); }
      lobbies.delete(lobby.code);
    } else {
      for (const m of lobby.members) m.ready = false;   // everyone re-readies for the next one
      pushLobby(lobby);
    }
  }
  pushRoomList(); pushWho();
  log(`= ${room.id} done in ${room.time.toFixed(1)}s: ${res.map(r => `${r.place}.${r.name}`).join(' ')}`);
}

// ---------------------------------------------------------------- handlers
wss.on('connection', (ws, req) => {
  const ip = clientIp(req, TRUST_PROXY);
  const refusal = limits.admit(ip);
  if (refusal) {
    try { ws.send(JSON.stringify({ t: 'err', msg: refusal, fatal: true })); ws.close(1013, 'rate limited'); } catch {}
    log(`  refused ${ip}: ${refusal}`);
    return;
  }
  const conn = { id: 'p' + (nextId++), ws, ip, sim: new NetSim(DEFAULT_NET), rttMs: 0,
    name: 'Racer', charIdx: Math.floor(Math.random() * C.CHARS.length),
    lobby: null, ready: false, room: null, entry: null, account: null, bytesIn: 0, bytesOut: 0, lastActive: Date.now() };
  conns.add(ws); ws.conn = conn;
  send(conn, { t: 'welcome', id: conn.id, tickHz: C.TICK_HZ, snapEvery: C.SNAP_EVERY, net: conn.sim.summary,
    googleClientId: GOOGLE_CLIENT_ID,
    chars: C.CHARS, items: C.ITEMS, tracks: C.TRACKS.map(t => ({ id: t.id, name: t.name, len: t.len })) });
  send(conn, roomListMessage());
  pushRoomList(); pushWho();

  ws.on('message', raw => {
    conn.bytesIn += raw.length;
    if (!limits.message(conn)) return;            // flooding: drop silently
    let parsed; try { parsed = JSON.parse(raw); } catch { return; }
    conn.sim.deliver(() => handle(conn, parsed), parsed.t !== 'in');
  });
  ws.on('close', () => {
    conns.delete(ws);
    limits.release(ip);
    const qi = queue.indexOf(conn); if (qi >= 0) queue.splice(qi, 1);
    if (conn.entry) {                       // dropped mid-race: hand the racer to a bot
      conn.entry.conn = null;
      conn.entry.bot = conn.entry.bot || { skill: 0.75, blink: 0, stuckT: 0, atkWait: 2, progX: -1e9, progT: 0, useIn: 0, jumpPrev: false };
      conn.entry.name += ' (left)';
    }
    leaveLobby(conn);
    pushRoomList(); pushWho();
    log(`- ${conn.id} left`);
  });
});

function handle(conn, m) {
  if (m.t !== 'in' && m.t !== 'ping' && m.t !== 'rtt') conn.lastActive = Date.now();
  const lobby = conn.lobby;
  const isHost = lobby && lobby.hostId === conn.id;
  switch (m.t) {
    case 'hello': {
      const nm = String(m.name || 'Racer').slice(0, 16);
      const ci = Math.max(0, Math.min(C.CHARS.length - 1, m.charIdx | 0));
      if (nm === conn.name && ci === conn.charIdx) break;
      conn.name = nm; conn.charIdx = ci; conn.named = true;
      if (lobby) pushLobby(lobby); else pushRoomList();
      pushWho();
      break;
    }
    case 'createRoom': {
      if (conn.lobby) break;
      if (!limits.openRoom(conn.ip)) { send(conn, { t: 'err', msg: 'You already have the maximum number of open rooms' }); break; }
      const l = createLobby(conn, m.pass, m.name); l.ownerIp = conn.ip;
      log(`  room ${l.code} "${l.name}" opened by ${conn.name}${l.pass ? ' (locked)' : ''}`);
      break;
    }
    case 'joinRoom': {
      const l = lobbies.get(String(m.code || '').toUpperCase().trim());
      if (!l) { send(conn, { t: 'err', msg: 'No room with that code' }); break; }
      joinLobby(conn, l, m.pass);
      break;
    }
    case 'leaveRoom': leaveLobby(conn); send(conn, roomListMessage()); break;
    case 'setTrack': { if (!isHost || lobby.race) break; const ti = Math.max(0, Math.min(C.TRACKS.length - 1, m.trackIdx | 0));
      if (ti !== lobby.trackIdx) { lobby.trackIdx = ti; pushLobby(lobby); pushRoomList(); } break; }
    case 'ready': if (lobby && conn.ready !== !!m.v) { conn.ready = !!m.v; pushLobby(lobby); } break;
    case 'addBot': if (isHost && !lobby.race) { addBot(lobby); pushLobby(lobby); pushRoomList(); } break;
    case 'removeBot': if (isHost && !lobby.race) { lobby.bots.pop(); pushLobby(lobby); pushRoomList(); } break;
    case 'start': if (isHost) startRace(lobby); break;
    case 'loaded':
      if (conn.entry && conn.room && conn.room.state === 'loading') {
        conn.entry.loaded = true;
        if (conn.room.players.every(e => !e.conn || e.loaded)) beginRace(conn.room);
      }
      break;
    case 'setRoomName': {
      if (!isHost || lobby.race) break;
      const nm = cleanName(m.name, lobby.name);
      if (nm !== lobby.name) { lobby.name = nm; sysChat(lobby, 'room renamed to "' + nm + '"'); pushLobby(lobby); pushRoomList(); }
      break;
    }
    case 'queue': {
      if (conn.lobby || queue.includes(conn)) break;
      conn.trackIdx = Math.max(0, Math.min(C.TRACKS.length - 1, m.trackIdx | 0));
      queue.push(conn);
      for (const c of queue) c.botOffer = false;   // a new arrival cancels any pending bot offer
      // Someone arriving restarts the clock, up to a hard ceiling. Without this
      // two friends who press Play eight seconds apart end up in two different
      // races, each alone with bots -- which is exactly what it looks like.
      const now0 = Date.now();
      if (queue.length === 1) queueOpenedAt = now0;
      const elapsed = now0 - queueOpenedAt;
      const wait = Math.max(1200, Math.min(QUEUE_WAIT_MS, QUEUE_MAX_WAIT_MS - elapsed));
      clearTimeout(queueTimer);
      if (queue.length >= C.MAX_PLAYERS) { queueTimer = null; startQuickMatch(); }
      else {
        queueTimer = setTimeout(startQuickMatch, wait);
        queueStartsAt = now0 + wait;
        for (const c of queue) send(c, { t: 'queued', n: queue.length, inMs: wait, max: C.MAX_PLAYERS });
      }
      break;
    }
    case 'unqueue': { const i = queue.indexOf(conn); if (i >= 0) { queue.splice(i, 1); conn.botOffer = false;
      send(conn, roomListMessage());
      if (!queue.length) { clearTimeout(queueTimer); queueTimer = null; } } break; }
    // Waiting is for finding people, not for punishing the impatient.
    case 'startQueue': if (queue.includes(conn)) startQuickMatch(); break;
    case 'in': if (conn.entry && conn.room && conn.room.state === 'running') conn.room.onInput(conn.entry, m); break;
    case 'ping': send(conn, { t: 'pong', c: m.c, s: now() }); break;
    case 'rtt': conn.rttMs = Math.max(0, Math.min(1000, +m.ms || 0)); break;
    case 'net': conn.sim.set(m); send(conn, { t: 'net', ...conn.sim.summary }); break;
    case 'chat': chat(conn, m.text); break;
    case 'auth':
      if (!GOOGLE_CLIENT_ID) { send(conn, { t: 'authed', ok: false, msg: 'Google sign-in is not configured on this server' }); break; }
      verifyGoogleToken(m.idToken, GOOGLE_CLIENT_ID).then(acc => {
        // One account, one connection: drop a stale session rather than letting
        // two tabs race as the same person.
        for (const ws of conns) {
          const o = ws.conn;
          if (o && o !== conn && o.account && o.account.sub === acc.sub) { send(o, { t: 'kicked', reason: 'signed-in-elsewhere' }); try { o.ws.close(); } catch {} }
        }
        conn.account = { sub: acc.sub };
        if (!conn.named) conn.name = String(acc.name).slice(0, 16);
        send(conn, { t: 'authed', ok: true, name: conn.name });
        if (conn.lobby) pushLobby(conn.lobby); else pushRoomList();
        pushWho();
        log(`  ${conn.id} signed in as ${conn.name}`);
      }).catch(err => send(conn, { t: 'authed', ok: false, msg: String(err.message || err) }));
      break;
  }
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

// A room that has already raced should not be held hostage by someone who
// walked away: a minute of silence and they go back to the lobby browser.
setInterval(() => {
  const t = Date.now();
  for (const lobby of [...lobbies.values()]) {
    if (lobby.race || lobby.quick || !lobby.racedOnce) continue;
    for (const m of [...lobby.members]) {
      if (t - (m.lastActive || 0) < IDLE_KICK_MS) continue;
      send(m, { t: 'kicked', reason: 'idle' });
      leaveLobby(m);
      send(m, roomListMessage());
      log(`  ${m.name} returned to the lobby (idle)`);
    }
  }
  pushWho();
}, 5000);

function log(s) { console.log(`[${(now() / 1000).toFixed(1)}s] ${s}`); }

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log('\n  shutting down — telling everyone first');
  for (const ws of conns) { const c = ws.conn; if (c) send(c, { t: 'err', msg: 'Server restarting, reconnect in a moment', fatal: true }); }
  setTimeout(() => { try { wss.close(); server.close(); } catch {} process.exit(0); }, 400);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Turbo Dash — authoritative server`);
  console.log(`  http://localhost:${PORT}   (health: /healthz)`);
  console.log(`  google sign-in: ${GOOGLE_CLIENT_ID ? 'enabled' : 'off (pass --google-client-id or set GOOGLE_CLIENT_ID)'}`);
  console.log(`  tick ${C.TICK_HZ}Hz · snapshots ${C.TICK_HZ / C.SNAP_EVERY}Hz · ${FILL_BOTS} bot(s) per new room · quick-match wait ${QUEUE_WAIT_MS}ms`);
  console.log(`  default link conditions: ${JSON.stringify(DEFAULT_NET)}  (each client can override live)\n`);
});
