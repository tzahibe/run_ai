import * as C from '../shared/constants.js';
import { Net } from '../client/net.js';
import { createBot, botInput } from '../server/bot.js';
const url = `ws://localhost:${process.argv[2] || 8099}`;
const bot = createBot(0.9);
let ticks = 0;
const n = new Net({
  onOpen(){ n.send({t:'hello',name:'DBG',charIdx:0}); n.send({t:'queue',trackIdx:0}); },
  onMatch(m){ console.log('match', m.players.map(p=>p.name).join(',')); },
  onEnd(m){ console.log('END', m.results.map(r=>`${r.place}.${r.name} ${r.done?r.time.toFixed(1):'DNF'}`).join(' ')); process.exit(0); }
});
n.connect(url);
setInterval(()=>{ if(n.state!=='racing'||!n.me) return;
  const bits = n.time>=0 ? botInput(n.me,bot,n.world,C.DT,[...n.players.values()]) : 0;
  n.tick(bits, C.DT); ticks++;
},1000/C.TICK_HZ);
setInterval(()=>{ if(n.state!=='racing'||!n.me) return;
  const snap=n.snaps[n.snaps.length-1];
  const auth=snap&&snap.snap.ps.find(p=>p.i===n.id);
  console.log(`t=${n.time.toFixed(1)} predX=${n.me.x.toFixed(0)} authX=${auth?auth.x.toFixed(0):'-'} vx=${n.me.vx.toFixed(0)} stun=${n.me.stun.toFixed(2)} corr=${n.stats.corr} buf=${n.stats.buf} pend=${n.pending.length} replay=${n.stats.replay} ticks=${ticks}`);
},1000);
setTimeout(()=>{ console.log('timeout'); process.exit(1); },45000);
