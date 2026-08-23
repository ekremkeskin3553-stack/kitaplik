/* Kitaplık — arayüz ve uygulama akışı */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = Search.escapeHtml;

  var state = {
    books: [],
    query: '',
    sort: 'title-asc',
    shelf: '',
    status: '',
    editingId: null,
    scanner: null,
    authMode: 'signin',
  };

  /* ==================================================================
   * Küçük yardımcılar
   * ================================================================ */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 5000 : 2600);
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /** Ödünç verilmiş ve iade tarihi geçmiş mi? */
  function isOverdue(b) {
    return !!(b.loan_to && !b.loan_returned && b.loan_due && b.loan_due < todayISO());
  }

  function isOnLoan(b) {
    return !!(b.loan_to && !b.loan_returned);
  }

  /* ==================================================================
   * Liste görünümü
   * ================================================================ */

  var STATUS_LABEL = { to_read: 'Okunacak', reading: 'Okunuyor', read: 'Okundu' };

  function cardHtml(b, qToks) {
    var pct = Math.round(Search.progressOf(b) * 100);
    var cover = b.cover_url
      ? '<img src="' + esc(b.cover_url) + '" alt="" loading="lazy" onerror="this.remove()">'
      : '';

    var meta = '';
    if (b.shelf) meta += '<span class="tag shelf">' + Search.highlight(b.shelf, qToks) + '</span>';
    if (b.series) meta += '<span class="tag">' + Search.highlight(b.series, qToks) + '</span>';
    if (b.rating) meta += '<span class="tag stars">' + '★'.repeat(b.rating) + '</span>';
    if (isOnLoan(b)) {
      var over = isOverdue(b);
      meta += '<span class="tag loan' + (over ? ' overdue' : '') + '">' +
              (over ? '⏰ ' : '↗ ') + esc(b.loan_to) +
              (b.loan_due ? ' · ' + esc(formatDate(b.loan_due)) : '') + '</span>';
    }
    if (b.status && b.status !== 'to_read' && pct !== 100) {
      meta += '<span class="tag">' + STATUS_LABEL[b.status] + '</span>';
    }

    return '' +
      '<button class="card" data-id="' + esc(b.id) + '">' +
        '<span class="card-cover">' + (cover || '<span>' + esc((b.title || '?').slice(0, 2)) + '</span>') + '</span>' +
        '<span class="card-main">' +
          '<span class="card-title-row">' +
            '<span class="card-title">' + Search.highlight(b.title || '(adsız)', qToks) + '</span>' +
            '<span class="card-pct" data-done="' + (pct === 100 ? 1 : 0) + '" data-active="' + (pct > 0 && pct < 100 ? 1 : 0) + '">%' + pct + '</span>' +
          '</span>' +
          (b.author ? '<span class="card-author">' + Search.highlight(b.author, qToks) + '</span>' : '') +
          '<span class="bar"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
          (meta ? '<span class="card-meta">' + meta + '</span>' : '') +
        '</span>' +
      '</button>';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function render() {
    var opts = {
      query: state.query,
      sort: state.sort,
      shelf: state.shelf,
      status: state.status === '__loaned' ? '' : state.status,
      loaned: state.status === '__loaned' ? true : undefined,
    };
    var results = Search.run(state.books, opts);
    var qToks = Search.tokens(state.query);

    var listEl = $('list');
    var emptyEl = $('empty');

    if (!results.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      var live = state.books.filter(function (b) { return !b.deleted; });
      if (!live.length) {
        emptyEl.innerHTML = '<h2>Kitaplığın boş</h2><p>Sağ alttaki <b>+</b> ile kitap ekle,' +
          ' ya da barkod düğmesiyle kitabın arkasını okut.</p>';
      } else {
        emptyEl.innerHTML = '<h2>Sonuç yok</h2><p>“' + esc(state.query) + '” için eşleşen kitap bulunamadı.</p>';
      }
    } else {
      emptyEl.hidden = true;
      // Rafa göre sıralandığında raf başlıklarıyla gruplayarak göster.
      if (state.sort === 'shelf-asc') {
        var html = '', lastShelf = null;
        results.forEach(function (b) {
          var sh = b.shelf || 'Rafsız';
          if (sh !== lastShelf) {
            html += '<div class="shelf-head">' + esc(sh) + '</div>';
            lastShelf = sh;
          }
          html += cardHtml(b, qToks);
        });
        listEl.innerHTML = html;
      } else {
        listEl.innerHTML = results.map(function (b) { return cardHtml(b, qToks); }).join('');
      }
    }

    renderStats(results);
    renderShelfOptions();
  }

  function renderStats(results) {
    var live = state.books.filter(function (b) { return !b.deleted; });
    var el = $('stats');
    if (!live.length) { el.hidden = true; return; }

    var read = 0, reading = 0, loaned = 0, overdue = 0, pages = 0;
    live.forEach(function (b) {
      var p = Search.progressOf(b);
      if (p >= 1) read++;
      else if (p > 0) reading++;
      if (isOnLoan(b)) loaned++;
      if (isOverdue(b)) overdue++;
      pages += Number(b.current_page) || 0;
    });

    var chips = [];
    var filtered = results.length !== live.length;
    chips.push('<span class="chip"><b>' + (filtered ? results.length + ' / ' : '') + live.length + '</b> kitap</span>');
    chips.push('<span class="chip"><b>' + read + '</b> okundu</span>');
    if (reading) chips.push('<span class="chip"><b>' + reading + '</b> okunuyor</span>');
    if (loaned) chips.push('<span class="chip"><b>' + loaned + '</b> ödünçte</span>');
    if (overdue) chips.push('<span class="chip" style="color:var(--danger)"><b>' + overdue + '</b> gecikmiş</span>');
    if (pages) chips.push('<span class="chip"><b>' + pages.toLocaleString('tr') + '</b> sayfa okundu</span>');

    el.innerHTML = chips.join('');
    el.hidden = false;
  }

  /** Raf filtresi ve form otomatik tamamlama listelerini tazele. */
  function renderShelfOptions() {
    var shelves = uniqueValues('shelf');
    var sel = $('shelf-filter');
    var current = sel.value;
    sel.innerHTML = '<option value="">Tüm raflar</option>' +
      shelves.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    sel.value = shelves.indexOf(current) !== -1 ? current : '';
    if (sel.value !== state.shelf) state.shelf = sel.value;

    fillDatalist('dl-shelves', shelves);
    fillDatalist('dl-authors', uniqueValues('author'));
    fillDatalist('dl-publishers', uniqueValues('publisher'));
    fillDatalist('dl-borrowers', uniqueValues('loan_to'));
  }

  function uniqueValues(key) {
    var seen = {}, out = [];
    state.books.forEach(function (b) {
      if (b.deleted) return;
      var v = (b[key] || '').trim();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    return out.sort(Search.collator.compare);
  }

  function fillDatalist(id, values) {
    var dl = $(id);
    if (!dl) return;
    dl.innerHTML = values.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
  }

  /* ==================================================================
   * Kitap formu
   * ================================================================ */

  var ratingValue = 0;

  function buildRating() {
    var el = $('f-rating');
    el.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = '★';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', n + ' yıldız');
        b.addEventListener('click', function () {
          ratingValue = (ratingValue === n) ? 0 : n;   // aynı yıldıza basınca temizle
          paintRating();
        });
        el.appendChild(b);
      })(i);
    }
  }

  function paintRating() {
    var kids = $('f-rating').children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-checked', (i < ratingValue) ? 'true' : 'false');
    }
  }

  function setProgressUI(pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    $('f-progress').value = pct;
    $('f-progress-fill').style.width = pct + '%';
    $('f-progress-out').textContent = '%' + pct;
  }

  /** Sayfa alanları değiştiğinde yüzdeyi yeniden hesapla. */
  function syncProgressFromPages() {
    var total = Number($('f-page-count').value) || 0;
    var cur = Number($('f-current-page').value) || 0;
    if (total > 0) setProgressUI((cur / total) * 100);
  }

  /** Kaydırıcı hareket ettiğinde: sayfa sayısı biliniyorsa okunan sayfayı
   *  güncelle, bilinmiyorsa yüzdeyi doğrudan sakla. */
  function syncPagesFromProgress() {
    var pct = Number($('f-progress').value) || 0;
    var total = Number($('f-page-count').value) || 0;
    if (total > 0) $('f-current-page').value = Math.round((pct / 100) * total);
    setProgressUI(pct);
    autoStatusFromProgress(pct);
  }

  /** İlerleme %100 olduysa "okundu", arada ise "okunuyor" işaretle. */
  function autoStatusFromProgress(pct) {
    var radios = document.querySelectorAll('input[name="status"]');
    var want = pct >= 100 ? 'read' : (pct > 0 ? 'reading' : null);
    if (!want) return;
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].value === want) { radios[i].checked = true; return; }
    }
  }

  function openBookDialog(book) {
    state.editingId = book ? book.id : null;
    $('book-dialog-title').textContent = book ? 'Kitabı Düzenle' : 'Kitap Ekle';
    $('f-delete').hidden = !book;
    $('f-lookup-msg').textContent = '';
    $('f-lookup-msg').className = 'hint';

    var b = book || {};
    $('f-isbn').value = b.isbn || '';
    $('f-title').value = b.title || '';
    $('f-author').value = b.author || '';
    $('f-shelf').value = b.shelf || '';
    $('f-series').value = b.series || '';
    $('f-publisher').value = b.publisher || '';
    $('f-year').value = b.published_year || '';
    $('f-current-page').value = b.current_page || '';
    $('f-page-count').value = b.page_count || '';
    $('f-tags').value = Array.isArray(b.tags) ? b.tags.join(', ') : (b.tags || '');
    $('f-notes').value = b.notes || '';
    setCover(b.cover_url || '');
    setMsg($('f-cover-msg'), '', '');
    $('f-loan-to').value = b.loan_to || '';
    $('f-loan-date').value = b.loan_date || '';
    $('f-loan-due').value = b.loan_due || '';
    $('f-loan-returned').checked = !!b.loan_returned;

    var status = b.status || 'to_read';
    var radios = document.querySelectorAll('input[name="status"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === status);

    ratingValue = Number(b.rating) || 0;
    paintRating();
    setProgressUI(Search.progressOf(b) * 100);

    $('book-dialog').showModal();
    if (!book) setTimeout(function () { $('f-title').focus(); }, 120);
  }

  function readForm() {
    var existing = state.editingId
      ? state.books.filter(function (b) { return b.id === state.editingId; })[0]
      : null;

    var statusEl = document.querySelector('input[name="status"]:checked');
    var total = Number($('f-page-count').value) || null;
    var cur = Number($('f-current-page').value) || 0;
    var loanTo = $('f-loan-to').value.trim();

    var b = {
      id: existing ? existing.id : uuid(),
      created_at: existing ? existing.created_at : new Date().toISOString(),
      title: $('f-title').value.trim(),
      author: $('f-author').value.trim(),
      isbn: ISBN.clean($('f-isbn').value),
      publisher: $('f-publisher').value.trim(),
      published_year: Number($('f-year').value) || null,
      page_count: total,
      current_page: total ? Math.min(cur, total) : cur,
      // Sayfa sayısı bilinmiyorsa kaydırıcının değeri tek ilerleme kaynağıdır.
      progress_pct: total ? null : (Number($('f-progress').value) || 0),
      status: statusEl ? statusEl.value : 'to_read',
      rating: ratingValue || null,
      cover_url: coverValue,
      shelf: $('f-shelf').value.trim(),
      series: $('f-series').value.trim(),
      tags: $('f-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      notes: $('f-notes').value.trim(),
      loan_to: loanTo,
      // Kime verildiği yazılmışsa ve tarih boşsa bugünü varsay.
      loan_date: loanTo ? ($('f-loan-date').value || todayISO()) : null,
      loan_due: loanTo ? ($('f-loan-due').value || null) : null,
      loan_returned: loanTo ? $('f-loan-returned').checked : false,
      deleted: false,
    };
    return b;
  }

  function saveBook(book) {
    return DB.putLocal(book).then(function (saved) {
      var i = -1;
      for (var k = 0; k < state.books.length; k++) {
        if (state.books[k].id === saved.id) { i = k; break; }
      }
      if (i === -1) state.books.push(saved); else state.books[i] = saved;
      render();
      scheduleSync();
      return saved;
    });
  }

  /* ==================================================================
   * Kapak görseli — cihazdan seçme
   *
   * Görsel, kaydın içinde data URI olarak saklanır; ayrı bir dosya deposu
   * kurmaya gerek kalmadan senkronla birlikte diğer cihazlara da gider.
   * Bunun bedeli boyut: telefon fotoğrafları 3–5 MB gelir ve base64'e
   * çevrilince bir kat daha büyür. Bu yüzden kaydetmeden önce küçültüp
   * sıkıştırıyoruz — kapak görseli için 480 piksel fazlasıyla yeterli.
   * ================================================================ */

  var MAX_COVER_EDGE = 480;
  var MAX_COVER_BYTES = 220 * 1024;   // data URI olarak kabaca üst sınır

  /** Dosyayı EXIF dönüşünü koruyarak çöz. Telefonlar fotoğrafı yan çekip
   *  "döndür" bilgisini ayrı tutar; bunu uygulamazsak kapaklar yan görünür. */
  function decodeImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Görsel açılamadı.')); };
      img.src = url;
    });
  }

  function drawScaled(src, maxEdge, quality) {
    var w = src.width || src.naturalWidth;
    var h = src.height || src.naturalHeight;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    var x = c.getContext('2d');
    // Saydam PNG'ler JPEG'e çevrilince siyah zemin alır; önce beyaza boyuyoruz.
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, cw, ch);
    x.drawImage(src, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', quality);
  }

  /** Küçült, sıkıştır, gerekirse sınıra inene kadar kaliteyi düşür. */
  function prepareCover(file) {
    return decodeImage(file).then(function (src) {
      var attempts = [
        { edge: MAX_COVER_EDGE, q: 0.72 },
        { edge: MAX_COVER_EDGE, q: 0.55 },
        { edge: 360, q: 0.5 },
        { edge: 280, q: 0.45 },
      ];
      var out = null;
      for (var i = 0; i < attempts.length; i++) {
        out = drawScaled(src, attempts[i].edge, attempts[i].q);
        if (out.length <= MAX_COVER_BYTES) break;
      }
      if (src.close) src.close();       // ImageBitmap belleğini bırak
      return out;
    });
  }

  var coverValue = '';

  /** Kapağı tek yerden ayarla: önizleme, kaldır düğmesi ve adres alanı
   *  hep tutarlı kalsın. */
  function setCover(value, opts) {
    opts = opts || {};
    coverValue = value || '';
    var isData = coverValue.indexOf('data:') === 0;

    $('f-cover-img').src = coverValue;
    $('f-cover-clear').hidden = !coverValue;

    // Cihazdan seçilen görselin base64'ünü adres kutusuna basmak anlamsız
    // (on binlerce karakter); kutuyu boş bırakıp durumu yazıyla anlatıyoruz.
    if (!opts.keepUrlField) {
      $('f-cover').value = isData ? '' : coverValue;
    }
    $('f-cover').placeholder = isData ? 'Cihazdan görsel seçildi' : 'https://…';
  }

  function pickCover(file) {
    var msg = $('f-cover-msg');
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setMsg(msg, 'Bu bir görsel dosyası değil.', 'error');
      return;
    }
    setMsg(msg, 'Görsel işleniyor…', '');
    prepareCover(file).then(function (dataUrl) {
      setCover(dataUrl);
      var kb = Math.round(dataUrl.length / 1024);
      setMsg(msg, 'Kapak eklendi (' + kb + ' KB). Kaydedince diğer cihazlara da gider.', 'ok');
    }).catch(function (e) {
      setMsg(msg, 'Görsel işlenemedi: ' + e.message, 'error');
    });
  }

  /* ==================================================================
   * ISBN künye çekme
   * ================================================================ */

  function applyLookup(data) {
    if (data.title && !$('f-title').value) $('f-title').value = data.title;
    if (data.author && !$('f-author').value) $('f-author').value = data.author;
    if (data.publisher && !$('f-publisher').value) $('f-publisher').value = data.publisher;
    if (data.published_year && !$('f-year').value) $('f-year').value = data.published_year;
    if (data.page_count && !$('f-page-count').value) {
      $('f-page-count').value = data.page_count;
      syncProgressFromPages();
    }
    if (data.cover_url && !coverValue) setCover(data.cover_url);
    if (data.isbn) $('f-isbn').value = data.isbn;
  }

  function doLookup(isbn, msgEl) {
    isbn = ISBN.clean(isbn);
    if (!isbn) { setMsg(msgEl, 'Önce ISBN yaz.', 'error'); return Promise.resolve(null); }
    if (!ISBN.isValid(isbn)) setMsg(msgEl, 'ISBN sağlaması tutmuyor, yine de aranıyor…', '');
    else setMsg(msgEl, 'Aranıyor…', '');

    if (!navigator.onLine) {
      setMsg(msgEl, 'Çevrimdışısın — künye çekilemez, bilgileri elle girebilirsin.', 'error');
      return Promise.resolve(null);
    }

    return ISBN.lookup(isbn).then(function (data) {
      if (!data || !data.title) {
        setMsg(msgEl, 'Bu ISBN için kayıt bulunamadı. Bilgileri elle girebilirsin.', 'error');
        return null;
      }
      setMsg(msgEl, 'Bulundu: ' + data.title + (data.source ? ' (' + data.source + ')' : ''), 'ok');
      return data;
    }).catch(function (e) {
      setMsg(msgEl, 'Arama başarısız: ' + e.message, 'error');
      return null;
    });
  }

  function setMsg(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = (el.id === 'scan-msg' ? 'scan-msg ' : 'hint ') + (cls || '');
  }

  /* ==================================================================
   * Barkod tarayıcı
   * ================================================================ */

  function openScanner() {
    var dlg = $('scan-dialog');
    var msg = $('scan-msg');
    $('scan-isbn').value = '';
    setMsg(msg, 'Kitabın arkasındaki barkodu çerçeveye getir.', '');
    dlg.showModal();

    var sup = ISBN.scannerSupport();
    if (!sup.ok) {
      setMsg(msg, sup.camera
        ? 'Bu tarayıcı barkod okumayı desteklemiyor (iOS Safari henüz desteklemiyor). ISBN\'i aşağıya elle yazabilirsin.'
        : 'Kameraya erişilemiyor. ISBN\'i aşağıya elle yazabilirsin.', 'error');
      setTimeout(function () { $('scan-isbn').focus(); }, 150);
      return;
    }

    ISBN.startScanner($('scan-video'), function (code) {
      setMsg(msg, 'Barkod okundu: ' + code + ' — künye aranıyor…', 'ok');
      handleScannedIsbn(code);
    }).then(function (handle) {
      state.scanner = handle;
    }).catch(function (err) {
      setMsg(msg, err.message === 'NO_DETECTOR'
        ? 'Bu tarayıcı barkod okumayı desteklemiyor. ISBN\'i elle yazabilirsin.'
        : err.message, 'error');
    });
  }

  function closeScanner() {
    if (state.scanner) { state.scanner.stop(); state.scanner = null; }
    var dlg = $('scan-dialog');
    if (dlg.open) dlg.close();
  }

  function handleScannedIsbn(code) {
    // Aynı ISBN zaten kitaplıkta varsa yeni kayıt açmak yerine mevcudu aç.
    var existing = state.books.filter(function (b) {
      return !b.deleted && b.isbn && ISBN.clean(b.isbn) === ISBN.clean(code);
    })[0];

    if (existing) {
      closeScanner();
      toast('Bu kitap zaten kitaplığında.');
      openBookDialog(existing);
      return;
    }

    doLookup(code, $('scan-msg')).then(function (data) {
      closeScanner();
      openBookDialog(null);
      $('f-isbn').value = ISBN.clean(code);
      if (data) {
        applyLookup(data);
        toast('Künye dolduruldu — kontrol edip kaydet.');
      } else {
        toast('Künye bulunamadı, bilgileri elle gir.');
        $('f-title').focus();
      }
    });
  }

  /* ==================================================================
   * Senkron
   * ================================================================ */

  var scheduleSync = debounce(function () { Sync.sync(); }, 1500);

  function setSyncState(s, title) {
    var btn = $('btn-sync');
    btn.dataset.state = s || '';
    if (title) btn.title = title;
  }

  function reloadFromDb() {
    return DB.allBooks().then(function (list) {
      state.books = list;
      render();
    });
  }

  function refreshBanner() {
    var el = $('banner');
    if (!Sync.isConfigured()) {
      el.hidden = false;
      el.innerHTML = 'Senkron kapalı — veriler yalnızca bu cihazda. Açmak için ' +
        '<code>config.js</code> içine Supabase bilgilerini gir.';
      return;
    }
    if (!Sync.currentUser()) {
      el.hidden = false;
      el.innerHTML = 'Cihazlarının aynı kitaplığı görmesi için ' +
        '<button class="link" id="banner-signin" type="button">giriş yap</button>.';
      var b = $('banner-signin');
      if (b) b.addEventListener('click', openAuth);
      return;
    }
    el.hidden = true;
  }

  Sync.on(function (evt, data) {
    if (evt === 'syncing') setSyncState('syncing', 'Eşitleniyor…');
    else if (evt === 'synced') {
      setSyncState('', 'Son eşitleme: ' + new Date().toLocaleTimeString('tr'));
      if (data && data.pulled) reloadFromDb();
    }
    else if (evt === 'syncerror') setSyncState('error', 'Eşitleme hatası: ' + (data && data.message));
    else if (evt === 'offline') setSyncState('offline', 'Çevrimdışı');
    else if (evt === 'session') { refreshBanner(); renderAccount(); }
  });

  /* ==================================================================
   * Giriş
   * ================================================================ */

  function openAuth() {
    state.authMode = 'signin';
    paintAuthMode();
    $('auth-msg').textContent = '';
    $('auth-dialog').showModal();
  }

  function paintAuthMode() {
    var signin = state.authMode === 'signin';
    $('auth-title').textContent = signin ? 'Giriş Yap' : 'Kayıt Ol';
    $('auth-submit').textContent = signin ? 'Giriş yap' : 'Kayıt ol';
    $('auth-toggle').textContent = signin ? 'Hesabım yok, kayıt ol' : 'Zaten hesabım var, giriş yap';
    $('auth-password').setAttribute('autocomplete', signin ? 'current-password' : 'new-password');
  }

  function renderAccount() {
    var box = $('account-box');
    if (!box) return;
    if (!Sync.isConfigured()) {
      box.innerHTML = '<div class="who">Senkron yapılandırılmamış</div>' +
        '<div class="sub">config.js içine Supabase adresini ve anon anahtarını yazınca ' +
        'telefon, tablet ve bilgisayar aynı kitaplığı görür.</div>';
      return;
    }
    var u = Sync.currentUser();
    if (!u) {
      box.innerHTML = '<div class="who">Giriş yapılmadı</div>' +
        '<div class="sub">Veriler yalnızca bu cihazda tutuluyor.</div>' +
        '<button class="btn primary block" id="acc-signin" type="button">Giriş yap</button>';
      $('acc-signin').addEventListener('click', function () { $('menu-dialog').close(); openAuth(); });
      return;
    }
    box.innerHTML = '<div class="who">' + esc(u.email || 'Hesap') + '</div>' +
      '<div class="sub">Cihazlar arası senkron açık.</div>' +
      '<button class="btn block" id="acc-signout" type="button">Çıkış yap</button>';
    $('acc-signout').addEventListener('click', function () {
      if (!confirm('Çıkış yapılsın mı? Bu cihazdaki yerel kopya silinecek, veriler sunucuda kalacak.')) return;
      Sync.signOut().then(function () {
        state.books = [];
        render();
        renderAccount();
        toast('Çıkış yapıldı.');
      });
    });
  }

  /* ==================================================================
   * Yedekleme
   * ================================================================ */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportJson() {
    var clean = state.books.map(function (b) {
      var c = {};
      Object.keys(b).forEach(function (k) { if (k !== 'dirty') c[k] = b[k]; });
      return c;
    });
    download('kitaplik-' + stamp() + '.json', JSON.stringify({ version: 1, books: clean }, null, 2));
    toast('Yedek indirildi.');
  }

  var CSV_COLS = [
    ['title', 'Kitap adı'], ['author', 'Yazar'], ['isbn', 'ISBN'],
    ['publisher', 'Yayınevi'], ['published_year', 'Yıl'], ['shelf', 'Raf'],
    ['series', 'Seri'], ['page_count', 'Toplam sayfa'], ['current_page', 'Okunan sayfa'],
    ['__pct', 'İlerleme %'], ['status', 'Durum'], ['rating', 'Puan'],
    ['loan_to', 'Ödünç alan'], ['loan_date', 'Veriliş'], ['loan_due', 'İade'],
    ['loan_returned', 'Geri geldi'], ['tags', 'Etiketler'], ['notes', 'Notlar'],
  ];

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var rows = [CSV_COLS.map(function (c) { return csvCell(c[1]); }).join(';')];
    state.books.filter(function (b) { return !b.deleted; }).forEach(function (b) {
      rows.push(CSV_COLS.map(function (c) {
        if (c[0] === '__pct') return Math.round(Search.progressOf(b) * 100);
        if (c[0] === 'status') return STATUS_LABEL[b.status] || '';
        if (c[0] === 'loan_returned') return b.loan_returned ? 'Evet' : '';
        return csvCell(b[c[0]]);
      }).join(';'));
    });
    // Baştaki BOM olmadan Excel dosyayı ANSI sanıp Türkçe karakterleri bozuyor.
    // Görünmez karakter yerine kaçış dizisi: kaynak dosyada gözle görülür kalsın.
    var BOM = String.fromCharCode(0xFEFF);
    download('kitaplik-' + stamp() + '.csv', BOM + rows.join('\r\n'), 'text/csv');
    toast('CSV indirildi.');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        toast('Dosya okunamadı: geçerli bir JSON değil.', true);
        return;
      }
      var incoming = Array.isArray(parsed) ? parsed : (parsed.books || []);
      if (!incoming.length) { toast('Dosyada kitap bulunamadı.', true); return; }

      var byId = {};
      state.books.forEach(function (b) { byId[b.id] = b; });

      var added = 0, updated = 0;
      var writes = incoming.map(function (raw) {
        if (!raw || !raw.title) return null;
        var b = Object.assign({}, raw);
        if (!b.id) b.id = uuid();
        if (!b.created_at) b.created_at = new Date().toISOString();

        var mine = byId[b.id];
        // Aynı kayıt yereldeyse ve yerel kopya daha yeniyse dokunma.
        if (mine && mine.updated_at && b.updated_at && mine.updated_at >= b.updated_at) return null;
        if (mine) updated++; else added++;
        return DB.putLocal(b);
      }).filter(Boolean);

      Promise.all(writes)
        .then(reloadFromDb)
        .then(function () {
          toast(added + ' eklendi, ' + updated + ' güncellendi.');
          scheduleSync();
        })
        .catch(function (e) { toast('Geri yükleme hatası: ' + e.message, true); });
    };
    reader.onerror = function () { toast('Dosya okunamadı.', true); };
    reader.readAsText(file);
  }

  function renderMenuStats() {
    var live = state.books.filter(function (b) { return !b.deleted; });
    var pending = state.books.filter(function (b) { return b.dirty === 1; }).length;
    var lines = ['<div>Toplam <b>' + live.length + '</b> kitap, <b>' + uniqueValues('shelf').length + '</b> raf.</div>'];
    if (pending) lines.push('<div>Gönderilmeyi bekleyen değişiklik: <b>' + pending + '</b></div>');
    $('menu-stats').innerHTML = lines.join('');
  }

  /* ==================================================================
   * Olay bağlantıları
   * ================================================================ */

  function wire() {
    // --- arama & filtreler ---
    var onQuery = debounce(function () {
      state.query = $('q').value.trim();
      $('q-clear').hidden = !state.query;
      // Arama yazılırken alaka sırasına geçmek en doğal davranış; kullanıcı
      // sıralamayı elle değiştirdiyse ona dokunmuyoruz.
      render();
    }, 120);
    $('q').addEventListener('input', onQuery);
    $('q-clear').addEventListener('click', function () {
      $('q').value = '';
      state.query = '';
      $('q-clear').hidden = true;
      $('q').focus();
      render();
    });

    $('sort').addEventListener('change', function () { state.sort = this.value; render(); });
    $('shelf-filter').addEventListener('change', function () { state.shelf = this.value; render(); });
    $('status-filter').addEventListener('change', function () { state.status = this.value; render(); });

    // --- liste ---
    $('list').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      var id = card.dataset.id;
      var book = state.books.filter(function (b) { return b.id === id; })[0];
      if (book) openBookDialog(book);
    });

    // --- ekle / tara ---
    $('btn-add').addEventListener('click', function () { openBookDialog(null); });
    $('btn-scan').addEventListener('click', openScanner);

    // --- kitap formu ---
    $('book-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var b = readForm();
      if (!b.title) { toast('Kitap adı gerekli.', true); $('f-title').focus(); return; }
      saveBook(b).then(function () {
        $('book-dialog').close();
        toast(state.editingId ? 'Kaydedildi.' : 'Kitap eklendi.');
        state.editingId = null;
      });
    });

    $('f-delete').addEventListener('click', function () {
      if (!state.editingId) return;
      var book = state.books.filter(function (b) { return b.id === state.editingId; })[0];
      if (!book) return;
      if (!confirm('“' + (book.title || 'Bu kitap') + '” silinsin mi?')) return;
      book.deleted = true;
      saveBook(book).then(function () {
        $('book-dialog').close();
        toast('Silindi.');
        state.editingId = null;
      });
    });

    $('f-lookup').addEventListener('click', function () {
      doLookup($('f-isbn').value, $('f-lookup-msg')).then(function (d) { if (d) applyLookup(d); });
    });

    $('f-page-count').addEventListener('input', syncProgressFromPages);
    $('f-current-page').addEventListener('input', syncProgressFromPages);
    $('f-progress').addEventListener('input', syncPagesFromProgress);

    // --- kapak görseli ---
    $('f-cover').addEventListener('input', function () {
      setCover(this.value.trim(), { keepUrlField: true });
    });
    $('f-cover-pick').addEventListener('click', function () { $('f-cover-file').click(); });
    $('f-cover-file').addEventListener('change', function () {
      if (this.files && this.files[0]) pickCover(this.files[0]);
      this.value = '';   // aynı dosya art arda seçilebilsin
    });
    $('f-cover-clear').addEventListener('click', function () {
      setCover('');
      setMsg($('f-cover-msg'), '', '');
    });

    // Ödünç alan yazılınca veriliş tarihini kendiliğinden bugüne kur.
    $('f-loan-to').addEventListener('change', function () {
      if (this.value.trim() && !$('f-loan-date').value) $('f-loan-date').value = todayISO();
    });

    // --- tarayıcı ---
    $('scan-isbn-go').addEventListener('click', function () {
      var v = $('scan-isbn').value.trim();
      if (v) handleScannedIsbn(v);
    });
    $('scan-isbn').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('scan-isbn-go').click(); }
    });
    $('scan-dialog').addEventListener('close', closeScanner);
    $('scan-dialog').addEventListener('cancel', closeScanner);

    // --- menü ---
    $('btn-menu').addEventListener('click', function () {
      renderAccount();
      renderMenuStats();
      $('menu-dialog').showModal();
    });
    $('btn-export').addEventListener('click', exportJson);
    $('btn-export-csv').addEventListener('click', exportCsv);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = '';
    });

    // --- giriş ---
    $('auth-toggle').addEventListener('click', function () {
      state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
      paintAuthMode();
      $('auth-msg').textContent = '';
    });

    $('auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('auth-email').value.trim();
      var pass = $('auth-password').value;
      var msg = $('auth-msg');
      var btn = $('auth-submit');
      btn.disabled = true;
      setMsg(msg, 'Bağlanılıyor…', '');

      var op = state.authMode === 'signin' ? Sync.signIn(email, pass) : Sync.signUp(email, pass);
      op.then(function (res) {
        btn.disabled = false;
        if (res && res.needsConfirmation) {
          setMsg(msg, 'Kayıt alındı. ' + email + ' adresine gelen doğrulama postasını onayla, sonra giriş yap.', 'ok');
          state.authMode = 'signin';
          paintAuthMode();
          return;
        }
        $('auth-dialog').close();
        $('auth-password').value = '';
        toast('Giriş yapıldı, eşitleniyor…');
        refreshBanner();
        return Sync.sync().then(reloadFromDb);
      }).catch(function (err) {
        btn.disabled = false;
        setMsg(msg, err.message || 'Giriş başarısız.', 'error');
      });
    });

    // --- panel kapatma düğmeleri ---
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.closest('dialog');
        if (d) d.close();
      });
    });

    // --- eşitleme ---
    $('btn-sync').addEventListener('click', function () {
      if (!Sync.isConfigured()) { toast('Senkron yapılandırılmamış.', true); return; }
      if (!Sync.currentUser()) { openAuth(); return; }
      Sync.sync().then(function (r) {
        reloadFromDb();
        if (r) toast('Eşitlendi.');
      });
    });

    // Uygulamaya geri dönüldüğünde ve ağ gelince kendiliğinden eşitle.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) Sync.sync().then(function (r) { if (r && r.pulled) reloadFromDb(); });
    });
    window.addEventListener('online', function () {
      setSyncState('', 'Çevrimiçi');
      Sync.sync().then(function (r) { if (r && r.pulled) reloadFromDb(); });
    });
    window.addEventListener('offline', function () { setSyncState('offline', 'Çevrimdışı'); });

    var interval = (window.KITAPLIK_CONFIG || {}).SYNC_INTERVAL_MS || 60000;
    setInterval(function () {
      if (!document.hidden) Sync.sync().then(function (r) { if (r && r.pulled) reloadFromDb(); });
    }, interval);

    // "/" ile aramaya atla (masaüstü kolaylığı)
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        $('q').focus();
      }
    });
  }

  /* ==================================================================
   * Açılış
   * ================================================================ */

  function boot() {
    buildRating();
    wire();
    refreshBanner();
    if (!navigator.onLine) setSyncState('offline', 'Çevrimdışı');

    reloadFromDb().then(function () {
      return Sync.sync();
    }).then(function (r) {
      if (r && r.pulled) return reloadFromDb();
    }).catch(function (e) {
      console.error(e);
      toast('Açılışta hata: ' + e.message, true);
    });

    // Ana ekran kısayolları: ?action=scan → doğrudan tarayıcı, ?action=add → boş form
    var action = new URLSearchParams(location.search).get('action');
    if (action === 'scan') setTimeout(openScanner, 250);
    else if (action === 'add') setTimeout(function () { openBookDialog(null); }, 250);
    if (action) history.replaceState(null, '', location.pathname);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('Service worker kaydedilemedi:', e);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
