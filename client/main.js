import * as C from '../shared/constants.js';
import { Net } from './net.js';
import * as R from './render.js';

const $ = id => document.getElementById(id);
const cv = $('game');
const keys = {};
let bits = 0, charIdx = Math.floor(Math.random() * C.CHARS.length), trackIdx = 0;
let cam = -240, toastT = 0;
const parts = [], blasts = [];
const crates = new Set(), coins = new Set(), broken = new Set();
let lastResults = null;

const net = new Net({
  onOpen: () => { pill('connPill', 'connected', 'on'); log('socket open'); },
  onClose: () => { pill('connPill', 'disconnected', 'off'); log('socket closed'); },
  onWelcome: m => { buildGate(); buildPickers(m); setupGoogle(m.googleClientId);
    log(`id ${m.id} · tick ${m.tickHz}Hz · snap ${m.tickHz / m.snapEvery}Hz`); },
  onAuthed: m => {
    if (!m.ok) { $('gateErr').textContent = m.msg || 'Sign-in failed'; return; }
    $('gateErr').textContent = '';
    $('gateName').value = m.name; LS.set('tf.name', m.name);
    log(`${m.name} signed in with Google`);
    if (!entered) enterLobby();
  },
  onQueued: m => {
    pill('statePill', `queued ${m.n}/${m.max || C.MAX_PLAYERS}`);
    queueEndsAt = performance.now() + (m.inMs || 0);
    queueCount = m.n; botOffer = false; searching = true;
    $('play').textContent = 'Searching…';
    $('queueBtns').hidden = true;                          // no extra buttons while searching
  },
  onRoom: st => { pill('statePill', 'room ' + st.code); showRoom(st); },
  // A room-list broadcast is data, not navigation. It used to yank the player
  // off the results screen the instant the server tidied up the finished room.
  onRooms: m => { roomList = m.list; renderRooms(); },
  onLeftRoom: () => { roomState = null; if (curView === 'room') setView('lobby'); },
  onWho: m => { whoList = m.list; renderWho(); },
  onChat: m => chatLine(m),
  onChatLog: m => { $('chatBox').innerHTML = ''; m.list.forEach(chatLine); },
  onErr: m => { log('! ' + m.msg); if (!$('roomView').hidden) addChat(esc(m.msg), 'sys'); else $('queueInfo').textContent = m.msg; },
  onKicked: m => { roomState = null; if (curView !== 'result') setView('lobby'); log(m && m.reason === 'idle' ? 'returned to the lobby after a minute of silence' : 'session closed elsewhere'); },
  onNet: m => log(`link set rtt=${m.rtt} jitter=${m.jitter} loss=${m.loss}%`),
  onMatch: m => {
    crates.clear(); coins.clear(); broken.clear(); parts.length = 0; blasts.length = 0;
    $('queueBtns').hidden = true; queueEndsAt = 0; botOffer = false; searching = false;
    $('play').textContent = 'Find match'; $('play').disabled = false; $('queueInfo').textContent = '';
    lastResults = null;
    log(`match ${m.room}: ${m.players.map(p => p.name).join(', ')}`);
    if (m.loading) { pill('statePill', 'loading'); $('hud').hidden = true; setView('load'); beginLoading(m); }
    else { pill('statePill', 'racing'); $('hud').hidden = false; setView('race'); }
  },
  onGo: () => { pill('statePill', 'racing'); $('hud').hidden = false; setView('race'); },
  onBotOffer: m => {
    // The one button they asked for: three seconds to say no to a bot race.
    botOffer = true;
    queueEndsAt = performance.now() + (m.inMs || 3000);
    $('queueBtns').hidden = false;
  },
  onEvents: evs => { for (const e of evs) onEvent(e); },
  onEnd: m => { lastResults = m.results; pill('statePill', 'finished'); $('hud').hidden = true; showResults(m.results); }
});
R.loadSprites('/client/');
net.connect();

function pill(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'pill' + (cls ? ' ' + cls : ''); }
function log(s) { const el = $('log'); el.textContent = (`${(performance.now() / 1000).toFixed(1)}  ${s}\n` + el.textContent).slice(0, 2600); }
function toast(s) { $('toast').textContent = s; $('toast').classList.add('on'); toastT = 1.6; }
function burst(x, y, n, col) { for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 260, vy: Math.random() * 240 - 40, life: .35 + Math.random() * .35, col, s: 2 + Math.random() * 3 }); }

function onEvent(e) {
  const mine = e.to === net.id;
  switch (e.k) {
    case 'coin': if (mine) { coins.add(e.idx); parts.push({ x: e.x, y: e.y, vx: 0, vy: 140, life: .5, col: '#ffc531', s: 4 }); } break;
    case 'crate': if (mine) { crates.add(e.idx); burst(e.x, e.y, 10, '#a8702f'); toast('picked up ' + e.item); } break;
    case 'break': broken.add(e.idx); burst(e.x, e.y, 14, '#ffc531'); break;
    case 'blast': blasts.push({ x: e.x, y: e.y, r: e.r, t: 0, life: .44 }); burst(e.x, e.y, 26, '#ffc531'); break;
    case 'melee': burst(e.x, e.y, e.landed ? 16 : 6, '#ffffff');
      if (e.by === net.id) toast(e.landed ? 'hit!' : 'missed'); else if (mine) toast('you got hit'); break;
    case 'hit': case 'freeze': burst(e.x, e.y + 24, 12, '#8bdcff'); if (mine) toast(e.k === 'freeze' ? 'frozen!' : 'hit!'); break;
    case 'dig': burst(e.x, e.y, 18, '#6b4420'); break;
    case 'finish': if (mine) toast(`finished #${e.place}`); break;
  }
}

// ------------------------------------------------------------------ input
const JUMPK = { Space: 1, ArrowUp: 1, KeyW: 1 }, SLIDEK = { ArrowDown: 1, KeyS: 1 }, USEK = { KeyE: 1 }, ATKK = { KeyF: 1, KeyK: 1 };
addEventListener('keydown', e => {
  if (JUMPK[e.code] || SLIDEK[e.code] || USEK[e.code] || ATKK[e.code]) e.preventDefault();
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('keydown', e => {
  if (e.code !== 'KeyT' || e.target.tagName === 'INPUT') return;
  miniOn = !miniOn; $('miniTel').hidden = !miniOn; $('escNote').hidden = miniOn;
});
function readBits() {
  let b = 0;
  for (const k in JUMPK) if (keys[k]) b |= C.IN_JUMP;
  for (const k in SLIDEK) if (keys[k]) b |= C.IN_SLIDE;
  for (const k in USEK) if (keys[k]) b |= C.IN_USE;
  for (const k in ATKK) if (keys[k]) b |= C.IN_ATK;
  return b;
}

// ------------------------------------------------------------- entry screen
// Nobody reaches the lobby without a name and a racer. Signing in with Google
// is optional: it only fixes your display name and marks you as verified, so
// the game works identically for guests.
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let entered = false, gateChars = [];

function buildGate() {
  charIdx = Math.max(0, Math.min(C.CHARS.length - 1, LS.get('tf.char', charIdx)));
  $('gateName').value = LS.get('tf.name', '') || '';
  $('gateChars').innerHTML = C.CHARS.map((c, i) =>
    `<button class="pick" type="button" data-g="${i}" aria-pressed="${i === charIdx}"><canvas width="84" height="112"></canvas><b>${c.name}</b></button>`).join('');
  gateChars = [...$('gateChars').querySelectorAll('canvas')];
  $('gateChars').onclick = e => { const b = e.target.closest('[data-g]'); if (!b) return;
    charIdx = +b.dataset.g;
    $('gateChars').querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-pressed', x === b));
  };
}
function enterLobby() {
  const nm = ($('gateName').value || '').trim();
  if (nm.length < 2) { $('gateErr').textContent = 'Pick a name with at least 2 characters.'; $('gateName').focus(); return; }
  LS.set('tf.name', nm); LS.set('tf.char', charIdx);
  entered = true;
  $('gate').hidden = true;
  $('name').value = nm;
  net.send({ t: 'hello', name: nm, charIdx });
  buildPickers();
}
$('gateEnter').onclick = enterLobby;
$('gateName').onkeydown = e => { if (e.key === 'Enter') enterLobby(); e.stopPropagation(); };
$('gateName').onkeyup = e => e.stopPropagation();

function setupGoogle(clientId) {
  if (!clientId) { $('gsiNote').textContent = 'Google sign-in is off on this server — play as a guest.'; return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
  s.onload = () => {
    try {
      google.accounts.id.initialize({ client_id: clientId, callback: r => net.send({ t: 'auth', idToken: r.credential }) });
      google.accounts.id.renderButton($('gsi'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    } catch (e) { $('gsiNote').textContent = 'Google sign-in could not start: ' + e.message; }
  };
  s.onerror = () => { $('gsiNote').textContent = 'Could not reach Google — play as a guest.'; };
  document.head.appendChild(s);
}

// ------------------------------------------------------------------ lobby
let roomState = null, whoList = [], roomList = [];
let queueEndsAt = 0, queueCount = 0, hiddenAt = 0, botOffer = false, searching = false;

let curView = 'lobby';
function setView(v) {
  curView = v;
  $('lobbyView').hidden = v !== 'lobby';
  $('roomView').hidden = v !== 'room';
  $('loadView').hidden = v !== 'load';
  $('resultView').hidden = v !== 'result';
  $('raceView').hidden = v !== 'race';
  document.body.classList.toggle('racing', v === 'race' || v === 'load' || v === 'result');
  if (v !== 'race') { $('miniTel').hidden = true; miniOn = false; }
  scrollTo(0, 0);
}
let miniOn = false;

function esc(x) { return String(x).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function buildPickers(m) {
  if (!$('name').value) $('name').value = LS.get('tf.name', '') || 'Racer ' + Math.floor(Math.random() * 900 + 100);
  $('charPick').innerHTML = C.CHARS.map((c, i) =>
    `<button class="chip" data-c="${i}" aria-pressed="${i === charIdx}"><span class="dot" style="background:${c.col}"></span>${c.name}</button>`).join('');
  renderTracks();
}
function renderTracks() {
  const host = roomState && roomState.hostId === net.id;
  const idx = roomState ? roomState.trackIdx : trackIdx;
  $('trackPick').innerHTML = C.TRACKS.map((t, i) =>
    `<button class="chip" data-t="${i}" aria-pressed="${i === idx}"${roomState && !host ? ' disabled style="opacity:.55;cursor:default"' : ''}>${t.name}</button>`).join('');
}
$('charPick').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return;
  charIdx = +b.dataset.c; LS.set('tf.char', charIdx); buildPickers(); net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx }); };
$('trackPick').onclick = e => { const b = e.target.closest('[data-t]'); if (!b || b.disabled) return;
  trackIdx = +b.dataset.t;
  if (roomState) net.send({ t: 'setTrack', trackIdx }); else renderTracks(); };
$('name').onchange = () => { LS.set('tf.name', $('name').value); net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx }); };

$('play').onclick = () => {
  if (searching) { leaveQueue(); return; }                 // tap again to back out
  net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx });
  net.send({ t: 'queue', trackIdx });
  searching = true; $('play').textContent = 'Searching…';
};
function leaveQueue() {
  net.send({ t: 'unqueue' });
  searching = false; botOffer = false; queueEndsAt = 0;
  $('play').textContent = 'Find match'; $('play').disabled = false;
  $('queueBtns').hidden = true; $('queueInfo').textContent = '';
}

$('cancelQueue').onclick = leaveQueue;
$('createRoom').onclick = () => { net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx });
  net.send({ t: 'createRoom', pass: $('roomPass').value || '', name: $('roomName').value || '' }); };
$('joinRoom').onclick = () => doJoin($('joinCode').value, $('roomPass').value);
$('joinCode').onkeydown = e => { if (e.key === 'Enter') $('joinRoom').click(); };
function doJoin(code, pass) {
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) { log('room codes are 4 characters'); return; }
  net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx });
  net.send({ t: 'joinRoom', code, pass: pass || '' });
}
$('leaveRoom').onclick = () => { net.send({ t: 'leaveRoom' }); roomState = null; setView('lobby'); };
$('readyBtn').onclick = () => { const me = roomState && roomState.players.find(p => p.id === net.id);
  net.send({ t: 'ready', v: !(me && me.ready) }); };
$('startBtn').onclick = () => net.send({ t: 'start' });
$('addBot').onclick = () => net.send({ t: 'addBot' });
$('renameRoom').onclick = () => {
  const cur = roomState ? roomState.name : '';
  const el = $('roomTitle');
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 24; input.value = cur; input.className = 'renameIn';
  el.replaceWith(input); input.focus(); input.select();
  const done = send => {
    if (send) net.send({ t: 'setRoomName', name: input.value });
    input.replaceWith(el);
  };
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  input.onkeyup = e => e.stopPropagation();
  input.onblur = () => done(true);
};
$('delBot').onclick = () => net.send({ t: 'removeBot' });

function showRoom(st) {
  roomState = st;
  if (!st) { setView('lobby'); renderTracks(); return; }
  if (net.state !== 'racing') setView('room');
  const host = st.hostId === net.id;
  const me = st.players.find(p => p.id === net.id);
  $('roomTitle').textContent = st.name || 'Room';
  $('roomCode').textContent = st.code;
  $('lockTag').hidden = !st.locked;
  $('renameRoom').hidden = !host;
  $('roomPlayers').innerHTML = st.players.map(p =>
    `<div class="item${p.id === net.id ? ' me' : ''}">
       <span class="dot" style="background:${C.CHARS[p.charIdx].col}"></span>
       <b>${esc(p.name)}</b>${p.verified ? '<span class="sp" title="signed in with Google">✓</span>' : ''}
       ${p.host ? '<span class="sp">host</span>' : `<span class="sp ${p.ready ? 'ok' : 'no'}">${p.ready ? 'ready' : 'waiting'}</span>`}
     </div>`).join('');
  $('hostTools').style.display = host ? '' : 'none';
  $('readyBtn').hidden = host;                       // the host readies by starting
  $('readyBtn').textContent = me && me.ready ? 'Not ready' : 'Ready';
  $('startBtn').hidden = !host;
  $('startBtn').disabled = !st.canStart;
  const waiting = st.players.filter(p => !p.ready && !p.host).map(p => p.name);
  $('roomHint').textContent = host
    ? (st.canStart ? 'everyone is ready — start when you like'
                   : (st.players.length < 2 ? 'add a bot or wait for someone to join'
                                            : 'waiting on ' + waiting.join(', ')))
    : (me && me.ready ? 'ready — waiting for the host to start'
                      : 'press Ready, then the host starts the race');
  renderTracks();
}

function renderRooms() {
  const el = $('roomList');
  if (!roomList.length) { el.innerHTML = '<div class="empty">No rooms open yet. Create one and share the code.</div>'; return; }
  el.innerHTML = roomList.map(r => {
    const shut = r.running || r.n >= r.max;
    return `<div class="roomcard${shut ? ' full' : ''}">
      <div class="rc-top"><b>${esc(r.name || 'Room')}</b>
        ${r.locked ? '<svg class="lockico" viewBox="0 0 24 24"><use href="#lock"></use></svg>' : ''}</div>
      <div class="rc-sub"><span class="rc-code">${r.code}</span> · ${esc(C.TRACKS[r.track].name)}</div>
      <div class="rc-n">${r.n} / ${r.max} players${r.running ? ' · racing' : ''}</div>
      <div class="rc-who">${r.players.map(esc).join(', ')}</div>
      <button class="rc-join" data-join="${r.code}"${shut ? ' disabled' : ''}>${r.running ? 'in a race' : r.n >= r.max ? 'full' : r.locked ? 'join (password)' : 'join'}</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-join]:not([disabled])').forEach(b => b.onclick = () => {
    const room = roomList.find(x => x.code === b.dataset.join);
    doJoin(b.dataset.join, room && room.locked ? ($('roomPass').value || '') : '');
  });
}
function renderWho() {
  $('onlineTag').textContent = whoList.length + ' online';
  $('whoList').innerHTML = whoList.map(p =>
    `<div class="item${p.id === net.id ? ' me' : ''}">
       <span class="dot" style="background:${C.CHARS[p.charIdx].col}"></span>
       <b>${esc(p.name)}</b>${p.verified ? '<span class="sp" title="signed in with Google">✓</span>' : ''}<span class="sp">${esc(p.where)}</span>
     </div>`).join('') || '<div class="empty">nobody else here</div>';
}

// ------------------------------------------------------------------- chat
function addChat(html, cls) {
  const box = $('chatBox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const d = document.createElement('div');
  d.className = cls || 'm'; d.innerHTML = html;
  box.appendChild(d);
  while (box.children.length > 120) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function chatLine(m) {
  if (m.sys) { addChat(esc(m.text), 'sys'); return; }
  addChat(`<b style="color:${m.from === net.id ? 'var(--sun)' : 'var(--sky)'}">${esc(m.name)}</b> ${esc(m.text)}`);
}
function sendChat() {
  const v = $('chatIn').value.trim();
  if (!v) return;
  net.send({ t: 'chat', text: v });
  $('chatIn').value = '';
}
$('chatSend').onclick = sendChat;
$('chatIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } e.stopPropagation(); };
$('chatIn').onkeyup = e => e.stopPropagation();

// --------------------------------------------------------- link conditions
function pushNet() {
  const rtt = +$('rtt').value, jit = +$('jit').value, loss = +$('loss').value;
  $('vRtt').textContent = rtt + ' ms'; $('vJit').textContent = jit + ' ms'; $('vLoss').textContent = loss + ' %';
  net.send({ t: 'net', rtt, jitter: jit, loss });
}
for (const id of ['rtt', 'jit', 'loss']) $(id).oninput = pushNet;
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
  const [r, j, l] = b.dataset.preset.split(',');
  $('rtt').value = r; $('jit').value = j; $('loss').value = l; pushNet();
});

// A hidden tab stops requestAnimationFrame, so no inputs are produced and the
// server holds the last one. Rather than replaying all of that on return, drop
// what is stale and snap to the server's truth.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = performance.now(); return; }
  const away = performance.now() - hiddenAt;
  last = 0; acc = 0;
  if (away > 400 && net.state === 'racing') { net.resync(); log(`resynced after ${(away / 1000).toFixed(1)}s in the background`); }
});

// ------------------------------------------------------- loading handshake
// Three things have to be true before the gate drops: the track is built, the
// clock has a real round-trip estimate (the input pacer steers by it), and the
// other players have said the same. Then the server starts the countdown.
let loadState = null;
function beginLoading(m) {
  loadState = { at: performance.now(), sent: false, players: m.players.length };
  renderLoad();
}
function renderLoad() {
  if (!loadState) return;
  const trackReady = !!net.track;
  const pings = net.stats.rtt > 0 || performance.now() - loadState.at > 2500;
  const steps = [
    ['track built', trackReady],
    ['clock synced' + (net.stats.rtt ? ` · ${net.stats.rtt} ms` : ''), pings],
    [`players ready`, loadState.sent]
  ];
  $('loadSteps').innerHTML = steps.map(([t, ok]) =>
    `<div class="lstep${ok ? ' on' : ''}"><i></i>${esc(t)}</div>`).join('');
  $('loadBar').style.width = (steps.filter(s => s[1]).length / steps.length * 100) + '%';
  $('loadHint').textContent = loadState.sent ? 'waiting for the other racers…' : 'syncing with the server…';
  if (trackReady && pings && !loadState.sent) { loadState.sent = true; net.send({ t: 'loaded' }); renderLoad(); }
}

// ------------------------------------------------------------------- loop
let acc = 0, last = 0;
// Frame rate is per tab: what THIS player's machine is actually drawing.
let fpsFrames = 0, fpsAcc = 0, lastClock = '';
function frame(now) {
  requestAnimationFrame(frame);
  R.resize(cv);
  if (!last) last = now;
  let dt = Math.min(0.1, (now - last) / 1000); last = now;

  acc += dt;
  let guard = 0;
  while (acc >= C.DT && guard++ < 8) { acc -= C.DT; bits = readBits(); net.tick(bits, C.DT); }

  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; p.vy -= 1200 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.life <= 0) parts.splice(i, 1); }
  for (let i = blasts.length - 1; i >= 0; i--) { blasts[i].t += dt; if (blasts[i].t >= blasts[i].life) blasts.splice(i, 1); }
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('on');

  if (net.state === 'racing' && net.track && net.me) {
    const me = Object.assign({}, net.me, { x: net.me.x + net.visualDX, y: net.me.y + net.visualDY });
    const racers = [...net.interpolated(), me];
    cam += ((me.x - R.viewWidth() * 0.34) - cam) * (1 - Math.exp(-dt * 7));
    R.render(cv, { track: net.track, racers, me, meItem: net.me.item, entities: net.entities,
      cam, now: performance.now() / 1000, parts, blasts, crates, coins, broken });
    drawHud(racers);
  } else {
    const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#120c22'; c.fillRect(0, 0, cv.width, cv.height);
  }
  fpsFrames++; fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    const fps = Math.round(fpsFrames / fpsAcc);
    $('clkFps').textContent = fps + ' fps';
    $('hudClock').classList.toggle('slow', fps < 45);
    fpsFrames = 0; fpsAcc = 0;
    const t = new Date();
    const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    if (hhmm !== lastClock) { lastClock = hhmm; $('clkTime').textContent = hhmm; }
  }

  if (queueEndsAt) {
    const left = Math.max(0, (queueEndsAt - now) / 1000);
    $('queueInfo').textContent = botOffer
      ? `No one else is waiting. Starting a race against bots in ${left.toFixed(1)}s.`
      : `Looking for players · ${queueCount} waiting · ${left.toFixed(1)}s — tap Searching to stop`;
    if (left <= 0) queueEndsAt = 0;
  }
  if (!$('loadView').hidden) renderLoad();
  for (const a of podAvatars) R.drawAvatar(a.cv, a.ch, now / 1000 + a.off, a.medal);
  telemetry();
  if (!$('gate').hidden && gateChars.length) {
    const t = now / 1000;
    for (let i = 0; i < gateChars.length; i++) R.drawAvatar(gateChars[i], i, t);
  }
}
requestAnimationFrame(frame);

function drawHud(racers) {
  const me = net.me;
  let place = 1;
  for (const p of net.players.values()) if (p !== me && (p.done ? p.x + 1e6 : p.x) > (me.done ? me.x + 1e6 : me.x)) place++;
  const t = Math.max(0, net.time);
  const s = Math.floor(t), cs = Math.floor((t - s) * 100);
  $('place').innerHTML = `${place}/${net.players.size}<small>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')} · ${me.coins}c</small>`;
  const slot = $('slot');
  if (me.item >= 0) { const it = C.ITEMS[me.item]; slot.textContent = it.name; slot.classList.add('full'); slot.style.setProperty('--it', it.col); slot.style.borderColor = it.col; }
  else { slot.textContent = 'item'; slot.classList.remove('full'); slot.style.borderColor = ''; }
  const lap = $('lap');
  if (lap.children.length !== net.players.size) {
    lap.innerHTML = ''; for (const p of net.players.values()) { const i = document.createElement('i'); i.style.background = C.CHARS[p.charIdx].col; i.dataset.id = p.id; lap.appendChild(i); }
  }
  for (const el of lap.children) { const p = net.players.get(el.dataset.id); if (p) el.style.left = Math.max(0, Math.min(1, p.x / net.track.len)) * 100 + '%'; }
  $('count').hidden = net.time >= 0;
  if (net.time < 0) $('count').textContent = Math.ceil(-net.time) || 'GO!';
}

function telemetry() {
  const s = net.stats;
  if (miniOn) {
    $('miniTel').textContent =
      `rtt ${s.rtt}ms  jit ${s.jitter}ms  snap ${s.snapHz}/s\n` +
      `drop ${s.drops}  pend ${net.pending.length}  buf ${s.buf}\n` +
      `corr ${s.corr}px  ${s.inKbps}kbps`;
  }
  $('sRtt').textContent = s.rtt + ' ms';
  $('sJit').textContent = s.jitter + ' ms';
  $('sSnap').textContent = s.snapHz + ' / s';
  $('sDrop').textContent = s.drops;
  $('sPend').textContent = net.pending.length;
  $('sBuf').textContent = s.buf;
  $('sReplay').textContent = s.replay;
  $('sCorr').textContent = s.corr + ' px';
  $('sKbps').textContent = s.inKbps + ' kbps';
}

// The results screen is the point of the race: show the podium, everyone's
// time, and the gap -- not a line in a log nobody reads.
let podAvatars = [], lastRes = null;
function charIdxOf(id) { const p = net.players.get(id); return p ? p.charIdx : 0; }
function fmtTime(s) { const w = Math.floor(s), c = Math.floor((s - w) * 100);
  return `${Math.floor(w / 60)}:${String(w % 60).padStart(2, '0')}.${String(c).padStart(2, '0')}`; }

function showResults(res) {
  lastRes = res;
  $('play').disabled = false; $('play').textContent = 'Find match'; searching = false;
  const mine = res.find(r => r.id === net.id);
  $('resTitle').textContent = !mine ? 'Race over'
    : mine.place === 1 ? 'You won' : mine.place === 2 ? 'Second place'
    : mine.place === 3 ? 'Third place' : `${mine.place}th place`;

  const slots = [{ p: 2, cls: 's' }, { p: 1, cls: 'g' }, { p: 3, cls: 'b' }];
  $('podium').innerHTML = slots.map(sl => {
    const r = res[sl.p - 1];
    if (!r) return '<div class="pod"></div>';
    return `<div class="pod${r.id === net.id ? ' me' : ''}">
      <canvas class="pav" data-ch="${charIdxOf(r.id)}" data-place="${sl.p}" width="84" height="112"></canvas>
      <div class="nm">${esc(r.name)}</div>
      <div class="tm">${r.done ? fmtTime(r.time) : 'dnf'}</div>
      <div class="block ${sl.cls}"><span>${sl.p}</span></div></div>`;
  }).join('');

  const winner = res.find(r => r.done);
  $('resTable').innerHTML = res.map(r => `<div class="r${r.id === net.id ? ' me' : ''}">
      <span class="p">${r.place}</span>
      <span class="n">${esc(r.name)}${r.bot ? ' <span class="bot">bot</span>' : ''}</span>
      <span class="t">${r.done ? fmtTime(r.time) : Math.max(0, Math.round((net.track ? net.track.len : 0) - r.x)) + 'm short'}</span>
      <span class="t">${r.done && winner && r !== winner ? '+' + (r.time - winner.time).toFixed(2) + 's' : ''}</span>
      <span class="t">${r.coins}c</span>
    </div>`).join('');

  podAvatars = [...$('podium').querySelectorAll('canvas')].map((cv, i) => ({ cv, ch: +cv.dataset.ch, medal: +cv.dataset.place, off: i * 2.1 }));
  $('againBtn').textContent = roomState ? (roomState.hostId === net.id ? 'Race again' : 'Back to room') : 'Find another match';
  setView('result');
  log('race over: ' + res.map(r => `${r.place}.${r.name}`).join(' '));
}
$('backBtn').onclick = () => { podAvatars = []; setView(roomState ? 'room' : 'lobby'); };
// nothing else dismisses the results: the player leaves it when they choose to
$('againBtn').onclick = () => {
  podAvatars = [];
  if (roomState) { setView('room'); if (roomState.hostId === net.id) net.send({ t: 'start' }); }
  else { setView('lobby'); net.send({ t: 'queue', trackIdx }); searching = true; $('play').textContent = 'Searching…'; }
};
