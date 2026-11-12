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
  onWelcome: m => { buildPickers(m); log(`id ${m.id} · tick ${m.tickHz}Hz · snap ${m.tickHz / m.snapEvery}Hz`); },
  onQueued: m => { pill('statePill', `queued (${m.n}/${C.MAX_PLAYERS})`); $('queueInfo').textContent = `waiting up to ${m.waitMs / 1000}s for players, then bots fill the grid`; },
  onNet: m => log(`link set rtt=${m.rtt} jitter=${m.jitter} loss=${m.loss}%`),
  onMatch: m => {
    crates.clear(); coins.clear(); broken.clear(); parts.length = 0; blasts.length = 0;
    pill('statePill', 'racing');
    $('hud').hidden = false; $('lobby').style.display = 'none'; lastResults = null;
    log(`match ${m.room}: ${m.players.map(p => p.name).join(', ')}`);
  },
  onEvents: evs => { for (const e of evs) onEvent(e); },
  onEnd: m => { lastResults = m.results; pill('statePill', 'finished'); $('hud').hidden = true; showResults(m.results); }
});
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
function readBits() {
  let b = 0;
  for (const k in JUMPK) if (keys[k]) b |= C.IN_JUMP;
  for (const k in SLIDEK) if (keys[k]) b |= C.IN_SLIDE;
  for (const k in USEK) if (keys[k]) b |= C.IN_USE;
  for (const k in ATKK) if (keys[k]) b |= C.IN_ATK;
  return b;
}

// ------------------------------------------------------------------ lobby
function buildPickers(m) {
  $('name').value = 'Racer ' + Math.floor(Math.random() * 900 + 100);
  $('charPick').innerHTML = C.CHARS.map((c, i) =>
    `<button class="chip" data-c="${i}" aria-pressed="${i === charIdx}"><span class="dot" style="background:${c.col}"></span>${c.name}</button>`).join('');
  $('trackPick').innerHTML = m.tracks.map((t, i) =>
    `<button class="chip" data-t="${i}" aria-pressed="${i === trackIdx}">${t.name}</button>`).join('');
  $('charPick').onclick = ev => { const b = ev.target.closest('[data-c]'); if (!b) return; charIdx = +b.dataset.c; buildPickers(m); };
  $('trackPick').onclick = ev => { const b = ev.target.closest('[data-t]'); if (!b) return; trackIdx = +b.dataset.t; buildPickers(m); };
}
$('play').onclick = () => {
  net.send({ t: 'hello', name: $('name').value || 'Racer', charIdx });
  net.send({ t: 'queue', trackIdx });
  $('play').disabled = true;
};

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

// ------------------------------------------------------------------- loop
let acc = 0, last = 0;
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
  telemetry();
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

function showResults(res) {
  $('lobby').style.display = '';
  $('play').disabled = false;
  $('queueInfo').innerHTML = '<table class="res"><tr><th>#</th><th>racer</th><th>time</th><th>coins</th></tr>' +
    res.map(r => `<tr><td>${r.place}</td><td>${r.name}${r.bot ? '' : ' •'}</td><td>${r.done ? r.time.toFixed(2) + 's' : '—'}</td><td>${r.coins}</td></tr>`).join('') + '</table>';
  log('race over: ' + res.map(r => `${r.place}.${r.name}`).join(' '));
}
