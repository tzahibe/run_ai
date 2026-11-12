// Takes a screenshot of each track so the scenery can be eyeballed.
//   node tools/shots.js [outdir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { launch } from './cdp.js';

const OUT = process.argv[2] || 'docs/img';
mkdirSync(OUT, { recursive: true });
const PORT = 8713;
const srv = spawn('node', ['server/index.js', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => { const h = d => { if (String(d).includes('http://localhost')) { srv.stdout.off('data', h); r(); } };
  srv.stdout.on('data', h); setTimeout(r, 4000); });

const STUB = `
  class FakeWS { constructor(u){ this.readyState=1; window.__ws=this; setTimeout(()=>this.onopen&&this.onopen(),0); }
    send(){} close(){} addEventListener(){} removeEventListener(){} }
  FakeWS.OPEN = 1; window.WebSocket = FakeWS;
  window.__recv = m => window.__ws.onmessage({ data: JSON.stringify(m) });
`;
const br = await launch();
const pg = await br.page();
await pg.addInit(STUB);
await pg.goto(`http://localhost:${PORT}/`);
await pg.eval('new Promise(r=>setTimeout(r,500))');
await pg.eval(`__recv({t:'welcome',id:'me',net:{rtt:0,jitter:0,loss:0}})`);
// Walk through the entry gate so the race canvas is actually on screen.
await pg.eval(`(() => { const n = document.getElementById('gateName'); if (n) n.value = 'You'; })()`);
await pg.eval('new Promise(r=>setTimeout(r,250))');
await pg.shot(`${OUT}/chars.png`);          // the roster, straight off the gate
await pg.eval(`(() => { const b = document.getElementById('gateEnter'); if (b) b.click(); })()`);
await pg.eval('new Promise(r=>setTimeout(r,300))');

const { TRACKS } = await import('../shared/constants.js');
const { buildTrack } = await import('../shared/track.js');
// Point the camera at something worth looking at on each track.
const spotOf = tk => {
  const cands = [tk.steps[0] && tk.steps[0].x, tk.movers[0] && tk.movers[0].x0,
    tk.springs[0] && tk.springs[0].x, tk.ice[0] && tk.ice[0].s, tk.belts[0] && tk.belts[0].s,
    tk.blinkers[0] && tk.blinkers[0].x].filter(v => typeof v === 'number');
  return cands.length ? Math.min(...cands) - 170 : 2400;
};
for (let i = 0; i < TRACKS.length; i++) {
  const roster = [
    { id: 'me', slot: 0, charIdx: 0, name: 'You' },
    { id: 'b1', slot: 1, charIdx: 3, name: 'Rex', bot: true },
    { id: 'b2', slot: 2, charIdx: 6, name: 'Blaze', bot: true }
  ];
  await pg.eval(`__recv(${JSON.stringify({ t: 'match', room: 'shot' + i, trackIdx: i, seed: TRACKS[i].seed, players: roster })})`);
  // Drop the pack into the middle of the track so there is scenery on screen.
  const spot = spotOf(buildTrack(TRACKS[i], TRACKS[i].seed));
  await pg.eval(`(() => { const n = window.__tf.net; n.time = 12;
     let k = 0; for (const p of n.players.values()) { p.x = ${spot} + (k++) * 150; p.y = 0; p.vx = 430; p.onGround = true; }
   })()`);
  await pg.eval('new Promise(r=>setTimeout(r,450))');
  // Lightning is a flash a third of a second long, so it is fired last.
  if (i === 3) { await pg.eval(`(() => { const p = window.__tf.net.players.get('b1'); if (p) p.charred = 1.3;
      window.__tf.R.bolts.push({ x: ${spot} + 150, t: 0.55, warn: 0.55, seed: 11 }); })()`);
    await pg.eval('new Promise(r=>setTimeout(r,70))'); }
  await pg.shot(`${OUT}/${TRACKS[i].id}.png`);
  console.log('  shot', `${OUT}/${TRACKS[i].id}.png`);
}
br.close(); srv.kill('SIGKILL');
