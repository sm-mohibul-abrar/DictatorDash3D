/*
 * DICTATOR'S DASH 3D  v3  -  web port
 *
 * This file is a section-by-section port of native/11.py (the PyOpenGL + GLUT version).
 * Same constants, same class and method names, same numbers, same sounds, same order of
 * operations, so the two versions play identically:
 *
 *   native/11.py                     web (this file)
 *   ------------------------------   ------------------------------------------------
 *   DIFFS, LOCS, PAL, env()          same tables, same env()
 *   class Game  (simulation)         class Game  (line-by-line)
 *   draw_world()  legacy OpenGL      draw_world()  same calls, via glshim.js -> Three.js
 *   draw_hud()    GL ortho 2D        draw_hud()    same layout, via Canvas 2D
 *   GLUT callbacks                   same callbacks, fed by browser events
 *   winsound.Beep                    Web Audio sine beep
 *   highscore.json                   localStorage (same JSON)
 *
 * Only the platform layer at the bottom is web-specific: browser events and the touch
 * controls for phones, which call the same game actions as the keyboard.
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


let AC = null;
function sfx(freq, ms) {                          // native: winsound.Beep(freq, ms) on a thread
  if (!AC || AC.state !== 'running') return;
  const t = AC.currentTime, d = ms / 1000;
  const o = AC.createOscillator(), v = AC.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  v.gain.setValueAtTime(0, t);
  v.gain.linearRampToValueAtTime(0.15, t + 0.004);
  v.gain.setValueAtTime(0.15, t + d - 0.004);
  v.gain.linearRampToValueAtTime(0, t + d);
  o.connect(v).connect(AC.destination);
  o.start(t);
  o.stop(t + d + 0.01);
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
  get loc() { return LOCS[this.li]; }
  get hi() { return this.his[this.di]; }

  reset() {
    const s = this;
    const prev = s.state === undefined ? 'menu' : s.state;
    const d = s.dd;
    s.state = 'play'; s.time = 0.0; s.speed = d.v0;
    s.lane = 2; s.px = 0.0; s.py = 0.0; s.vy = 0.0; s.slide = 0.0;
    s.hpmax = d.hp;
    s.health = s.hpmax; s.shield = false; s.rapid = 0.0; s.chain = 0;
    s.score = 0.0; s.coins = 0; s.kills = 0;
    s.invuln = s.shake = s.flash = s.fire_cd = s.phase = 0.0;
    s.obs = []; s.cns = []; s.items = []; s.clones = [];
    s.drones = [];
    s.pb = []; s.cb = []; s.parts = []; s.flames = [];
    s.target = d.v0; s.fuel = 100.0; s.heat = false; s.fire_on = false;
    if (prev != 'menu') {
      s.randomize_env();                          // every new run: new time of day / weather
      s.new_track(160);
    }
    s.next_spawn = s.D + 20;
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
      this.vy = 9.0;
      this.slide = 0.0;
    }
  }

  duck() {
    if (this.state != 'play') return;
    if (this.py > 0.05) this.vy = -14.0;
    else this.slide = 0.7;
  }

  shoot(straight = false) {
    const s = this;
    if (s.state == 'play' && s.fire_cd <= 0) {
      const [hx, hy, hz] = s.hand;
      const d = straight ? [0.0, 0.0, -1.0] : s.aim;
      s.pb.push({ x: hx, y: hy, z: hz, dx: d[0] * 50, dy: d[1] * 50, dz: d[2] * 50 });
      s.fire_cd = s.rapid > 0 ? 0.1 : 0.28;
    }
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
      sfx(500, 80);
      return;
    }
    s.health -= dmg;
    s.chain = 0; s.flash = 0.35;
    s.burst(s.px, 1, 0, [1, 0.2, 0.1], 20);
    sfx(180, 140);
    if (s.health <= 0) {
      s.state = 'over';
      s.shake = s.invuln = s.flash = 0.0;         // nothing may shake/blink on the game-over screen
      s.flames = []; s.fire_on = false;
      if (Math.trunc(s.score) > s.his[s.di]) {
        s.his[s.di] = Math.trunc(s.score);
        save_hi(s.his);
      }
    }
  }

  get vmin() {                                    // minimum speed rises with time
    const d = this.dd;
    return Math.min(d.vmin0 + this.time * d.vgrow, d.vcap);
  }

  speed_adj(d) {
    if (this.state == 'play') this.target = Math.max(this.vmin, Math.min(this.dd.vmax, this.target + d));
  }

  cycle_tod() { this.tod = (this.tod + 1) % 4; }

  get hand() {                                    // where bullets and flames leave Aladdin
    const s = this;
    const low = s.slide > 0 ? 0.6 : null;
    if (s.view == 1) return [s.px + 0.35, s.py + (low || 1.45), -0.5];
    return [s.px + 0.5, s.py + (low || 1.25), -0.4];
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
    sfx(450, 80);
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
    const cx = (random.choice(free) - 2) * LW;
    const nc = random.randint(3, 6);
    for (let n = 0; n < nc; n++) s.cns.push([cx, z - n * 2.2]);
    const r = random.random();
    if (r < d.clone_p && s.clones.length < d.clone_max) {
      s.clones.push({ x: (random.randrange(LANES) - 2) * LW, z: z - 6, cd: random.uniform(0.5, 1.5) });
    } else if (r > 1 - d.item_p) {
      s.items.push({ x: (random.randrange(LANES) - 2) * LW, z: z - 10,
                     k: random.choice(['shield', 'rapid', 'heal']) });
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
    s.target = Math.max(s.vmin, Math.min(d.vmax, s.target));
    s.speed += (s.target - s.speed) * Math.min(1, 3 * dt);
    const sp = s.speed;
    s.D += sp * dt;
    s.update_road(dt);
    s.score += sp * dt * 0.2 * (sp / 14);
    s.phase += sp * dt * 0.7;
    s.px += (((s.lane - 2) * LW) - s.px) * Math.min(1, [12, 8, 9, 12][s.weather] * dt);
    if (s.py > 0 || s.vy > 0) {
      s.vy -= 24 * dt;
      s.py = Math.max(0.0, s.py + s.vy * dt);
      if (s.py == 0.0) s.vy = 0.0;
    }
    s.slide = Math.max(0, s.slide - dt);
    s.invuln = Math.max(0, s.invuln - dt);
    s.rapid = Math.max(0, s.rapid - dt);
    s.shake = Math.max(0, s.shake - dt * 1.5);
    s.flash = Math.max(0, s.flash - dt);
    s.fire_cd -= dt;
    if (s.D >= s.next_spawn) {
      s.spawn_row();
      s.next_spawn = s.D + Math.max(d.gapmin, d.gap0 - s.time * d.gaps);
    }

    const top = s.py + (s.slide > 0 ? 0.9 : 1.9);

    // flamethrower: streams toward the mouse aim
    if (s.heat && s.fuel > 25) s.heat = false;
    if (s.fire_on && !s.heat) {
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
            sfx(600, 50);
          }
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
            sfx(700, 60);
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
    for (const c of s.cns) {
      c[1] += sp * dt;
      if (Math.abs(c[1]) < 1.0 && Math.abs(c[0] - s.px) < 1.0 && s.py < 2.2) {
        c.push(1);
        s.coins += 1;
        s.chain += 1;
        s.score += 10 * s.mult;
        s.burst(c[0], 1, c[1], GOLD, 6);
        sfx(1300, 30);
      }
    }
    for (const it of s.items) {
      it.z += sp * dt;
      if (Math.abs(it.z) < 1.2 && Math.abs(it.x - s.px) < 1.2) {
        it.dead = true;
        if (it.k == 'shield') s.shield = true;
        else if (it.k == 'rapid') s.rapid = 8;
        else s.health = Math.min(s.hpmax, s.health + d.heal);
        s.burst(it.x, 1, it.z, [1, 1, 1], 20);
        sfx(900, 90);
      }
      if (it.z > 6) it.dead = true;
    }

    // clone guards
    for (const c of s.clones) {
      c.z += sp * 0.55 * dt;
      if (c.z > -30) c.x += Math.max(-1, Math.min(1, s.px - c.x)) * 1.6 * dt;
      c.cd -= dt;
      if (-60 < c.z && c.z < -8 && c.cd <= 0) {
        s.cb.push({ x: c.x, z: c.z + 1 });
        c.cd = random.uniform(1.3, 2.2) * d.ecd;
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
    for (const name of ['obs', 'items', 'clones', 'drones', 'pb', 'cb']) {
      s[name] = s[name].filter(e => !e.dead);
    }
    s.cns = s.cns.filter(c => c.length == 2 && c[1] < 6);
    s.parts = s.parts.filter(p => p[6] > 0);
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
  glutSolidSphere(r, 20, 14);
  glPopMatrix();
  if (glow) glEnable(GL_LIGHTING);
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


function figure(ph, vest, pants, skin, hair, enemy = false) {
  const sw = Math.sin(ph) * 40;
  for (const side of [-1, 1]) {
    glPushMatrix(); glTranslatef(side * 0.2, 0.9, 0); glRotatef(side * sw, 1, 0, 0);
    box(0, -0.45, 0, 0.24, 0.9, 0.26, pants); glPopMatrix();
    glPushMatrix(); glTranslatef(side * 0.5, 1.6, 0); glRotatef(-side * sw, 1, 0, 0);
    box(0, -0.35, 0, 0.18, 0.75, 0.18, skin); glPopMatrix();
  }
  box(0, 1.3, 0, 0.75, 0.75, 0.38, vest);
  box(0, 0.98, 0, 0.78, 0.14, 0.42, GOLD);
  ball(0, 1.9, 0, 0.27, skin);
  ball(0, 1.98, 0.04, 0.3, hair, 1, 0.75, 1);
  if (enemy) {
    box(-0.1, 1.92, -0.26, 0.08, 0.06, 0.04, [1, 0, 0]);
    box(0.1, 1.92, -0.26, 0.08, 0.06, 0.04, [1, 0, 0]);
    box(0.38, 1.2, -0.45, 0.1, 0.12, 0.7, [0.3, 0.3, 0.3]);
  }
}


function draw_player() {
  if (g.view == 1 || (g.state == 'play' && g.invuln > 0 && Math.trunc(g.t * 20) % 2)) return;
  shadow(g.px, 0, 0.7 / (1 + g.py * 0.3), 0.4 / (1 + g.py * 0.4));
  glPushMatrix();
  glTranslatef(g.px, g.py, 0);
  if (g.slide > 0) {
    glTranslatef(0, 0.35, 0);
    glRotatef(-70, 1, 0, 0);
  }
  figure(g.phase, [0.75, 0.1, 0.15], [0.95, 0.95, 0.9], [0.8, 0.55, 0.35], [0.08, 0.06, 0.05]);
  glPopMatrix();
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
    box(x, 0.9, z, 1.7, 1.8, 1.2, [0.55, 0.36, 0.18]);
    box(x, 0.9, z, 1.75, 0.2, 1.25, [0.3, 0.18, 0.08]);
    box(x, 0.9, z, 0.2, 1.85, 1.25, [0.3, 0.18, 0.08]);
  }
}


// ---- location scenery
function lamp(side, z, c) {
  box(side * 5.9, 1.2, z, 0.1, 2.4, 0.1, [0.2, 0.15, 0.1]);
  ball(side * 5.9, 2.5, z, 0.22, c, 1, 1, 1, true);
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


const SCN = { desert: scn_desert, city: scn_city, snow: scn_snow, forest: scn_forest };


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
  for (let j = j0; j < j0 + 14; j++) {
    const z = D - j * 12;
    glPushMatrix();
    glTranslatef(g.off(z), 0, 0);
    for (const side of [-1, 1]) {
      const h = (j * 73856093 + side * 83492791) & 0xFFFF;
      fn(side, h, j, z, e);
      if (pymod(j, 2) == 0) {
        let lc = L.lamp;
        if (L.kind == 'city' && pymod(j, 4) == 0) lc = [1.0, 0.3, 0.85];
        lamp(side, z, lc);
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


function _norm(v) {
  const n = Math.sqrt(v.reduce((a, c) => a + c * c, 0)) || 1.0;
  return v.map(c => c / n);
}


function _cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}


function compute_aim() {
  // Unit vector from Aladdin's hand toward the mouse cursor (pure maths, no GL queries).
  const [eye, ctr, fov] = camera();
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
const MSAA = /[?&]msaa\b/.test(location.search);  // native: python 11.py --msaa
const ren = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: MSAA, alpha: true });
ren.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(58, 1, 0.3, 260);
GLShim.init(scene);

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
  cam.fov = fov;                                                 // FOV widens with speed
  cam.aspect = WIN[0] / WIN[1];
  cam.updateProjectionMatrix();
  const sh = g.state == 'play' ? g.shake * 0.8 : 0.0;           // no shake on pause / game over
  const jx = random.uniform(-sh, sh), jy = random.uniform(-sh, sh) * 0.5;
  cam.position.set(eye[0] + jx, eye[1] + jy, eye[2]);
  cam.up.set(Math.sin(g.roll), Math.cos(g.roll), 0);             // banks into bends
  cam.lookAt(ctr[0], ctr[1], ctr[2]);
  g.aim = compute_aim();
  glFog(e.sky, e.fs, e.fe);
  glLightModelAmbient(e.amb);
  glLight0(e.dif, [0.4, 1.0, 0.5]);
  const t = Math.max(e.night * 0.9, L.glow, (g.fire_on && !g.heat && g.state == 'play') ? 0.9 : 0.0);
  const tc = L.torch;
  glLight1([t * tc[0], t * tc[1], t * tc[2]], [g.px, 3.0, 2.0]);  // torch / flame / neon light

  GLShim.beginFrame();
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
    const c = { shield: [0.3, 0.7, 1], rapid: [1, 0.5, 0.1], heal: [0.2, 0.9, 0.3] }[it.k];
    glPushMatrix(); glTranslatef(it.x + g.off(it.z), 1.1 + 0.2 * Math.sin(g.t * 3), it.z);
    glRotatef(g.t * 120, 0, 1, 0);
    ball(0, 0, 0, 0.35, c);
    glRotatef(70, 1, 0, 0); glColor3f(1, 1, 1); glutSolidTorus(0.05, 0.6, 8, 20);
    glPopMatrix();
  }
  for (const c of g.clones) {
    const cxx = c.x + g.off(c.z);
    shadow(cxx, c.z, 0.7, 0.35);
    glPushMatrix(); glTranslatef(cxx, 0, c.z); glRotatef(180, 0, 1, 0);
    figure(g.t * 8, [0.12, 0.12, 0.15], [0.05, 0.05, 0.07], [0.5, 0.4, 0.35], [0, 0, 0], true);
    glPopMatrix();
  }
  for (const dr of g.drones) draw_drone(dr);
  draw_player();

  glDisable(GL_LIGHTING); glDisable(GL_FOG);                     // unlit effects
  for (const b of g.pb) {
    glColor3f(1, 1, 0.3); glPushMatrix(); glTranslatef(b.x, b.y, b.z); glutSolidSphere(0.18, 10, 8); glPopMatrix();
  }
  for (const b of g.cb) {
    glColor3f(...('vx' in b ? [1, 0.2, 0.9] : [1, 0.15, 0.1]));
    const bx_ = 'vx' in b ? b.x : b.x + g.off(b.z);
    glPushMatrix(); glTranslatef(bx_, b.y !== undefined ? b.y : 1.2, b.z); glutSolidSphere(0.25, 10, 8); glPopMatrix();
  }
  glPointSize(5);
  glBegin(GL_POINTS);
  for (const p of g.parts) {
    glColor3f(...p[7]); glVertex3f(p[0], p[1], p[2]);
  }
  glEnd();
  const wl = g.wx.slice(0, Math.trunc(g.wx.length * g.wk));
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
  ren.render(scene, cam);
}


// ------------------------------------------------------------------------ HUD
// Native draws the HUD with gluOrtho2D (origin bottom-left, 1 unit = 1 pixel). Here the same
// functions draw on a Canvas 2D layer; Y() flips the y axis. On screens smaller than the
// native layout the HUD is scaled down by HS so the menu still fits.
const H10 = '10px Helvetica, Arial, sans-serif', H12 = '12px Helvetica, Arial, sans-serif';
const H18 = '18px Helvetica, Arial, sans-serif', T24 = '24px "Times New Roman", Times, serif';
const DARK = [0.04, 0.05, 0.09];
const DIM = [0.62, 0.66, 0.76];
const UI = [];                                                   // clickable regions, rebuilt each frame
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');
let HS = 1, HW = WIN[0], HH = WIN[1];                            // HUD scale and HUD size in HUD units
const Y = y => HH - y;
const rgba = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const MXY = () => [g.mx / HS, g.my / HS];                        // mouse in HUD units (y from the top)


function text(x, y, s, font = H18, c = [1, 1, 1]) {
  ctx.font = font;
  ctx.fillStyle = rgba(c);
  ctx.fillText(s, x, Y(y));
}


function tw_(s, font) {
  ctx.font = font;
  return ctx.measureText(s).width;
}


function text_m(xc, y, s, font = H18, c = [1, 1, 1], sh = true) {   // centred on xc, optional drop shadow
  const x = xc - tw_(s, font) / 2;
  if (sh) text(x + 1, y - 1, s, font, [0, 0, 0]);
  text(x, y, s, font, c);
}


function text_c(y, s, font = H18, c = [1, 1, 1]) {
  text_m(HW / 2, y, s, font, c);
}


// GLUT_STROKE_ROMAN has a cap height of about 100 units; a light sans-serif matches its single-line look
const strokeFont = sc => `300 ${Math.round(140 * sc)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

function stroke_w(s, sc) {
  return tw_(s, strokeFont(sc));
}


function stroke(x, y, s, sc, c, lw = 3.0, a = 1.0) {              // big scalable title text
  ctx.font = strokeFont(sc);
  ctx.fillStyle = ctx.strokeStyle = rgba(c, a);
  ctx.lineWidth = Math.max(0, lw - 3) + 0.8;
  ctx.fillText(s, x, Y(y));
  ctx.strokeText(s, x, Y(y));
}


function rect(x, y, w, h, c, a = 1.0) {
  ctx.fillStyle = rgba(c, a);
  ctx.fillRect(x, Y(y + h), w, h);
}


function rrect(x, y, w, h, r, c, a = 1.0) {                       // rounded rectangle
  r = Math.max(0.0, Math.min(r, w / 2, h / 2));
  const t = Y(y + h);
  ctx.fillStyle = rgba(c, a);
  ctx.beginPath();
  ctx.moveTo(x + r, t);
  ctx.arcTo(x + w, t, x + w, t + h, r);
  ctx.arcTo(x + w, t + h, x, t + h, r);
  ctx.arcTo(x, t + h, x, t, r);
  ctx.arcTo(x, t, x + w, t, r);
  ctx.closePath();
  ctx.fill();
}


function tri(x1, y1, x2, y2, x3, y3, c, a = 1.0) {
  ctx.fillStyle = rgba(c, a);
  ctx.beginPath();
  ctx.moveTo(x1, Y(y1)); ctx.lineTo(x2, Y(y2)); ctx.lineTo(x3, Y(y3));
  ctx.closePath();
  ctx.fill();
}


function vignette(a) {
  const w = HW, h = HH;
  const m = 0.16 * w, n = 0.22 * h;
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(0,0,0,${a})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, m, 0, 0, 0, m, h);                                  // left
  edge(w, 0, w - m, 0, w - m, 0, m, h);                          // right
  edge(0, h, 0, h - n, 0, h - n, w, n);                          // bottom
  edge(0, 0, 0, n, 0, 0, w, n);                                  // top
}


function speed_lines() {
  const w = HW, h = HH;
  const k = Math.min(1.0, (g.speed - 22) / 20);
  ctx.lineWidth = 1.5;
  for (let q = 0; q < Math.trunc(10 + 20 * k); q++) {
    const an = random.uniform(0, 6.2832);
    const r0 = random.uniform(0.38, 0.55), r1 = random.uniform(0.6, 0.9);
    const ca = Math.cos(an), sa = Math.sin(an);
    const x0 = w / 2 + ca * w * r0, y0 = Y(h / 2 + sa * h * r0);
    const x1 = w / 2 + ca * w * r1, y1 = Y(h / 2 + sa * h * r1);
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, `rgba(255,255,255,${0.22 * k})`);
    ctx.strokeStyle = gr;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.lineWidth = 1;
}


function button(x, y, w, h, act, label, col, sel = false, sub = null) {
  const [mx, my] = MXY();
  const hov = x <= mx && mx <= x + w && y <= HH - my && HH - my <= y + h;
  UI.push([x, y, w, h, act]);
  const bc = (sel || hov) ? col : [0.35, 0.36, 0.42];
  rrect(x - 2, y - 2, w + 4, h + 4, 13, bc, sel ? 1.0 : (hov ? 0.85 : 0.5));
  rrect(x, y, w, h, 11, [0.08, 0.09, 0.13], 0.97);
  if (sel) rrect(x, y, w, h, 11, col, 0.28);
  const lc = (sel || hov) ? [1, 1, 1] : [0.75, 0.77, 0.83];
  if (sub) {
    text_m(x + w / 2, y + h / 2 + 3, label, H18, lc);
    text_m(x + w / 2, y + 8, sub, H10, DIM, false);
  } else {
    text_m(x + w / 2, y + h / 2 - 6, label, H18, lc);
  }
}


function hud_play(w, h) {
  const d = g.dd, L = g.loc;
  const acc = L.acc;
  // health + flamethrower panel
  rrect(14, h - 72, 312, 58, 14, DARK, 0.66);
  const hp = Math.max(0, g.health) / g.hpmax;
  rrect(24, h - 40, 292, 18, 9, [0.15, 0.16, 0.2], 0.9);
  if (hp > 0.01) rrect(24, h - 40, Math.max(18, 292 * hp), 18, 9, lerp([0.95, 0.25, 0.2], [0.3, 0.9, 0.5], hp), 1.0);
  text(32, h - 36, `HP  ${Math.max(0, g.health)} / ${g.hpmax}`, H12);
  rrect(24, h - 62, 200, 9, 4, [0.15, 0.16, 0.2], 0.9);
  if (g.fuel > 1) rrect(24, h - 62, Math.max(9, 200 * g.fuel / 100), 9, 4, g.heat ? [1, 0.25, 0.1] : [1, 0.65, 0.1], 1.0);
  text(232, h - 62, g.heat ? 'OVERHEATED' : 'FLAME [G]', H10, g.heat ? [1, 0.35, 0.25] : [1, 0.8, 0.4]);
  // score
  rrect(w / 2 - 105, h - 70, 210, 56, 16, DARK, 0.66);
  text_m(w / 2, h - 33, 'SCORE', H10, DIM, false);
  text_m(w / 2, h - 60, `${Math.trunc(g.score)}`, T24, GOLD);
  // coins / best / badge
  rrect(w - 226, h - 72, 212, 58, 14, DARK, 0.66);
  ctx.fillStyle = rgba(GOLD);
  ctx.beginPath(); ctx.arc(w - 202, Y(h - 34), 9, 0, Math.PI * 2); ctx.fill();
  text(w - 184, h - 40, `${g.coins}`, H18);
  text(w - 124, h - 38, `Best ${g.hi}`, H12, DIM);
  text(w - 214, h - 62, `${d.name.toUpperCase()}  |  ${L.name.toUpperCase()}`, H10, d.col);
  // combo
  let y = h - 98;
  if (g.mult > 1) {
    text_m(w / 2, y, `COMBO x${g.mult}`, T24, [1, 0.6, 0.1]);
    rrect(w / 2 - 60, y - 14, 120, 6, 3, [0.15, 0.16, 0.2], 0.9);
    const prog = g.mult >= 5 ? 1.0 : (g.chain % 5) / 5;
    if (prog > 0.02) rrect(w / 2 - 60, y - 14, Math.max(6, 120 * prog), 6, 3, [1, 0.6, 0.1], 1.0);
    y -= 38;
  }
  // curve warning
  const kk = g.curv(g.D + 35);
  if (Math.abs(kk) > 0.0007) {
    const sd = kk > 0 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const al = 0.35 + 0.65 * Math.max(0.0, Math.sin(g.t * 9 - i * 0.9));
      const bx = w / 2 + sd * (30 + i * 20);
      tri(bx - sd * 8, y - 3, bx - sd * 8, y + 15, bx + sd * 6, y + 6, acc, al);
    }
    text_m(w / 2, y - 14, 'CURVE ' + (sd > 0 ? 'RIGHT' : 'LEFT'), H10, [1, 1, 1]);
  }
  // speed gauge
  rrect(w / 2 - 150, 16, 300, 38, 14, DARK, 0.66);
  const fr = Math.max(0.0, Math.min(1.0, g.speed / d.vmax));
  rrect(w / 2 - 138, 24, 276, 9, 4, [0.15, 0.16, 0.2], 0.9);
  rrect(w / 2 - 138, 24, Math.max(9, 276 * fr), 9, 4, lerp([0.3, 0.8, 1.0], [1.0, 0.4, 0.2], fr), 1.0);
  rect(w / 2 - 138 + 276 * g.vmin / d.vmax, 22, 2, 13, [1, 1, 1], 0.8);
  text_m(w / 2, 39, `${Math.trunc(g.speed * 4)} km/h`, H12, [1, 1, 1]);
  text(w / 2 + 160, 30, 'Q / E', H10, DIM);
  // power-ups
  y = 24;
  if (g.shield) {
    rrect(14, y, 112, 30, 15, [0.1, 0.32, 0.55], 0.85);
    text_m(70, y + 10, 'SHIELD', H12, [0.7, 0.9, 1]); y += 38;
  }
  if (g.rapid > 0) {
    rrect(14, y, 138, 30, 15, [0.55, 0.28, 0.05], 0.85);
    text_m(83, y + 10, `RAPID FIRE ${g.rapid.toFixed(0)}s`, H12, [1, 0.85, 0.5]);
  }
  // reticle (dark outline + white core so it reads on any background)
  if (g.state == 'play') {
    const [mx, my] = MXY();
    const cx_ = mx, cy_ = Y(HH - my);
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
    ctx.lineWidth = 1;
    rect(cx_ - 2, HH - my - 2, 4, 4, [0, 0, 0], 0.6);
    rect(cx_ - 1.5, HH - my - 1.5, 3, 3, acc, 1.0);
  }
}


function menu_screen(w, h) {
  const L = g.loc;
  const cx = w / 2, cy = h / 2;
  rect(0, 0, w, h, [0, 0, 0], 0.30);
  const pw = 820, ph = 520;
  const x0 = cx - pw / 2, y0 = cy - ph / 2;
  const top = y0 + ph;
  rrect(x0 - 3, y0 - 3, pw + 6, ph + 6, 23, L.acc, 0.55);
  rrect(x0, y0, pw, ph, 20, DARK, 0.84);
  const title = "DICTATOR'S DASH";
  const sc = 0.42;
  const wd = stroke_w(title, sc);
  stroke(cx - wd / 2 + 3, top - 91, title, sc, [0, 0, 0], 5, 0.6);
  stroke(cx - wd / 2, top - 88, title, sc, GOLD, 3);
  text_m(cx, top - 114, '3D EDITION   |   ENDLESS RUNNER', H12, DIM, false);
  rect(x0 + 40, top - 128, pw - 80, 1, [1, 1, 1], 0.12);
  // difficulty
  text_m(cx, top - 152, 'SELECT DIFFICULTY', H12, DIM, false);
  const bw = 230, gap = 20;
  const bx0 = cx - (3 * bw + 2 * gap) / 2;
  DIFFS.forEach((dd, i) => {
    button(bx0 + i * (bw + gap), top - 212, bw, 46, ['diff', i], dd.name.toUpperCase(), dd.col,
           i == g.di, `Best ${g.his[i]}`);
  });
  text_m(cx, top - 232, g.dd.desc, H12, g.dd.col, false);
  // location
  text_m(cx, top - 262, 'SELECT LOCATION', H12, DIM, false);
  const cw = 176, cg = 14;
  const cx0 = cx - (4 * cw + 3 * cg) / 2;
  const [mx, my] = MXY();
  LOCS.forEach((Lc, i) => {
    const bx = cx0 + i * (cw + cg), by = top - 382;
    const sel = i == g.li;
    const hov = bx <= mx && mx <= bx + cw && by <= HH - my && HH - my <= by + 104;
    UI.push([bx, by, cw, 104, ['loc', i]]);
    rrect(bx - 2, by - 2, cw + 4, 108, 13, sel ? Lc.acc : [0.35, 0.36, 0.42], sel ? 1.0 : (hov ? 0.85 : 0.5));
    rrect(bx, by, cw, 104, 11, [0.08, 0.09, 0.13], 0.97);
    const gr = ctx.createLinearGradient(0, Y(by + 98), 0, Y(by + 56));
    gr.addColorStop(0, rgba(Lc.pv));
    gr.addColorStop(1, rgba(Lc.ground));
    ctx.fillStyle = gr;
    ctx.fillRect(bx + 6, Y(by + 98), cw - 12, 42);
    text_m(bx + cw / 2, by + 34, Lc.name, H18, (sel || hov) ? [1, 1, 1] : [0.78, 0.8, 0.86]);
    text_m(bx + cw / 2, by + 14, Lc.tag, H10, sel ? Lc.acc : DIM, false);
  });
  text_m(cx, top - 402, L.desc, H12, L.acc, false);
  button(cx - 150, top - 470, 300, 46, ['start'], 'START RUN', [0.4, 1.0, 0.55], true, null);
  text_m(cx, top - 500, 'Up/Down: difficulty   Left/Right: location   Enter: start   V view   N time   M weather',
         H10, DIM, false);
}


function panel_screen(w, h, title, tcol, pw, ph, lines, btns) {
  rect(0, 0, w, h, [0, 0, 0], 0.5);
  const cx = w / 2, cy = h / 2;
  const x0 = cx - pw / 2, y0 = cy - ph / 2;
  rrect(x0 - 3, y0 - 3, pw + 6, ph + 6, 23, tcol, 0.5);
  rrect(x0, y0, pw, ph, 20, DARK, 0.9);
  const wd = stroke_w(title, 0.36);
  stroke(cx - wd / 2 + 2, y0 + ph - 78, title, 0.36, [0, 0, 0], 5, 0.6);
  stroke(cx - wd / 2, y0 + ph - 75, title, 0.36, tcol, 3);
  let y = y0 + ph - 118;
  for (const [s, font, c] of lines) {
    text_m(cx, y, s, font, c);
    y -= 28;
  }
  const n = btns.length;
  const bw = 200;
  const bx = cx - (n * bw + (n - 1) * 20) / 2;
  btns.forEach(([lab, act, col], i) => button(bx + i * (bw + 20), y0 + 26, bw, 44, act, lab, col, i == 0));
}


function draw_hud() {
  const w = HW, h = HH;
  UI.length = 0;
  const dpr = hudCanvas.width / WIN[0];
  ctx.setTransform(dpr * HS, 0, 0, dpr * HS, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (g.bolt > 0) rect(0, 0, w, h, [1, 1, 1], Math.min(0.7, g.bolt * 4));
  if (g.weather == 3) rect(0, 0, w, h, [0.8, 0.6, 0.3], 0.18 * g.wk);
  if (g.flash > 0) rect(0, 0, w, h, [1, 0, 0], g.flash);
  vignette(0.42);
  if (g.state == 'play' && g.speed > 22) speed_lines();
  if (g.state != 'menu') hud_play(w, h);

  if (g.state == 'menu') {
    menu_screen(w, h);
  } else if (g.state == 'paused') {
    panel_screen(w, h, 'PAUSED', [0.6, 0.8, 1.0], 460, 220, [['Take a breath. The desert can wait.', H12, DIM]],
                 [['RESUME', ['resume'], [0.4, 1.0, 0.55]], ['MENU', ['menu'], [1.0, 0.75, 0.3]]]);
  } else if (g.state == 'over') {
    const nb = Math.trunc(g.score) >= g.hi && g.hi > 0;
    const lines = [[`Score ${Math.trunc(g.score)}      Coins ${g.coins}      Guards downed ${g.kills}`, H18, [1, 1, 1]],
                   [(nb ? 'NEW BEST!  ' : '') + `Best (${g.dd.name}): ${g.hi}`, H18, GOLD],
                   [`${g.dd.name}  |  ${g.loc.name}`, H12, DIM]];
    panel_screen(w, h, 'GAME OVER', [1.0, 0.3, 0.25], 600, 300, lines,
                 [['RESTART [R]', ['restart'], [0.4, 1.0, 0.55]], ['MENU [B]', ['menu'], [1.0, 0.75, 0.3]]]);
  }

  const wl_ = WM[g.wmode] + (g.wmode == 0 ? ` (${WN[g.weather]})` : '');
  const s_ = `[N] Time: ${TODN[g.tod]}    [M] Weather: ${wl_}    [V] View: ${VN[g.view]}    [B] Menu`;
  text(w - tw_(s_, H10) - 14, 6, s_, H10, [0.85, 0.88, 0.95]);
}


// ------------------------------------------------------------------ callbacks
const GLUT_LEFT_BUTTON = 0, GLUT_RIGHT_BUTTON = 2, GLUT_DOWN = 0, GLUT_UP = 1;
const GLUT_KEY_LEFT = 'ArrowLeft', GLUT_KEY_RIGHT = 'ArrowRight', GLUT_KEY_UP = 'ArrowUp', GLUT_KEY_DOWN = 'ArrowDown';

function display() {
  draw_world();
  draw_hud();
}


function reshape(w, h) {
  WIN[0] = w; WIN[1] = Math.max(1, h);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  ren.setPixelRatio(dpr);
  ren.setSize(WIN[0], WIN[1], false);
  hudCanvas.width = Math.round(WIN[0] * dpr);
  hudCanvas.height = Math.round(WIN[1] * dpr);
  HS = Math.min(1, WIN[0] / 880, WIN[1] / 560);                 // shrink the HUD only if the menu would not fit
  HW = WIN[0] / HS; HH = WIN[1] / HS;
}


let last = 0.0;
let cursor = null;


function tick(ms) {
  const now = ms / 1000.0;
  const dt = Math.min(now - last, 0.033);
  last = now;
  g.update(dt);
  const want = g.state == 'play' ? 'none' : 'default';          // custom reticle while playing
  if (want != cursor) {
    cursor = want;
    document.body.style.cursor = want;
    platform_state_changed();
  }
  display();
  requestAnimationFrame(tick);
}


function keyboard(key, x, y) {
  const k = key.toLowerCase();
  if (k == '\x1b') return;                                       // native quits here; a browser tab cannot
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
  else if (k == 'a') g.move(-1);
  else if (k == 'd') g.move(1);
  else if (k == 'w' || k == ' ') g.jump();
  else if (k == 's') g.duck();
  else if (k == 'f') g.shoot(true);
  else if (k == 'g') g.fire_on = true;
  else if (k == 'q') g.speed_adj(-3);
  else if (k == 'e') g.speed_adj(3);
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
  if (button == GLUT_LEFT_BUTTON && state == GLUT_DOWN) {
    if (g.state != 'play') {                                     // menu / pause / game-over buttons
      const ux = x / HS, uy = HH - y / HS;
      for (const [bx, by, bw, bh, act] of UI) {
        if (bx <= ux && ux <= bx + bw && by <= uy && uy <= by + bh) {
          g.ui(act);
          return;
        }
      }
      return;
    }
    g.shoot();
  }
}


// ------------------------------------------------------------------ platform layer (web only)
// Browser events are translated into the GLUT callbacks above. Phones get touch controls that
// call the same game actions; nothing here changes the game rules.
const isTouch = matchMedia('(pointer: coarse)').matches;
const $ = id => document.getElementById(id);

function unlock_audio() {                                        // browsers only allow audio after a user gesture
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { AC = null; }
}

function platform_state_changed() {                              // touch buttons only while playing
  document.body.classList.toggle('playing', g.state == 'play');
}

addEventListener('keydown', e => {
  unlock_audio();
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (e.key.startsWith('Arrow')) special(e.key, g.mx, g.my);
  else if (e.key == 'Enter') keyboard('\r', g.mx, g.my);
  else if (e.key == 'Escape') keyboard('\x1b', g.mx, g.my);
  else if (e.key.length == 1) keyboard(e.key, g.mx, g.my);
});
addEventListener('keyup', e => { if (e.key.length == 1) keyboard_up(e.key, g.mx, g.my); });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('resize', () => reshape(innerWidth, innerHeight));

const onButton = e => e.target.closest && e.target.closest('.m-ctrl-btn');
let tx = 0, ty = 0;

addEventListener('pointermove', e => {
  if (e.pointerType == 'mouse' || g.state == 'play') motion(e.clientX, e.clientY);
});

addEventListener('pointerdown', e => {
  unlock_audio();
  if (onButton(e)) return;
  if (e.pointerType == 'mouse') {
    mouse(e.button == 2 ? GLUT_RIGHT_BUTTON : GLUT_LEFT_BUTTON, GLUT_DOWN, e.clientX, e.clientY);
  } else {
    tx = e.clientX; ty = e.clientY;
  }
});

addEventListener('pointerup', e => {
  if (onButton(e)) return;
  if (e.pointerType == 'mouse') {
    if (e.button == 2) mouse(GLUT_RIGHT_BUTTON, GLUT_UP, e.clientX, e.clientY);
    return;
  }
  // touch: swipe = move / jump / slide, tap = shoot (or press a menu button)
  const dx = e.clientX - tx, dy = e.clientY - ty;
  if (g.state == 'play' && Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) g.move(dx > 0 ? 1 : -1);
  else if (g.state == 'play' && dy < -35) g.jump();
  else if (g.state == 'play' && dy > 35) g.duck();
  else mouse(GLUT_LEFT_BUTTON, GLUT_DOWN, e.clientX, e.clientY);
});

function touchKey(id, key) {
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); unlock_audio(); keyboard(key, g.mx, g.my); });
}
touchKey('bv', 'v'); touchKey('bw', 'm'); touchKey('bt', 'n'); touchKey('bp', 'p');
touchKey('be', 'e'); touchKey('bq', 'q');
$('bf').addEventListener('pointerdown', e => { e.preventDefault(); unlock_audio(); g.fire_on = g.state == 'play'; });
for (const n of ['pointerup', 'pointercancel', 'pointerleave']) $('bf').addEventListener(n, () => (g.fire_on = false));
document.body.classList.toggle('touch', isTouch);


function main() {
  reshape(innerWidth, innerHeight);
  requestAnimationFrame(tick);
}

main();
