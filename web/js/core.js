/*
 * core.js - services shared by the game (game.js) and the interface (ui.js)
 *
 *   Bus     tiny event bus: the simulation announces things ('runend', 'medal'), the UI reacts
 *   Store   the player's profile in localStorage: settings, coin bank, outfits, achievements, stats
 *   Snd     Web Audio: synthesised sound effects and a procedural music loop, plus four short crowd clips
 *   buzz    haptic feedback on phones
 *
 * Everything here is data or a browser service. No game rules live in this file.
 */
'use strict';

const Bus = {
  h: {},
  on(n, f) { (this.h[n] || (this.h[n] = [])).push(f); },
  emit(n, d) { for (const f of this.h[n] || []) f(d); }
};

// ------------------------------------------------------------------ content tables
// The athletes. model / kit pick the rigged model and its props in actors.js, tint recolours
// parts of it. vest / pants / hair colour the built-in fallback figure and the roster icon.
// mods bend the rules for that athlete: grip (lane-change speed), jump, hp, coin (value of a coin).
const SKINS = [
  { id: 'general', name: 'Admiral General Aladeen', cost: 0, model: 'man', kit: 'aladeen',
    blurb: 'Supreme Leader, supreme athlete. Balanced, according to him.',
    tint: { top: [0.97, 0.97, 0.95], bottom: [0.97, 0.97, 0.95], shoes: [0.16, 0.16, 0.18] }, mods: {},
    vest: [0.96, 0.96, 0.94], pants: [0.96, 0.96, 0.94], hair: [0.08, 0.06, 0.05] },
  { id: 'double', name: 'Efawadh, the Body Double', cost: 300, model: 'man', kit: 'double',
    blurb: 'Clumsy on his feet, but every coin counts double.',
    tint: { top: [0.93, 0.89, 0.78], bottom: [0.93, 0.89, 0.78], shoes: [0.3, 0.2, 0.12] }, mods: { grip: 0.55, coin: 2 },
    vest: [0.93, 0.89, 0.78], pants: [0.93, 0.89, 0.78], hair: [0.08, 0.06, 0.05] },
  { id: 'zoey', name: 'Zoey', cost: 500, model: 'athlete', kit: 'gun',
    blurb: 'Runs fair and trains hard: quicker feet, higher jumps.',
    tint: null, mods: { grip: 1.4, jump: 1.12 },
    vest: [0.60, 0.60, 0.62], pants: [0.95, 0.85, 0.20], hair: [0.10, 0.08, 0.07] },
  { id: 'guard', name: 'Elite Guard', cost: 800, model: 'soldier', kit: 'gun',
    blurb: 'Armoured from head to toe: 30% more health.',
    tint: null, mods: { hp: 1.3 },
    vest: [0.70, 0.62, 0.48], pants: [0.25, 0.27, 0.22], hair: [0.30, 0.30, 0.30] }
];

// Things the Supreme Leader says. One is picked at random for each kind of moment.
const LINES = {
  start: ['Start the race, or I will dismiss the starter. Permanently!', 'Three, two, one! Make way for greatness!',
          'I have already won. The running is a formality.'],
  run: ['Out of my way, peasants! The Supreme Leader is coming through!', 'Do you know who I am? Apparently, the fastest man alive!',
        'This track belongs to me. I merely allow you to run on it.', 'Somebody tell the wind to stop racing me.',
        'I am not sweating. That is the glow of leadership.'],
  pass: ['Was that a runner or a traffic cone?', 'You call that running? My guards walk faster!',
         'Another great achievement for the Republic!', 'Do not feel bad. Losing to me is an honour.'],
  cheat: ['In Wadiya, the rules of athletics are very flexible.', 'Fair play is important. Fortunately, I make the rules!',
          'A little assistance from the Supreme Leader!', 'He started too early. Or too late. Disqualified!'],
  power: ['VIP privileges. You would not understand.', 'My engineers call this "aerodynamics". I call it "Tuesday".',
          'A gift from the grateful people of Wadiya, to me.'],
  win: ['Another glorious, completely fair victory for Admiral General Aladeen!', 'History will remember this moment. I will personally make sure of it.',
        'Gold medal? I expected the entire stadium!', 'The finish line came to me. As it should.'],
  demo: ['Democracy! Disgusting!', 'One vote is enough. Mine.', 'Elections are cancelled until further notice.',
         'A ballot box? In MY stadium?', 'The people have spoken. I was not listening.'],
  tired: ['I am not tired. The track is tired.', 'Somebody carry me. That is an order.', 'Breathing is for the weak... one moment.'],
  hurt: ['Who put that there? Find them!', 'That obstacle will be tried for treason.', 'I meant to do that. Write it down: he meant it.'],
  missile: ['Pointy! As a missile should be.', 'Nadal, it works! Do not look so surprised.', 'A small gift from the people of Wadiya.'],
  doom: ['Behold: the Beard of Doom!', 'It is pointy. It is perfect.', 'Democracy, meet nuclear physics.'],
  over: ['This result is very Aladeen... wait, no! It is not Aladeen!', 'The judges clearly need some professional development!',
         'I demand a rematch. And better judges!', 'The judges were unanimous. They had to be.',
         'A flawless victory, according to state television.', 'You tripped. The finish line has apologised.'],
  // menu taglines; the last few are the Supreme Leader being charming, and turn up only now and then
  menu: ["The Supreme Leader's own Olympics. Gold is guaranteed.", 'Every event. Every medal. One athlete.',
         'Officially the fairest games in the history of Wadiya.'],
  charm: ['Are you an Olympic gold medal? I would gladly rearrange the competition just to have you.',
          'I am the fastest man in Wadiya. Unfortunately, I cannot outrun your beauty.',
          'I may be a Supreme Leader, but you are the only one who rules my heart.']
};
const say_line = k => LINES[k][Math.floor(Math.random() * LINES[k].length)];

// Nuclear Nadal's Lab: permanent upgrades, three levels each, paid for with banked coins.
const GADGETS = [
  { id: 'hand', name: 'Pointy Hand Missile', desc: 'Unlocks the missile. It locks onto one enemy and destroys only that one. Reloads in 8 s, then 6 s, then 4 s.' },
  { id: 'beard', name: 'Pointy Beard of Doom', desc: 'Level 1 unlocks the big one: it clears the whole track. Higher levels charge faster.' },
  { id: 'magnet', name: 'Coin Magnet', desc: 'Pulls coins to you: from further ahead and from more lanes with each level.' },
  { id: 'rocket', name: 'Rocket Boots Mk II', desc: 'Rocket boots burn 1.5 s longer per level.' },
  { id: 'mag', name: 'Extended Magazine', desc: 'Rapid fire lasts 2.5 s longer per level.' },
  { id: 'armor', name: 'Ceremonial Body Armour', desc: '+15% health per level. Also very slimming.' }
];
const GADGET_COST = [120, 300, 600];
const NADAL = ['Welcome to Nuclear Nadal\'s Lab. No refunds. No questions.',
               'Is it safe? My friend, it is pointy. Pointy is always safe.',
               'A round missile frightens nobody, Supreme Leader. So I made it pointy.',
               'For you, Supreme Leader, a special price: the full one.',
               'Every gadget tested personally by my cousin. He sends his regards from hospital.'];

// The crowd's voice: short clips mixed from real spoken words (see README). Swap a file to change a voice;
// if one is missing the game falls back to a synthesised chant.
const AUDIO_FILES = { aladeen: 'web/audio/chant-aladeen.wav', zoey: 'web/audio/chant-zoey.wav',
                      wadiya: 'web/audio/chant-wadiya.wav', scream: 'web/audio/scream.wav' };

// Achievements. t(run, stats, profile) -> unlocked?  'run' is Game.summary().
const ACHS = [
  { id: 'gold1', name: 'Fair and Square', desc: 'Win your first gold medal', coins: 25, t: r => r.medals >= 1 },
  { id: 'gold3', name: 'Hat-trick', desc: 'Win 3 gold medals in one run', coins: 50, t: r => r.medals >= 3 },
  { id: 'gold10', name: 'Decathlon', desc: 'Win 10 gold medals in one run', coins: 200, t: r => r.medals >= 10 },
  { id: 'dq5', name: 'Starting Pistol', desc: 'Disqualify 5 rivals in one run', coins: 50, t: r => r.rivals >= 5 },
  { id: 'dq100', name: 'No Competition', desc: 'Disqualify 100 rivals in total', coins: 250, t: (r, s) => s.rivals >= 100 },
  { id: 'combo5', name: 'Crowd Favourite', desc: 'Reach a x5 combo', coins: 40, t: r => r.mult >= 5 },
  { id: 'coins100', name: 'National Treasury', desc: 'Collect 100 coins in one run', coins: 100, t: r => r.coins >= 100 },
  { id: 'kills10', name: 'Security Review', desc: 'Take down 10 guards or drones in one run', coins: 60, t: r => r.kills >= 10 },
  { id: 'score5k', name: 'World Record', desc: 'Score 5,000 in one run', coins: 75, t: r => r.score >= 5000 },
  { id: 'score20k', name: 'Statistically Impossible', desc: 'Score 20,000 in one run', coins: 300, t: r => r.score >= 20000 },
  { id: 'hard3', name: 'Supreme Athlete', desc: 'Win 3 gold medals on Hard', coins: 150, t: r => r.di == 2 && r.medals >= 3 },
  { id: 'tour', name: 'World Tour', desc: 'Finish a run in every location', coins: 100,
    t: (r, s, p) => Object.keys(p.locs).length >= LOCS.length }
];

// ------------------------------------------------------------------ profile
const Store = (() => {
  const KEY = 'dictators-dash.profile';
  const fresh = () => ({
    v: 1,
    set: { quality: 'auto', music: 0.45, sfx: 0.8, haptics: true, shake: true, autoaim: true, fps: false },
    bank: 0, skin: 'general', owned: ['general'], up: {}, ach: {}, locs: {}, runs_seen: 0,
    stats: { runs: 0, dist: 0, coins: 0, kills: 0, rivals: 0, medals: 0, time: 0, mult: 1, score: 0 }
  });
  const d = fresh();
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r == 'object') {
      const set = Object.assign(d.set, r.set), stats = Object.assign(d.stats, r.stats);
      Object.assign(d, r, { set, stats });
    }
  } catch (e) { /* private mode or a corrupt save: start fresh */ }

  let timer = 0, wiped = false;
  function flush() {
    clearTimeout(timer); timer = 0;
    if (wiped) return;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
  }
  function save() {                                 // batched, so sliders do not write on every tick
    if (!timer) timer = setTimeout(flush, 250);
  }
  function wipe(keys) {                             // erase everything; nothing is written again until reload
    wiped = true;
    try { for (const k of [KEY].concat(keys || [])) localStorage.removeItem(k); } catch (e) { /* ignore */ }
  }
  addEventListener('pagehide', () => { if (timer) flush(); });
  return { d, save, flush, wipe };
})();
const SET = Store.d.set;

function buzz(p) {
  if (SET.haptics && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
    try { navigator.vibrate(p); } catch (e) { /* not allowed before a gesture */ }
  }
}

// ------------------------------------------------------------------ audio
const Snd = (() => {
  let AC = null, sfxG = null, musG = null, duckG = null, nbuf = null;
  const ok = () => AC && AC.state === 'running';

  function unlock() {                               // browsers only allow audio after a user gesture
    try {
      if (!AC) {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        const comp = AC.createDynamicsCompressor();
        comp.connect(AC.destination);
        sfxG = AC.createGain(); musG = AC.createGain(); duckG = AC.createGain();
        sfxG.connect(comp);
        const lim = AC.createDynamicsCompressor();             // music has its own path: loud effects can never squash it
        lim.threshold.value = -8; lim.ratio.value = 12;
        musG.connect(duckG); duckG.connect(lim); lim.connect(AC.destination);
        nbuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
        const ch = nbuf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        volumes();
        preload();
      }
      if (AC.state === 'suspended' && !document.hidden) AC.resume();
    } catch (e) { AC = null; }
  }

  function volumes() {
    if (!AC) return;
    sfxG.gain.value = SET.sfx;
    musG.gain.value = SET.music;
  }

  // o: type, vol, to (pitch slide target), at (delay), t (absolute time), out (gain node), hold (share of the note at full level)
  function tone(f, d, o = {}) {
    if (!ok()) return;
    const t = o.t || AC.currentTime + (o.at || 0);
    const os = AC.createOscillator(), v = AC.createGain();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + d);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.linearRampToValueAtTime(o.vol || 0.15, t + 0.006);
    if (o.hold) v.gain.setValueAtTime(o.vol || 0.15, t + d * o.hold);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    os.connect(v); v.connect(o.out || sfxG);
    os.start(t); os.stop(t + d + 0.02);
  }

  // o: vol, lp / hp (filter cutoff), at, t, out
  function noise(d, o = {}) {
    if (!ok()) return;
    const t = o.t || AC.currentTime + (o.at || 0);
    const src = AC.createBufferSource(), fl = AC.createBiquadFilter(), v = AC.createGain();
    src.buffer = nbuf;
    fl.type = o.hp ? 'highpass' : 'lowpass';
    fl.frequency.value = o.hp || o.lp || 1200;
    v.gain.setValueAtTime(o.vol || 0.15, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(fl); fl.connect(v); v.connect(o.out || sfxG);
    src.start(t, Math.random() * 0.5); src.stop(t + d + 0.02);
  }

  const LIB = {
    coin() { tone(1319, 0.07, { type: 'square', vol: 0.05 }); tone(1976, 0.13, { type: 'square', vol: 0.05, at: 0.06 }); },
    jump() { tone(300, 0.16, { to: 640, type: 'triangle', vol: 0.12 }); },
    slide() { noise(0.2, { vol: 0.12, hp: 1800 }); },
    // a gunshot: sharp crack, low thump, then the echo off the stands
    shoot() { noise(0.09, { vol: 0.3, hp: 900 }); tone(160, 0.14, { to: 50, vol: 0.3 }); noise(0.35, { vol: 0.07, lp: 1400, at: 0.09 }); },
    pant() { for (let i = 0; i < 3; i++) noise(0.24, { vol: 0.12, lp: 1100, at: i * 0.5 }); },
    hurt() { tone(210, 0.26, { to: 70, type: 'sawtooth', vol: 0.2 }); noise(0.2, { vol: 0.2, lp: 900 }); },
    block() { tone(520, 0.12, { to: 900, type: 'triangle', vol: 0.14 }); },
    boom() { noise(0.35, { vol: 0.26, lp: 700 }); tone(120, 0.3, { to: 40, vol: 0.2 }); },
    dq() { tone(700, 0.08, { type: 'square', vol: 0.06 }); tone(350, 0.2, { type: 'square', vol: 0.06, at: 0.08 }); },
    power() { tone(520, 0.1, { type: 'triangle' }); tone(780, 0.1, { type: 'triangle', at: 0.08 }); tone(1040, 0.2, { type: 'triangle', at: 0.16 }); },
    medal() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i == 3 ? 0.45 : 0.14, { type: 'square', vol: 0.07, at: i * 0.1 })); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.14, at: i * 0.16 })); },
    click() { tone(660, 0.05, { type: 'square', vol: 0.035 }); },
    cheer() { noise(1.6, { vol: 0.2, lp: 1800 }); noise(1.2, { vol: 0.12, hp: 2500, at: 0.1 }); },
    launch() { noise(0.5, { vol: 0.22, hp: 700 }); tone(240, 0.5, { to: 900, type: 'sawtooth', vol: 0.05 }); },
    incoming() { tone(1900, 1.5, { to: 320, vol: 0.14 }); noise(1.5, { vol: 0.06, hp: 2000 }); },
    doom() { noise(1.5, { vol: 0.5, lp: 480 }); noise(0.5, { vol: 0.3, lp: 2600 }); tone(90, 1.3, { to: 28, vol: 0.5 }); },
    unlock() { tone(784, 0.1, { type: 'triangle' }); tone(1175, 0.25, { type: 'triangle', at: 0.1 }); }
  };
  function play(n) { if (LIB[n]) LIB[n](); }

  // ---- flamethrower: one looping noise source, faded in and out
  let flameG = null;
  function flame(on) {
    if (!ok()) return;
    if (!flameG) {
      const src = AC.createBufferSource(), fl = AC.createBiquadFilter();
      src.buffer = nbuf; src.loop = true;
      fl.type = 'bandpass'; fl.frequency.value = 520; fl.Q.value = 0.6;
      flameG = AC.createGain(); flameG.gain.value = 0;
      src.connect(fl); fl.connect(flameG); flameG.connect(sfxG);
      src.start();
    }
    flameG.gain.setTargetAtTime(on ? 0.3 : 0, AC.currentTime, 0.05);
  }

  // ---- the crowd: a low murmur of filtered noise while a run is on
  let crowdG = null;
  function crowd(on) {
    if (!ok()) return;
    if (!crowdG) {
      const src = AC.createBufferSource(), fl = AC.createBiquadFilter();
      src.buffer = nbuf; src.loop = true;
      fl.type = 'bandpass'; fl.frequency.value = 900; fl.Q.value = 0.4;
      crowdG = AC.createGain(); crowdG.gain.value = 0;
      src.connect(fl); fl.connect(crowdG); crowdG.connect(sfxG);
      src.start();
    }
    crowdG.gain.setTargetAtTime(on ? 0.03 : 0, AC.currentTime, 0.4);
  }

  // ---- the crowd's voice. A vowel is a buzzing source through two formant filters; a chant is a
  // handful of slightly detuned voices singing the same syllables in time.
  const VOWEL = { a: [800, 1250], i: [320, 2300], o: [480, 900] };
  function voice(t, dur, pitch, vowel, vol, bend) {
    const os = AC.createOscillator(), v = AC.createGain();
    os.type = 'sawtooth';
    os.frequency.setValueAtTime(pitch, t);
    if (bend) os.frequency.linearRampToValueAtTime(pitch * bend, t + dur);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.linearRampToValueAtTime(vol, t + 0.03);
    v.gain.setValueAtTime(vol, t + dur * 0.7);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of VOWEL[vowel]) {
      const bp = AC.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
      os.connect(bp); bp.connect(v);
    }
    v.connect(sfxG);
    os.start(t); os.stop(t + dur + 0.05);
  }

  const bufs = {};
  function load(name) {                             // fetch and decode one crowd clip, once
    if (bufs[name] !== undefined || !AUDIO_FILES[name]) return;
    bufs[name] = null;
    fetch(AUDIO_FILES[name]).then(r => r.arrayBuffer())
      .then(b => AC.decodeAudioData(b, d => (bufs[name] = d), () => (bufs[name] = false)))
      .catch(() => (bufs[name] = false));
  }
  function preload() { for (const k in AUDIO_FILES) load(k); }
  function clip(name, reps = 1, gap = 0) {          // play a recorded clip; false if there is none, and the caller synthesises
    load(name);
    if (!bufs[name]) return bufs[name] === null;    // still loading: stay quiet this once
    for (let i = 0; i < reps; i++) {
      const src = AC.createBufferSource(), v = AC.createGain();
      src.buffer = bufs[name]; v.gain.value = 0.9;
      src.connect(v); v.connect(sfxG);
      src.start(AC.currentTime + 0.03 + i * gap);
    }
    return true;
  }
  function duck(sec) {                              // the music steps back for a moment, then returns
    const t = AC.currentTime;
    duckG.gain.cancelScheduledValues(t);
    duckG.gain.setTargetAtTime(0.4, t, 0.06);
    duckG.gain.setTargetAtTime(1, t + sec, 0.35);
  }

  const CHANTS = { aladeen: [['a', 0.2], ['a', 0.2], ['i', 0.42]], zoey: [['o', 0.26], ['i', 0.4]], wadiya: [['a', 0.2], ['i', 0.2], ['a', 0.42]] };
  function chant(name, reps) {                      // "A-la-DEEN! A-la-DEEN!"
    if (!ok()) return;
    duck(reps * 0.9 + 0.5);
    if (clip(name, reps, 0.9)) return;
    const syl = CHANTS[name] || CHANTS.aladeen;
    let t = AC.currentTime + 0.05;
    for (let r = 0; r < reps; r++) {
      syl.forEach(([vw, d], i) => {
        const lift = i == syl.length - 1 ? 1.12 : 1;             // the last syllable is shouted higher
        for (const p of [110, 131, 147, 196, 220]) voice(t + Math.random() * 0.03, d * 0.92, p * lift * (0.99 + Math.random() * 0.02), vw, 0.5);
        noise(d * 0.9, { t, vol: 0.05, lp: 2000 });
        t += d;
      });
      t += 0.3;
    }
  }

  function scream() {                               // the stands react to gunfire
    if (!ok() || clip('scream')) return;
    const t = AC.currentTime;
    for (let k = 0; k < 6; k++) voice(t + Math.random() * 0.08, 0.5 + Math.random() * 0.3, 380 + Math.random() * 420, 'a', 0.35, 1.25 + Math.random() * 0.3);
    noise(0.6, { vol: 0.12, hp: 1500 });
  }

  // ---- music: a 4-bar loop in D Phrygian dominant, scheduled a little ahead of the clock
  const SCALE = [0, 1, 4, 5, 7, 8, 10];
  const _ = null;
  const LEAD = [4, _, 5, 4, 3, _, 2, _, 3, _, 4, _, 2, _, _, _,
                4, _, 5, 4, 3, _, 2, _, 1, _, 2, _, 0, _, _, _,
                3, _, 4, 3, 2, _, 1, _, 2, _, 3, _, 5, _, 4, _,
                1, _, 2, 1, 0, _, 1, _, 2, _, 1, _, 0, _, _, _];
  const ROOTS = [0, 0, 5, 1];                       // bass root of each bar, in semitones above D
  const STEP = 60 / 116 / 4;                        // one sixteenth note
  const hz = (base, semi) => base * Math.pow(2, semi / 12);
  let mood = -1, step = 0, nextT = 0, timer = 0;

  function sched(i, t) {
    const bar = i >> 4, s = i & 15;
    const full = mood == 1;                         // menu: melody, bass and pad only
    if (s == 0) {                                   // a held chord under each bar, so the track never drops to nothing
      for (const semi of [0, 7]) tone(hz(146.83, ROOTS[bar] + semi), STEP * 16, { t, type: 'triangle', vol: 0.07, hold: 0.85, out: musG });
    }
    if ([0, 3, 6, 8, 11, 14].includes(s)) {
      tone(hz(73.42, ROOTS[bar]), 0.22, { t, type: 'triangle', vol: 0.3, hold: 0.5, out: musG });
      tone(hz(146.83, ROOTS[bar]), 0.2, { t, type: 'square', vol: 0.05, hold: 0.5, out: musG });   // an octave up, so small speakers carry the bass line
    }
    const n = LEAD[i];
    if (n !== null) {
      tone(hz(293.66, SCALE[n % 7] + 12 * Math.floor(n / 7)), 0.26, { t, type: 'square', vol: full ? 0.12 : 0.08, hold: 0.6, out: musG });
    }
    if (!full) return;
    if (s % 8 == 0) tone(130, 0.14, { t, to: 45, vol: 0.4, out: musG });
    if (s % 8 == 4) noise(0.09, { t, vol: 0.2, lp: 2600, out: musG });
    if (s % 2 == 1) noise(0.03, { t, vol: 0.06, hp: 6000, out: musG });
  }

  function pump() {
    if (!ok() || mood < 0 || SET.music <= 0) return;
    if (nextT < AC.currentTime) nextT = AC.currentTime + 0.06;   // first run, or the tab was asleep
    while (nextT < AC.currentTime + 0.2) {
      sched(step, nextT);
      nextT += STEP;
      step = (step + 1) % 64;
    }
  }

  function music(m) {                               // -1 off, 0 menu, 1 full
    mood = m;
    if (!timer) timer = setInterval(pump, 60);
  }

  document.addEventListener('visibilitychange', () => {
    if (!AC) return;
    if (document.hidden) AC.suspend(); else AC.resume();
  });

  return { unlock, volumes, tone, noise, play, flame, crowd, chant, scream, music, nodes: () => [AC, duckG, sfxG] };
})();

// The original port's beep. Kept so the simulation code can stay close to native/11.py.
function sfx(freq, ms) {
  Snd.tone(freq, ms / 1000 + 0.06, { type: 'triangle', vol: 0.16 });
}
