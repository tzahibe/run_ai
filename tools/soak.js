// Spins up several real clients against a running server, each on its own
// simulated link, and reports how the netcode behaved.
//   node tools/soak.js [port]
import { runClient } from './testclient.js';

const port = process.argv[2] || 8099;
const url = `ws://localhost:${port}`;
const PROFILES = [
  { name: 'LAN',     net: { rtt: 0,   jitter: 0,  loss: 0 },   skill: 0.9 },
  { name: 'Good4G',  net: { rtt: 60,  jitter: 15, loss: 0.5 }, skill: 0.85 },
  { name: 'Mobile',  net: { rtt: 140, jitter: 40, loss: 2 },   skill: 0.8 },
  { name: 'Awful',   net: { rtt: 280, jitter: 90, loss: 8 },   skill: 0.75 }
];

const handles = [];
function handlesPush(n,label){handles.push({n,label});}
globalThis.__soakTrack = (n, label) => handlesPush(n, label);
let left = PROFILES.length;
const out = [];
PROFILES.forEach((p, i) => {
  runClient({ url, name: p.name, charIdx: i, trackIdx: 0, net: p.net, skill: p.skill,
    onDone: s => {
      out.push(s);
      if (--left === 0) {
        console.log('\n  profile   place  finished   time      avg corr   max corr   rtt     drops  pend/buf');
        console.log('  ' + '-'.repeat(78));
        for (const p2 of PROFILES) {
          const s2 = out.find(o => o.name === p2.name); if (!s2) continue;
          const avg = s2.corrN ? (s2.corrSum / s2.corrN) : 0;
          console.log(`  ${s2.name.padEnd(9)} ${String(s2.place).padEnd(6)} ${String(s2.finished).padEnd(10)} ${s2.time.toFixed(2).padStart(6)}s  ${avg.toFixed(2).padStart(8)}px ${s2.corrMax.toFixed(1).padStart(9)}px ${String(s2.rtt).padStart(5)}ms ${String(s2.drops).padStart(6)} ${String(s2.pend)}/${s2.buf}`);
        }
        console.log('');
        process.exit(0);
      }
    } });
});
setInterval(() => {
  if (!handles.length) return;
  console.log(handles.map(h => {
    const n = h.n;
    if (!n.me) return h.label + ':-';
    const sp = n.snaps[n.snaps.length - 1], a = sp && sp.snap.ps.find(x => x.i === n.id);
    return `${h.label} ${a ? ((a.x / 11000 * 100) | 0) + '%' : '-'}`;
  }).join(' | '));
}, 5000);
setTimeout(() => { console.log('timeout'); process.exit(1); }, 150000);
