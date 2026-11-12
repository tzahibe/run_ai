// Shared by the authoritative server and every client. One source of truth for
// the simulation: if these drift, prediction and reconciliation drift with them.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const SNAP_EVERY = 3;            // snapshots at 20 Hz
export const INPUT_REDUNDANCY = 14;     // unacked inputs resent every packet
export const INTERP_DELAY_MS = 110;     // remote players rendered this far in the past
export const MAX_REWIND_MS = 260;       // lag-compensation window for melee
export const CORRECTION_SNAP = 140;     // px of error above which we hard-snap
export const CORRECTION_RATE = 12;      // otherwise error is eased away at this rate

export const G = 2500, JUMP_V = 775, JUMP2_V = 690, BASE = 430, ACC = 2100;
export const HW = 15, H_STAND = 52, H_SLIDE = 24, BEAM_BOT = 36;
export const ATK_DUR = 0.3, ATK_CD = 0.8, ATK_FWD = 78, ATK_BACK = 46;
export const NO_CONTACT_SEC = 2;        // no melee during the start of a race
export const MAX_PLAYERS = 4;
export const COUNTDOWN_SEC = 3.2;

// input bits, packed into one byte per tick
export const IN_JUMP = 1, IN_SLIDE = 2, IN_USE = 4, IN_ATK = 8;

export const TRACKS = [
  { id:'roofs',  name:'Candy Rooftops', len:11000, seed:1337,  diff:0.55, shape:'blob',
    sky:['#ffd9ee','#9fe0ff'], ground:'#6b4bd6', top:'#a78bfa', far:'#ffffff', mid:'#7d5ad8', sun:'#fff3b8', void:'#3a2a63' },
  { id:'sewer',  name:'Neon Sewer',     len:15000, seed:90210, diff:0.78, shape:'arch',
    sky:['#1d2f52','#06313c'], ground:'#10313d', top:'#1fd8a4', far:'#14263a', mid:'#0d3b48', sun:'#8ff8db', void:'#06171d' },
  { id:'temple', name:'Sky Temple',     len:19000, seed:55512, diff:1.0,  shape:'peak',
    sky:['#ffb067','#4f33a8'], ground:'#522a66', top:'#ffc531', far:'#8a4a9c', mid:'#6a3680', sun:'#fff0a8', void:'#2a1434' }
];

export const CHARS = [
  { id:'bun', name:'Thorn',  col:'#c2697e', dark:'#5f2635', belly:'#ddb2ba', ear:'bunny',   acc:'bandana', acc2:'#a82c2c', tail:'puff', scar:'cheek' },
  { id:'cat', name:'Claw',   col:'#cf9a2e', dark:'#664205', belly:'#dcc491', ear:'cat',     acc:'cap',     acc2:'#2b5f7a', tail:'long', scar:'eye' },
  { id:'bear',name:'Hammer', col:'#8d6239', dark:'#422a13', belly:'#bd9d75', ear:'bear',    acc:'collar',  acc2:'#9aa1ad', tail:'puff', scar:'brow' },
  { id:'fox', name:'Rust',   col:'#bf5824', dark:'#60250a', belly:'#cf9b72', ear:'fox',     acc:'goggles', acc2:'#3c8f6e', tail:'long', scar:'eye' },
  { id:'pen', name:'Frost',  col:'#44536f', dark:'#1c2435', belly:'#c3c9d4', ear:'penguin', acc:'helmet',  acc2:'#7c8391', tail:'none', scar:'cheek' },
  { id:'uni', name:'Storm',  col:'#8f7bb8', dark:'#43306a', belly:'#b8a9d2', ear:'uni',     acc:'crown',   acc2:'#b08a2a', tail:'long', scar:'brow' }
];

export const ITEMS = [
  { id:'boost',  name:'Bolt',    col:'#ffc531' },
  { id:'shield', name:'Shield',  col:'#3fb6f5' },
  { id:'freeze', name:'Freeze',  col:'#8bdcff' },
  { id:'punch',  name:'Glove',   col:'#ff3d7f' },
  { id:'trap',   name:'Sawtrap', col:'#b6a8d4' },
  { id:'jet',    name:'Jetboot', col:'#2ee6a8' },
  { id:'rocket', name:'Bazooka', col:'#ff6b35' },
  { id:'nade',   name:'Grenade', col:'#7a9c3f' },
  { id:'hole',   name:'Pit',     col:'#8a5a2b' }
];
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
