/* Kitaplık — barkod okuma ve ISBN'den künye çekme */

(function () {
  'use strict';

  var cfg = window.KITAPLIK_CONFIG || {};

  /* ------------------------------------------------------------------
   * ISBN yardımcıları
   * ---------------------------------------------------------------- */

  function clean(isbn) {
    return String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  }

  function isValidIsbn13(s) {
    if (!/^[0-9]{13}$/.test(s)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(s[i]);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }

  function isValidIsbn10(s) {
    if (!/^[0-9]{9}[0-9X]$/.test(s)) return false;
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += (10 - i) * Number(s[i]);
    sum += s[9] === 'X' ? 10 : Number(s[9]);
    return sum % 11 === 0;
  }

  function isValid(isbn) {
    var s = clean(isbn);
    return isValidIsbn13(s) || isValidIsbn10(s);
  }

  /** Kitap barkodları 978/979 ile başlayan EAN-13'lerdir; diğerleri
   *  (örn. 590 ile başlayan gıda barkodları) kitap değildir. */
  function looksLikeBook(code) {
    var s = clean(code);
    if (isValidIsbn10(s)) return true;
    return isValidIsbn13(s) && (s.indexOf('978') === 0 || s.indexOf('979') === 0);
  }

  /* ------------------------------------------------------------------
   * Künye arama
   * ---------------------------------------------------------------- */

  function fetchJson(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  function fromGoogle(isbn) {
    var url = 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(isbn);
    return fetchJson(url).then(function (j) {
      if (!j.items || !j.items.length) return null;
      var v = j.items[0].volumeInfo || {};
      var img = v.imageLinks || {};
      var cover = img.thumbnail || img.smallThumbnail || '';
      return {
        title: v.title ? (v.subtitle ? v.title + ': ' + v.subtitle : v.title) : '',
        author: (v.authors || []).join(', '),
        publisher: v.publisher || '',
        published_year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
        page_count: v.pageCount || null,
        // Google küçük ve http'li kapak veriyor; https'e çevirip biraz büyütüyoruz.
        cover_url: cover ? cover.replace(/^http:/, 'https:').replace('&zoom=1', '&zoom=2') : '',
        source: 'Google Books',
      };
    });
  }

  function fromOpenLibrary(isbn) {
    var url = 'https://openlibrary.org/api/books?bibkeys=ISBN:' + encodeURIComponent(isbn) +
              '&format=json&jscmd=data';
    return fetchJson(url).then(function (j) {
      var rec = j['ISBN:' + isbn];
      if (!rec) return null;
      // publish_date "1997", "September 1998", "1998-09-01" gibi çok farklı
      // biçimlerde gelebiliyor; içindeki ilk dört haneli sayıyı yıl kabul ediyoruz.
      var yearMatch = rec.publish_date ? String(rec.publish_date).match(/\d{4}/) : null;
      return {
        title: rec.title ? (rec.subtitle ? rec.title + ': ' + rec.subtitle : rec.title) : '',
        author: (rec.authors || []).map(function (a) { return a.name; }).join(', '),
        publisher: (rec.publishers || []).map(function (p) { return p.name; }).join(', '),
        published_year: yearMatch ? Number(yearMatch[0]) : null,
        page_count: rec.number_of_pages || null,
        cover_url: (rec.cover && (rec.cover.large || rec.cover.medium)) || '',
        source: 'Open Library',
      };
    });
  }

  var SOURCES = { google: fromGoogle, openlibrary: fromOpenLibrary };

  /**
   * ISBN'den künye çek. Kaynaklar sırayla denenir; ilk dolu sonuç kullanılır,
   * eksik alanlar sonraki kaynaklardan tamamlanır.
   * @returns {Promise<Object|null>}
   */
  function lookup(isbnRaw) {
    var isbn = clean(isbnRaw);
    if (!isbn) return Promise.resolve(null);

    var order = cfg.LOOKUP_SOURCES || ['google', 'openlibrary'];
    var merged = null;

    return order.reduce(function (p, name) {
      return p.then(function () {
        var fn = SOURCES[name];
        if (!fn) return;
        // Yeterince dolu bir sonuç varsa diğer kaynaklara gitmeye gerek yok.
        if (merged && merged.title && merged.author && merged.cover_url) return;
        return fn(isbn).then(function (res) {
          if (!res) return;
          if (!merged) {
            merged = res;
          } else {
            Object.keys(res).forEach(function (k) {
              if (!merged[k] && res[k]) merged[k] = res[k];
            });
          }
        }).catch(function (e) {
          console.warn('Künye kaynağı başarısız (' + name + '):', e.message);
        });
      });
    }, Promise.resolve()).then(function () {
      if (merged) {
        merged.isbn = isbn;
        // Hiç kapak bulunamadıysa Open Library'nin kapak servisi çoğu zaman iş görür.
        if (!merged.cover_url) {
          merged.cover_url = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg';
        }
      }
      return merged;
    });
  }

  /* ------------------------------------------------------------------
   * Kamera ile barkod okuma
   * ---------------------------------------------------------------- */

  function scannerSupport() {
    var hasCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var hasDetector = typeof window.BarcodeDetector !== 'undefined';
    var hasFallback = typeof window.EAN !== 'undefined';
    return {
      camera: hasCamera,
      detector: hasDetector,
      fallback: hasFallback,
      // Kamera varsa tarama yapılabilir: tarayıcının kendi çözücüsü yoksa
      // kendi EAN-13 çözücümüz devreye giriyor (iOS böyle çalışıyor).
      ok: hasCamera && (hasDetector || hasFallback),
      motor: hasDetector ? 'tarayıcı' : (hasFallback ? 'dahili' : 'yok'),
    };
  }

  /**
   * Kamerayı açar ve barkod okur.
   * @param {HTMLVideoElement} video
   * @param {(isbn:string)=>void} onFound
   * @returns {Promise<{stop:()=>void}>}
   */
  function startScanner(video, onFound) {
    var sup = scannerSupport();
    if (!sup.camera) return Promise.reject(new Error('Bu cihaz/tarayıcı kamera erişimine izin vermiyor.'));
    if (!sup.ok) return Promise.reject(new Error('NO_DETECTOR'));

    // Tarayıcının kendi çözücüsü varsa onu kullan (daha hızlı ve daha çok
    // biçim tanır); yoksa kendi EAN-13 çözücümüze düş. iOS'ta ikinci yol
    // devreye giriyor çünkü orada BarcodeDetector hiçbir tarayıcıda yok.
    var detector = sup.detector
      ? new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
      : null;

    // Dahili çözücü için kare yakalama tuvali
    var canvas = null, cctx = null;
    if (!detector) {
      canvas = document.createElement('canvas');
      cctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    var stream = null;
    var timer = null;
    var stopped = false;
    var busy = false;
    // Tek karelik yanlış okumaları elemek için aynı kodu iki kez üst üste
    // görmeden kabul etmiyoruz.
    var lastCode = null;
    var repeats = 0;

    /** Okunan kodu doğrula ve yeterince tekrarlandıysa kabul et. */
    function consider(raw) {
      raw = clean(raw);
      if (!looksLikeBook(raw)) return false;
      if (raw === lastCode) repeats++; else { lastCode = raw; repeats = 1; }
      if (repeats < 2) return false;
      if (navigator.vibrate) navigator.vibrate(60);
      stop();
      onFound(raw);
      return true;
    }

    function stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      video.srcObject = null;
    }

    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return { stop: stop }; }
      stream = s;
      video.srcObject = s;
      video.setAttribute('playsinline', '');   // iOS'ta tam ekrana geçmesin
      return video.play().catch(function () { /* autoplay engeli — kullanıcı dokununca oynar */ });
    }).then(function () {
      timer = setInterval(function () {
        if (stopped || busy || video.readyState < 2) return;

        if (detector) {
          busy = true;
          detector.detect(video).then(function (codes) {
            busy = false;
            if (!codes || stopped) return;
            for (var i = 0; i < codes.length; i++) {
              if (consider(codes[i].rawValue)) return;
            }
          }).catch(function () { busy = false; });
          return;
        }

        // --- dahili çözücü ---
        // Kareyi tuvale al ve tara. Çözünürlüğü sınırlıyoruz: barkodun
        // çubuklarını ayırt etmek için 640 piksel genişlik yeterli ve
        // telefonda her karede tam çözünürlük işlemek gereksiz yavaşlatır.
        var vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        var scale = Math.min(1, 640 / vw);
        var cw = Math.round(vw * scale), ch = Math.round(vh * scale);
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        cctx.drawImage(video, 0, 0, cw, ch);
        var hit = window.EAN.decodeFrame(cctx, cw, ch);
        if (hit) consider(hit);
      }, detector ? 250 : 120);

      return { stop: stop };
    }).catch(function (err) {
      stop();
      if (err && err.message === 'NO_DETECTOR') throw err;
      var msg = 'Kamera açılamadı.';
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        msg = 'Kamera izni verilmedi. Tarayıcı ayarlarından bu siteye kamera izni ver.';
      } else if (err && err.name === 'NotFoundError') {
        msg = 'Cihazda kamera bulunamadı.';
      }
      throw new Error(msg);
    });
  }

  window.ISBN = {
    clean: clean,
    isValid: isValid,
    looksLikeBook: looksLikeBook,
    lookup: lookup,
    scannerSupport: scannerSupport,
    startScanner: startScanner,
  };
})();
