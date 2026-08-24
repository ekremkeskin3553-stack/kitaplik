/* Kitaplık — yerel depo (IndexedDB)
 *
 * Uygulama her zaman ÖNCE yerel depoya yazar, sonra sunucuya gönderir.
 * Böylece çevrimdışıyken de her şey çalışır; internet gelince birikenler
 * kendiliğinden gider.
 *
 * İki depo var:
 *   books   → kitapların kendisi
 *   meta    → senkron durumu, oturum bilgisi gibi tekil değerler
 *
 * Silme işlemi gerçek silme değil, `deleted: true` işaretlemesidir. Aksi hâlde
 * bir cihazda silinen kitabı diğer cihaz "yeni kayıt" sanıp geri diriltirdi.
 */

(function () {
  'use strict';

  var DB_NAME = 'kitaplik';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('books')) {
          var s = db.createObjectStore('books', { keyPath: 'id' });
          s.createIndex('updated_at', 'updated_at');
          s.createIndex('dirty', 'dirty');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* ------------------------------------------------------------------ */

  function allBooks() {
    return tx('books', 'readonly').then(function (s) { return wrap(s.getAll()); });
  }

  function getBook(id) {
    return tx('books', 'readonly').then(function (s) { return wrap(s.get(id)); });
  }

  /** Kullanıcının yaptığı değişiklik: dirty=1 işaretlenir, senkronda gönderilir. */
  function putLocal(book) {
    book.updated_at = new Date().toISOString();
    book.dirty = 1;
    return tx('books', 'readwrite').then(function (s) {
      return wrap(s.put(book));
    }).then(function () { return book; });
  }

  /** Sunucudan gelen kayıt: dirty=0, çünkü zaten sunucuda mevcut hâli bu. */
  function putRemote(book) {
    book.dirty = 0;
    return tx('books', 'readwrite').then(function (s) {
      return wrap(s.put(book));
    });
  }

  function putManyRemote(books) {
    if (!books.length) return Promise.resolve();
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('books', 'readwrite');
        var s = t.objectStore('books');
        books.forEach(function (b) { b.dirty = 0; s.put(b); });
        t.oncomplete = resolve;
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /** Gönderilmeyi bekleyen değişiklikler. */
  function dirtyBooks() {
    return allBooks().then(function (list) {
      return list.filter(function (b) { return b.dirty === 1; });
    });
  }

  /** Sunucu kabul ettikten sonra "temiz" işaretle — ama arada kullanıcı
   *  tekrar düzenlediyse (updated_at değiştiyse) dirty'de bırak. */
  function markClean(id, syncedUpdatedAt) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('books', 'readwrite');
        var s = t.objectStore('books');
        var g = s.get(id);
        g.onsuccess = function () {
          var b = g.result;
          if (b && b.updated_at === syncedUpdatedAt) {
            b.dirty = 0;
            s.put(b);
          }
        };
        t.oncomplete = resolve;
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /** Belirli kayıtları yerelden gerçekten sil (işaretleme değil).
   *  Yalnızca yereldeki bozuk/yabancı kayıtları temizlemek için; kullanıcının
   *  sildiği kitaplar için deleted işareti kullanılır. */
  function removeMany(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('books', 'readwrite');
        var s = t.objectStore('books');
        ids.forEach(function (id) { s.delete(id); });
        t.oncomplete = resolve;
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  /** Yerel depoyu tamamen boşalt (çıkış yaparken). */
  function clearBooks() {
    return tx('books', 'readwrite').then(function (s) { return wrap(s.clear()); });
  }

  /* ------------------------------------------------------------------ */

  function getMeta(k, fallback) {
    return tx('meta', 'readonly').then(function (s) { return wrap(s.get(k)); })
      .then(function (r) { return r ? r.v : fallback; });
  }

  function setMeta(k, v) {
    return tx('meta', 'readwrite').then(function (s) { return wrap(s.put({ k: k, v: v })); });
  }

  window.DB = {
    allBooks: allBooks,
    getBook: getBook,
    putLocal: putLocal,
    putRemote: putRemote,
    putManyRemote: putManyRemote,
    dirtyBooks: dirtyBooks,
    markClean: markClean,
    removeMany: removeMany,
    clearBooks: clearBooks,
    getMeta: getMeta,
    setMeta: setMeta,
  };
})();
