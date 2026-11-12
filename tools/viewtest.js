// Regression tests for the client's view state machine, run against the real
// page in a real browser with a stubbed socket. Every test here exists because
// the bug it checks for actually shipped at least once.
//   node tools/viewtest.js
import { spawn } from 'node:child_process';
import { launch } from './cdp.js';

const PORT = 8711;
const srv = spawn('node', ['server/index.js', '--port', String(PORT)],
  { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => {
  const h = d => { if (String(d).includes('http://localhost')) { srv.stdout.off('data', h); r(); } };
  srv.stdout.on('data', h); setTimeout(r, 4000);
});

const STUB = `
  window.__sent = [];
  class FakeWS {
    constructor(url){ this.url = url; this.readyState = 1; window.__ws = this;
      setTimeout(() => this.onopen && this.onopen(), 0); }
    send(d){ window.__sent.push(d); }
    close(){ this.readyState = 3; this.onclose && this.onclose(); }
    addEventListener(){} removeEventListener(){}
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
  window.__recv = m => window.__ws.onmessage({ data: JSON.stringify(m) });
  window.__view = () => ['lobbyView','roomView','loadView','resultView','raceView']
    .filter(id => !document.getElementById(id).hidden).join(',') || 'none';
`;

const ROSTER = [
  { id: 'me', slot: 0, charIdx: 0, name: 'Me' },
  { id: 'b1', slot: 1, charIdx: 1, name: 'Rex', bot: true }
];
const RESULTS = [
  { id: 'me', name: 'Me', place: 1, time: 21.4, done: true, coins: 7, x: 9999 },
  { id: 'b1', name: 'Rex', place: 2, time: 23.9, done: true, coins: 4, bot: true, x: 9999 }
];
const WELCOME = { t: 'welcome', id: 'me', net: { rtt: 0, jitter: 0, loss: 0 }, chars: 10 };
const MATCH = { t: 'match', room: 'r1', trackIdx: 0, seed: 12345, players: ROSTER, loading: false };
const ROOM = { t: 'room', code: 'ABCD', name: 'Room', hostId: 'me', trackIdx: 0,
  players: [{ id: 'me', name: 'Me', charIdx: 0, host: true, ready: true }], locked: false };
const ROOMS = { t: 'rooms', online: 2, list: [{ code: 'ABCD', name: 'Room', track: 0,
  running: false, locked: false, n: 1, max: 8, humans: 1, players: ['Me'] }] };

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  const good = got === want;
  good ? pass++ : fail++;
  console.log(`  ${good ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}` +
    (good ? '' : `\n          expected ${want}, got ${got}`));
};

const br = await launch();
const pg = await br.page();
await pg.addInit(STUB);
await pg.goto(`http://localhost:${PORT}/`);
await pg.eval('new Promise(r => setTimeout(r, 400))');

const view = () => pg.eval('__view()');
const recv = async (...ms) => {
  for (const m of ms) await pg.eval(`__recv(${JSON.stringify(m)})`);
  await pg.eval('new Promise(r => setTimeout(r, 120))');
};
const reset = async () => {
  await pg.eval(`document.getElementById('backBtn').click()`);
  await pg.eval('new Promise(r => setTimeout(r, 80))');
};

console.log('\nview state machine');
await recv(WELCOME);

// --- the race actually starts -------------------------------------------
await recv(MATCH);
ok('match switches to the race view', await view(), 'raceView');

// --- the results screen survives the post-race storm ---------------------
await recv({ t: 'end', results: RESULTS });
ok('end shows the results', await view(), 'resultView');

await recv(ROOM);
ok('a room update does NOT steal the results', await view(), 'resultView');

await recv(ROOMS);
ok('a room-list broadcast does NOT steal the results', await view(), 'resultView');

await recv({ t: 'leftroom' }, ROOMS);
ok('quick-match teardown does NOT steal the results', await view(), 'resultView');

await recv({ t: 'kicked', reason: 'idle' });
ok('an idle kick does NOT steal the results', await view(), 'resultView');

await recv({ t: 'queued', n: 1, max: 8, inMs: 10000 });
ok('a stray queue update does NOT steal the results', await view(), 'resultView');

await recv({ t: 'who', list: [] }, { t: 'chat', from: 'Rex', msg: 'gg' });
ok('chat and presence do NOT steal the results', await view(), 'resultView');

// --- and the player can still leave it ------------------------------------
await reset();
ok('the exit button leaves the results', await view(), 'lobbyView');

// --- a genuinely new race always wins -------------------------------------
await recv({ t: 'end', results: RESULTS });
await recv({ ...MATCH, room: 'r2' });
ok('a new match overrides the results screen', await view(), 'raceView');

await recv({ t: 'end', results: RESULTS });
await recv({ ...MATCH, room: 'r3', loading: true });
ok('a new loading screen overrides the results', await view(), 'loadView');
await recv({ t: 'go' });
ok('go leaves the loading screen', await view(), 'raceView');

// --- the results table is actually populated and fits ---------------------
await recv({ t: 'end', results: RESULTS });
const rows = await pg.eval(`document.querySelectorAll('#resTable .r').length`);
ok('every racer has a results row', rows, RESULTS.length);
const pods = await pg.eval(`document.querySelectorAll('#podium .pod canvas').length`);
ok('the podium has its medal canvases', pods, 2);
const overflow = await pg.eval(
  `(() => { const p = document.getElementById('resultView');
     return p.scrollHeight > p.clientHeight + 2 ? p.scrollHeight - p.clientHeight : 0; })()`);
ok('the results panel does not overflow', overflow, 0);

// --- HUD: the things asked for by name ------------------------------------
await reset();
await recv({ ...MATCH, room: 'r4' });
const hud = await pg.eval(`(() => ({
  rival: !!document.getElementById('rival'),
  hudShown: !document.getElementById('hud').hidden
}))()`);
ok('the HUD exposes a nearest-rival readout', hud.rival, true);
ok('the HUD is visible while racing', hud.hudShown, true);

const errs = pg.logs.filter(l => l.startsWith('EXCEPTION'));
ok('no uncaught exceptions in the page', errs.length, 0);
if (errs.length) console.log(errs.slice(0, 4).map(e => '          ' + e.slice(0, 160)).join('\n'));

await pg.shot('/tmp/tf-result.png');
br.close(); srv.kill('SIGKILL');
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
