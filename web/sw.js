/* =====================================================================
   ТОННАЖ — service worker
   ---------------------------------------------------------------------
   Задача одна: приложение должно открываться и работать в подвальном
   зале без связи. Оболочка (html/css/js) кэшируется, обращения к
   хранилищу — никогда: они должны честно падать, чтобы store.js положил
   запись в очередь и отправил позже, а не получил старый ответ.

   Все пути относительные: приложение одинаково работает и в корне
   домена, и в подкаталоге вида логин.github.io/tonnage/.
   ===================================================================== */

const VERSION = 'tonnage-v2';

const SHELL = [
  './', './index.html', './styles.css',
  './app.js', './engine.js', './exercises.js', './store.js', './doc.js',
  './figure.js', './charts.js',
  './adapters/index.js', './adapters/github.js', './adapters/telegram.js',
  './adapters/server.js', './adapters/local.js',
  './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

const SHELL_URLS = SHELL.map(p => new URL(p, self.registration.scope).href);
const INDEX = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // Одна недоступная иконка не должна срывать установку целиком,
      // поэтому кладём файлы по одному и молча пропускаем неудачи.
      .then(c => Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Свой сервер, если он используется как хранилище — мимо кэша
  if (url.origin === location.origin && url.pathname.includes('/api/')) return;

  // Шрифты Google: кэшируем после первой загрузки, дальше работают офлайн
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // GitHub, Telegram и прочие хранилища — только живая сеть.
  // Закэшированный ответ здесь означал бы показанный вчерашний дневник.
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => null);

      // Навигация без сети — отдаём оболочку приложения из кэша
      if (req.mode === 'navigate') {
        return hit || net.then(r => r || caches.match(INDEX));
      }
      return hit || net;
    })
  );
});
