/* Kitaplık — service worker
 *
 * Amaç: uygulama bir kez açıldıktan sonra internetsiz de açılsın.
 * Veri zaten IndexedDB'de duruyor; burada sadece uygulamanın kendi dosyaları
 * ve kapak görselleri önbelleğe alınıyor.
 *
 * Sürüm notu: dosyalarda değişiklik yaptığında CACHE sürümünü artır —
 * eski önbellek temizlenir ve kullanıcı yeni sürümü alır.
 */

var CACHE = 'kitaplik-v6';
var COVERS = 'kitaplik-covers-v1';

// Yollar göreli: uygulama alan adının kökünde de, /kitaplik/ alt yolunda da
// aynı şekilde çalışsın diye.
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './search.js',
  './db.js',
  './sync.js',
  './ean.js',
  './isbn.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Tek bir dosya eksik olsa bile kurulum tümden düşmesin.
      return Promise.all(SHELL.map(function (url) {
        return c.add(url).catch(function (err) {
          console.warn('[sw] önbelleğe alınamadı:', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== COVERS) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Supabase'e giden istekler asla önbelleğe alınmaz — veri her zaman taze
  // olmalı ve çevrimdışıyken zaten yerel kuyruk devreye giriyor.
  if (url.pathname.indexOf('/rest/v1/') !== -1 || url.pathname.indexOf('/auth/v1/') !== -1) {
    return;
  }

  // Kapak görselleri: önce önbellek, arkada tazele.
  if (req.destination === 'image' && url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(COVERS).then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  // Künye arama servisleri (Google Books / Open Library): sadece ağ.
  if (url.origin !== self.location.origin) return;

  // Uygulamanın kendi dosyaları: önce önbellek, yoksa ağ.
  // Gezinme isteklerinde ağ başarısız olursa index.html'e düşülür ki
  // çevrimdışı açılış çalışsın.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // Arka planda sessizce tazele, bir sonraki açılışta yeni sürüm gelsin.
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res); });
        }).catch(function () {});
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
