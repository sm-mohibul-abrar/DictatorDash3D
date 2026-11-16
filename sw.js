/*
 * sw.js - offline support for the web version
 *
 * The whole game is a handful of static files, so they are cached on first visit and the game
 * then starts without a network. Requests are answered from the cache straight away and
 * refreshed in the background, so a new release shows up on the visit after it is published.
 *
 * Spoken lines (web/audio/voice) are cached as they are first fetched.
 * Bump CACHE whenever the files below change in a release: that clears the old copy.
 */
const CACHE = 'dictators-dash-v4.8.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'web/css/style.css',
  'web/vendor/three.min.js',
  'web/vendor/GLTFLoader.js',
  'web/vendor/SkeletonUtils.js',
  'web/models/soldier.glb',
  'web/models/athlete.glb',
  'web/models/man.glb',
  'web/models/moves.json',
  'web/audio/chant-aladeen.mp3',
  'web/audio/chant-zoey.mp3',
  'web/audio/chant-wadiya.mp3',
  'web/audio/scream.mp3',
  'web/audio/roar.mp3',
  'web/audio/crowd-loop.mp3',
  'web/audio/sfx-pistol.mp3',
  'web/audio/sfx-missile-launch.mp3',
  'web/audio/sfx-missile-hit.mp3',
  'web/audio/sfx-doom-incoming.mp3',
  'web/audio/sfx-doom-blast.mp3',
  'web/audio/sfx-ballot-box.mp3',
  'web/audio/sfx-coin.mp3',
  'web/audio/sfx-powerup.mp3',
  'web/audio/sfx-jump.mp3',
  'web/audio/sfx-slide.mp3',
  'web/audio/sfx-hurt.mp3',
  'web/audio/sfx-whistle.mp3',
  'web/audio/sfx-gameover.mp3',
  'web/audio/sfx-medal.mp3',
  'web/audio/sfx-click.mp3',
  'web/audio/sfx-purchase.mp3',
  'web/audio/sfx-pant.mp3',
  'web/audio/sfx-drone-down.mp3',
  'web/js/actors.js',
  'web/js/core.js',
  'web/js/glshim.js',
  'web/js/game.js',
  'web/js/ui.js',
  'web/icons/icon.svg',
  'web/icons/icon-180.png',
  'web/icons/icon-192.png',
  'web/icons/icon-512.png',
  'web/icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k != CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method != 'GET' || new URL(req.url).origin != self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
