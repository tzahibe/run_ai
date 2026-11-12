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
export const MAX_PLAYERS = 8;
export const COUNTDOWN_SEC = 3.2;

// input bits, packed into one byte per tick
export const IN_JUMP = 1, IN_SLIDE = 2, IN_USE = 4, IN_ATK = 8, IN_RUN = 16;
// Sprint: faster, but it burns a meter that only refills while you are off it.
export const SPRINT_MUL = 1.28, SPRINT_DRAIN = 1 / 2.3, SPRINT_REFILL = 1 / 3.4;
// Coins are not decoration: every twelve is an automatic two-second turbo.
export const COINS_PER_TURBO = 12, TURBO_SEC = 2.0;

// Each track carries its own scenery kit: `theme` picks the props the renderer
// scatters along the ground, `weather` the stuff falling out of the sky, and
// `storm` arms the lightning.
export const TRACKS = [
  { id:'roofs',  name:'Candy Rooftops', len:22000, seed:1337,  diff:0.55, shape:'blob', theme:'candy',
    block:'#c2458c', spike:'#fff0f7', sky:['#ffd9ee','#9fe0ff'], ground:'#6b4bd6', top:'#a78bfa', far:'#ffffff', mid:'#7d5ad8', sun:'#fff3b8', void:'#3a2a63' },
  { id:'sewer',  name:'Neon Sewer',     len:30000, seed:90210, diff:0.78, shape:'arch', theme:'sewer', weather:'drip',
    block:'#123743', spike:'#8ff8db', sky:['#1d2f52','#06313c'], ground:'#10313d', top:'#1fd8a4', far:'#14263a', mid:'#0d3b48', sun:'#8ff8db', void:'#06171d' },
  { id:'temple', name:'Sky Temple',     len:38000, seed:55512, diff:1.0,  shape:'peak', theme:'temple', weather:'ember',
    block:'#3d2050', spike:'#ffe6a8', sky:['#ffb067','#4f33a8'], ground:'#522a66', top:'#ffc531', far:'#8a4a9c', mid:'#6a3680', sun:'#fff0a8', void:'#2a1434' },
  { id:'frost',  name:'Frostpeak',      len:28000, seed:77301, diff:0.85, shape:'peak', theme:'snow',
    weather:'snow', wind:true, storm:true,
    block:'#7fc8e8', spike:'#ffffff', sky:['#9fd8f2','#dceefb'], ground:'#5b7ea3', top:'#f4fbff', far:'#ffffff', mid:'#bcd9ee', sun:'#fffdf2', void:'#243a52' }
];

// --- lightning (Frostpeak) -------------------------------------------------
// A bolt lands every few seconds somewhere near the pack. Anyone standing in
// the blast is charred: black as coal, and briefly too rattled to run.
export const BOLT_EVERY   = [3.2, 6.0];   // seconds between strikes, random in range
export const BOLT_WARN    = 0.55;         // the flicker before it lands
export const BOLT_R       = 70;           // horizontal blast radius
export const CHAR_SEC     = 1.5;          // how long you stay burnt
export const CHAR_SLOW    = 0.55;         // speed multiplier while charred

// --- terrain ---------------------------------------------------------------
export const SPRING_V = 1250;             // how hard a launch pad throws you
export const ICE_GRIP = 0.16;             // acceleration multiplier on ice
export const CLIMB    = 38;               // the tallest step you mount by running

export const CHARS = [
  { id:'hog', run:{bob:1.6,lean:.03,squash:.04,sway:0,hover:0,spin:.55,step:1.15}, atk:{name:'Spin dash',fwd:58,back:58,stun:.34,slow:.4,kb:10,pop:140,cost:.70}, sprite:'sprites/hog.png',  name:'Blitz',   col:'#2f6fe4', dark:'#15336e', belly:'#f6c98a', muzzle:'#f6c98a', ear:'hedgehog', quill:'#2f6fe4', acc:null, acc2:'#ffffff', tail:'spike', shoe:'#e8402f', strap:'#ffffff', eye:'#3fd1a8' },
  { id:'lion', run:{bob:3.0,lean:.07,squash:.06,sway:0,hover:0,spin:0,step:.95}, atk:{name:'Claw swipe',fwd:94,back:40,stun:.5,slow:.3,kb:20,pop:160,cost:.58}, name:'Rex', sprite:'sprites/lion.png',     col:'#f2a73f', dark:'#8a470f', belly:'#ffe2b2', ear:'lion',  mane:'#e0732a', acc:'headband', acc2:'#d6392f', tail:'lion', shoe:'#d6392f', strap:'#ffe2b2', eye:'#c9872a' },
  { id:'fox', run:{bob:2.2,lean:.05,squash:.05,sway:1.3,hover:0,spin:0,step:1.22}, atk:{name:'Tail whip',fwd:40,back:86,stun:.4,slow:.34,kb:16,pop:180,cost:.68}, sprite:'sprites/fox.png',  name:'Pixel',   col:'#ff8c3f', dark:'#a3421a', belly:'#ffe1c4', ear:'fox',   hair:'#ff5fa2', acc:'phones',   acc2:'#2ed3c4', tail:'bush', shoe:'#2ed3c4', strap:'#ffffff', eye:'#3fb6f5' },
  { id:'wolf', run:{bob:2.0,lean:.06,squash:.05,sway:.6,hover:0,spin:0,step:1.05}, atk:{name:'Bite',fwd:62,back:36,stun:.62,slow:.26,kb:8,pop:120,cost:.55}, sprite:'sprites/wolf.png', name:'Frost',   col:'#8f9db0', dark:'#333c48', belly:'#dde6f0', ear:'wolf',  acc:'shades',  acc2:'#3fa9f5', tail:'bush', shoe:'#2a3340', strap:'#3fa9f5', eye:'#8bdcff', scarf:'#3fa9f5' },
  { id:'tiger', run:{bob:2.8,lean:.055,squash:.05,sway:0,hover:0,spin:0,step:1.0}, atk:{name:'Double slash',fwd:80,back:44,stun:.46,slow:.3,kb:14,pop:200,cost:.60}, sprite:'sprites/tiger.png',name:'Fang',    col:'#ff9d24', dark:'#2a1a12', belly:'#ffe6c0', ear:'round', stripes:true,  acc:'shades',   acc2:'#ffc531', tail:'whip', shoe:'#2a1a12', strap:'#ffc531', eye:'#ffd23b' },
  { id:'shark', run:{bob:1.2,lean:.03,squash:.03,sway:2.4,hover:3,spin:0,step:.9}, atk:{name:'Chomp',fwd:52,back:30,stun:.78,slow:.22,kb:10,pop:120,cost:.50}, sprite:'sprites/shark.png',name:'Reef',    col:'#4fb4c9', dark:'#1b4f5e', belly:'#e8f6f8', ear:'fin',   quill:'#3f97ab', acc:null,     acc2:'#ffffff', tail:'spike', shoe:'#ffd23b', strap:'#1b4f5e', eye:'#17121f' },
  { id:'drag', run:{bob:1.0,lean:.04,squash:.03,sway:1.6,hover:5,spin:0,step:.8}, atk:{name:'Wing buffet',fwd:82,back:50,stun:.4,slow:.34,kb:12,pop:380,cost:.62}, sprite:'sprites/drag.png', name:'Draco',   col:'#4cc56a', dark:'#1d5a31', belly:'#e3f7cf', ear:'dragon', quill:'#2f9c4c', acc:null,    acc2:'#ffc531', tail:'spike', shoe:'#ffc531', strap:'#1d5a31', eye:'#ff6b35' },
  { id:'panda', run:{bob:3.4,lean:.04,squash:.09,sway:0,hover:0,spin:0,step:.85}, atk:{name:'Belly bump',fwd:66,back:52,stun:.35,slow:.38,kb:32,pop:140,cost:.66}, sprite:'sprites/panda.png',name:'Bamboo',  col:'#f4f4f4', dark:'#232329', belly:'#ffffff', ear:'panda', patch:'panda', acc:'cap',      acc2:'#6f9440', tail:'puff', shoe:'#6f9440', strap:'#ffffff', eye:'#7bd36a', pack:'#5e7d36' },
  { id:'bun', run:{bob:4.2,lean:.03,squash:.08,sway:0,hover:0,spin:0,step:1.3}, atk:{name:'Spin kick',fwd:72,back:40,stun:.42,slow:.32,kb:12,pop:320,cost:.72,hop:true}, sprite:'sprites/bun.png',  name:'Blossom', col:'#fdf3f6', dark:'#bd7089', belly:'#ffd8e3', ear:'bunny', acc:'goggles', acc2:'#ff6fa5', tail:'puff', shoe:'#ff6fa5', strap:'#ffffff', eye:'#ff8fb8', scarf:'#ff6fa5' },
  { id:'rhino', run:{bob:1.8,lean:.03,squash:.04,sway:0,hover:0,spin:0,step:.8}, atk:{name:'Horn charge',fwd:90,back:30,stun:.5,slow:.5,kb:28,pop:150,cost:1.1}, sprite:'sprites/rhino.png',name:'Tank',    col:'#8e94a2', dark:'#424854', belly:'#c9cfd9', ear:'rhino', horn:true,     acc:'bandana',  acc2:'#ffd23b', tail:'none', shoe:'#ffd23b', strap:'#424854', eye:'#ffd23b', pack:'#d7a81f' }
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
