/*
 * DICTATOR'S DASH 3D  v4  -  web edition
 *
 * The simulation and the 3D drawing started as a section-by-section port of native/11.py
 * (the PyOpenGL + GLUT version) and still use its tables, class and method names:
 *
 *   native/11.py                     web (this file)
 *   ------------------------------   ------------------------------------------------
 *   DIFFS, LOCS, PAL, env()          same tables, same env()
 *   class Game  (simulation)         class Game, plus the web-only "rigged Olympics" rules:
 *                                    rival athletes, finish tapes and gold medals
 *   draw_world()  legacy OpenGL      draw_world()  same calls, via glshim.js -> Three.js
 *   draw_hud()    GL ortho 2D        screen effects on a Canvas 2D layer; menus and HUD are
 *                                    HTML (ui.js) so they stay readable on phones
 *   GLUT callbacks                   same callbacks, fed by keyboard, mouse, touch and gamepad
 *   winsound.Beep                    Web Audio (core.js)
 *   highscore.json                   localStorage (same JSON)
 */
'use strict';

// ---- Python-style helpers so the port reads like the original
const random = {
  random: Math.random,
  uniform: (a, b) => a + Math.random() * (b - a),
  choice: a => a[Math.floor(Math.random() * a.length)],
  randrange: n => Math.floor(Math.random() * n),
  randint: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  shuffle: a => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  },
  choices: (pop, w) => {                          // random.choices(pop, weights)[0]
    let r = Math.random() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < pop.length; i++) {
      r -= w[i];
      if (r < 0) return pop[i];
    }
    return pop[pop.length - 1];
  }
};
const floordiv = (a, b) => Math.floor(a / b);     // Python a // b
const pymod = (a, b) => ((a % b) + b) % b;        // Python a % b (never negative)
function pyround(x) {                             // Python round(): halves go to even
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const LANES = 5, LW = 2.2;                        // 5 lanes, 2.2 units wide each
const SAVE = 'dictators-dash.highscore';          // localStorage key (native: highscore.json)
const GOLD = [0.95, 0.75, 0.15];
const WIN = [innerWidth, innerHeight];
const NR = 75;                                    // road samples, 2 units apart (150 units of visible road)
const TODN = ['Day', 'Dusk', 'Night', 'Auto cycle'];
const WN = ['Clear', 'Rain', 'Snow', 'Sandstorm'];
const WM = ['Auto'].concat(WN);
const VN = ['Chase', 'First-person', 'Overhead'];

// ---- web-only rules: the Supreme Leader's own Olympics
const TAPE_GAP = 400.0;                           // a finish tape is carried out to you this often
const EVENTS = ['100 m Dash', '200 m Sprint', '400 m Hurdles', '800 m Run', '1500 m Run', 'Marathon'];
const RIVAL_P = [0.22, 0.30, 0.38];               // chance of a rival athlete per spawn row, by difficulty
const RIVAL_COLS = [                              // national kit: top, shorts, hair, skin
  [[0.10, 0.62, 0.28], [0.96, 0.82, 0.14], [0.05, 0.05, 0.05], [0.45, 0.30, 0.20]],
  [[0.96, 0.96, 0.98], [0.14, 0.30, 0.78], [0.25, 0.15, 0.08], [0.93, 0.76, 0.62]],
  [[0.86, 0.12, 0.12], [0.96, 0.96, 0.96], [0.08, 0.06, 0.05], [0.86, 0.66, 0.48]],
  [[0.16, 0.42, 0.92], [0.82, 0.14, 0.14], [0.80, 0.70, 0.40], [0.70, 0.50, 0.36]]
];

// ---- render detail. apply_quality() copies one tier into Q; 'auto' also scales the resolution (Q.dyn)
const TIERS = {
  low: { pr: 1.0, wx: 0.35, rows: 9, sl: 12, sk: 8, glow: false, rig: 0 },   // rig: how many rivals get the detailed model
  medium: { pr: 1.5, wx: 0.7, rows: 12, sl: 16, sk: 10, glow: true, rig: 2 },
  high: { pr: 2.0, wx: 1.0, rows: 14, sl: 20, sk: 14, glow: true, rig: 4 }
};
const Q = Object.assign({ dyn: 1.0, auto: 'high' }, TIERS.high);

// ------------------------------------------------------------------ difficulty presets
const DIFFS = [
  { name: 'Easy', col: [0.35, 0.85, 0.50],
    desc: 'Relaxed pace, gentle curves, forgiving hits. Great for learning the moves.',
    hp: 130, dmg: 0.6, heal: 40, v0: 12.0, vmin0: 10.0, vgrow: 0.12, vcap: 22.0, vmax: 34.0,
    gap0: 28.0, gapmin: 16.0, gaps: 0.08, nobs: [1, 1, 1, 2], clone_p: 0.18, clone_max: 2,
    drone_t: 30.0, drone_max: 1, drone_p: 0.12, drone_cap: 0.25, ecd: 1.5, item_p: 0.20, curve: 0.7 },
  { name: 'Medium', col: [1.00, 0.78, 0.20],
    desc: "The classic Dictator's Dash experience. Balanced speed, enemies and curves.",
    hp: 100, dmg: 1.0, heal: 30, v0: 14.0, vmin0: 12.0, vgrow: 0.20, vcap: 30.0, vmax: 42.0,
    gap0: 24.0, gapmin: 13.0, gaps: 0.12, nobs: [1, 1, 2, 3], clone_p: 0.28, clone_max: 3,
    drone_t: 12.0, drone_max: 3, drone_p: 0.20, drone_cap: 0.45, ecd: 1.0, item_p: 0.12, curve: 1.0 },
  { name: 'Hard', col: [1.00, 0.30, 0.25],
    desc: 'Fast, dense, aggressive drones and sharp bends. Every hit hurts.',
    hp: 80, dmg: 1.4, heal: 25, v0: 17.0, vmin0: 15.0, vgrow: 0.28, vcap: 34.0, vmax: 48.0,
    gap0: 21.0, gapmin: 12.0, gaps: 0.15, nobs: [2, 2, 3, 3], clone_p: 0.40, clone_max: 4,
    drone_t: 6.0, drone_max: 4, drone_p: 0.30, drone_cap: 0.60, ecd: 0.7, item_p: 0.08, curve: 1.25 }
];

// ------------------------------------------------------------------ locations
// tint/tw: sky colour pushed toward 'tint' with weight tw.  night: bias toward the night palette.
// fog: fog distance multiplier.  curve: how twisty the road is.  wt: weather odds (clear, rain, snow, sand)
const LOCS = [
  { name: 'Wadiya Stadium', tag: 'Olympic arena', kind: 'stadium',
    desc: "The People's Glorious Olympic Stadium. Attendance is mandatory, cheering is enforced.",
    pv: [0.45, 0.70, 0.96], ground: [0.20, 0.50, 0.24], road: [0.74, 0.22, 0.16],
    edge: [1.00, 1.00, 1.00], dash: [1.00, 1.00, 1.00], lamp: [1.0, 1.0, 0.9], far: [0.45, 0.52, 0.62],
    tint: [0.5, 0.7, 1.0], tw: 0.0, night: 0.0, fog: 1.15, curve: 0.7, wt: [7, 1, 0, 0],
    torch: [1.0, 1.0, 0.9], glow: 0.0, acc: [0.95, 0.75, 0.15] },
  { name: 'Agrabah', tag: 'Desert highway', kind: 'desert',
    desc: 'Golden domes, palms and warm dust. Sandstorms roll in without warning.',
    pv: [0.97, 0.62, 0.35], ground: [0.86, 0.70, 0.45], road: [0.42, 0.10, 0.12],
    edge: [0.95, 0.75, 0.15], dash: [0.95, 0.90, 0.80], lamp: [1.0, 0.9, 0.4], far: [0.80, 0.58, 0.34],
    tint: [1.0, 0.7, 0.35], tw: 0.0, night: 0.0, fog: 1.0, curve: 1.0, wt: [5, 1, 0, 3],
    torch: [1.0, 0.7, 0.35], glow: 0.0, acc: [0.95, 0.75, 0.15] },
  { name: 'Neon City', tag: 'Cyber night', kind: 'city',
    desc: 'A rain-slick skyline that never sleeps. Neon everywhere, mostly after dark.',
    pv: [0.28, 0.08, 0.40], ground: [0.07, 0.07, 0.10], road: [0.10, 0.10, 0.14],
    edge: [0.20, 0.90, 1.00], dash: [0.90, 0.45, 1.00], lamp: [0.3, 0.9, 1.0], far: [0.14, 0.10, 0.28],
    tint: [0.8, 0.2, 0.7], tw: 0.5, night: 0.85, fog: 0.85, curve: 0.6, wt: [2, 5, 1, 0],
    torch: [0.8, 0.3, 1.0], glow: 0.45, acc: [0.35, 0.9, 1.0] },
  { name: 'Frozen Peaks', tag: 'Snow and ice', kind: 'snow',
    desc: 'A winding alpine pass under pale skies. Snow falls often, bends are tight.',
    pv: [0.72, 0.86, 1.0], ground: [0.92, 0.95, 1.0], road: [0.27, 0.30, 0.38],
    edge: [0.60, 0.85, 1.00], dash: [0.95, 0.97, 1.0], lamp: [0.7, 0.85, 1.0], far: [0.72, 0.80, 0.92],
    tint: [0.7, 0.85, 1.0], tw: 0.35, night: 0.0, fog: 0.9, curve: 1.3, wt: [2, 0, 6, 0],
    torch: [0.7, 0.85, 1.0], glow: 0.0, acc: [0.6, 0.85, 1.0] },
  { name: 'Emerald Vale', tag: 'Misty forest', kind: 'forest',
    desc: 'A twisty valley road through dense trees and drifting mist. Often rainy.',
    pv: [0.50, 0.75, 0.62], ground: [0.20, 0.45, 0.20], road: [0.36, 0.28, 0.19],
    edge: [0.60, 0.88, 0.40], dash: [0.95, 0.92, 0.75], lamp: [1.0, 0.85, 0.5], far: [0.18, 0.40, 0.34],
    tint: [0.45, 0.8, 0.6], tw: 0.3, night: 0.0, fog: 0.78, curve: 1.5, wt: [3, 5, 0, 0],
    torch: [1.0, 0.8, 0.45], glow: 0.0, acc: [0.55, 0.9, 0.45] }
];

const PAL = [
  { sky: [0.55, 0.78, 0.95], top: [0.16, 0.40, 0.85], dif: [1.0, 0.97, 0.88], amb: [0.50, 0.50, 0.52],
    sun: [1, 1, 0.85], sy: 46.0, stars: 0.0, night: 0.0 },
  { sky: [0.97, 0.60, 0.33], top: [0.30, 0.20, 0.52], dif: [1.0, 0.85, 0.65], amb: [0.42, 0.36, 0.40],
    sun: [1, 0.9, 0.5], sy: 24.0, stars: 0.0, night: 0.0 },
  { sky: [0.03, 0.04, 0.13], top: [0.005, 0.005, 0.04], dif: [0.30, 0.35, 0.60], amb: [0.14, 0.15, 0.26],
    sun: [0.9, 0.92, 1], sy: 40.0, stars: 1.0, night: 1.0 }
];
const ORDER = [0, 1, 2, 1];
const STARS = Array.from({ length: 190 }, () =>
  [random.uniform(-230, 230), random.uniform(20, 190), -245, random.uniform(0.4, 1)]);


function lerp(a, b, f) {
  if (Array.isArray(a)) return a.map((x, i) => x + (b[i] - x) * f);
  return a + (b - a) * f;
}


function env() {
  const L = g.loc;
  let e;
  if (g.tod < 3) {
    e = Object.assign({}, PAL[g.tod]);
  } else {
    const ph = pymod(g.clock, 120) / 30.0;        // 30 s per stage, 2 min per full day
    const i = Math.floor(ph);
    let f = ph - i;
    f = f * f * (3 - 2 * f);
    const a = PAL[ORDER[i]], b = PAL[ORDER[(i + 1) % 4]];
    e = {};
    for (const k in a) e[k] = lerp(a[k], b[k], f);
  }
  if (L.night > 0) {                              // location bias toward night (Neon City)
    const n2 = PAL[2];
    for (const k in e) e[k] = lerp(e[k], n2[k], L.night);
  }
  if (L.tw > 0) {                                 // location colour grading
    const bright = 1 - 0.65 * e.night;
    const tint = L.tint.map(c => c * bright);
    e.sky = lerp(e.sky, tint, L.tw);
    e.top = lerp(e.top, tint.map(c => c * 0.6), L.tw);
    e.amb = lerp(e.amb, L.tint.map(c => c * 0.45), L.tw * 0.5);
  }
  const fm = L.fog;
  e.fs = 25.0 * fm;
  e.fe = 105.0 * fm;
  const w = g.weather, k = g.wk;
  if (w && k > 0) {
    const grey = [[0.45, 0.47, 0.5], [0.8, 0.83, 0.88], [0.78, 0.62, 0.4]][w - 1];
    const day = 0.25 + 0.75 * (1 - e.stars);
    e.sky = lerp(e.sky, grey.map(c => c * day), 0.65 * k);
    e.top = lerp(e.top, e.sky, 0.7 * k);
    e.dif = e.dif.map(c => c * lerp(1.0, [0.6, 0.7, 0.8][w - 1], k));
    e.sun = lerp(e.sun, e.sky, 0.75 * k);
    e.stars *= lerp(1.0, 0.15, k);
    const [fs, fe] = [[15, 70], [18, 75], [6, 40]][w - 1];
    e.fs = lerp(e.fs, fs * fm, k);
    e.fe = lerp(e.fe, fe * fm, k);
  }
  return e;
}


function load_hi() {
  try {
    const b = JSON.parse(localStorage.getItem(SAVE)).best;
    if (typeof b === 'object') return DIFFS.map(d => Math.trunc(b[d.name] || 0));
    return [0, Math.trunc(b), 0];                 // old single-score format counts as Medium
  } catch (e) {
    return [0, 0, 0];
  }
}


function save_hi(v) {
  try {
    const best = {};
    DIFFS.forEach((d, i) => (best[d.name] = Math.trunc(v[i])));
    localStorage.setItem(SAVE, JSON.stringify({ best }));
  } catch (e) { /* private mode etc. - ignore like the native version */ }
}


// ----------------------------------------------------------------- game state
class Game {
  constructor() {
    const s = this;
    s.his = load_hi();
    s.t = 0.0; s.D = 0.0;
    s.di = 1; s.li = 0;                           // difficulty / location index
    s.tod = 3; s.wmode = 0; s.view = 0;
    s.weather = s.wnext = 0;
    s.wk = 1.0; s.wtimer = 30.0; s.clock = 0.0; s.wx = []; s.bolt = 0.0;
    s.mx = Math.floor(WIN[0] / 2); s.my = Math.floor(WIN[1] / 2); s.aim = [0.0, 0.0, -1.0];
    s.roll = 0.0; s.rt = new Array(NR + 1).fill(0.0); s.k0 = 0.0; s.cdir = 1;
    s.new_track(40);
    s.randomize_env();
    s.reset();
    s.state = 'menu';
    s.build_road();
  }

  get dd() { return DIFFS[this.di]; }
  get up() { return Store.d.up || {}; }                        // gadget levels bought from Nadal
  get mods() { return (SKINS.find(k => k.id == Store.d.skin) || SKINS[0]).mods; }   // this athlete's rule tweaks
  get loc() { return LOCS[this.li]; }
  get hi() { return this.his[this.di]; }

  reset() {
    const s = this;
    const prev = s.state === undefined ? 'menu' : s.state;
    if (prev == 'play' || prev == 'paused') Bus.emit('runend', s.summary(false, false));   // run abandoned
    const d = s.dd;
    s.state = 'play'; s.time = 0.0; s.speed = d.v0 * 0.35;        // off the blocks: accelerate up to pace
    s.lane = 2; s.px = 0.0; s.py = 0.0; s.vy = 0.0; s.slide = 0.0;
    s.hpmax = Math.round(d.hp * (s.mods.hp || 1) * (1 + 0.15 * (s.up.armor || 0)));
    s.health = s.hpmax; s.shield = false; s.rapid = 0.0; s.chain = 0;
    s.score = 0.0; s.coins = 0; s.kills = 0;
    s.invuln = s.shake = s.flash = s.fire_cd = s.phase = 0.0;
    s.obs = []; s.cns = []; s.items = []; s.clones = [];
    s.drones = [];
    s.pb = []; s.cb = []; s.parts = []; s.flames = []; s.ms = []; s.booms = [];
    s.target = d.v0; s.fuel = 100.0; s.heat = false; s.fire_on = false;
    s.rivals = []; s.tapes = []; s.pops = [];
    s.medals = 0; s.rk = 0; s.maxmult = 1; s.tap_t = 0.0; s.scare = 0.0;
    s.boost = 0.0; s.cheer = 0.0; s.lean = 0.0; s.talk = 9.0;
    s.aim_t = 0.0; s.muzzle = 0.0; s.stam = 100.0; s.tired = 0.0; s.chant_t = 22.0;
    s.hm_cd = 1.5; s.doom = 0.0; s.doom_seen = 0;
    if (prev != 'menu') {
      s.randomize_env();                          // every new run: new time of day / weather
      s.new_track(160);
    }
    s.next_spawn = s.D + 20;
    s.D0 = s.D;
    s.next_tape = s.D + TAPE_GAP;
    s.run_id = (s.run_id || 0) + 1;
  }

  summary(dead, best) {                           // what the UI needs to know about this run
    const s = this;
    return { dead, best, score: Math.trunc(s.score), coins: s.coins, kills: s.kills, rivals: s.rk,
             medals: s.medals, dist: Math.trunc(s.D - s.D0), time: s.time, mult: s.maxmult,
             di: s.di, li: s.li, hi: s.hi };
  }

  pop(x, y, z, text, c) {                         // floating label at a world position
    this.pops.push({ x, y, z, s: text, c, t: 1.0 });
  }

  to_menu() {
    this.reset();
    this.state = 'menu';
    this.new_track(30);
  }

  get mult() { return 1 + Math.min(floordiv(this.chain, 5), 4); }

  // ---- menu helpers
  set_diff(i) { this.di = Math.max(0, Math.min(DIFFS.length - 1, i)); }

  set_loc(i) {
    this.li = pymod(i, LOCS.length);
    this.reroll_weather();
  }

  ui(a) {
    const k = a[0];
    if (k == 'diff') this.set_diff(a[1]);
    else if (k == 'loc') this.set_loc(a[1]);
    else if (k == 'start' || k == 'restart') this.reset();
    else if (k == 'menu') this.to_menu();
    else if (k == 'resume') this.pause();
  }

  // ---- curved road: lane-space logic stays straight, rendering/aiming add off(z)
  new_track(lead = 160) {
    this.segs = [];
    this.cend = this.D + lead;
  }

  curv(d) {                                       // road curvature at track distance d
    const s = this;
    while (s.cend < d + 220) {
      const a = s.cend + random.uniform(60, 190);
      const ln = random.uniform(110, 240);
      const sg = random.random() < 0.65 ? -s.cdir : s.cdir;
      s.cdir = sg;
      s.segs.push([a, ln, sg * random.uniform(1.8e-3, 3.5e-3)]);
      s.cend = a + ln;
    }
    const f = s.dd.curve * s.loc.curve;
    for (const [a, ln, pk] of s.segs) {
      if (a <= d && d < a + ln) return pk * f * Math.sin(Math.PI * (d - a) / ln) ** 2;
    }
    return 0.0;
  }

  build_road() {                                  // lateral offset table, 2 units apart, ahead of Aladdin
    const s = this, ds = 2.0;
    let h = 0.0, x = 0.0;
    s.k0 = s.curv(s.D);
    s.rt[0] = 0.0;
    for (let i = 1; i <= NR; i++) {
      const k = s.curv(s.D + (i - 0.5) * ds);
      const h2 = h + k * ds;
      x += (h + h2) * 0.5 * ds;
      h = h2;
      s.rt[i] = x;
    }
  }

  off(z) {                                        // sideways road offset at depth z
    const s = this, d = -z;
    if (d <= 0) return 0.5 * s.k0 * d * d;
    const i = d * 0.5, n = Math.trunc(i);
    if (n >= NR) return s.rt[NR];
    return s.rt[n] + (s.rt[n + 1] - s.rt[n]) * (i - n);
  }

  rx(x, z) { return x + this.off(z); }            // lane x -> rendered world x

  update_road(dt) {
    const s = this;
    s.segs = s.segs.filter(q => q[0] + q[1] > s.D - 40);
    s.build_road();
    const tgt = Math.max(-0.08, Math.min(0.08, s.curv(s.D + 25) * 18));
    s.roll += (tgt - s.roll) * Math.min(1.0, 4 * dt);
  }

  // ---- actions
  move(d) {
    if (this.state == 'play') this.lane = Math.max(0, Math.min(LANES - 1, this.lane + d));
  }

  jump() {
    if (this.state == 'play' && this.py <= 0.01) {
      this.vy = 9.0 * (this.mods.jump || 1);
      this.slide = 0.0;
      Snd.play('jump');
    }
  }

  duck() {
    if (this.state != 'play') return;
    if (this.py > 0.05) this.vy = -14.0;
    else {
      if (this.slide <= 0) Snd.play('slide');
      this.slide = 0.7;
    }
  }

  shoot(straight = false) {
    const s = this;
    if (s.state == 'play' && s.fire_cd <= 0) {
      const [hx, hy, hz] = s.hand;
      const d = straight ? [0.0, 0.0, -1.0] : s.aim;
      s.pb.push({ x: hx, y: hy, z: hz, dx: d[0] * 50, dy: d[1] * 50, dz: d[2] * 50 });
      s.fire_cd = s.rapid > 0 ? 0.1 : 0.28;
      s.scare = 1.2; s.aim_t = 0.35; s.muzzle = 0.07;
      s.parts.push([hx + 0.1, hy, hz + 0.3, 2.5, 3.0, 0.5, 0.5, GOLD]);   // spent casing
      Bus.emit('shot');                              // gunfire: the rivals freeze
      Snd.play('shoot');
    }
  }

  // ---- Nuclear Nadal's Lab: the Pointy Hand Missile and the Pointy Beard of Doom
  get hm_max() { return 10 - 2 * Math.max(1, this.up.hand || 0); }          // seconds to reload the hand missile

  verdict() { return random.choice(['ELECTION CANCELLED', 'ELECTION POSTPONED', 'ELECTION RIGGED']); }

  threat() {                                      // what a missile locks onto: the nearest robot or drone, else a ballot box or a rival
    const s = this;
    let best = null, bz = -70;
    const see = (o, h, k) => { if (!o.dead && o.z < -3 && o.z > bz) { bz = o.z; best = { o, h, k }; } };
    for (const c of s.clones) see(c, 1.1, 'clone');
    for (const dr of s.drones) see(dr, dr.y, 'drone');
    if (best) return best;
    for (const o of s.obs) if (o.k == 'crate') see(o, 0.9, 'crate');
    for (const r of s.rivals) see(r, 1.1, 'rival');
    return best;
  }

  strike(to) {                                    // a hand missile destroys its target, and nothing else
    const s = this, o = to.o, x = s.rx(o.x, o.z);
    if (to.k == 'drone') s.drone_down(o);
    else if (to.k == 'rival') s.rival_out(o, RIVAL_COLS[o.c][0]);
    else if (to.k == 'crate') {
      o.dead = true;
      s.score += 20 * s.mult;
      s.burst(x, 1, o.z, [0.7, 0.45, 0.2], 18);
      s.pop(x, 2.4, o.z, s.verdict(), [0.75, 0.88, 1]);
    } else {
      o.dead = true;
      s.kills += 1; s.chain += 1;
      s.score += 50 * s.mult;
      s.burst(x, 1.2, o.z, [0.9, 0.3, 0.1], 24);
      s.pop(x, 2.6, o.z, `+${50 * s.mult}`, [1, 0.7, 0.3]);
      Bus.emit('say', 'demo');
    }
    s.booms.push({ x, y: to.h, z: o.z, r: 2.6, t: 0.4, T: 0.4 });
    s.shake = Math.max(s.shake, 0.3);
    Snd.play('boom');
    buzz(40);
  }

  missile() {                                     // leaves his hand and flies to the locked target
    const s = this;
    if (s.state != 'play' || !s.up.hand || s.hm_cd > 0) return;
    const to = s.threat();
    if (!to) { Snd.play('click'); return; }       // nothing to lock onto: keep the missile
    const [hx, hy, hz] = s.hand;
    s.ms.push({ k: 'hand', x: hx, y: hy + 0.15, z: hz - 0.4, vx: 0, vy: 5, vz: -24, t: 0, to });
    s.hm_cd = s.hm_max;
    s.scare = 1.5; s.aim_t = 0.5;
    Bus.emit('shot'); Bus.emit('say', 'missile');
    Snd.play('launch');
    buzz(30);
  }

  doom_call() {                                   // the big one is fired from somewhere far behind the stadium
    const s = this;
    if (s.state != 'play' || !s.up.beard || s.doom < 1) return;
    s.doom = 0.0;
    s.ms.push({ k: 'doom', x: s.px + 10, y: 36, z: 18, vx: 0, vy: -1, vz: -1, t: 0 });
    s.scare = 3.0;
    Bus.emit('shot'); Bus.emit('say', 'doom');
    Snd.play('incoming');
  }

  blast(x, y, z, R, doom) {                       // everything within R of the explosion is gone
    const s = this;
    const near = (ox, oy, oz) => (ox - x) ** 2 + (oy - y) ** 2 + (oz - z) ** 2 < R * R;
    for (const o of s.obs) {
      const ox = s.rx(o.x, o.z);
      if (!o.dead && near(ox, 1, o.z)) {
        o.dead = true;
        s.score += 20 * s.mult;
        s.burst(ox, 1, o.z, [0.7, 0.45, 0.2], 10);
        if (o.k == 'crate' && !doom) s.pop(ox, 2.4, o.z, s.verdict(), [0.75, 0.88, 1]);
      }
    }
    for (const c of s.clones) {
      const cx = s.rx(c.x, c.z);
      if (!c.dead && near(cx, 1.1, c.z)) {
        c.dead = true;
        s.kills += 1; s.chain += 1;
        s.score += 50 * s.mult;
        s.burst(cx, 1.2, c.z, [0.9, 0.3, 0.1], 16);
        if (!doom) s.pop(cx, 2.6, c.z, `+${50 * s.mult}`, [1, 0.7, 0.3]);
      }
    }
    for (const dr of s.drones) if (!dr.dead && near(s.rx(dr.x, dr.z), dr.y, dr.z)) s.drone_down(dr);
    for (const r of s.rivals) if (!r.dead && near(s.rx(r.x, r.z), r.y + 1.1, r.z)) s.rival_out(r, RIVAL_COLS[r.c][0]);
    for (const b of s.cb) if (near('vx' in b ? b.x : s.rx(b.x, b.z), b.y !== undefined ? b.y : 1.2, b.z)) b.dead = true;
    for (const c of [[1, 0.55, 0.1], [1, 0.85, 0.3], [0.4, 0.38, 0.36]]) s.burst(x, y + 0.4, z, c, doom ? 40 : 12);
    s.booms.push({ x, y, z, r: doom ? 24 : R + 1, t: doom ? 1.0 : 0.45, T: doom ? 1.0 : 0.45 });
    s.shake = Math.max(s.shake, doom ? 0.8 : 0.4);
    if (doom) {
      s.bolt = 0.22;                              // the sky goes white
      s.pop(x, 5, z, 'BEARD OF DOOM', [1, 0.8, 0.3]);
      s.doom_seen = s.kills + s.rk + 2 * s.medals;   // its own victims do not charge the next one
    }
    Snd.play(doom ? 'doom' : 'boom');
    buzz(doom ? [60, 40, 160] : 50);
  }

  burst(x, y, z, c, n = 14) {
    for (let i = 0; i < n; i++) {
      this.parts.push([x, y, z, random.uniform(-3, 3), random.uniform(1, 6),
                       random.uniform(-3, 3), random.uniform(0.4, 0.9), c]);
    }
  }

  hurt(dmg) {
    const s = this;
    if (s.invuln > 0) return;
    dmg = Math.max(1, Math.trunc(pyround(dmg * s.dd.dmg)));
    s.invuln = 1.0; s.shake = 0.5;
    if (s.shield) {
      s.shield = false;
      s.burst(s.px, 1, 0, [0.3, 0.7, 1], 25);
      Snd.play('block');
      buzz(20);
      return;
    }
    s.health -= dmg;
    s.chain = 0; s.flash = 0.35;
    s.burst(s.px, 1, 0, [1, 0.2, 0.1], 20);
    Snd.play('hurt');
    buzz(60);
    if (s.health > 0) Bus.emit('say', 'hurt');
    if (s.health <= 0) {
      s.state = 'over';
      s.shake = s.invuln = s.flash = 0.0;         // nothing may shake/blink on the game-over screen
      s.flames = []; s.fire_on = false;
      const best = Math.trunc(s.score) > s.his[s.di];
      const sum = s.summary(true, best);          // 'hi' in the summary is the record before this run
      if (best) {
        s.his[s.di] = Math.trunc(s.score);
        save_hi(s.his);
      }
      Snd.play('over');
      buzz([80, 60, 160]);
      Bus.emit('runend', sum);
    }
  }

  rival_out(r, c) {                               // a rival athlete is "disqualified"
    const s = this;
    r.dead = true;
    s.rk += 1;
    s.chain += 1;
    s.score += 40 * s.mult;
    const x = s.rx(r.x, r.z);
    s.burst(x, 1.2, r.z, c, 22);
    s.pop(x, 2.6, r.z, 'DISQUALIFIED', [1, 0.85, 0.3]);
    Bus.emit('say', 'cheat');
    Snd.play('dq');
  }

  get vmin() {                                    // minimum speed rises with time
    const d = this.dd;
    return Math.min(d.vmin0 + this.time * d.vgrow, d.vcap);
  }

  speed_adj(d) {
    if (this.state == 'play' && this.tired <= 0) this.target = Math.max(this.vmin, Math.min(this.dd.vmax, this.target + d));
  }

  cycle_tod() { this.tod = (this.tod + 1) % 4; }

  get hand() {                                    // where bullets and flames leave Aladdin
    const s = this;
    const low = s.slide > 0 ? 0.6 : null;
    if (s.view == 1) return [s.px + 0.35, s.py + (low || 1.45), -0.5];
    return [s.px + 0.24, s.py + (low || 1.42), -0.62];           // the muzzle, with the pistol arm out
  }

  in_cone(x, y, z) {                              // is a point inside the flame cone?
    const [hx, hy, hz] = this.hand;
    const d = this.aim;
    const vx = x - hx, vy = y - hy, vz = z - hz;
    const al = vx * d[0] + vy * d[1] + vz * d[2];
    if (!(0.5 < al && al < 15)) return false;
    const r = 1.1 + al * 0.1;
    return vx * vx + vy * vy + vz * vz - al * al < r * r;
  }

  // ---- environment
  pick_weather(excl = null) {
    const ws = this.loc.wt;
    let ch = [0, 1, 2, 3].filter(w => w !== excl && ws[w] > 0);
    if (!ch.length) ch = [0];
    return random.choices(ch, ch.map(w => ws[w]));
  }

  reroll_weather() {
    const s = this;
    s.weather = s.wnext = s.wmode == 0 ? s.pick_weather() : s.wmode - 1;
    s.wk = 1.0; s.wtimer = random.uniform(25, 50);
    s.seed_weather();
  }

  randomize_env() {
    if (this.tod == 3) this.clock = random.uniform(0, 120);
    this.reroll_weather();
  }

  seed_weather() {
    const n = [0, 450, 320, 380][this.weather];
    this.wx = Array.from({ length: n }, () =>
      [random.uniform(-16, 16), random.uniform(0, 14), random.uniform(-45, 8)]);
  }

  cycle_weather() {
    const s = this;
    s.wmode = (s.wmode + 1) % 5;
    s.wnext = s.wmode == 0 ? s.pick_weather() : s.wmode - 1;
    s.wtimer = random.uniform(25, 50);
  }

  weather_tick(dt) {
    const s = this;
    if (s.wmode == 0) {                           // auto: change every 25-50 s (odds depend on location)
      s.wtimer -= dt;
      if (s.wtimer <= 0) {
        s.wtimer = random.uniform(25, 50);
        s.wnext = s.pick_weather(s.wnext);
      }
    }
    if (s.weather != s.wnext) {                   // fade old weather out, then new one in
      s.wk -= dt / 1.5;
      if (s.wk <= 0 || s.weather == 0) {
        s.weather = s.wnext; s.wk = 0.0;
        s.seed_weather();
      }
    } else {
      s.wk = Math.min(1.0, s.wk + dt / 3);
    }
    const sp = s.speed, w = s.weather;
    for (const p of s.wx) {
      if (w == 1) {
        p[1] -= 24 * dt; p[2] += sp * 0.4 * dt;
      } else if (w == 2) {
        p[1] -= 2.2 * dt; p[0] += Math.sin(s.t * 1.5 + p[2]) * 0.6 * dt; p[2] += sp * 0.6 * dt;
      } else {
        p[0] += 16 * dt; p[1] += Math.sin(s.t * 3 + p[0]) * 0.5 * dt; p[2] += sp * 0.7 * dt;
      }
      if (p[1] < 0) p[1] = 14;
      if (p[1] > 14) p[1] = 0.2;
      if (p[2] > 8) p[2] = -45;
      if (p[0] > 16) p[0] = -16;
    }
    s.bolt = Math.max(0, s.bolt - dt);
    if (w == 1 && s.wk > 0.5 && random.random() < 0.15 * dt) s.bolt = 0.18;
  }

  drone_down(dr) {
    const s = this;
    dr.dead = true;
    s.kills += 1;
    s.chain += 1;
    s.score += 75 * s.mult;
    const x = s.rx(dr.x, dr.z);
    s.burst(x, dr.y, dr.z, [0.5, 0.85, 1.0], 20);
    s.burst(x, dr.y, dr.z, [1.0, 0.6, 0.1], 14);
    s.pop(x, dr.y + 0.9, dr.z, `+${75 * s.mult}`, [0.6, 0.9, 1.0]);
    Snd.play('boom');
  }

  pause() {
    if (this.state == 'play' || this.state == 'paused') this.state = this.state == 'play' ? 'paused' : 'play';
  }

  // ---- spawning
  spawn_row() {
    const s = this, d = s.dd;
    const z = -100.0;
    const lanes = [...Array(LANES).keys()];
    random.shuffle(lanes);
    for (const i of lanes.slice(0, random.choice(d.nobs))) {
      s.obs.push({ x: (i - 2) * LW, z: z, k: random.choice(['barrier', 'beam', 'crate']) });
    }
    const free = lanes.slice(3).length ? lanes.slice(3) : lanes.slice(-1);
    if (random.random() < RIVAL_P[s.di] && s.rivals.length < 4) {   // a rival athlete, in an open lane
      s.rivals.push({ x: (random.choice(free) - 2) * LW, y: 0.0, vy: 0.0, sl: 0.0, fear: 0.0, z: z - 5,
                      ph: random.uniform(0, 6.28), c: random.randrange(RIVAL_COLS.length) });
    }
    const cx = (random.choice(free) - 2) * LW;
    const nc = random.randint(3, 6);
    for (let n = 0; n < nc; n++) s.cns.push([cx, z - n * 2.2]);
    const r = random.random();
    if (r < d.clone_p && s.clones.length < d.clone_max) {
      s.clones.push({ x: (random.randrange(LANES) - 2) * LW, z: z - 6, cd: random.uniform(0.5, 1.5) });
    } else if (r > 1 - d.item_p) {
      s.items.push({ x: (random.randrange(LANES) - 2) * LW, z: z - 10,
                     k: random.choice(['shield', 'rapid', 'heal', 'rocket']) });
    }
    if (s.time > d.drone_t && s.drones.length < d.drone_max &&
        random.random() < Math.min(d.drone_cap, d.drone_p + s.time * 0.003)) {
      s.drones.push({ x: (random.randrange(LANES) - 2) * LW, y: 3.2, z: z - 12,
                      cd: random.uniform(0.8, 1.6), ph: random.uniform(0, 6.28), rot: 0.0 });
    }
  }

  // ---- per-frame update
  update(dt) {
    const s = this;
    s.t += dt;
    if (s.state != 'paused') {
      s.clock += dt;
      s.weather_tick(dt);
    }
    if (s.state == 'menu') {
      s.D += 5 * dt;
      s.phase += 4 * dt;
      s.update_road(dt);
      return;
    }
    if (s.state != 'play') return;
    const d = s.dd, rx = (x, z) => s.rx(x, z);
    s.time += dt;
    s.tap_t = Math.max(0, s.tap_t - dt);
    s.scare = Math.max(0, s.scare - dt);
    s.aim_t = Math.max(0, s.aim_t - dt);
    s.muzzle = Math.max(0, s.muzzle - dt);
    s.chant_t -= dt;
    if (s.chant_t <= 0) {                                        // now and then the crowd chants his name
      s.chant_t = random.uniform(26, 40);
      Bus.emit('chant');
    }
    s.maxmult = Math.max(s.maxmult, s.mult);
    s.target = Math.max(s.vmin, Math.min(d.vmax, s.target));
    // stamina: running above cruising pace costs breath; at empty he is spent for a few seconds
    const push = (s.target - s.vmin) / Math.max(1, d.vmax - s.vmin);
    if (s.tired > 0) {
      s.tired -= dt;
      s.target = s.vmin;
      if (s.tired <= 0) s.stam = 40.0;
    } else if (push > 0.05 && s.boost <= 0) {
      s.stam -= (6 + 22 * push) * dt;
      if (s.stam <= 0) {
        s.stam = 0.0; s.tired = 3.2;
        Snd.play('pant');
        Bus.emit('say', 'tired');
      }
    } else {
      s.stam = Math.min(100.0, s.stam + 10 * dt);
    }
    s.speed += (s.target - s.speed) * Math.min(1, 3 * dt);
    const sp = s.speed * (s.boost > 0 ? 1.5 : 1.0) * (s.tired > 0 ? 0.85 : 1.0);            // rocket boots
    s.D += sp * dt;
    s.update_road(dt);
    s.phase += sp * dt * 0.7;
    const grip = [12, 8, 9, 12][s.weather] * (s.mods.grip || 1);
    const vx = ((s.lane - 2) * LW - s.px) * grip;               // sideways speed of this lane change
    s.px += vx * Math.min(1 / grip, dt);
    // the runner turns into a lane change instead of sliding sideways: heading = sideways / forward speed
    s.lean += (Math.max(-0.4, Math.min(0.4, vx / Math.max(sp, 10))) - s.lean) * Math.min(1, 12 * dt);
    if (s.py > 0 || s.vy > 0) {
      s.vy -= 24 * dt;
      s.py = Math.max(0.0, s.py + s.vy * dt);
      if (s.py == 0.0) s.vy = 0.0;
    }
    if (s.slide > 0 && s.py == 0.0 && random.random() < 0.7) {   // sliding kicks up dust behind the heels
      s.parts.push([s.px + random.uniform(-0.45, 0.45), 0.08, random.uniform(-0.6, 0.5), random.uniform(-1.2, 1.2),
                    random.uniform(0.6, 2.2), -sp * 0.75, random.uniform(0.25, 0.5), [0.78, 0.74, 0.68]]);
    }
    s.slide = Math.max(0, s.slide - dt);
    s.invuln = Math.max(0, s.invuln - dt);
    s.rapid = Math.max(0, s.rapid - dt);
    s.cheer = Math.max(0, s.cheer - dt);
    if (s.boost > 0) {                                           // rocket boots: faster, and nothing can stop you
      s.boost = Math.max(0, s.boost - dt);
      s.invuln = Math.max(s.invuln, 0.2);
      for (const sd of [-0.15, 0.15]) {
        s.flames.push([s.px + sd, s.py + 0.15, 0.35, random.uniform(-0.5, 0.5), random.uniform(-0.6, 0.2), 7, 0.3, 0.3]);
      }
    }
    s.talk -= dt;
    if (s.talk <= 0) {                                           // now and then the Supreme Leader shares a thought
      s.talk = random.uniform(13, 20);
      Bus.emit('say', 'run');
    }
    s.shake = Math.max(0, s.shake - dt * 1.5);
    s.flash = Math.max(0, s.flash - dt);
    s.fire_cd -= dt;
    s.hm_cd = Math.max(0, s.hm_cd - dt);
    const acts = s.kills + s.rk + 2 * s.medals;                  // the Beard of Doom charges on kills, disqualifications and medals
    if (s.up.beard) s.doom = Math.min(1, s.doom + (acts - s.doom_seen) / (14 - 3 * s.up.beard) + dt / 90);
    s.doom_seen = acts;
    if (s.D >= s.next_spawn) {
      s.spawn_row();
      s.next_spawn = s.D + Math.max(d.gapmin, d.gap0 - s.time * d.gaps);
    }

    const top = s.py + (s.slide > 0 ? 0.9 : 1.9);

    // flamethrower: streams toward the mouse aim
    if (s.heat && s.fuel > 25) s.heat = false;
    if (s.fire_on && !s.heat) {
      s.scare = Math.max(s.scare, 0.6); s.aim_t = 0.3;
      s.fuel -= 38 * dt;
      if (s.fuel <= 0) { s.fuel = 0.0; s.heat = true; }
      const [hx, hy, hz] = s.hand;
      const a = s.aim;
      for (let q = 0; q < 7; q++) {
        const L = random.uniform(0.4, 0.7), v = random.uniform(18, 27);
        s.flames.push([hx, hy, hz, a[0] * v + random.uniform(-1.6, 1.6),
                       a[1] * v + random.uniform(-1.0, 1.2), a[2] * v + random.uniform(-1.6, 1.6), L, L]);
      }
      for (const o of s.obs) {
        const cy = { crate: 0.9, barrier: 0.45, beam: 1.5 }[o.k];
        const ox = rx(o.x, o.z);
        if (!o.dead && s.in_cone(ox, cy, o.z)) {
          o.burn = (o.burn || 0) + dt;
          s.flames.push([ox + random.uniform(-0.7, 0.7), 0.8, o.z, 0, 2.5, 0, 0.4, 0.4]);
          if (o.burn > { crate: 0.35, barrier: 0.5, beam: 0.7 }[o.k]) {
            o.dead = true;
            s.score += 15 * s.mult;
            s.burst(ox, 1, o.z, [1, 0.5, 0.1], 18);
            if (o.k == 'crate') s.pop(ox, 2.4, o.z, s.verdict(), [0.75, 0.88, 1]);
          }
        }
      }
      for (const c of s.clones) {
        const cx_ = rx(c.x, c.z);
        if (!c.dead && s.in_cone(cx_, 1.1, c.z)) {
          c.burn = (c.burn || 0) + dt;
          s.flames.push([cx_ + random.uniform(-0.4, 0.4), 1.2, c.z, 0, 2.5, 0, 0.4, 0.4]);
          if (c.burn > 0.5) {
            c.dead = true;
            s.kills += 1;
            s.chain += 1;
            s.score += 50 * s.mult;
            s.burst(cx_, 1.2, c.z, [1, 0.4, 0.1], 26);
            s.pop(cx_, 2.6, c.z, `+${50 * s.mult}`, [1, 0.7, 0.3]);
            sfx(600, 50);
            Bus.emit('say', 'demo');
          }
        }
      }
      for (const r of s.rivals) {
        const rx_ = rx(r.x, r.z);
        if (!r.dead && s.in_cone(rx_, r.y + 1.1, r.z)) {
          r.burn = (r.burn || 0) + dt;
          s.flames.push([rx_ + random.uniform(-0.4, 0.4), r.y + 1.2, r.z, 0, 2.5, 0, 0.4, 0.4]);
          if (r.burn > 0.35) s.rival_out(r, [1, 0.4, 0.1]);
        }
      }
      for (const dr of s.drones) {
        const dx_ = rx(dr.x, dr.z);
        if (!dr.dead && s.in_cone(dx_, dr.y, dr.z)) {
          dr.burn = (dr.burn || 0) + dt;
          s.flames.push([dx_ + random.uniform(-0.4, 0.4), dr.y, dr.z, 0, 2.0, 0, 0.35, 0.35]);
          if (dr.burn > 0.4) s.drone_down(dr);
        }
      }
    } else {
      s.fuel = Math.min(100.0, s.fuel + 14 * dt);
    }

    // player bullets (aimed at the mouse; 3 sub-steps so fast bullets cannot tunnel)
    for (const b of s.pb) {
      for (let q = 0; q < 3; q++) {
        b.x += b.dx * dt / 3;
        b.y += b.dy * dt / 3;
        b.z += b.dz * dt / 3;
        for (const o of s.obs) {
          if (o.k == 'crate' && !o.dead &&
              (rx(o.x, o.z) - b.x) ** 2 + (0.9 - b.y) ** 2 + (o.z - b.z) ** 2 < 1.3) {
            o.dead = b.dead = true;
            s.score += 20 * s.mult;
            s.pop(rx(o.x, o.z), 2.4, o.z, s.verdict(), [0.75, 0.88, 1]);
            s.burst(rx(o.x, o.z), 1, o.z, [0.7, 0.45, 0.2], 18);
          }
        }
        for (const c of s.clones) {
          if (!c.dead &&
              (rx(c.x, c.z) - b.x) ** 2 + (1.1 - b.y) ** 2 + (c.z - b.z) ** 2 < 1.0) {
            c.dead = b.dead = true;
            s.kills += 1;
            s.chain += 1;
            s.score += 50 * s.mult;
            s.burst(rx(c.x, c.z), 1.2, c.z, [0.9, 0.1, 0.1], 24);
            s.pop(rx(c.x, c.z), 2.6, c.z, `+${50 * s.mult}`, [1, 0.7, 0.3]);
            sfx(700, 60);
            Bus.emit('say', 'demo');
          }
        }
        for (const r of s.rivals) {
          if (!r.dead &&
              (rx(r.x, r.z) - b.x) ** 2 + (r.y + 1.1 - b.y) ** 2 + (r.z - b.z) ** 2 < 1.0) {
            b.dead = true;
            s.rival_out(r, RIVAL_COLS[r.c][0]);
          }
        }
        for (const dr of s.drones) {
          if (!dr.dead &&
              (rx(dr.x, dr.z) - b.x) ** 2 + (dr.y - b.y) ** 2 + (dr.z - b.z) ** 2 < 1.1) {
            b.dead = true;
            s.drone_down(dr);
          }
        }
        if (b.dead) break;
      }
      if (b.z < -110 || b.y < 0 || b.y > 40 || Math.abs(b.x) > 60) b.dead = true;
    }

    // missiles from Nadal's lab
    for (const m of s.ms) {
      m.t += dt;
      if (m.k == 'doom') {                                       // dives in from behind the stadium onto the track ahead
        if (m.x0 === undefined) { m.x0 = m.x; m.y0 = m.y; m.z0 = m.z; }
        const T = 1.5, k = Math.min(1, m.t / T) ** 1.7, tx = s.off(-30);
        m.vx = tx - m.x0; m.vy = -m.y0; m.vz = -30 - m.z0;
        m.x = m.x0 + m.vx * k; m.y = m.y0 + m.vy * k; m.z = m.z0 + m.vz * k;
        for (let q = 0; q < 3; q++) {
          s.flames.push([m.x, m.y + 2, m.z + 2.5, random.uniform(-2, 2), random.uniform(2, 6), random.uniform(2, 8), 0.5, 0.5]);
        }
        s.parts.push([m.x, m.y + 2.5, m.z + 3, random.uniform(-1, 1), random.uniform(1, 3), 4, 0.8, [0.8, 0.8, 0.82]]);
        if (m.t >= T) { m.dead = true; s.blast(tx, 0.5, -30, 70, true); }
        continue;
      }
      if (m.to && m.to.o.dead) m.to = s.threat();                // someone else got it first: lock onto the next one
      const to = m.to;
      const tx = to ? s.rx(to.o.x, to.o.z) : m.x, ty = to ? to.h : 1.2, tz = to ? to.o.z : m.z - 30;
      const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z, dist = Math.hypot(dx, dy, dz) || 1;
      const v = Math.min(60, 30 + 60 * m.t), turn = Math.min(1, 12 * dt);
      m.vx += (dx / dist * v - m.vx) * turn; m.vy += (dy / dist * v - m.vy) * turn; m.vz += (dz / dist * v - m.vz) * turn;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      s.flames.push([m.x, m.y, m.z + 0.5, random.uniform(-0.6, 0.6), random.uniform(-0.3, 0.6), 6, 0.22, 0.22]);
      s.parts.push([m.x, m.y, m.z + 0.6, random.uniform(-0.5, 0.5), random.uniform(0.2, 1.2), 4, random.uniform(0.3, 0.6), [0.82, 0.82, 0.84]]);
      if (to && dist < 1.4) { m.dead = true; s.strike(to); }
      else if (m.t > 2.5 || m.y < 0.1 || (!to && m.z < -42)) {   // nothing left to hit: it fizzles harmlessly
        m.dead = true;
        s.booms.push({ x: m.x, y: Math.max(0.6, m.y), z: m.z, r: 1.6, t: 0.3, T: 0.3 });
      }
    }

    // obstacles
    for (const o of s.obs) {
      o.z += sp * dt;
      if (Math.abs(o.z) < 1.0 && Math.abs(o.x - s.px) < 1.0 && !o.dead) {
        const k = o.k;
        const hit = (k == 'barrier' && s.py < 0.9) || (k == 'crate' && s.py < 1.8) ||
                    (k == 'beam' && top > 1.1 && s.py < 2.2);
        if (hit) {
          o.dead = true;
          s.hurt(20);
          s.burst(o.x, 1, o.z, [0.9, 0.5, 0.1], 14);
        }
      }
      if (o.z > 6) o.dead = true;
    }

    // coins & items
    const mg = s.up.magnet || 0;
    for (const c of s.cns) {
      c[1] += sp * dt;
      if (mg && c[1] > -(3 + 4 * mg) && c[1] < 2 && Math.abs(c[0] - s.px) < 0.4 + 2.2 * mg) {   // Nadal's magnet reels it in
        c[0] += (s.px - c[0]) * Math.min(1, 7 * dt);
        if (c[1] < 0) c[1] = Math.min(0, c[1] + 9 * dt);
        if (random.random() < 0.3) s.parts.push([s.rx(c[0], c[1]), 1.0, c[1], 0, 1.6, 0, 0.25, GOLD]);
      }
      if (Math.abs(c[1]) < 1.0 && Math.abs(c[0] - s.px) < 1.0 && (s.py < 2.2 || mg)) {
        c.push(1);
        s.coins += s.mods.coin || 1;
        s.chain += 1;
        s.score += 10 * s.mult;
        s.burst(c[0], 1, c[1], GOLD, 6);
        Snd.play('coin');
      }
    }
    for (const it of s.items) {
      it.z += sp * dt;
      if (Math.abs(it.z) < 1.2 && Math.abs(it.x - s.px) < 1.2) {
        it.dead = true;
        if (it.k == 'shield') s.shield = true;
        else if (it.k == 'rapid') s.rapid = 8 + 2.5 * (s.up.mag || 0);
        else if (it.k == 'rocket') s.boost = 4.5 + 1.5 * (s.up.rocket || 0);
        else { s.health = Math.min(s.hpmax, s.health + d.heal); s.stam = 100.0; }
        s.burst(it.x, 1, it.z, [1, 1, 1], 20);
        s.pop(it.x, 2.4, it.z, { shield: 'VIP PASS', rapid: 'RAPID FIRE', rocket: 'ROCKET BOOTS', heal: `+${d.heal} HP` }[it.k], [1, 1, 1]);
        Bus.emit('say', 'power');
        Snd.play('power');
      }
      if (it.z > 6) it.dead = true;
    }

    // clone guards
    for (const c of s.clones) {
      c.z += (sp + 4.0) * dt;                     // walking up the track toward you
      if (c.z > -30) c.x += Math.max(-1, Math.min(1, s.px - c.x)) * 1.6 * dt;
      c.cd -= dt;
      if (-60 < c.z && c.z < -8 && c.cd <= 0) {
        s.cb.push({ x: c.x, z: c.z + 1 });
        c.cd = random.uniform(1.6, 2.6) * d.ecd;
      }
      if (Math.abs(c.z) < 1.2 && Math.abs(c.x - s.px) < 1.2 && !c.dead) {
        c.dead = true;
        s.hurt(30);
      }
      if (c.z > 6) c.dead = true;
    }
    for (const b of s.cb) {
      if ('vx' in b) {                            // drone shot: flies straight at where you were
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const cy = s.py + (s.slide > 0 ? 0.45 : 0.95);
        if ((b.x - s.px) ** 2 + (b.y - cy) ** 2 + b.z ** 2 < 0.8) {
          b.dead = true;
          s.hurt(12);
        }
        if (b.z > 8 || b.y < 0) b.dead = true;
        continue;
      }
      b.z += (sp + 22) * dt;
      if (Math.abs(b.z) < 0.8 && Math.abs(b.x - s.px) < 0.8 && top > 0.95 && s.py < 1.45) {
        b.dead = true;
        s.hurt(15);
      }
      if (b.z > 8) b.dead = true;
    }

    // flying drones: hover high, strafe toward you, shoot, then dive (slide under or shoot them)
    for (const dr of s.drones) {
      dr.z += sp * 0.5 * dt;
      dr.x += Math.max(-1, Math.min(1, s.px - dr.x)) * 2.2 * dt;
      dr.rot += 900 * dt;
      dr.cd -= dt;
      if (dr.z > -22) dr.y += (1.45 - dr.y) * Math.min(1, 1.2 * dt);
      else dr.y = 3.2 + 0.25 * Math.sin(s.t * 3 + dr.ph);
      if (-55 < dr.z && dr.z < -10 && dr.cd <= 0) {
        const wx_ = rx(dr.x, dr.z);
        const tx = s.px - wx_, ty = s.py + 0.9 - dr.y, tz = -dr.z;
        const n = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1.0;
        s.cb.push({ x: wx_, y: dr.y, z: dr.z, vx: tx / n * 26, vy: ty / n * 26, vz: tz / n * 26 });
        dr.cd = random.uniform(1.4, 2.2) * d.ecd;
      }
      if (Math.abs(dr.z) < 1.2 && Math.abs(dr.x - s.px) < 1.1 && !dr.dead &&
          s.py - 0.3 < dr.y && dr.y < top + 0.3) {
        s.drone_down(dr);
        s.score = Math.max(0.0, s.score - 75 * s.mult);  // crashing into you gives no points
        s.kills -= 1;
        s.hurt(25);
      }
      if (dr.z > 6) dr.dead = true;
    }

    // rival athletes: slower runners ahead of you. Shoot them ("disqualified") or go around.
    // They hop barriers and duck beams, but crates are too much for them. When Aladdin fires,
    // every rival in earshot stops dead with their hands up until the shooting is over.
    for (const r of s.rivals) {
      const afraid = s.scare > 0 && r.z > -55 ? 1.0 : 0.0;
      r.fear += (afraid - r.fear) * Math.min(1, 9 * dt);
      r.z += sp * (0.7 + 0.3 * r.fear) * dt;      // 1.0 x your speed = standing still on the road
      r.ph += sp * 0.5 * (1 - r.fear) * dt;
      r.sl = Math.max(0, r.sl - dt);
      if (r.y > 0 || r.vy > 0) {
        r.vy -= 24 * dt;
        r.y = Math.max(0.0, r.y + r.vy * dt);
        if (r.y == 0.0) r.vy = 0.0;
      }
      for (const o of s.obs) {
        const gap = r.z - o.z;                    // obstacles close in on a rival from the far side
        if (o.dead || r.dead || Math.abs(o.x - r.x) > 1.0 || gap < -1.0 || gap > 4.0) continue;
        if (o.k == 'barrier') { if (r.y == 0.0 && gap < 3.0) r.vy = 8.0; }
        else if (o.k == 'beam') r.sl = 0.3;
        else if (gap < 1.0) {
          r.dead = true;
          s.burst(rx(r.x, r.z), 1, r.z, [0.9, 0.9, 0.9], 12);
        }
      }
      if (Math.abs(r.z) < 1.0 && Math.abs(r.x - s.px) < 0.9 && !r.dead &&
          s.py < r.y + 1.6 && r.y < top) {
        r.dead = true;
        s.hurt(12);
      }
      if (r.z > 1.5 && !r.passed && !r.dead) {                   // left behind
        r.passed = true;
        Bus.emit('say', 'pass');
      }
      if (r.z > 6) r.dead = true;
    }

    // finish tapes: guards carry the finish line out to you, so you always win
    if (s.D >= s.next_tape) {
      s.tapes.push({ z: -100.0 });
      s.next_tape = s.D + TAPE_GAP;
    }
    for (const tp of s.tapes) {
      tp.z += sp * dt;                                         // the officials stand still at the line
      if (tp.z >= 0 && !tp.won) {
        tp.won = true;
        s.medals += 1;
        s.chain += 1;
        s.score += 100 * s.mult;
        s.health = Math.min(s.hpmax, s.health + 5);
        for (const c of [GOLD, [1, 1, 1], [1, 0.3, 0.3], [0.3, 0.8, 1]]) {
          s.burst(s.px + random.uniform(-3, 3), 2.2, -1.5, c, 10);
        }
        s.cheer = 1.8;                                            // fists up, crowd on its feet
        Snd.play('medal');
        Snd.play('cheer');
        buzz([30, 40, 60]);
        Bus.emit('medal', s.medals);
      }
      if (tp.z > 8) tp.dead = true;
    }

    for (const p of s.pops) {
      p.z += sp * 0.35 * dt;
      p.y += 1.4 * dt;
      p.t -= dt;
    }
    s.pops = s.pops.filter(p => p.t > 0);

    // particles
    for (const p of s.parts) {
      p[0] += p[3] * dt;
      p[1] = Math.max(0, p[1] + p[4] * dt);
      p[2] += (p[5] + sp) * dt;
      p[4] -= 9 * dt;
      p[6] -= dt;
    }
    for (const f of s.flames) {
      f[0] += f[3] * dt; f[1] += f[4] * dt; f[2] += f[5] * dt; f[6] -= dt;
    }
    s.flames = s.flames.filter(f => f[6] > 0);
    for (const name of ['obs', 'items', 'clones', 'drones', 'rivals', 'tapes', 'pb', 'cb', 'ms']) {
      s[name] = s[name].filter(e => !e.dead);
    }
    s.cns = s.cns.filter(c => c.length == 2 && c[1] < 6);
    s.parts = s.parts.filter(p => p[6] > 0);
    for (const b of s.booms) b.t -= dt;
    s.booms = s.booms.filter(b => b.t > 0);
  }
}

const g = new Game();


// ------------------------------------------------------------ drawing helpers
function box(x, y, z, sx, sy, sz, c, glow = false) {
  glColor3f(...c);
  if (glow) glDisable(GL_LIGHTING);
  glPushMatrix();
  glTranslatef(x, y, z);
  glScalef(sx, sy, sz);
  glutSolidCube(1);
  glPopMatrix();
  if (glow) glEnable(GL_LIGHTING);
}


function ball(x, y, z, r, c, sx = 1, sy = 1, sz = 1, glow = false) {
  glColor3f(...c);
  if (glow) glDisable(GL_LIGHTING);
  glPushMatrix();
  glTranslatef(x, y, z);
  glScalef(sx, sy, sz);
  glutSolidSphere(r, Q.sl, Q.sk);
  glPopMatrix();
  if (glow) glEnable(GL_LIGHTING);
}


// Soft additive glows (lamps, shots, pick-ups). Queued in world space during the frame and
// drawn by draw_glows() as one batch, so twenty glows cost one draw call.
const GLOWS = [];
function glow(x, y, z, r, c, a) {
  if (Q.glow && a > 0.02) GLOWS.push(x, y, z, r, c[0], c[1], c[2], a);
}


function draw_glows() {
  if (!GLOWS.length) return;
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE); glDepthMask(GL_FALSE);
  glBegin(GL_TRIANGLES);
  for (let i = 0; i < GLOWS.length; i += 8) {
    const x = GLOWS[i], y = GLOWS[i + 1], z = GLOWS[i + 2], r = GLOWS[i + 3];
    const cr = GLOWS[i + 4], cg = GLOWS[i + 5], cb = GLOWS[i + 6], a = GLOWS[i + 7];
    for (let k = 0; k < 10; k++) {
      const a0 = k * Math.PI / 5, a1 = (k + 1) * Math.PI / 5;
      glColor4f(cr, cg, cb, a); glVertex3f(x, y, z);
      glColor4f(cr, cg, cb, 0);
      glVertex3f(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z);
      glVertex3f(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z);
    }
  }
  glEnd();
  glDepthMask(GL_TRUE); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDisable(GL_BLEND);
  GLOWS.length = 0;
}


function quad(x0, x1, z0, z1, y, c) {
  glColor3f(...c);
  glNormal3f(0, 1, 0);
  glBegin(GL_QUADS);
  glVertex3f(x0, y, z0); glVertex3f(x1, y, z0); glVertex3f(x1, y, z1); glVertex3f(x0, y, z1);
  glEnd();
}


function shadow(x, z, r, a = 0.35) {             // soft contact shadow
  glDisable(GL_LIGHTING); glEnable(GL_BLEND); glDepthMask(GL_FALSE);
  glBegin(GL_TRIANGLE_FAN);
  glColor4f(0, 0, 0, a); glVertex3f(x, 0.03, z);
  glColor4f(0, 0, 0, 0);
  for (let k = 0; k < 13; k++) {
    const an = k * Math.PI / 6;
    glVertex3f(x + Math.cos(an) * r, 0.03, z + Math.sin(an) * r * 1.3);
  }
  glEnd();
  glDepthMask(GL_TRUE); glDisable(GL_BLEND); glEnable(GL_LIGHTING);
}


function halo(x, y, z, r, c, a) {                // additive glow billboard
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE); glDepthMask(GL_FALSE);
  glBegin(GL_TRIANGLE_FAN);
  glColor4f(...c, a); glVertex3f(x, y, z);
  glColor4f(...c, 0);
  for (let k = 0; k < 25; k++) {
    const an = k * Math.PI / 12;
    glVertex3f(x + Math.cos(an) * r, y + Math.sin(an) * r, z);
  }
  glEnd();
  glDepthMask(GL_TRUE); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDisable(GL_BLEND);
}


// ---- characters
// Humans (Aladdin and the rival athletes) are built from tapered limbs and ellipsoids with knee
// and elbow joints, and are posed by blending four poses: running, airborne, hands-up and sliding.
// Robots (clone guards, tape carriers) are boxes on purpose: stiff, metallic, one glowing visor.
const SKIN = [0.80, 0.56, 0.38], SHOE = [0.13, 0.13, 0.16];
const mix = (a, b, k) => a + (b - a) * k;


function limb(len, r0, r1, c) {                                  // tapered segment hanging down from the origin
  glColor3f(...c);
  glutSolidLimb(r0, r1, len, Q.sl > 12 ? 10 : 7);
}


function human(ph, o, pose) {
  // o: { vest, pants, hair, skin }   pose: { slide, air, fear } each 0..1, optional bib
  // Angles are degrees about x: positive swings a hanging limb forward (the figure faces -z).
  const sl = pose.slide || 0, air = (pose.air || 0) * (1 - sl), fear = (pose.fear || 0) * (1 - sl);
  const run = 1 - fear;
  const skin = o.skin || SKIN;
  const bob = Math.abs(Math.cos(ph)) * 0.05 * run * (1 - air) * (1 - sl);
  glPushMatrix();
  glTranslatef(0, mix(0.98 + bob, 0.30, sl), 0);

  for (const side of [-1, 1]) {
    const a = ph + (side > 0 ? 0 : Math.PI);                     // the two sides are half a stride apart
    const lead = side > 0;
    // legs: thigh swing, knee folds while the leg comes forward
    let th = 42 * Math.sin(a) * run, kn = -(16 + 58 * Math.max(0, Math.cos(a))) * run - 6 * fear;
    th = mix(th, lead ? 58 : -18, air); kn = mix(kn, lead ? -85 : -60, air);          // hurdle tuck
    th = mix(th, lead ? 84 : 120, sl); kn = mix(kn, lead ? -8 : -112, sl);            // one leg out, one knee up
    glPushMatrix();
    glTranslatef(side * 0.13, 0, 0);
    glRotatef(th, 1, 0, 0);
    limb(0.48, 0.115, 0.085, o.pants);
    glTranslatef(0, -0.48, 0);
    ball(0, 0, 0, 0.085, o.pants);
    glRotatef(kn, 1, 0, 0);
    limb(0.46, 0.08, 0.055, o.pants);
    box(0, -0.5, -0.07, 0.13, 0.09, 0.29, SHOE);
    glPopMatrix();
  }

  // upper body leans from the hips: into the run, back into the slide
  glRotatef(mix(mix(mix(-9, -4, air), 3, fear), 52, sl), 1, 0, 0);
  ball(0, 0.03, 0, 0.2, o.pants, 1, 0.72, 0.78);                 // hips
  ball(0, 0.16, 0, 0.19, GOLD, 1.02, 0.3, 0.8);                  // sash
  ball(0, 0.37, 0, 0.215, o.vest, 1.08, 1.3, 0.74);              // chest
  if (pose.bib) box(0, 0.4, 0.165, 0.26, 0.24, 0.02, [1, 1, 1]);

  for (const side of [-1, 1]) {
    const a = ph + (side > 0 ? Math.PI : 0);                     // arms swing against the legs
    const lead = side > 0;
    let ar = 40 * Math.sin(a) * run, el = (72 + 14 * Math.sin(a)) * run;
    ar = mix(ar, lead ? -35 : 140, air); el = mix(el, 35, air);
    ar = mix(ar, 168, fear); el = mix(el, 22, fear);                                  // hands up
    ar = mix(ar, lead ? 46 : -88, sl); el = mix(el, lead ? 35 : 6, sl);               // one hand to the ground
    glPushMatrix();
    glTranslatef(side * 0.27, 0.56, 0);
    glRotatef(side * mix(7, 16, fear), 0, 0, 1);
    glRotatef(ar, 1, 0, 0);
    ball(0, 0, 0, 0.095, o.vest);
    limb(0.3, 0.075, 0.06, o.vest);
    glTranslatef(0, -0.3, 0);
    ball(0, 0, 0, 0.06, skin);
    glRotatef(el, 1, 0, 0);
    limb(0.27, 0.058, 0.045, skin);
    ball(0, -0.31, 0, 0.062, skin);
    glPopMatrix();
  }

  glTranslatef(0, 0.64, 0);
  glRotatef(mix(4, -34, sl), 1, 0, 0);                           // the head stays up while the body lies back
  limb(0.12, 0.065, 0.07, skin);                                 // neck (drawn downward from the head)
  ball(0, 0.2, 0, 0.165, skin, 0.95, 1.14, 1.02);
  ball(0, 0.26, 0.035, 0.17, o.hair, 1.0, 0.92, 1.04);
  ball(0, 0.17, -0.165, 0.035, skin);                            // nose
  for (const sd of [-1, 1]) ball(sd * 0.062, 0.225, -0.148, 0.024, [0.1, 0.07, 0.06]);   // eyes
  for (const sd of [-1, 1]) ball(sd * 0.158, 0.2, 0.0, 0.04, skin, 0.5, 1, 0.8);     // ears
  glPopMatrix();
}


function robot(ph, acc, gun) {
  const sw = Math.sin(ph) * 30;
  const steel = [0.36, 0.38, 0.44], dark = [0.13, 0.14, 0.18];
  for (const side of [-1, 1]) {
    glPushMatrix(); glTranslatef(side * 0.2, 0.94, 0); glRotatef(side * sw, 1, 0, 0);
    box(0, -0.22, 0, 0.2, 0.46, 0.22, steel);
    ball(0, -0.47, 0, 0.1, dark);
    box(0, -0.68, 0, 0.16, 0.4, 0.18, dark);
    box(0, -0.9, -0.06, 0.22, 0.08, 0.36, steel);
    glPopMatrix();
    glPushMatrix(); glTranslatef(side * 0.53, 1.6, 0); glRotatef(-side * sw * 0.7, 1, 0, 0);
    ball(0, 0, 0, 0.15, dark);
    box(0, -0.3, 0, 0.15, 0.48, 0.15, steel);
    box(0, -0.62, 0, 0.19, 0.2, 0.19, dark);
    glPopMatrix();
  }
  box(0, 1.0, 0, 0.46, 0.2, 0.28, dark);                         // waist
  box(0, 1.36, 0, 0.8, 0.62, 0.42, steel);                       // chest plate
  box(0, 1.42, -0.22, 0.34, 0.1, 0.02, acc, true);               // chest light
  box(0, 1.72, 0, 0.16, 0.12, 0.16, dark);                       // neck
  box(0, 1.95, 0, 0.44, 0.36, 0.4, dark);                        // head
  box(0, 1.97, -0.205, 0.36, 0.09, 0.02, acc, true);             // visor
  box(0.15, 2.24, 0, 0.03, 0.24, 0.03, steel);                   // antenna
  ball(0.15, 2.38, 0, 0.05, acc, 1, 1, 1, true);
  if (gun) {                                                     // the forces of Democracy: arm cannon and a placard
    box(0.53, 1.02, -0.4, 0.13, 0.15, 0.75, dark);
    box(-0.62, 2.0, -0.05, 0.05, 1.5, 0.05, [0.5, 0.42, 0.3]);
    glPushMatrix(); glTranslatef(-0.62, 2.95, -0.08); glRotatef(180, 0, 1, 0);
    glColor3f(1, 1, 1); glTexQuad(tex('sign' + (gun - 1) % 4), 1.0, 0.62);
    glPopMatrix();
  }
}


function draw_player() {
  if (g.view == 1 || (g.state == 'play' && g.invuln > 0 && g.boost <= 0 && Math.trunc(g.t * 20) % 2)) return;
  shadow(g.px, 0, 0.7 / (1 + g.py * 0.3), 0.4 / (1 + g.py * 0.4));
  const slide = Math.max(0, Math.min(1, g.slide * 7, (0.72 - g.slide) * 9));   // ease in and out of the slide
  glPushMatrix();
  glTranslatef(g.px, g.py, 0);
  const sk = SKINS.find(k => k.id == Store.d.skin) || SKINS[0];
  const act = Actors.player(sk.model, sk.kit), air = Math.min(1, g.py * 1.6);
  // the victory V: he runs facing -z, so his right hand is on +x. The right fist pumps up and down.
  const ch = Math.min(1, g.cheer * 2.5), pmp = 0.5 + 0.5 * Math.sin(g.t * 11);
  const reach = ch > 0 ? [[[0.42, 0.8 + 0.35 * pmp, -0.12], ch, 'Right'], [[-0.55, 0.85, -0.12], ch, 'Left']] : null;
  if (act) {                                                     // the rigged model, once it has loaded
    const pace = g.speed * (g.boost > 0 ? 1.5 : 1.0);
    act.show({ x: g.px, y: g.py, z: 0, dt: FDT, slide, air, tint: sk.tint, dir: g.state == 'play' ? g.lean : 0,
               cheer: ch, pump: ch * pmp, reach, tired: Math.min(1, g.tired * 2),
               aim: g.aim, aimK: g.state == 'play' ? Math.min(1, g.aim_t * 6) : 0,
               rate: g.state == 'menu' ? 0.6 : Math.max(0.6, Math.min(2.0, pace / 14)) });
  } else {
    human(g.phase, sk, { slide, air });
  }
  glPopMatrix();
  if (g.muzzle > 0) {                                            // muzzle flash
    const [hx, hy, hz] = g.hand;
    glow(hx, hy, hz - 0.1, 0.9, [1, 0.85, 0.4], 0.95);
  }
  if (g.shield) {
    glEnable(GL_BLEND);
    glColor4f(0.3, 0.7, 1, 0.28);
    glPushMatrix(); glTranslatef(g.px, g.py + 1, 0); glutSolidSphere(1.4, 24, 16); glPopMatrix();
    glDisable(GL_BLEND);
  }
}


function draw_drone(dr) {
  const x = dr.x + g.off(dr.z), y = dr.y, z = dr.z;
  shadow(x, z, 0.7, 0.35);
  glPushMatrix();
  glTranslatef(x, y, z);
  ball(0, 0, 0, 0.5, [0.22, 0.24, 0.3], 1, 0.6, 1);
  ball(0, 0, 0.38, 0.14, [1, 0.1, 0.1], 1, 1, 1, true);          // red eye faces the player
  box(0, -0.3, 0, 0.3, 0.12, 0.5, [0.15, 0.15, 0.18]);
  box(0, 0.28, 0, 0.08, 0.2, 0.08, [0.3, 0.3, 0.3]);
  for (const k of [0, 90]) {
    glPushMatrix(); glTranslatef(0, 0.4, 0); glRotatef(dr.rot + k, 0, 1, 0);
    box(0, 0, 0, 1.5, 0.04, 0.12, [0.7, 0.7, 0.75]); glPopMatrix();
  }
  glPopMatrix();
  glow(x, y, z + 0.5, 0.9, [1, 0.15, 0.1], 0.5);
}


// Sideways drift of the track per unit forward at depth z. Everyone on the road turns to face
// along it, so on a bend the field runs round the curve instead of pointing straight up the screen.
function tangent(z) {
  return (g.off(z - 1) - g.off(z + 1)) / 2;
}
const oncoming = z => Math.atan2(tangent(z), -1) * 180 / Math.PI;   // heading (degrees) for something coming at you


function draw_clone(c) {                                         // robot guard, facing you
  const x = c.x + g.off(c.z);
  shadow(x, c.z, 0.7, 0.35);
  glPushMatrix(); glTranslatef(x, 0, c.z); glRotatef(oncoming(c.z), 0, 1, 0);
  if (c.sg === undefined) c.sg = random.randrange(4);           // each robot carries its own slogan
  robot(g.t * 8, [1, 0.12, 0.1], 1 + c.sg);
  glPopMatrix();
  glow(x, 1.97, c.z + 0.3, 0.8, [1, 0.15, 0.1], 0.45);
}


let TAPE_ID = 0, RIGGED = 0;                                    // RIGGED: detailed rivals drawn so far this frame
const SUIT = { top: [0.1, 0.1, 0.13], bottom: [0.1, 0.1, 0.13], shoes: [0.25, 0.25, 0.28] };


function draw_rival(r) {                                         // athlete seen from behind, bib on the back
  const x = r.x + g.off(r.z), c = RIVAL_COLS[r.c];
  shadow(x, r.z, 0.7 / (1 + r.y * 0.3), 0.35 / (1 + r.y * 0.4));
  const pose = { slide: Math.min(1, r.sl * 8), air: Math.min(1, r.y * 1.6), fear: r.fear, bib: true };
  const act = RIGGED < Q.rig ? Actors.rival(r, 'man') : null;   // phones give only the nearest few the detailed model
  if (act) {
    RIGGED++;                                                     // team colours on the kit, never on the skin
    act.show({ x, y: r.y, z: r.z, dt: FDT, rate: 0.85 * (1 - r.fear), dir: tangent(r.z),
               tint: { top: c[0], bottom: c[1], shoes: [1.6, 1.6, 1.7] }, ...pose });
    return;
  }
  glPushMatrix();
  glTranslatef(x, r.y, r.z);
  glRotatef(-Math.atan(tangent(r.z)) * 180 / Math.PI, 0, 1, 0);
  human(r.ph, { vest: c[0], pants: c[1], hair: c[2], skin: c[3] }, pose);
  glPopMatrix();
}


function draw_tape(tp) {                                         // two of his officials stand at the line, holding the tape out
  const z = tp.z, o = g.off(z);
  tp.id = tp.id || ++TAPE_ID;
  const ends = [];
  for (const sd of [-1, 1]) {
    const x = o + sd * 5.3;
    shadow(x, z, 0.7, 0.35);
    const a = Q.rig ? Actors.cast('tape' + tp.id + sd, 'man', 'official') : null;
    if (a) {
      // facing the runner, so the tape is on the official's left on the left side and right on the right side
      const arm = sd < 0 ? 'Left' : 'Right';
      a.show({ x, y: 0, z, dt: FDT, rate: 1, stand: 1, yaw: Math.atan2(-tangent(z), 1), tint: SUIT,
               arm, aim: tp.won ? [sd * 0.3, -1, 0.2] : [-sd, -0.18, 0.12], aimK: 1 });
      const p = a.hand(arm);
      if (p) ends.push(p);
      continue;
    }
    glPushMatrix(); glTranslatef(x, 0, z); glRotatef(oncoming(z), 0, 1, 0);
    human(0, { vest: SUIT.top, pants: SUIT.top, hair: [0.05, 0.05, 0.05] }, {});
    glPopMatrix();
  }
  if (tp.won) return;                                            // you broke the tape
  let cx = o, cy = 1.2, w = 10.4;
  if (ends.length == 2) {                                        // stretched from one hand to the other
    cx = (ends[0].x + ends[1].x) / 2; cy = (ends[0].y + ends[1].y) / 2; w = Math.abs(ends[1].x - ends[0].x);
  }
  box(cx, cy, z, w, 0.16, 0.04, [1, 1, 1], true);
  box(cx, cy, z + 0.03, w, 0.05, 0.04, GOLD, true);
  for (const sd of [-1, 0, 1]) glow(cx + sd * w / 3, cy, z + 0.1, 1.6, GOLD, 0.3);
}


function draw_missile(m) {                                       // orange, with fins, and above all pointy
  const s = m.k == 'doom' ? 5.0 : 0.5, OR = [0.96, 0.47, 0.1], DK = [0.1, 0.27, 0.24];
  glPushMatrix(); glTranslatef(m.x, m.y, m.z);
  glRotatef(Math.atan2(-m.vx, -m.vz) * 180 / Math.PI, 0, 1, 0);
  glRotatef(Math.atan2(m.vy, Math.hypot(m.vx, m.vz)) * 180 / Math.PI, 1, 0, 0);
  glScalef(s, s, s);
  const tube = (z, r0, r1, len, c) => {                          // a cylinder along the body, from z toward the nose
    glPushMatrix(); glTranslatef(0, 0, z); glRotatef(90, 1, 0, 0); glColor3f(...c); glutSolidLimb(r0, r1, len, 12); glPopMatrix();
  };
  tube(0.9, 0.16, 0.16, 1.5, OR);                                // body
  tube(0.3, 0.168, 0.168, 0.12, DK); tube(-0.4, 0.168, 0.168, 0.1, DK);   // the two dark bands
  tube(1.08, 0.09, 0.15, 0.18, [0.12, 0.12, 0.14]);              // nozzle
  glPushMatrix(); glTranslatef(0, 0, -0.6); glRotatef(180, 0, 1, 0); glColor3f(...OR); glutSolidCone(0.16, 0.8, 12); glPopMatrix();   // the point
  for (const [fx, fy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    box(fx * 0.25, fy * 0.25, 0.72, fx ? 0.22 : 0.03, fy ? 0.22 : 0.03, 0.42, DK);
  }
  glPopMatrix();
  const n = Math.hypot(m.vx, m.vy, m.vz) || 1, back = s * 1.2;
  glow(m.x - m.vx / n * back, m.y - m.vy / n * back, m.z - m.vz / n * back, 1.6 * s + 0.6, [1, 0.6, 0.2], 0.7);
}


function draw_obstacle(o) {
  const x = o.x + g.off(o.z), z = o.z;
  if (o.k == 'barrier') {
    box(x, 0.45, z, 1.9, 0.9, 0.5, [0.95, 0.5, 0.1]);
    box(x, 0.45, z, 1.95, 0.2, 0.55, [1, 1, 1]);
  } else if (o.k == 'beam') {
    for (const sx of [-0.95, 0.95]) box(x + sx, 1.15, z, 0.2, 2.3, 0.3, [0.25, 0.15, 0.1]);
    box(x, 1.65, z, 2.1, 1.1, 0.5, [0.7, 0.2, 0.1]);
    box(x, 1.65, z, 2.15, 0.2, 0.55, GOLD);
  } else {
    box(x, 0.9, z, 1.7, 1.8, 1.2, [0.93, 0.93, 0.96]);           // a ballot box
    box(x, 1.83, z, 1.78, 0.14, 1.28, [0.12, 0.3, 0.7]);
    box(x, 1.91, z, 0.7, 0.03, 0.12, [0.03, 0.03, 0.05]);
    glPushMatrix(); glTranslatef(x, 0.95, z + 0.61); glColor3f(1, 1, 1); glTexQuad(tex('ballot'), 1.4, 0.8); glPopMatrix();
  }
}


// ---- location scenery
function lamp(side, z, c, e) {
  box(side * 5.9, 1.2, z, 0.1, 2.4, 0.1, [0.2, 0.15, 0.1]);
  ball(side * 5.9, 2.5, z, 0.22, c, 1, 1, 1, true);
  // lamps bloom after dark (and always in Neon City); the glow thins out into the fog
  glow(side * 5.9 + g.off(z), 2.5, z, 1.5, c, 0.5 * Math.max(e.night, g.loc.glow) * Math.max(0, 1 + z / e.fe));
}


function scn_desert(side, h, j, z, e) {
  const bx = side * (9 + (h >> 3) % 4), bh = 3 + (h >> 5) % 6;
  box(bx, bh / 2, z, 3, bh, 3, [0.85 - (h % 3) * 0.06, 0.7 - (h % 3) * 0.05, 0.5]);
  if (h % 2) ball(bx, bh + 0.2, z, 1.3, GOLD, 1, 0.9, 1);
  box(bx - side * 1.52, bh * 0.6, z, 0.05, 0.8, 0.6, [1, 0.85, 0.4], true);
  const px_ = side * 6.9;
  box(px_, 1.5, z + 3, 0.3, 3, 0.3, [0.4, 0.25, 0.1]);
  for (const [fx, fz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
    ball(px_ + fx, 3.1, z + 3 + fz, 0.9, [0.1, 0.5, 0.15], 1, 0.25, 1);
  }
  ball(px_, 3.3, z + 3, 0.4, [0.1, 0.45, 0.12]);
}


function scn_city(side, h, j, z, e) {
  const w = 3 + h % 3;
  const bh = 9 + (h >> 3) % 24;
  const bx = side * (9.5 + w / 2 + (h >> 6) % 4);
  const d = 0.05 + (h % 4) * 0.02;
  box(bx, bh / 2, z, w, bh, 4.5, [d, d + 0.01, d + 0.06]);
  const nc = [[0.2, 0.9, 1.0], [1.0, 0.25, 0.8], [0.7, 0.4, 1.0]][(h >> 4) % 3];
  const fx = bx - side * (w / 2 + 0.04);
  glDisable(GL_LIGHTING);                                        // neon + windows are emissive
  box(fx, bh / 2, z + 2.0, 0.12, bh, 0.12, nc);
  const lit = 0.35 + 0.65 * e.night;
  for (let r = 0; r < Math.floor(bh / 2.6); r++) {
    if ((h >> (r % 13)) & 1) {
      const wc = (r + h) % 3 ? [lit, 0.82 * lit, 0.45 * lit] : [0.45 * lit, 0.85 * lit, lit];
      box(fx, 1.6 + r * 2.6, z, 0.06, 1.1, 2.6, wc);
    }
  }
  if ((h >> 2) & 1) box(bx, bh + 0.7, z, w * 0.7, 1.2, 0.3, nc);
  glEnable(GL_LIGHTING);
}


function pine(x, z, s) {
  box(x, 0.6 * s, z, 0.4 * s, 1.2 * s, 0.4 * s, [0.3, 0.2, 0.12]);
  for (const [r, hh, y, c] of [[1.8, 2.4, 0.9, [0.10, 0.32, 0.22]], [1.4, 2.2, 2.3, [0.14, 0.38, 0.26]],
                               [1.0, 2.0, 3.6, [0.85, 0.92, 0.97]]]) {
    glColor3f(...c);
    glPushMatrix(); glTranslatef(x, y * s, z); glRotatef(-90, 1, 0, 0);
    glutSolidCone(r * s, hh * s, 10, 2);
    glPopMatrix();
  }
}


function scn_snow(side, h, j, z, e) {
  pine(side * (8 + (h >> 3) % 6), z + h % 5, 0.9 + ((h >> 4) % 5) * 0.25);
  pine(side * (13 + (h >> 5) % 7), z + 6 - h % 4, 0.9 + ((h >> 6) % 5) * 0.25);
  ball(side * (7.2 + (h >> 7) % 3), 0.25, z + 3, 1.2, [0.96, 0.98, 1.0], 1.4, 0.35, 1);
}


function tree(x, z, s, c) {
  box(x, 1.2 * s, z, 0.5 * s, 2.4 * s, 0.5 * s, [0.35, 0.24, 0.14]);
  ball(x, 3.1 * s, z, 1.6 * s, c, 1, 1.05, 1);
  ball(x, 4.3 * s, z, 1.1 * s, c.map(v => Math.min(1.0, v * 1.15)));
}


function scn_forest(side, h, j, z, e) {
  const sh = [[0.12, 0.45, 0.18], [0.18, 0.52, 0.22], [0.10, 0.38, 0.25], [0.30, 0.55, 0.15]];
  tree(side * (8 + (h >> 3) % 5), z + 1, 0.9 + ((h >> 4) % 4) * 0.18, sh[h % 4]);
  tree(side * (13 + (h >> 5) % 6), z + 5, 1.0 + ((h >> 6) % 4) * 0.18, sh[(h >> 2) % 4]);
  if (h % 3 == 0) ball(side * (6.9 + (h >> 6) % 2), 0.4, z + 4, 0.7, [0.45, 0.45, 0.48], 1.2, 0.7, 1);
  if (e.night > 0.3) {                                           // fireflies after dark
    for (let q = 0; q < 2; q++) {
      ball(side * (7 + q * 2.5) + Math.sin(g.t + h) * 0.5, 1.2 + q * 0.7 + Math.sin(g.t * 2 + h + q) * 0.3,
           z + q * 2, 0.07, [0.9, 1.0, 0.35], 1, 1, 1, true);
    }
  }
}


const CROWD = [[0.85, 0.2, 0.2], [0.95, 0.75, 0.15], [0.2, 0.5, 0.9], [0.95, 0.95, 0.95], [0.2, 0.65, 0.35], [0.6, 0.3, 0.7]];
const FACES = [[0.93, 0.76, 0.62], [0.80, 0.56, 0.38], [0.60, 0.42, 0.28], [0.42, 0.28, 0.18]];
const BOARDS = [GOLD, [0.75, 0.1, 0.1], [0.95, 0.95, 0.95], [0.1, 0.45, 0.25]];

// ---- pictures painted once onto a canvas and used as textures (placards, ballot boxes, the crowd)
const TEX = {};
function tex(name) {
  if (TEX[name]) return TEX[name];
  const [w, h, paint] = PAINT[name];
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  paint(cv.getContext('2d'), w, h);
  return (TEX[name] = new THREE.CanvasTexture(cv));
}
const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
// the stands: one row of seated spectators, a still picture (two versions, so neighbouring rows differ)
const seats = seed0 => [512, 68, (c, w, h) => {
  let seed = seed0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => rgb(a[Math.floor(rnd() * a.length)]);
  c.fillStyle = '#2c2f3c'; c.fillRect(0, 0, w, h);                // the step behind them
  for (let x = 13; x < w - 8; x += 23.2) {
    const up = Math.round(rnd() * 3), shirt = pick(CROWD), skin = pick(FACES);
    c.fillStyle = '#17603f'; c.fillRect(x - 10, 22, 20, 30);      // seat back
    c.fillStyle = shirt;
    c.fillRect(x - 8, 27 - up, 16, 22);                           // an upright torso
    c.beginPath(); c.arc(x, 28 - up, 8, 3.14, 6.29); c.fill();    // shoulders
    c.fillRect(x - 11, 27 - up, 4, 17); c.fillRect(x + 7, 27 - up, 4, 17);   // arms down to the lap
    c.fillStyle = skin;
    c.fillRect(x - 2.5, 16 - up, 5, 6);                           // neck
    c.beginPath(); c.arc(x, 12 - up, 6.5, 0, 6.3); c.fill();      // head
    c.fillRect(x - 10, 43 - up, 7, 4); c.fillRect(x + 3, 43 - up, 7, 4);     // hands on the knees
    c.fillStyle = '#1a1310'; c.beginPath(); c.arc(x, 10.5 - up, 6.7, 3.25, 6.17); c.fill();   // hair
    c.fillStyle = '#262a40';
    c.fillRect(x - 9, 47, 7.5, 8); c.fillRect(x + 1.5, 47, 7.5, 8);          // thighs, seen end-on
    c.fillRect(x - 8, 55, 6, 10); c.fillRect(x + 2, 55, 6, 10);              // shins
    if (rnd() < 0.1) {                                            // a little Wadiyan flag
      c.fillStyle = '#dddddd'; c.fillRect(x + 9, 5, 1.5, 24);
      c.fillStyle = '#128a48'; c.fillRect(x + 10.5, 5, 12, 8);
      c.fillStyle = '#f2bf26'; c.fillRect(x + 10.5, 8, 12, 2);
    }
  }
  c.fillStyle = '#62657a'; c.fillRect(0, h - 3, w, 3);            // the lip of the step
}];
// his supporters, along the road in every location: a still picture, standing behind a barrier
const fans = seed0 => [512, 160, (c, w, h) => {
  let seed = seed0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => rgb(a[Math.floor(rnd() * a.length)]);
  c.clearRect(0, 0, w, h);
  let n = 0;
  for (let x = 16; x < w - 10; x += 25 + rnd() * 5, n++) {
    const top = 52 + rnd() * 10, shirt = pick(CROWD), skin = pick(FACES), pose = n % 5 == 2 ? 3 : Math.floor(rnd() * 3);
    c.fillStyle = '#24283a'; c.fillRect(x - 7, top + 50, 6, h - top - 50); c.fillRect(x + 1, top + 50, 6, h - top - 50);   // legs
    c.fillStyle = shirt; c.fillRect(x - 9, top + 14, 18, 38);                                                               // body
    c.beginPath(); c.arc(x, top + 16, 9, 3.14, 6.29); c.fill();
    c.lineWidth = 5; c.lineCap = 'round'; c.strokeStyle = shirt;
    const arm = (sx, ex, ey) => { c.beginPath(); c.moveTo(x + sx, top + 17); c.lineTo(x + ex, top + ey); c.stroke(); };
    if (pose == 0) { arm(-8, -17, -8); arm(8, 17, -8); }          // both arms up
    else if (pose == 1) { arm(-8, -12, 44); arm(8, 13, -10); }     // one fist up
    else { arm(-8, -12, 44); arm(8, 14, 2); }                     // holding a flag or a sign
    c.fillStyle = skin;
    c.fillRect(x - 3, top + 4, 6, 8);
    c.beginPath(); c.arc(x, top, 8, 0, 6.3); c.fill();
    c.fillStyle = '#17110d'; c.beginPath(); c.arc(x, top - 2, 8.2, 3.2, 6.2); c.fill();
    if (pose == 2) {                                              // a Wadiyan flag on a pole
      c.fillStyle = '#ddd'; c.fillRect(x + 13, top - 34, 2, 40);
      c.fillStyle = '#128a48'; c.fillRect(x + 15, top - 34, 20, 13);
      c.fillStyle = '#f2bf26'; c.fillRect(x + 15, top - 29, 20, 3);
    } else if (pose == 3) {                                       // a sign held up for the Supreme Leader
      c.fillStyle = '#8a6a42'; c.fillRect(x + 12, top - 22, 3, 28);
      c.fillStyle = '#f4f1e6'; c.fillRect(x - 18, top - 50, 62, 28);
      c.strokeStyle = '#128a48'; c.lineWidth = 3; c.strokeRect(x - 18, top - 50, 62, 28);
      c.fillStyle = '#128a48'; c.font = '900 13px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(rnd() < 0.5 ? 'ALADEEN' : 'WE ♥ HIM', x + 13, top - 36);
    }
  }
}];
const PAINT = {
  ballot: [256, 144, (c, w, h) => {
    c.fillStyle = '#f4f4f8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4fb4'; c.font = '900 50px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('BALLOT', w / 2, 52);
    c.font = '700 26px Arial, sans-serif'; c.fillText('DEMOCRACY INSIDE', w / 2, 104);
  }],
  seats0: seats(7), seats1: seats(1234), fans0: fans(99), fans1: fans(4242),
  // the Supreme Leader, larger than life, on the back wall
  banner: [256, 288, (c, w, h) => {
    c.fillStyle = '#128a48'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f2bf26'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#f4f4ee'; c.beginPath(); c.ellipse(128, 262, 96, 70, 0, 3.14, 6.29); c.fill();   // uniform
    c.fillStyle = '#f2bf26'; c.fillRect(34, 196, 44, 14); c.fillRect(178, 196, 44, 14);            // epaulettes
    c.fillStyle = '#c98d5c'; c.beginPath(); c.ellipse(128, 118, 44, 54, 0, 0, 6.29); c.fill();     // face
    c.fillStyle = '#120d0a';
    c.beginPath(); c.ellipse(128, 70, 62, 44, 0, 0, 6.29); c.fill();                               // hair
    c.beginPath(); c.ellipse(128, 160, 46, 40, 0, 0, 6.29); c.fill();                              // beard
    c.fillStyle = '#c98d5c'; c.beginPath(); c.ellipse(128, 112, 40, 28, 0, 0, 6.29); c.fill();
    c.fillStyle = '#0a0a0c'; c.fillRect(88, 100, 34, 18); c.fillRect(134, 100, 34, 18); c.fillRect(120, 104, 16, 4);   // sunglasses
    c.fillStyle = '#f2bf26'; c.font = '900 30px Arial, sans-serif'; c.textAlign = 'center'; c.fillText('ALADEEN', 128, 276);
  }]
};


// placards for the forces of Democracy, one slogan each
const SIGNS = [['VOTE', '#1f4fb4'], ['DEMOCRACY', '#b4261f'], ['FREEDOM', '#1b7a3c'], ['EQUAL RIGHTS', '#6a2c91']];
SIGNS.forEach(([words, col], i) => {
  PAINT['sign' + i] = [256, 160, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.strokeStyle = col; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = words.split(' ');
    let px = lines.length > 1 ? 66 : 100;
    do { px -= 4; c.font = `900 ${px}px Arial, sans-serif`; } while (lines.some(t => c.measureText(t).width > w - 40));
    lines.forEach((t, k) => c.fillText(t, w / 2, h / 2 + 5 + (k - (lines.length - 1) / 2) * (px + 10)));
  }];
});


function scn_stadium(side, h, j, z, e) {
  // five terraces, each with one upright painted row of seated spectators: nothing in the stands moves
  for (let i = 0; i < 5; i++) {
    const x0 = 8.2 + i * 1.65, y = 1.0 + i * 1.3;
    box(side * (x0 + 16.65) / 2, y / 2, z, 16.65 - x0, y, 12, i % 2 ? [0.44, 0.46, 0.54] : [0.5, 0.52, 0.6]);
    glPushMatrix(); glTranslatef(side * (x0 + 1.0), y + 0.8, z); glRotatef(-side * 90, 0, 1, 0);
    glColor3f(1, 1, 1); glTexQuad(tex('seats' + ((i + j) & 1)), 12, 1.6);
    glPopMatrix();
  }
  box(side * 16.9, 5.5, z, 0.5, 11, 12, [0.26, 0.28, 0.36]);     // back wall, with a portrait on every other section
  if (pymod(j, 4) == 0) {
    glPushMatrix(); glTranslatef(side * 16.6, 9.2, z); glRotatef(-side * 90, 0, 1, 0);
    glColor3f(1, 1, 1); glTexQuad(tex('banner'), 3.0, 3.3);
    glPopMatrix();
  } else if (pymod(j, 4) == 2) {
    box(side * 16.6, 9.2, z, 0.1, 2.0, 7.5, [0.1, 0.45, 0.25], true);
  }
  box(side * 6.9, 0.45, z, 0.16, 0.9, 11.7, BOARDS[pymod(j + (side > 0 ? 2 : 0), 4)]);   // trackside boards
  if (pymod(j, 2)) {                                             // flags of Wadiya
    box(side * 7.6, 2.3, z + 3, 0.08, 4.6, 0.08, [0.75, 0.75, 0.78]);
    glPushMatrix(); glTranslatef(side * 7.6, 4.0, z + 3); glRotatef(Math.sin(g.t * 3 + j) * 20, 0, 1, 0);
    box(0, 0, 0.6, 0.04, 0.8, 1.2, [0.1, 0.5, 0.28]);
    box(0, 0, 0.6, 0.05, 0.28, 1.2, GOLD);
    glPopMatrix();
  }
  if (pymod(j, 4) == 0) {                                        // floodlight towers
    box(side * 17.6, 7.5, z, 0.4, 15, 0.4, [0.2, 0.2, 0.25]);
    box(side * 17.0, 15, z, 2.4, 1.3, 0.5, [1, 1, 0.88], true);
    glow(side * 17.0 + g.off(z), 15, z, 5, [1, 1, 0.85], (0.25 + 0.5 * e.night) * Math.max(0, 1 + z / e.fe));
  }
}


const SCN = { stadium: scn_stadium, desert: scn_desert, city: scn_city, snow: scn_snow, forest: scn_forest };


function draw_road() {
  const D = g.D, L = g.loc;
  const rc = L.road, ec = L.edge, dc = L.dash;
  const j0 = Math.floor((D - 10) / 2.0);
  const zs = Array.from({ length: 84 }, (_, i) => D - (j0 + i) * 2.0);
  const os_ = zs.map(z => g.off(z));
  glNormal3f(0, 1, 0);
  glBegin(GL_QUADS);                                             // asphalt, banded so speed is visible
  for (let i = 0; i < 83; i++) {
    const k = pymod(floordiv(j0 + i, 4), 2) ? 1.0 : 0.88;
    glColor3f(rc[0] * k, rc[1] * k, rc[2] * k);
    glVertex3f(os_[i] - 5.5, 0, zs[i]); glVertex3f(os_[i] + 5.5, 0, zs[i]);
    glVertex3f(os_[i + 1] + 5.5, 0, zs[i + 1]); glVertex3f(os_[i + 1] - 5.5, 0, zs[i + 1]);
  }
  glEnd();
  glDisable(GL_LIGHTING);
  glEnable(GL_BLEND);
  for (const sd of [-1, 1]) {                                    // neon edge: bright core + soft outer glow
    glBegin(GL_QUADS);
    for (let i = 0; i < 83; i++) {
      glColor4f(...ec, 1.0);
      glVertex3f(os_[i] + sd * 5.5, 0.04, zs[i]); glVertex3f(os_[i] + sd * 5.85, 0.04, zs[i]);
      glVertex3f(os_[i + 1] + sd * 5.85, 0.04, zs[i + 1]); glVertex3f(os_[i + 1] + sd * 5.5, 0.04, zs[i + 1]);
    }
    glEnd();
    glBegin(GL_QUADS);
    for (let i = 0; i < 83; i++) {
      glColor4f(...ec, 0.35); glVertex3f(os_[i] + sd * 5.85, 0.03, zs[i]);
      glColor4f(...ec, 0.0); glVertex3f(os_[i] + sd * 7.4, 0.03, zs[i]);
      glVertex3f(os_[i + 1] + sd * 7.4, 0.03, zs[i + 1]);
      glColor4f(...ec, 0.35); glVertex3f(os_[i + 1] + sd * 5.85, 0.03, zs[i + 1]);
    }
    glEnd();
  }
  glDisable(GL_BLEND);
  glColor3f(...dc);
  glBegin(GL_QUADS);                                             // lane dashes follow the bend
  const j6 = Math.floor(D / 6) - 1;
  for (let j = j6; j < j6 + 27; j++) {
    const za = D - j * 6.0;
    const zb = za - 2.5;
    const oa = g.off(za), ob = g.off(zb);
    for (const lx of [-3.3, -1.1, 1.1, 3.3]) {
      glVertex3f(oa + lx - 0.06, 0.02, za); glVertex3f(oa + lx + 0.06, 0.02, za);
      glVertex3f(ob + lx + 0.06, 0.02, zb); glVertex3f(ob + lx - 0.06, 0.02, zb);
    }
  }
  glEnd();
  glEnable(GL_LIGHTING);
}


function draw_scenery(e) {
  const D = g.D, L = g.loc;
  quad(-220, 220, -175, 20, -0.02, L.ground);
  if (L.kind == 'forest') {                                      // a lake on the left
    quad(-220, -30, -175, 20, -0.01, lerp([0.14, 0.34, 0.46], e.sky, 0.25));
  }
  draw_road();
  const fn = SCN[L.kind];
  const j0 = Math.floor(D / 12) - 1;
  for (let j = j0; j < j0 + Q.rows; j++) {
    const z = D - j * 12;
    glPushMatrix();
    glTranslatef(g.off(z), 0, 0);
    for (const side of [-1, 1]) {
      const h = (j * 73856093 + side * 83492791) & 0xFFFF;
      fn(side, h, j, z, e);
      if (L.kind != 'stadium' && pymod(j, 2) == 1) {             // his supporters line the road everywhere
        glPushMatrix(); glTranslatef(side * 7.7, 1.25, z); glRotatef(-side * 90, 0, 1, 0);
        glColor3f(1, 1, 1); glTexQuad(tex('fans' + (h & 1)), 8, 2.5);
        glPopMatrix();
        box(side * 7.15, 0.4, z, 0.08, 0.8, 8.2, [0.1, 0.5, 0.28]);
        box(side * 7.15, 0.82, z, 0.12, 0.06, 8.2, GOLD);
      }
      if (pymod(j, 2) == 0) {
        let lc = L.lamp;
        if (L.kind == 'city' && pymod(j, 4) == 0) lc = [1.0, 0.3, 0.85];
        lamp(side, z, lc, e);
      }
    }
    glPopMatrix();
  }
}


function _r(i) {                                                 // deterministic pseudo-random 0..1
  return (((i * 2654435761) >> 7) & 1023) / 1023.0;
}


function draw_backdrop(e) {                                      // far silhouettes (mountains / dunes / skyline)
  const L = g.loc, n = e.night;
  const base = L.far.map(c => c * (1 - 0.65 * n));
  const col = lerp(base, e.sky, 0.42);
  const kind = L.kind;
  for (let i = 0; i < 30; i++) {
    const x = -290 + i * 20 + (_r(i) - 0.5) * 14;
    const r1 = _r(i + 3), r2 = _r(i + 11);
    glPushMatrix();
    glTranslatef(x, -0.5, -165);
    glColor3f(...col);
    if (kind == 'desert') {
      if (i % 5 == 0) {
        glRotatef(-90, 1, 0, 0); glRotatef(45, 0, 0, 1);
        glutSolidCone(24 + r1 * 14, 26 + r2 * 14, 4, 1);
      } else {
        glScalef(1, 0.3, 0.5);
        glutSolidSphere(30 + r1 * 22, 16, 10);
      }
    } else if (kind == 'city') {
      const w = 8 + r1 * 10, hh = 25 + r2 * 60;
      glTranslatef(0, hh / 2, 0);
      glScalef(w, hh, w);
      glutSolidCube(1);
    } else if (kind == 'snow') {
      const R = 28 + r1 * 20, H = 44 + r2 * 34;
      glRotatef(-90, 1, 0, 0);
      glutSolidCone(R, H, 6, 1);
      glColor3f(...lerp([0.97, 0.98, 1.0], e.sky, 0.3));
      glTranslatef(0, 0, H * 0.6);
      glutSolidCone(R * 0.405, H * 0.405, 6, 1);
    } else {
      glScalef(1, 0.4 + r2 * 0.3, 0.6);
      glutSolidSphere(28 + r1 * 20, 16, 10);
    }
    glPopMatrix();
    if (kind == 'city') {                                        // lit windows on the skyline
      const w = 8 + r1 * 10, hh = 25 + r2 * 60;
      const lit = 0.25 + 0.75 * n;
      for (let q = 0; q < 5; q++) {
        const wc = [[1.0, 0.4, 0.9], [0.3, 0.9, 1.0], [1.0, 0.85, 0.5]][q % 3];
        box(x + (_r(i * 7 + q) - 0.5) * w * 0.7, 6 + _r(i * 13 + q) * (hh - 8), -165 + w / 2 + 0.2,
            1.2, 1.8, 0.1, [wc[0] * lit, wc[1] * lit, wc[2] * lit]);
      }
    }
  }
}


const YAW_GAIN = 1.2;          // aim assist: widens the firing angle so >60 degrees is easy to reach
const MAX_YAW = 85.0, MIN_PITCH = -45.0, MAX_PITCH = 60.0;


function camera() {
  // Eye, look-at point and vertical FOV for the current view (shared by rendering and aiming).
  const v = g.view;
  let eye, ctr;
  if (v == 0) {                                                  // chase (leans into the bend)
    eye = [g.px * 0.6, 4.3, 7.5]; ctr = [g.px * 0.4 + g.off(-14) * 0.45, 1.4, -12.0];
  } else if (v == 1) {                                           // first person
    const ey = g.py + (g.slide > 0 ? 0.9 : 1.75);
    eye = [g.px, ey, -0.2]; ctr = [g.px + g.off(-20) * 0.5, ey - 0.15, -20.0];
  } else {                                                       // overhead
    eye = [g.px * 0.4, 15.0, 9.0]; ctr = [g.px * 0.4 + g.off(-9) * 0.3, 0.0, -9.0];
  }
  return [eye, ctr, [58, 92, 50][v] + Math.max(0, g.speed - 14) * 0.3];
}


function fit_fov(fov) {
  // Web only: a portrait phone keeps the horizontal view of a square window, so all 5 lanes stay
  // on screen. Landscape windows (every native window) get the FOV unchanged.
  const a = WIN[0] / WIN[1];
  if (a >= 1.0) return fov;
  return 2 * Math.atan(Math.tan(fov * Math.PI / 360) / a) * 180 / Math.PI;
}


function _norm(v) {
  const n = Math.sqrt(v.reduce((a, c) => a + c * c, 0)) || 1.0;
  return v.map(c => c / n);
}


function _cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}


function compute_aim() {
  // Unit vector from Aladdin's hand toward the mouse cursor (pure maths, no GL queries).
  const [eye, ctr, fov_] = camera();
  const fov = fit_fov(fov_);
  const f = _norm([0, 1, 2].map(i => ctr[i] - eye[i]));
  const r = _norm(_cross(f, [Math.sin(g.roll), Math.cos(g.roll), 0.0]));   // camera right (includes bank roll)
  const u = _cross(r, f);
  const th = Math.tan(fov * Math.PI / 180 / 2);
  const nx = 2.0 * g.mx / WIN[0] - 1.0;
  const ny = 1.0 - 2.0 * g.my / WIN[1];
  const d = [0, 1, 2].map(i => f[i] + r[i] * nx * th * WIN[0] / WIN[1] + u[i] * ny * th);
  const [hx, hy, hz] = g.hand;
  let T = null;
  if (d[1] < -1e-3) {                                // ray hits the plane at hand height
    const t = (hy - eye[1]) / d[1];
    if (t > 0) T = [0, 1, 2].map(i => eye[i] + d[i] * t);
  }
  if (T === null && d[2] < -1e-3) {                  // cursor above horizon: use a wall 30 units ahead
    const t = (-30 - eye[2]) / d[2];
    if (t > 0) T = [0, 1, 2].map(i => eye[i] + d[i] * t);
  }
  if (T === null) return [0.0, 0.0, -1.0];
  let v = [T[0] - hx, T[1] - hy, T[2] - hz];
  if (Math.sqrt(v.reduce((a, c) => a + c * c, 0)) < 1.5) v = d;   // target right at our feet: follow the view ray
  const deg = 180 / Math.PI;
  const yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, Math.atan2(v[0], -v[2]) * deg * YAW_GAIN));
  const pit = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.atan2(v[1], Math.hypot(v[0], v[2])) * deg));
  const yr = yaw / deg, pr = pit / deg;
  return [Math.sin(yr) * Math.cos(pr), Math.sin(pr), -Math.cos(yr) * Math.cos(pr)];
}


// ---- Three.js objects behind the shim (native: the GLUT window + its GL context)
// Anti-aliasing is fixed when the GL context is created, so it follows the quality setting at load:
// always on High, on for Auto / Medium unless the screen is already high-DPI, off on Low.
const MSAA = /[?&]msaa\b/.test(location.search) || SET.quality == 'high' ||
             (SET.quality != 'low' && (devicePixelRatio || 1) < 2);
let ren;
try {
  ren = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: MSAA, alpha: true,
                                  powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('nogl');                           // style.css shows the "needs WebGL" notice
  throw e;
}
ren.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(58, 1, 0.3, 260);
GLShim.init(scene);
Actors.init(scene);
let FDT = 0.0;                                                   // this frame's animation time step (0 while paused)

let skyCss = '';
function sky_gradient(e) {                                       // screen-space gradient behind the world
  const c = v => `rgb(${v.map(x => Math.round(Math.min(1, x) * 255)).join(',')})`;
  const s = `linear-gradient(to top, ${c(e.sky)} 0%, ${c(e.sky)} 50%, ${c(e.top)} 100%)`;
  if (s !== skyCss) document.body.style.background = skyCss = s;
}


function draw_world() {
  const e = env();
  const L = g.loc;
  sky_gradient(e);
  const [eye, ctr, fov] = camera();
  cam.fov = fit_fov(fov);                                        // FOV widens with speed
  cam.aspect = WIN[0] / WIN[1];
  cam.updateProjectionMatrix();
  const sh = g.state == 'play' && SET.shake ? g.shake * 0.8 : 0.0;   // no shake on pause / game over
  const jx = random.uniform(-sh, sh), jy = random.uniform(-sh, sh) * 0.5;
  cam.position.set(eye[0] + jx, eye[1] + jy, eye[2]);
  cam.up.set(Math.sin(g.roll), Math.cos(g.roll), 0);             // banks into bends
  cam.lookAt(ctr[0], ctr[1], ctr[2]);
  g.aim = aim_now();
  glFog(e.sky, e.fs, e.fe);
  glLightModelAmbient(e.amb);
  glLight0(e.dif, [0.4, 1.0, 0.5]);
  const t = Math.max(e.night * 0.9, L.glow, (g.fire_on && !g.heat && g.state == 'play') ? 0.9 : 0.0);
  const tc = L.torch;
  glLight1([t * tc[0], t * tc[1], t * tc[2]], [g.px, 3.0, 2.0]);  // torch / flame / neon light

  GLShim.beginFrame();
  Actors.begin();
  RIGGED = 0;
  glDisable(GL_LIGHTING); glDisable(GL_FOG);                     // sky bodies + far backdrop
  if (e.stars > 0.05) {
    glPointSize(2);
    glBegin(GL_POINTS);
    for (const [sx, sy_, sz, v] of STARS) {
      glColor3f(v * e.stars, v * e.stars, v * e.stars);
      glVertex3f(sx, sy_, sz);
    }
    glEnd();
  }
  const sr = lerp(16.0, 9.0, e.night);
  glColor3f(...e.sun);
  glPushMatrix(); glTranslatef(-38, e.sy * 1.5, -190); glutSolidSphere(sr, 28, 18); glPopMatrix();
  halo(-38, e.sy * 1.5, -188, sr * 4.2, e.sun, 0.55 * (1 - 0.85 * g.wk * (g.weather ? 1 : 0)));
  draw_backdrop(e);
  glEnable(GL_LIGHTING); glEnable(GL_FOG);

  draw_scenery(e);
  for (const o of g.obs) draw_obstacle(o);
  for (const [x, z] of g.cns) {
    glPushMatrix(); glTranslatef(x + g.off(z), 1.0 + 0.15 * Math.sin(g.t * 4 + z), z);
    glRotatef(g.t * 180, 0, 1, 0); glScalef(1, 1, 0.2);
    glColor3f(...GOLD); glutSolidSphere(0.35, 16, 12); glPopMatrix();
  }
  for (const it of g.items) {
    const c = { shield: [0.3, 0.7, 1], rapid: [1, 0.5, 0.1], heal: [0.2, 0.9, 0.3], rocket: [1, 0.3, 0.9] }[it.k];
    glPushMatrix(); glTranslatef(it.x + g.off(it.z), 1.1 + 0.2 * Math.sin(g.t * 3), it.z);
    glRotatef(g.t * 120, 0, 1, 0);
    ball(0, 0, 0, 0.35, c);
    glRotatef(70, 1, 0, 0); glColor3f(1, 1, 1); glutSolidTorus(0.05, 0.6, 8, 20);
    glPopMatrix();
    glow(it.x + g.off(it.z), 1.1, it.z, 1.4, c, 0.4);
  }
  for (const r of g.rivals) draw_rival(r);
  for (const tp of g.tapes) draw_tape(tp);
  for (const c of g.clones) draw_clone(c);
  for (const dr of g.drones) draw_drone(dr);
  draw_player();
  for (const m of g.ms) draw_missile(m);
  for (const b of g.booms) {                                     // fireballs
    const k = 1 - b.t / b.T;
    glow(b.x, b.y + 0.5, b.z, b.r * (0.3 + 0.7 * k), [1, 0.55, 0.15], 0.95 * (1 - k));
    glow(b.x, b.y + 0.5, b.z, b.r * 0.5 * (0.3 + 0.7 * k), [1, 1, 0.8], 1 - k);
  }

  glDisable(GL_LIGHTING); glDisable(GL_FOG);                     // unlit effects
  if (g.pb.length) {                                             // tracers: a bright streak behind each bullet
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE); glDepthMask(GL_FALSE);
    glBegin(GL_QUADS);
    for (const b of g.pb) {
      const n = Math.hypot(b.dx, b.dy, b.dz) || 1, L = Math.min(2.8, Math.abs(b.z + 0.62) + 0.2);
      const tx = b.x - b.dx / n * L, ty = b.y - b.dy / n * L, tz = b.z - b.dz / n * L;
      for (const [wx, wy] of [[0.07, 0], [0, 0.07]]) {           // two crossed ribbons, so it shows from any side
        glColor4f(1, 0.95, 0.6, 1); glVertex3f(b.x - wx, b.y - wy, b.z); glVertex3f(b.x + wx, b.y + wy, b.z);
        glColor4f(1, 0.7, 0.2, 0); glVertex3f(tx + wx, ty + wy, tz); glVertex3f(tx - wx, ty - wy, tz);
      }
    }
    glEnd();
    glDepthMask(GL_TRUE); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDisable(GL_BLEND);
  }
  for (const b of g.cb) {
    const bx_ = 'vx' in b ? b.x : b.x + g.off(b.z), by_ = b.y !== undefined ? b.y : 1.2;
    if ('vx' in b) {                                             // a drone's shot is a spinning ballot paper
      glPushMatrix(); glTranslatef(bx_, by_, b.z); glRotatef(g.t * 500, 1, 0.4, 0);
      box(0, 0, 0, 0.42, 0.3, 0.03, [0.97, 0.97, 1.0]);
      glPopMatrix();
    } else {
      glColor3f(1, 0.15, 0.1);
      glPushMatrix(); glTranslatef(bx_, by_, b.z); glutSolidSphere(0.25, 10, 8); glPopMatrix();
    }
    glow(bx_, b.y !== undefined ? b.y : 1.2, b.z, 0.9, [1, 0.2, 0.3], 0.55);
  }
  draw_glows();
  glPointSize(5);
  glBegin(GL_POINTS);
  for (const p of g.parts) {
    glColor3f(...p[7]); glVertex3f(p[0], p[1], p[2]);
  }
  glEnd();
  const wl = g.wx.slice(0, Math.trunc(g.wx.length * g.wk * Q.wx));
  if (wl.length) {                                               // weather
    if (g.weather == 1) {
      glColor3f(0.7, 0.8, 1);
      glBegin(GL_LINES);
      for (const p of wl) {
        glVertex3f(p[0], p[1], p[2]); glVertex3f(p[0], p[1] + 0.7, p[2] - 0.15);
      }
      glEnd();
    } else {
      glPointSize(g.weather == 2 ? 4 : 3);
      glColor3f(...(g.weather == 2 ? [1, 1, 1] : [0.85, 0.7, 0.45]));
      glBegin(GL_POINTS);
      for (const p of wl) glVertex3f(...p);
      glEnd();
    }
  }
  if (g.flames.length) {                                         // fire
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE);
    for (const [size, hot] of [[11, false], [5, true]]) {
      glPointSize(size);
      glBegin(GL_POINTS);
      for (const f of g.flames) {
        const k = f[6] / f[7];
        glColor4f(1, hot ? 0.95 : 0.25 + 0.5 * k, hot ? 0.6 : 0.05, k);
        glVertex3f(f[0], f[1], f[2]);
      }
      glEnd();
    }
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDisable(GL_BLEND);
  }
  glEnable(GL_LIGHTING); glEnable(GL_FOG);
  GLShim.endFrame();
  Actors.end();
  ren.render(scene, cam);
}


// ------------------------------------------------------------------ screen effects
// Menus and the HUD are HTML (ui.js). This canvas only carries the full-screen effects that
// follow the frame or the 3D camera: flashes, speed lines, floating score labels, the reticle.
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');
const rgba = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const UIFONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
let hudUsed = true;                                              // was anything drawn last frame?


function wash(c, a) {
  ctx.fillStyle = rgba(c, a);
  ctx.fillRect(0, 0, WIN[0], WIN[1]);
}


function speed_lines() {
  const w = WIN[0], h = WIN[1];
  const k = Math.min(1.0, (g.speed - 22) / 20);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(255,255,255,${0.16 * k})`;
  ctx.beginPath();
  for (let q = 0; q < Math.trunc(10 + 20 * k); q++) {
    const an = random.uniform(0, 6.2832);
    const r0 = random.uniform(0.38, 0.55), r1 = random.uniform(0.6, 0.9);
    const ca = Math.cos(an), sa = Math.sin(an);
    ctx.moveTo(w / 2 + ca * w * r0, h / 2 + sa * h * r0);
    ctx.lineTo(w / 2 + ca * w * r1, h / 2 + sa * h * r1);
  }
  ctx.stroke();
}


const pv = new THREE.Vector3();
function draw_pops() {                                           // "+50", "DISQUALIFIED": world position -> screen
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.round(Math.max(13, Math.min(20, WIN[0] / 40)))}px ${UIFONT}`;
  ctx.lineWidth = 3;
  for (const p of g.pops) {
    pv.set(p.x, p.y, p.z).project(cam);
    if (pv.z > 1) continue;
    const x = (pv.x + 1) / 2 * WIN[0], y = (1 - pv.y) / 2 * WIN[1], a = Math.min(1, p.t * 2.5);
    ctx.strokeStyle = `rgba(0,0,0,${0.7 * a})`;
    ctx.strokeText(p.s, x, y);
    ctx.fillStyle = rgba(p.c, a);
    ctx.fillText(p.s, x, y);
  }
}


function reticle() {                                             // dark outline + white core reads on any background
  const cx_ = g.mx, cy_ = g.my;
  for (const [lw, col, al] of [[4.5, [0, 0, 0], 0.55], [2, [1, 1, 1], 1.0]]) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = rgba(col, al);
    ctx.beginPath(); ctx.arc(cx_, cy_, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (const [dx_, dy_] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx_ + dx_ * 15, cy_ - dy_ * 15); ctx.lineTo(cx_ + dx_ * 21, cy_ - dy_ * 21);
    }
    ctx.stroke();
  }
  ctx.fillStyle = rgba(g.loc.acc);
  ctx.fillRect(cx_ - 1.5, cy_ - 1.5, 3, 3);
}


function draw_hud() {
  const play = g.state == 'play';
  const busy = g.bolt > 0 || g.weather == 3 || g.flash > 0 || play;
  if (!busy && !hudUsed) return;                                 // nothing to draw and nothing to erase
  hudUsed = busy;
  const dpr = hudCanvas.width / WIN[0];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, WIN[0], WIN[1]);
  const soft = SET.shake ? 1.0 : 0.4;                            // "reduce flashes" setting
  if (g.bolt > 0) wash([1, 1, 1], Math.min(0.6, g.bolt * 4) * soft);
  if (g.weather == 3) wash([0.8, 0.6, 0.3], 0.18 * g.wk);
  if (g.flash > 0) wash([1, 0, 0], g.flash * soft);
  if (!play) return;
  if (g.speed > 22) speed_lines();
  if (g.pops.length) draw_pops();
  if (inputMode == 'mouse') reticle();
  if (g.up.hand && g.hm_cd <= 0) {                               // the hand missile's lock: a red bracket on its target
    const to = g.threat();
    if (to) {
      pv.set(g.rx(to.o.x, to.o.z), to.h, to.o.z).project(cam);
      if (pv.z < 1) {
        const x = (pv.x + 1) / 2 * WIN[0], y = (1 - pv.y) / 2 * WIN[1], r = Math.max(18, Math.min(40, 640 / -to.o.z));
        const q = r * 0.45, t = 1 + 0.08 * Math.sin(g.t * 10);
        for (const [lw, col] of [[6, 'rgba(0,0,0,0.6)'], [3, 'rgba(255,60,40,1)']]) {   // dark outline, red core
          ctx.lineWidth = lw; ctx.strokeStyle = col;
          ctx.beginPath();
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const cx_ = x + sx * r * t, cy_ = y + sy * r * t;
            ctx.moveTo(cx_, cy_ - sy * q); ctx.lineTo(cx_, cy_); ctx.lineTo(cx_ - sx * q, cy_);
          }
          ctx.stroke();
        }
      }
    }
  }
}


// ------------------------------------------------------------------ aiming without a mouse
function auto_aim() {
  // Touch and gamepad: point at the nearest threat ahead, leading it by the bullet's flight time.
  const [hx, hy, hz] = g.hand, sp = g.speed;
  let best = null, bd = 1e9;
  const see = (x, y, z, rel, reach) => {
    if (z > -3 || z < -48) return;
    const wx = g.rx(x, z), side = Math.abs(wx - hx);
    if (side > reach) return;
    const d = side * 1.5 - z;
    if (d < bd) { bd = d; best = [wx, y, z, rel]; }
  };
  for (const c of g.clones) see(c.x, 1.1, c.z, 1.25, 7);
  for (const d of g.drones) see(d.x, d.y, d.z, 0.5, 7);
  for (const r of g.rivals) see(r.x, r.y + 1.1, r.z, 0.7, 7);
  for (const o of g.obs) if (o.k == 'crate') see(o.x, 0.9, o.z, 1.0, 1.5);   // only crates in your way
  if (!best) return null;
  const t = Math.hypot(best[0] - hx, best[2] - hz) / 50;
  return _norm([best[0] - hx, best[1] - hy, best[2] + best[3] * sp * t - hz]);
}


function aim_now() {
  if (inputMode == 'mouse') return compute_aim();
  const a = SET.autoaim ? auto_aim() : null;
  if (a) return a;
  return inputMode == 'touch' && g.tap_t > 0 ? compute_aim() : [0.0, 0.0, -1.0];
}


// ------------------------------------------------------------------ quality and frame pacing
function apply_quality() {
  const q = SET.quality;
  Object.assign(Q, TIERS[q == 'auto' ? Q.auto : q]);
  if (q != 'auto') Q.dyn = 1.0;
  reshape(innerWidth, innerHeight);
}


function reshape(w, h) {
  WIN[0] = Math.max(1, w); WIN[1] = Math.max(1, h);
  const dpr = devicePixelRatio || 1;
  ren.setPixelRatio(Math.min(dpr, Q.pr) * Q.dyn);
  ren.setSize(WIN[0], WIN[1], false);
  const hd = Math.min(dpr, Q.pr > 1 ? 2 : 1);
  hudCanvas.width = Math.round(WIN[0] * hd);
  hudCanvas.height = Math.round(WIN[1] * hd);
  hudUsed = true;
}


// 'Auto' quality: once a second, look at the average frame time. Too slow -> render fewer pixels,
// then drop a detail tier. Comfortably fast -> creep back up, waiting longer after every drop so a
// borderline device settles instead of bouncing between two resolutions.
let FPS = 60, pf_t = 0.0, pf_n = 0, pf_skip = 3, pf_wait = 4, pf_cool = 0;

function perf_tick(dt) {
  pf_t += dt; pf_n++;
  if (pf_t < 1.0) return;
  const ms = pf_t / pf_n * 1000;
  FPS = Math.round(1000 / ms);
  pf_t = 0.0; pf_n = 0;
  if (pf_skip > 0) { pf_skip--; return; }                        // shader compiles make the first seconds slow
  if (SET.quality != 'auto') return;
  pf_cool--;
  if (ms > 21) {
    if (Q.dyn > 0.6) Q.dyn = Math.max(0.6, Q.dyn - 0.1);
    else if (Q.auto != 'low') {
      Q.auto = Q.auto == 'high' ? 'medium' : 'low';
      Object.assign(Q, TIERS[Q.auto]);
      Q.dyn = 0.8;
    } else return;
    pf_wait = Math.min(60, pf_wait * 2);
    pf_cool = pf_wait;
    reshape(innerWidth, innerHeight);
  } else if (ms < 17.5 && Q.dyn < 1.0 && pf_cool <= 0) {
    Q.dyn = Math.min(1.0, Q.dyn + 0.1);
    pf_cool = pf_wait;
    reshape(innerWidth, innerHeight);
  }
}


// ------------------------------------------------------------------ callbacks
const GLUT_LEFT_BUTTON = 0, GLUT_RIGHT_BUTTON = 2, GLUT_DOWN = 0, GLUT_UP = 1;
const GLUT_KEY_LEFT = 'ArrowLeft', GLUT_KEY_RIGHT = 'ArrowRight', GLUT_KEY_UP = 'ArrowUp', GLUT_KEY_DOWN = 'ArrowDown';

function display() {
  draw_world();
  draw_hud();
}


let last = 0.0;
let cursor = null;


function tick(ms) {
  requestAnimationFrame(tick);
  const now = ms / 1000.0;
  const dt = Math.min(now - last, 0.1);
  last = now;
  if (dt <= 0) return;
  perf_tick(dt);
  poll_pad();
  // Fixed-size physics steps: a slow frame runs more steps instead of slowing the game down,
  // and no step is long enough for an obstacle to pass through Aladdin.
  const n = Math.max(1, Math.ceil(dt / 0.02));
  for (let i = 0; i < n; i++) g.update(dt / n);
  Snd.flame(g.state == 'play' && g.fire_on && !g.heat);
  FDT = g.state == 'paused' || g.state == 'over' ? 0.0 : dt;
  const want = g.state == 'play' && inputMode == 'mouse' ? 'none' : 'default';   // custom reticle while playing
  if (want != cursor) {
    cursor = want;
    document.body.style.cursor = want;
  }
  display();
  UIX.frame(dt);
}


function keyboard(key, x, y) {
  const k = key.toLowerCase();
  if (k == '\x1b') {                                             // native quits here; on the web Esc pauses
    g.pause();
    return;
  }
  if (k == 'v') {
    g.view = (g.view + 1) % 3;
    return;
  }
  if (k == 'n') { g.cycle_tod(); return; }
  if (k == 'm') { g.cycle_weather(); return; }
  if (g.state == 'menu') {
    if (k == '\r' || k == ' ') g.reset();
    else if (k == '1' || k == '2' || k == '3') g.set_diff(parseInt(k) - 1);
    else if (k == 'a') g.set_loc(g.li - 1);
    else if (k == 'd') g.set_loc(g.li + 1);
    return;
  }
  if (k == 'b') g.to_menu();
  else if (k == 'r') g.reset();
  else if (k == 'p') g.pause();
  else if (k == '\r' && g.state == 'over') g.reset();
  else if (k == 'a') g.move(-1);
  else if (k == 'd') g.move(1);
  else if (k == 'w' || k == ' ') g.jump();
  else if (k == 's') g.duck();
  else if (k == 'f') g.shoot(true);
  else if (k == 'g') g.fire_on = g.state == 'play';
  else if (k == 'q') g.speed_adj(-3);
  else if (k == 'e') g.speed_adj(3);
  else if (k == 'x') g.missile();
  else if (k == 'c') g.doom_call();
}


function keyboard_up(key, x, y) {
  if (key.toLowerCase() == 'g') g.fire_on = false;
}


function special(key, x, y) {
  if (g.state == 'menu') {
    if (key == GLUT_KEY_LEFT) g.set_loc(g.li - 1);
    else if (key == GLUT_KEY_RIGHT) g.set_loc(g.li + 1);
    else if (key == GLUT_KEY_UP) g.set_diff(g.di - 1);
    else if (key == GLUT_KEY_DOWN) g.set_diff(g.di + 1);
    return;
  }
  if (key == GLUT_KEY_LEFT) g.move(-1);
  else if (key == GLUT_KEY_RIGHT) g.move(1);
  else if (key == GLUT_KEY_UP) g.jump();
  else if (key == GLUT_KEY_DOWN) g.duck();
}


function motion(x, y) {
  g.mx = x; g.my = y;
}


function mouse(button, state, x, y) {
  g.mx = x; g.my = y;
  if (button == GLUT_RIGHT_BUTTON) {
    g.fire_on = state == GLUT_DOWN && g.state == 'play';
    return;
  }
  if (button == GLUT_LEFT_BUTTON && state == GLUT_DOWN && g.state == 'play') {
    g.aim = compute_aim();                                       // aim at this click, not last frame's cursor
    g.shoot();
  }
}


// ------------------------------------------------------------------ platform layer (web only)
// Browser events are translated into the GLUT callbacks above. Phones get swipes and touch
// buttons, gamepads are polled; both call the same game actions as the keyboard.
const isTouch = matchMedia('(pointer: coarse)').matches;
const $ = id => document.getElementById(id);
const canvas = $('c');
let inputMode = isTouch ? 'touch' : 'mouse';                     // 'mouse' | 'touch' | 'pad': decides how shots are aimed

function set_mode(m) {
  if (m == inputMode) return;
  inputMode = m;
  document.body.classList.toggle('touch', m == 'touch');
}

// The keyboard belongs to a focused control (reached with Tab) while a menu is up
const on_control = () => g.state != 'play' && document.activeElement &&
                         /^(BUTTON|INPUT|A|SELECT)$/.test(document.activeElement.tagName);

addEventListener('keydown', e => {
  Snd.unlock();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (typeof UIX == 'undefined') return;                          // a key pressed while the page is still loading
  if (UIX.key(e)) return;                                        // a dialog is open: it owns the keyboard
  if (on_control() && (e.key == 'Enter' || e.key == ' ')) return;
  if ([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (e.repeat && !['a', 'd', 'A', 'D', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;   // only lane changes auto-repeat
  if (e.key.startsWith('Arrow')) special(e.key, g.mx, g.my);
  else if (e.key == 'Enter') keyboard('\r', g.mx, g.my);
  else if (e.key == 'Escape') keyboard('\x1b', g.mx, g.my);
  else if (e.key.length == 1) keyboard(e.key, g.mx, g.my);
});
addEventListener('keyup', e => {
  if (e.key == ' ' && !on_control()) e.preventDefault();         // Space must not "click" a stale focused button
  if (e.key.length == 1) keyboard_up(e.key, g.mx, g.my);
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('resize', () => reshape(innerWidth, innerHeight));
addEventListener('gesturestart', e => e.preventDefault());       // iOS pinch zoom
for (const n of ['pointerup', 'touchend', 'click']) addEventListener(n, () => Snd.unlock(), { passive: true });

// Leaving the tab pauses the run; so does the window losing focus
document.addEventListener('visibilitychange', () => { if (document.hidden && g.state == 'play') g.pause(); });
addEventListener('blur', () => {
  g.fire_on = false;
  if (g.state == 'play') g.pause();
});

canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

// ---- mouse and touch on the 3D view (menus and HUD buttons are HTML and handle themselves)
const touches = new Map();                                       // pointerId -> where the gesture started

canvas.addEventListener('pointerdown', e => {
  Snd.unlock();
  if (e.pointerType == 'mouse') {
    set_mode('mouse');
    mouse(e.button == 2 ? GLUT_RIGHT_BUTTON : GLUT_LEFT_BUTTON, GLUT_DOWN, e.clientX, e.clientY);
    return;
  }
  set_mode('touch');
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, sw: false });
});

addEventListener('pointermove', e => {
  if (e.pointerType == 'mouse') {
    if (e.movementX || e.movementY) set_mode('mouse');
    motion(e.clientX, e.clientY);
    return;
  }
  // A swipe acts the moment it has travelled far enough, not when the finger lifts.
  // One swipe is one action, however long the finger keeps moving.
  const t = touches.get(e.pointerId);
  if (!t || t.sw || g.state != 'play') return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y, th = 24;
  if (Math.abs(dx) > th && Math.abs(dx) > Math.abs(dy)) g.move(dx > 0 ? 1 : -1);
  else if (dy < -th && Math.abs(dy) > Math.abs(dx)) g.jump();
  else if (dy > th && Math.abs(dy) > Math.abs(dx)) g.duck();
  else return;
  t.sw = true;
});

addEventListener('pointerup', e => {
  if (e.pointerType == 'mouse') {
    if (e.button == 2) mouse(GLUT_RIGHT_BUTTON, GLUT_UP, e.clientX, e.clientY);
    return;
  }
  const t = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  // Tap length comes from the events' own timestamps: a slow frame between finger-down and
  // finger-up must not turn a quick tap into a rejected long press.
  if (!t || t.sw || g.state != 'play' || e.timeStamp - t.t > 450) return;
  g.mx = e.clientX; g.my = e.clientY;                            // tap: shoot (auto-aim, else where you tapped)
  g.tap_t = 0.5;
  g.aim = aim_now();
  g.shoot();
});
addEventListener('pointercancel', e => touches.delete(e.pointerId));

function touchKey(id, key) {
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); Snd.unlock(); set_mode('touch'); keyboard(key, g.mx, g.my); });
}
touchKey('bv', 'v'); touchKey('be', 'e'); touchKey('bq', 'q');
for (const [id, fn] of [['bm', () => g.missile()], ['bd', () => g.doom_call()]]) {   // clickable with a mouse too, without switching to touch mode
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Snd.unlock(); if (e.pointerType != 'mouse') set_mode('touch'); fn(); });
}
$('bf').addEventListener('pointerdown', e => { e.preventDefault(); Snd.unlock(); set_mode('touch'); g.fire_on = g.state == 'play'; });
for (const n of ['pointerup', 'pointercancel', 'pointerleave']) $('bf').addEventListener(n, () => (g.fire_on = false));
document.body.classList.toggle('touch', isTouch);

// ---- gamepad (standard mapping): stick / d-pad lanes, A jump, B slide, X / RB shoot, RT flame, LB missile, Back for the Beard of Doom
const padWas = {};
function poll_pad() {
  if (!navigator.getGamepads) return;
  let p = null;
  for (const q of navigator.getGamepads()) if (q && q.connected) { p = q; break; }
  if (!p) return;
  const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
  const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  const now = { l: b(14) || ax < -0.55, r: b(15) || ax > 0.55, u: b(12) || ay < -0.6, d: b(13) || ay > 0.6,
                a: b(0), b: b(1), x: b(2) || b(5), y: b(3), start: b(9), fire: b(7), slow: b(6), m: b(4), doom: b(8) };
  const hit = k => now[k] && !padWas[k];
  let any = false;
  for (const k in now) any = any || now[k];
  if (any) { set_mode('pad'); Snd.unlock(); }
  if (UIX.blocking()) {
    if (hit('b') || hit('start')) UIX.close();
  } else if (g.state == 'menu') {
    if (hit('l')) g.set_loc(g.li - 1);
    if (hit('r')) g.set_loc(g.li + 1);
    if (hit('u')) g.set_diff(g.di - 1);
    if (hit('d')) g.set_diff(g.di + 1);
    if (hit('a') || hit('start')) g.reset();
  } else if (g.state == 'play') {
    if (hit('l')) g.move(-1);
    if (hit('r')) g.move(1);
    if (hit('a') || hit('u')) g.jump();
    if (hit('b') || hit('d')) g.duck();
    if (now.x) g.shoot();
    if (hit('y')) g.view = (g.view + 1) % 3;
    if (hit('m')) g.missile();
    if (hit('doom')) g.doom_call();
    if (hit('start')) g.pause();
    if (inputMode == 'pad') g.fire_on = now.fire;
  } else {
    if (hit('a') || hit('start')) { if (g.state == 'paused') g.pause(); else g.reset(); }
    if (hit('b')) g.to_menu();
  }
  Object.assign(padWas, now);
}


function main() {
  Q.auto = isTouch || (navigator.hardwareConcurrency || 8) <= 4 ? 'medium' : 'high';
  apply_quality();
  requestAnimationFrame(tick);
}
// main() is called at the end of ui.js, once every script has loaded.
