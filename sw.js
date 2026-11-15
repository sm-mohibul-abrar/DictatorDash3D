/*
 * sw.js - offline support for the web version
 *
 * The whole game is a handful of static files, so they are cached on first visit and the game
 * then starts without a network. Requests are answered from the cache straight away and
 * refreshed in the background, so a new release shows up on the visit after it is published.
 *
 * Bump CACHE whenever the files below change in a release: that clears the old copy.
 */
const CACHE = 'dictators-dash-v4.6.0';
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
  'web/audio/chant-aladeen.wav',
  'web/audio/chant-zoey.wav',
  'web/audio/chant-wadiya.wav',
  'web/audio/scream.wav',
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
