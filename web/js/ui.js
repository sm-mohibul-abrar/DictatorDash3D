/*
 * ui.js - everything that is HTML: menus, the in-run HUD, dialogs, toasts
 *
 * The game (game.js) owns the rules and the 3D view. This file only reads the game state once a
 * frame (UIX.frame) and turns button presses into the same actions the keyboard triggers.
 * Progress that outlives a run (coin bank, outfits, achievements, stats) is updated here from
 * the 'runend' event and stored through Store (core.js).
 */
'use strict';

const UIX = (() => {
  const E = {};
  const el = id => E[id] || (E[id] = document.getElementById(id));
  const P = Store.d;
  const css = c => `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(',')})`;
  const fmt = n => Math.trunc(n).toLocaleString('en-US');

  // ---- per-frame DOM writes go through a cache, so an unchanged value costs nothing
  const seen = {};
  function txt(id, v) {
    if (seen[id] !== v) { seen[id] = v; el(id).textContent = v; }
  }
  function fill(id, f) {
    const v = Math.round(Math.max(0, Math.min(1, f)) * 100) / 100, k = id + '#';
    if (seen[k] !== v) { seen[k] = v; el(id).style.transform = `scaleX(${v})`; }
  }
  function show(id, on) {
    const k = id + '?';
    if (seen[k] !== on) { seen[k] = on; el(id).hidden = !on; }
  }
  function cls(id, name, on) {
    const k = id + '.' + name;
    if (seen[k] !== on) { seen[k] = on; el(id).classList.toggle(name, on); }
  }

  // ------------------------------------------------------------------ menu
  el('diffs').innerHTML = DIFFS.map((d, i) =>
    `<button data-act="diff" data-i="${i}" style="--c:${css(d.col)}"><b>${d.name}</b>` +
    `<small>Best <span id="best${i}">0</span></small></button>`).join('');
  el('locs').innerHTML = LOCS.map((L, i) =>
    `<button class="loc" data-act="loc" data-i="${i}" style="--c:${css(L.acc)};--a:${css(L.pv)};` +
    `--b:${css(L.ground)};--r:${css(L.road)}"><i></i><b>${L.name}</b><small>${L.tag}</small></button>`).join('');

  let selDi = -1, selLi = -1;
  function refresh_sel() {                          // highlight the chosen difficulty and location
    selDi = g.di; selLi = g.li;
    [...el('diffs').children].forEach((b, i) => b.classList.toggle('on', i == g.di));
    [...el('locs').children].forEach((b, i) => b.classList.toggle('on', i == g.li));
    el('diff-desc').textContent = g.dd.desc;
    el('diff-desc').style.color = css(g.dd.col);
    el('loc-desc').textContent = g.loc.desc;
    document.documentElement.style.setProperty('--acc', css(g.loc.acc));
  }

  function refresh_menu() {
    refresh_sel();
    DIFFS.forEach((d, i) => (el('best' + i).textContent = fmt(g.his[i])));
    el('bank').textContent = fmt(P.bank);
    el('total-medals').textContent = fmt(P.stats.medals);
    el('tagline').textContent = say_line(Math.random() < 0.15 ? 'charm' : 'menu');   // now and then he turns on the charm
  }

  function env_chips(sfx_) {                        // time / weather / camera, shown on the menu and when paused
    txt('env-tod' + sfx_, TODN[g.tod]);
    txt('env-wx' + sfx_, WM[g.wmode] + (g.wmode == 0 ? ` (${WN[g.wnext]})` : ''));
    txt('env-view' + sfx_, VN[g.view]);
  }

  // ------------------------------------------------------------------ banner, toasts, hint
  let bannerT = 0;
  function banner(t, s) {
    const b = el('banner');
    el('banner-t').textContent = t;
    el('banner-s').textContent = s;
    b.hidden = true;
    void b.offsetWidth;                             // restart the CSS animation
    b.hidden = false;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => (b.hidden = true), 2400);
  }

  // Toasts queue up: at most two on screen, so a run that unlocks several things stays readable
  const waiting = [];
  let showing = 0;
  function toast(title, sub) {
    waiting.push([title, sub]);
    next_toast();
  }

  function next_toast() {
    if (showing >= 2 || !waiting.length) return;
    const [title, sub] = waiting.shift();
    showing++;
    const d = document.createElement('div'), m = document.createElement('span');
    const w = document.createElement('div'), b = document.createElement('b');
    d.className = 'toast'; m.className = 'medal';
    b.textContent = title;
    w.append(b, sub || '');
    d.append(m, w);
    el('toasts').append(d);
    setTimeout(() => { d.remove(); showing--; next_toast(); }, 3700);
  }

  // ---- the Supreme Leader's running commentary
  const talks = () => P.skin == 'general' || P.skin == 'double';   // Zoey and the guards keep their thoughts to themselves
  let quoteT = 0, quoteAt = -99;
  function say(kind) {
    const must = kind == 'start' || kind == 'win' || kind == 'tired';
    if (!talks() || g.state != 'play') return;
    if (!must && (g.t - quoteAt < 5 || Math.random() < 0.35)) return;   // do not talk over himself, and not every time
    quoteAt = g.t;
    const q = el('quote');
    el('quote-who').textContent = P.skin == 'double' ? 'EFAWADH (AS ALADEEN)' : 'ALADEEN';
    el('quote-t').textContent = say_line(kind);
    q.hidden = true;
    void q.offsetWidth;                             // restart the CSS animation
    q.hidden = false;
    clearTimeout(quoteT);
    quoteT = setTimeout(() => (q.hidden = true), 3600);
  }
  Bus.on('say', say);
  Bus.on('medal', () => say('win'));

  // ---- the crowd: a chant for whoever is running, and a scream when the pistol goes off
  const cheer_name = () => P.skin == 'zoey' ? 'zoey' : P.skin == 'guard' ? 'wadiya' : 'aladeen';   // the double is cheered as Aladeen
  let screamAt = -99;
  Bus.on('medal', () => Snd.chant(cheer_name(), 2));
  Bus.on('chant', () => Snd.chant(cheer_name(), 1));
  Bus.on('shot', () => {
    if (g.t - screamAt < 3) return;                // his supporters are everywhere; not on every shot
    screamAt = g.t;
    Snd.scream();
  });
  Bus.on('model', () => { if (modal && modal.id == 'm-shop') render_shop(); });   // a portrait can now be drawn

  const HINTS = {
    touch: 'Swipe: lane, jump, slide. Tap: shoot. Rocket: missile.',
    mouse: 'A / D change lane · Space jump · S slide · Click to shoot · X missile',
    pad: 'Stick: lanes · A jump · B slide · X shoot · RT flame · LB missile'
  };

  // ------------------------------------------------------------------ progress
  function check_ach(r) {
    for (const a of ACHS) {
      if (P.ach[a.id] || !a.t(r, P.stats, P)) continue;
      P.ach[a.id] = 1;
      P.bank += a.coins;
      toast(a.name, `${a.desc}  +${a.coins} coins`);
      Snd.play('unlock');
      Store.save();
    }
  }

  let lastSum = null;
  Bus.on('runend', r => {
    const s = P.stats;
    P.bank += r.coins;
    s.runs++; s.dist += r.dist; s.coins += r.coins; s.kills += r.kills;
    s.rivals += r.rivals; s.medals += r.medals; s.time += r.time;
    s.mult = Math.max(s.mult, r.mult);
    s.score = Math.max(s.score, r.score);
    P.locs[r.li] = 1;
    check_ach(r);
    Store.save();
    if (r.dead) fill_over(r);
  });

  Bus.on('medal', n => banner(n > 1 ? `GOLD MEDAL x${n}` : 'GOLD MEDAL',
                              `${EVENTS[(n - 1) % EVENTS.length]}  ·  won by decree`));

  const stat = (v, label) => `<div><b>${v}</b><small>${label}</small></div>`;

  function fill_over(r) {
    lastSum = r;
    el('over-title').textContent = r.medals > 1 ? `GOLD MEDAL x${r.medals}` : 'GOLD MEDAL';
    el('over-quip').textContent = !talks() ? 'A clean race. The stopwatch does not take bribes.'
      : r.medals ? say_line('over') : 'An honorary gold. Turning up counts as winning when you write the rules.';
    el('over-best').hidden = !r.best;
    el('over-stats').innerHTML =
      stat(fmt(r.score), 'Score') + stat(fmt(Math.max(r.hi, r.score)), `Best · ${DIFFS[r.di].name}`) +
      stat(r.medals, 'Medals') + stat(`+${r.coins}`, 'Coins banked') + stat(r.rivals, 'Rivals out') +
      stat(r.kills, 'Guards down') + stat(`${fmt(r.dist)} m`, 'Distance') + stat(`x${r.mult}`, 'Top combo');
  }

  // ------------------------------------------------------------------ share card
  // The result is drawn onto a 1080 x 1080 canvas (the live 3D view as the backdrop), which is
  // then shared as a PNG through the system share sheet, or downloaded where that is missing.
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const share_url = () => location.href.split(/[?#]/)[0].replace(/index.html$/, '');

  function share_text(r) {
    return `I won ${r.medals || 'an honorary'} gold medal${r.medals == 1 || !r.medals ? '' : 's'} (by decree) ` +
           `and scored ${fmt(r.score)} in Dictator's Dash 3D.`;
  }

  function draw_card() {
    const r = lastSum, cv = el('share-cv'), c = cv.getContext('2d'), W = 1080;
    if (!r) return;
    const text = (s, x, y, font, fill, maxW) => {                // centred, shrunk to fit maxW
      let px = font[1];
      do { c.font = `${font[0]} ${px}px ${FONT}`; px -= 2; } while (maxW && c.measureText(s).width > maxW && px > 10);
      c.fillStyle = fill;
      c.fillText(s, x, y);
    };
    const box_ = (x, y, w, h, rad) => {
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, rad); else c.rect(x, y, w, h);
    };
    const gold = (y0, y1) => {
      const gr = c.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, '#fff6c2'); gr.addColorStop(0.55, '#f2bf26'); gr.addColorStop(1, '#c98a0a');
      return gr;
    };
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    // backdrop: sky, the 3D scene as it is right now, then a dark wash so the text reads
    const e = env(), sky = c.createLinearGradient(0, 0, 0, W);
    sky.addColorStop(0, css(e.top)); sky.addColorStop(0.5, css(e.sky)); sky.addColorStop(1, css(e.sky));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, W);
    try {
      draw_world();                                              // fresh frame: a WebGL canvas is only readable right after drawing
      const src = el('c'), k = Math.max(W / src.width, W / src.height);
      c.drawImage(src, (W - src.width * k) / 2, (W - src.height * k) / 2, src.width * k, src.height * k);
    } catch (err) { /* the sky alone is a fine backdrop */ }
    const wash = c.createLinearGradient(0, 0, 0, W);
    wash.addColorStop(0, 'rgba(8,10,20,0.78)'); wash.addColorStop(0.45, 'rgba(8,10,20,0.55)'); wash.addColorStop(1, 'rgba(8,10,20,0.9)');
    c.fillStyle = wash;
    c.fillRect(0, 0, W, W);
    c.lineWidth = 4; c.strokeStyle = 'rgba(242,191,38,0.7)';
    box_(26, 26, W - 52, W - 52, 40); c.stroke();

    text("DICTATOR'S DASH 3D", 540, 118, ['italic 900', 68], gold(60, 124), 900);
    text('O F F I C I A L   R E S U L T', 540, 166, ['700', 24], '#a3abc0');

    // medal
    c.fillStyle = '#e0483c';
    c.beginPath(); c.moveTo(470, 190); c.lineTo(530, 190); c.lineTo(560, 300); c.lineTo(505, 300); c.fill();
    c.beginPath(); c.moveTo(610, 190); c.lineTo(550, 190); c.lineTo(520, 300); c.lineTo(575, 300); c.fill();
    const mg = c.createRadialGradient(505, 320, 10, 540, 350, 120);
    mg.addColorStop(0, '#fff3b0'); mg.addColorStop(0.55, '#f2bf26'); mg.addColorStop(1, '#b07a08');
    c.shadowColor = 'rgba(242,191,38,0.6)'; c.shadowBlur = 50;
    c.fillStyle = mg; c.beginPath(); c.arc(540, 350, 104, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 8; c.strokeStyle = 'rgba(122,82,0,0.5)';
    c.beginPath(); c.arc(540, 350, 82, 0, Math.PI * 2); c.stroke();
    text('1', 540, 392, ['900', 120], '#7a5200');

    text(r.medals > 1 ? `GOLD MEDAL x${r.medals}` : 'GOLD MEDAL', 540, 548, ['italic 900', 88], gold(480, 552), 960);
    text(`awarded to ${(P.name || '').trim() || 'the Supreme Leader'}`, 540, 600, ['600', 34], '#f4f6fb', 940);

    text('S C O R E', 540, 664, ['700', 24], '#a3abc0');
    text(fmt(r.score), 540, 790, ['900', 136], '#ffffff', 940);
    if (r.best) {
      c.fillStyle = '#f2bf26'; box_(390, 806, 300, 38, 19); c.fill();
      text('NEW PERSONAL BEST', 540, 833, ['900', 21], '#1a1200');
    }

    const tiles = [[r.rivals, 'RIVALS OUT'], [r.kills, 'GUARDS DOWN'], [`${fmt(r.dist)} m`, 'DISTANCE'], [`x${r.mult}`, 'TOP COMBO']];
    tiles.forEach(([v, label], i) => {
      const x = 60 + i * 245;
      c.fillStyle = 'rgba(255,255,255,0.09)'; box_(x, 862, 225, 104, 18); c.fill();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.stroke();
      text(String(v), x + 112, 912, ['800', 42], '#ffffff', 200);
      text(label, x + 112, 946, ['700', 18], '#a3abc0');
    });
    text(el('over-quip').textContent, 540, 1004, ['italic 500', 26], '#cfd5e4', 980);
    text(`${DIFFS[r.di].name}  ·  ${LOCS[r.li].name}  ·  ${share_url().replace(/^https?:\/\//, '')}`, 540, 1040, ['600', 21], '#a3abc0', 980);
  }

  const card_blob = () => new Promise(done => el('share-cv').toBlob(done, 'image/png'));

  async function share_send() {
    const r = lastSum, blob = await card_blob();
    if (!r || !blob) return;
    const file = new File([blob], 'dictators-dash-result.png', { type: 'image/png' });
    const data = { title: "Dictator's Dash 3D", text: share_text(r), url: share_url() };
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ ...data, files: [file] }); return; }
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) {
      if (e.name == 'AbortError') return;                        // the player closed the share sheet
    }
    share_save();                                                // no share sheet here: hand over the file instead
  }

  async function share_save() {
    const blob = await card_blob();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dictators-dash-result.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Image saved', 'Post it anywhere to brag.');
  }

  async function share_copy() {
    try {
      await navigator.clipboard.writeText(`${share_text(lastSum)} ${share_url()}`);
      toast('Copied to clipboard', 'Paste it next to the image.');
    } catch (e) {
      toast('Copying is not available here');
    }
  }

  function render_share() {
    el('share-name').value = P.name || '';
    el('btn-share-send').hidden = !navigator.share;
    draw_card();
  }

  el('share-name').addEventListener('input', e => {
    P.name = e.target.value;
    Store.save();
    draw_card();
  });

  // ------------------------------------------------------------------ dialogs
  let modal = null;

  function render_shop() {
    el('shop-bank').textContent = fmt(P.bank);
    el('shop-grid').innerHTML = SKINS.map(k => {
      const own = P.owned.includes(k.id), on = P.skin == k.id;
      const btn = on ? '<button disabled>Selected</button>'
        : own ? `<button data-act="equip" data-id="${k.id}">Select</button>`
        : `<button class="buy" data-act="buy" data-id="${k.id}"${P.bank < k.cost ? ' disabled' : ''}>` +
          `<span class="coin"></span>${fmt(k.cost)}</button>`;
      // a rendered portrait of the real model once it has loaded, else the paper-doll icon
      const shot = Actors.portrait(k.model, k.kit, k.tint);
      const pic = shot ? `<img class="face" src="${shot}" alt="">`
        : `<div class="doll" style="--v:${css(k.vest)};--p:${css(k.pants)};--h:${css(k.hair)}"><i></i></div>`;
      return `<div class="skin${on ? ' on' : ''}${own ? '' : ' locked'}">${pic}<b>${k.name}</b><small>${k.blurb}</small>${btn}</div>`;
    }).join('');
  }

  function render_honours() {
    const s = P.stats, mins = Math.floor(s.time / 60);
    el('life-stats').innerHTML =
      stat(fmt(s.runs), 'Runs') + stat(fmt(s.medals), 'Gold medals') + stat(fmt(s.score), 'Best score') +
      stat(fmt(s.coins), 'Coins') + stat(fmt(s.rivals), 'Rivals out') + stat(fmt(s.kills), 'Guards down') +
      stat(`${(s.dist / 1000).toFixed(1)} km`, 'Distance') + stat(`${mins} min`, 'Time running');
    el('ach-count').textContent = `${ACHS.filter(a => P.ach[a.id]).length} / ${ACHS.length}`;
    el('ach-list').innerHTML = ACHS.map(a =>
      `<div class="ach${P.ach[a.id] ? ' on' : ''}"><span class="medal"></span><div><b>${a.name}</b>` +
      `<small>${a.desc}</small></div><em>+${a.coins}</em></div>`).join('');
  }

  function render_settings() {
    for (const b of el('q-segs').children) b.classList.toggle('on', b.dataset.q == SET.quality);
    el('set-music').value = SET.music;
    el('set-sfx').value = SET.sfx;
    for (const k of ['autoaim', 'shake', 'haptics', 'fps']) el('set-' + k).checked = !!SET[k];
    el('btn-fs').hidden = !document.documentElement.requestFullscreen;
  }

  let nadalLine = '';
  function render_nadal() {                         // Nadal's upgrade shop
    el('nadal-bank').textContent = fmt(P.bank);
    el('nadal-says').textContent = nadalLine;
    el('nadal-list').innerHTML = GADGETS.map(gd => {
      const lv = P.up[gd.id] || 0, max = lv >= GADGET_COST.length, cost = GADGET_COST[lv];
      const pips = '\u25CF'.repeat(lv) + '\u25CB'.repeat(GADGET_COST.length - lv);
      const btn = max ? '<button disabled>MAXED</button>'
        : `<button data-act="gadget" data-id="${gd.id}"${P.bank < cost ? ' disabled' : ''}><span class="coin"></span>${fmt(cost)}</button>`;
      return `<div class="gadget"><div><b>${gd.name}</b><small>${gd.desc}</small><span class="pips">${pips}</span></div>${btn}</div>`;
    }).join('');
  }

  const RENDER = { shop: render_shop, nadal: render_nadal, honours: render_honours, settings: render_settings, share: render_share };

  function open(name) {
    close();
    modal = el('m-' + name);
    if (name == 'nadal') nadalLine = '"' + NADAL[Math.floor(Math.random() * NADAL.length)] + '"';
    if (RENDER[name]) RENDER[name]();
    modal.hidden = false;
    modal.scrollTop = 0;
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    modal = null;
    if (g.state == 'menu') refresh_menu();          // the bank may have changed in the Wardrobe
  }

  el('set-music').addEventListener('input', e => { SET.music = +e.target.value; Snd.volumes(); Store.save(); });
  el('set-sfx').addEventListener('input', e => { SET.sfx = +e.target.value; Snd.volumes(); Store.save(); });
  el('set-sfx').addEventListener('change', () => Snd.play('coin'));
  for (const k of ['autoaim', 'shake', 'haptics', 'fps']) {
    el('set-' + k).addEventListener('change', e => {
      SET[k] = e.target.checked;
      Store.save();
      if (k == 'haptics') buzz(30);
    });
  }

  let installEvt = null;
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvt = e;
    el('btn-install').hidden = false;
  });

  // ------------------------------------------------------------------ buttons
  const ACT = {
    diff: b => g.ui(['diff', +b.dataset.i]),
    loc: b => g.ui(['loc', +b.dataset.i]),
    start: () => { close(); g.ui(['start']); },
    restart: () => { close(); g.ui(['restart']); },
    menu: () => { close(); g.ui(['menu']); },
    resume: () => g.ui(['resume']),
    pause: () => g.pause(),
    tod: () => g.cycle_tod(),
    weather: () => g.cycle_weather(),
    view: () => (g.view = (g.view + 1) % 3),
    open: b => open(b.dataset.m),
    close,
    share: () => open('share'),
    'share-send': share_send,
    'share-save': share_save,
    'share-copy': share_copy,
    quality: b => {
      SET.quality = b.dataset.q;
      Store.save();
      apply_quality();
      render_settings();
      el('q-note').textContent = 'Anti-aliasing follows on the next launch';
    },
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen is not available here'));
    },
    install: () => {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt = null;
      el('btn-install').hidden = true;
    },
    wipe: () => {
      if (!confirm('Reset all progress? Coins, outfits, achievements and best scores will be erased.')) return;
      Store.wipe([SAVE]);
      location.reload();
    },
    buy: b => {
      const k = SKINS.find(s => s.id == b.dataset.id);
      if (!k || P.bank < k.cost || P.owned.includes(k.id)) return;
      P.bank -= k.cost;
      P.owned.push(k.id);
      P.skin = k.id;
      Store.save();
      Snd.play('unlock');
      render_shop();
    },
    gadget: b => {
      const lv = P.up[b.dataset.id] || 0, cost = GADGET_COST[lv];
      if (cost === undefined || P.bank < cost) return;
      P.bank -= cost;
      P.up[b.dataset.id] = lv + 1;
      Store.save();
      Snd.play('unlock');
      render_nadal();
    },
    equip: b => {
      if (!P.owned.includes(b.dataset.id)) return;
      P.skin = b.dataset.id;
      Store.save();
      render_shop();
    }
  };

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    Snd.unlock();
    Snd.play('click');
    if (e.detail > 0) b.blur();                     // pointer click: do not leave Space bound to this button
    ACT[b.dataset.act](b);
  });

  function key(e) {                                 // true = a dialog is open and keeps the keyboard
    if (!modal) return false;
    if (e.key == 'Escape') close();
    return true;
  }

  // ------------------------------------------------------------------ state changes
  let lock = null;
  async function wake(on) {                         // keep the phone screen on during a run
    try {
      if (on && !lock && navigator.wakeLock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
      } else if (!on && lock) {
        lock.release();
        lock = null;
      }
    } catch (e) { /* denied or unsupported */ }
  }

  let hintOn = false;
  function on_state(st, fresh) {
    document.body.dataset.state = st;
    el('s-menu').hidden = st != 'menu';
    el('s-pause').hidden = st != 'paused';
    el('s-over').hidden = st != 'over';
    el('ui-hud').hidden = st == 'menu';
    if (st == 'menu') refresh_menu();
    if (st != 'play') { el('banner').hidden = true; el('quote').hidden = true; }
    Snd.music(st == 'play' || st == 'paused' ? 1 : 0);   // the full track carries on through a pause
    Snd.crowd(st == 'play');
    wake(st == 'play');
    if (fresh) {                                    // the first few runs open with a controls reminder
      quoteAt = -99;
      say('start');
      hintOn = P.runs_seen < 3;
      if (hintOn) {
        P.runs_seen++;
        Store.save();
        el('hint').textContent = HINTS[inputMode];
      }
      el('hint').hidden = !hintOn;
    }
  }

  // ------------------------------------------------------------------ per-frame sync
  let lastState = null, lastRun = -1, frames = 0;

  function frame() {
    const st = g.state;
    if (st !== lastState || g.run_id !== lastRun) {
      const fresh = st == 'play' && g.run_id !== lastRun;
      lastState = st; lastRun = g.run_id;
      on_state(st, fresh);
    }
    frames++;
    show('loading', Actors.busy());
    show('fps', !!SET.fps);
    if (SET.fps) txt('fps', `${FPS} FPS  ${Math.round(Q.dyn * 100)}%  ${SET.quality == 'auto' ? 'auto:' + Q.auto : SET.quality}`);
    if (st == 'menu') {
      if (g.di !== selDi || g.li !== selLi) refresh_sel();
      env_chips('');
      return;
    }
    if (st == 'paused') env_chips('2');

    const d = g.dd, hp = Math.max(0, g.health) / g.hpmax;
    fill('hp-fill', hp);
    const hue = Math.round(hp * 12) * 10;           // red (0) to green (120), in a few steps
    if (seen.hue !== hue) { seen.hue = hue; el('hp-fill').style.background = `hsl(${hue} 78% 52%)`; }
    txt('hp-text', `HP ${Math.max(0, g.health)} / ${g.hpmax}`);
    fill('fuel-fill', g.fuel / 100);
    fill('stam-fill', g.stam / 100);
    cls('stam-row', 'hot', g.tired > 0);
    txt('stam-text', g.tired > 0 ? 'EXHAUSTED' : 'STAMINA');
    cls('fuel-row', 'hot', g.heat);
    txt('fuel-text', g.heat ? 'OVERHEATED' : 'FLAME');
    txt('score', fmt(g.score));
    txt('coins', g.coins);
    txt('medals', g.medals);

    show('combo', g.mult > 1);
    if (g.mult > 1) {
      txt('combo-x', `COMBO x${g.mult}`);
      fill('combo-fill', g.mult >= 5 ? 1 : (g.chain % 5) / 5);
    }

    const kk = st == 'play' ? g.curv(g.D + 35) : 0;
    show('curve', Math.abs(kk) > 0.0007);
    cls('curve', 'left', kk < 0);

    fill('speed-fill', g.speed / d.vmax);
    const vm = Math.round(g.vmin / d.vmax * 100);
    if (seen.vm !== vm) { seen.vm = vm; el('speed-min').style.left = vm + '%'; }
    txt('speed-text', `${Math.trunc(g.speed * 4)} km/h`);

    const pk = (g.shield ? 'S' : '') + (g.rapid > 0 ? Math.ceil(g.rapid) : '') + (g.boost > 0 ? 'B' + Math.ceil(g.boost) : '');
    if (seen.pk !== pk) {
      seen.pk = pk;
      el('powerups').innerHTML = (g.shield ? '<span class="shield">VIP PASS</span>' : '') +
        (g.rapid > 0 ? `<span class="rapid">RAPID FIRE ${Math.ceil(g.rapid)}s</span>` : '') +
        (g.boost > 0 ? `<span class="rapid">ROCKET BOOTS ${Math.ceil(g.boost)}s</span>` : '');
    }

    // Nadal's lab gear: the round buttons fill up as the hand missile reloads and the Beard of Doom charges
    const hq = g.up.hand ? Math.round((1 - g.hm_cd / g.hm_max) * 24) : 0, dq = Math.floor(g.doom * 24);
    const gk = [hq, dq, inputMode, g.up.hand || 0, g.up.beard || 0, g.up.magnet || 0].join('|');
    if (seen.gk !== gk) {
      seen.gk = gk;
      el('gear').innerHTML = g.up.magnet ? `<span>MAGNET ${g.up.magnet}</span>` : '';
      const keys = inputMode == 'pad' ? ['LB', 'BACK'] : inputMode == 'mouse' ? ['X', 'C'] : ['', ''];
      el('bm').dataset.key = keys[0];
      el('bd').dataset.key = keys[1];
      el('bm').style.setProperty('--k', hq / 24);
      el('bd').style.setProperty('--k', dq / 24);
      cls('bm', 'ready', !!g.up.hand && g.hm_cd <= 0);
      cls('bd', 'ready', g.doom >= 1);
      show('bm', !!g.up.hand);
      show('bd', !!g.up.beard);
    }

    if (hintOn && g.time > 7) { hintOn = false; el('hint').hidden = true; }
    if (st == 'play' && frames % 30 == 0) check_ach(g.summary(false, false));
  }

  // ------------------------------------------------------------------ offline support
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/[?&]nosw\b/.test(location.search)) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline play is optional */ }));
  }

  return { frame, key, close, blocking: () => !!modal, toast };
})();

main();
