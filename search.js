/* Kitaplık — arama ve sıralama
 *
 * Tasarım notu: kişisel bir kitaplık birkaç bin kaydı geçmez, bu yüzden arama
 * tamamen istemcide, bellekteki dizi üzerinde yapılıyor. Sonuç anında gelir,
 * çevrimdışı da çalışır, sunucuya tek istek gitmez.
 */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * Türkçe duyarlı normalizasyon
   *
   * Amaç: kullanıcı "gulun adi" yazdığında "Gülün Adı" bulunsun. Türkçe'nin
   * noktalı/noktasız i sorunu yüzünden düz toLowerCase() yetmiyor:
   * "I".toLowerCase() → "i" ama Türkçe'de "I"nın karşılığı "ı".
   * Aramada ikisini de aynı harfe indirgiyoruz ki hangi klavyeyle yazılırsa
   * yazılsın eşleşsin.
   * ------------------------------------------------------------------- */
  var FOLD = {
    'ı': 'i', 'İ': 'i', 'I': 'i', 'i': 'i',
    'ş': 's', 'Ş': 's',
    'ğ': 'g', 'Ğ': 'g',
    'ü': 'u', 'Ü': 'u',
    'ö': 'o', 'Ö': 'o',
    'ç': 'c', 'Ç': 'c',
    'â': 'a', 'Â': 'a', 'à': 'a', 'á': 'a', 'ä': 'a',
    'î': 'i', 'Î': 'i', 'í': 'i', 'ï': 'i',
    'û': 'u', 'Û': 'u', 'ú': 'u',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'É': 'e',
    'ó': 'o', 'ô': 'o', 'õ': 'o',
    'ñ': 'n', 'ß': 's', 'å': 'a', 'ø': 'o', 'æ': 'a',
  };

  function fold(str) {
    if (!str) return '';
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      out += FOLD[ch] !== undefined ? FOLD[ch] : ch.toLowerCase();
    }
    return out;
  }

  /** Aramaya hazır hâle getir: harf katla, noktalamayı boşluğa çevir, sadeleştir. */
  function normalize(str) {
    return fold(str)
      .replace(/[^a-z0-9ğüşöçı\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(str) {
    var n = normalize(str);
    return n ? n.split(' ') : [];
  }

  /* ---------------------------------------------------------------------
   * Eşleşme türleri — her biri farklı puan getirir
   * ------------------------------------------------------------------- */

  /** Sorgu harfleri metinde sırayla geçiyor mu? "hrp" → "Harry Potter" bulur.
   *  Bitişik geçen harfler için bonus verilir, böylece dağınık eşleşmeler
   *  gerçek eşleşmelerin önüne geçmez. Eşleşmezse -1 döner.
   *
   *  Eşleşmenin DERLİ TOPLU olması şart: harfler metnin dört bir yanına
   *  dağılmışsa bu bir eşleşme değil, tesadüftür. Bu kısıt olmadan uzun bir
   *  yazar adı neredeyse her kısa sorguyla eşleşiyordu — örneğin "eco" harfleri
   *  "josE mauro de vasConcelOs" içinde sırayla bulunabiliyor. */
  function subsequenceScore(needle, hay) {
    if (!needle) return 0;
    var ni = 0, run = 0, best = 0, score = 0, firstAt = -1, lastAt = -1;
    for (var hi = 0; hi < hay.length && ni < needle.length; hi++) {
      if (hay[hi] === needle[ni]) {
        if (firstAt < 0) firstAt = hi;
        lastAt = hi;
        run++;
        score += 1 + run;            // ardışık eşleşme giderek daha değerli
        if (run > best) best = run;
        ni++;
      } else {
        run = 0;
      }
    }
    if (ni < needle.length) return -1;  // tüm harfler sırayla bulunamadı

    // Kapladığı alan, sorgunun kendisinden çok daha genişse eşleşme sayılmaz.
    // Pay, kelime araları ve atlanan birkaç harf için: iki katı + 4.
    var span = lastAt - firstAt + 1;
    if (span > needle.length * 2 + 4) return -1;

    // Baştan başlayan eşleşme daha alakalı; uzun metinlerde puan seyrelsin.
    return score + best * 2 - Math.min(firstAt, 20) * 0.5;
  }

  /** İki kelime arası Levenshtein mesafesi, maxDist'i aşarsa erken çıkar.
   *  Yazım hatalarını tolere etmek için: "dostoyevski" ~ "dostoyevsky". */
  function editDistance(a, b, maxDist) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (var k = 1; k <= b.length; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
        if (cur[k] < rowMin) rowMin = cur[k];
      }
      if (rowMin > maxDist) return maxDist + 1;
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  /** Kelime uzunluğuna göre kabul edilebilir hata payı. Kısa kelimelerde
   *  tolerans olmamalı, yoksa "ali" ile "eli" karışır. */
  function allowedTypos(len) {
    if (len <= 3) return 0;
    if (len <= 6) return 1;
    return 2;
  }

  /* ---------------------------------------------------------------------
   * Tek bir alan içinde tek bir sorgu parçasını ara
   * ------------------------------------------------------------------- */
  function fieldScore(qTok, fieldNorm, fieldTokens) {
    if (!fieldNorm) return 0;

    // 1) Alanın tamamı birebir aynı
    if (fieldNorm === qTok) return 1000;

    // 2) Alan sorguyla başlıyor  ("gul" → "gulun adi")
    if (fieldNorm.indexOf(qTok) === 0) return 600;

    // 3) Alandaki bir kelime sorguyla başlıyor  ("adi" → "gulun adi")
    for (var i = 0; i < fieldTokens.length; i++) {
      if (fieldTokens[i].indexOf(qTok) === 0) return 450;
    }

    // 4) Sorgu alanın herhangi bir yerinde geçiyor  ("lun a" → "gulun adi")
    if (fieldNorm.indexOf(qTok) !== -1) return 320;

    // 5) Bir kelimeye yazım hatası payıyla yakın  ("gulun" ~ "gulum")
    var tol = allowedTypos(qTok.length);
    if (tol > 0) {
      for (var j = 0; j < fieldTokens.length; j++) {
        var w = fieldTokens[j];
        if (Math.abs(w.length - qTok.length) > tol) continue;
        var d = editDistance(qTok, w, tol);
        if (d <= tol) return 220 - d * 40;
      }
    }

    // 6) Harfler sırayla geçiyor  ("hrp" → "harry potter")
    //    En zayıf eşleşme türü; sadece 3+ harflik sorgularda devrede,
    //    yoksa neredeyse her kitap eşleşir.
    if (qTok.length >= 3) {
      var s = subsequenceScore(qTok, fieldNorm);
      if (s >= 0) return 60 + Math.min(s, 60);
    }

    return 0;
  }

  /* ---------------------------------------------------------------------
   * Aranabilir alanlar ve ağırlıkları
   * ------------------------------------------------------------------- */
  var FIELDS = [
    { key: 'title',     weight: 1.0 },
    { key: 'author',    weight: 0.95 },
    { key: 'shelf',     weight: 0.45 },
    { key: 'publisher', weight: 0.35 },
    { key: 'series',    weight: 0.45 },
    { key: 'loan_to',   weight: 0.35 },
    { key: 'tags',      weight: 0.4 },
    { key: 'notes',     weight: 0.25 },
  ];

  /** Kitabın arama indeksini hazırla ve kaydın üstünde önbelleğe al.
   *  Kayıt her değiştiğinde updated_at değiştiği için indeks tazelenir. */
  function ensureIndex(book) {
    if (book.__idx && book.__idxAt === book.updated_at) return book.__idx;
    var idx = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i].key;
      var raw = book[k];
      if (Array.isArray(raw)) raw = raw.join(' ');
      var norm = normalize(raw || '');
      idx[k] = { norm: norm, toks: norm ? norm.split(' ') : [] };
    }
    idx.isbn = String(book.isbn || '').replace(/[^0-9Xx]/g, '').toLowerCase();
    Object.defineProperty(book, '__idx', { value: idx, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(book, '__idxAt', { value: book.updated_at, writable: true, configurable: true, enumerable: false });
    return idx;
  }

  /**
   * Tek kitabı sorguya karşı puanla.
   * Çok kelimeli sorgularda TÜM kelimeler bir yerde eşleşmeli (VE mantığı),
   * aksi hâlde "orhan pamuk" araması sadece "orhan" geçen her şeyi getirirdi.
   */
  function scoreBook(book, qToks) {
    var idx = ensureIndex(book);
    var total = 0;

    for (var t = 0; t < qToks.length; t++) {
      var qTok = qToks[t];

      // ISBN gibi görünen sorgu doğrudan ISBN'e vurur
      if (/^[0-9]{6,13}$/.test(qTok) && idx.isbn && idx.isbn.indexOf(qTok) !== -1) {
        total += 900;
        continue;
      }

      var bestForTok = 0;
      for (var f = 0; f < FIELDS.length; f++) {
        var fi = idx[FIELDS[f].key];
        var s = fieldScore(qTok, fi.norm, fi.toks) * FIELDS[f].weight;
        if (s > bestForTok) bestForTok = s;
      }

      if (bestForTok === 0) return 0;   // bu kelime hiçbir alanda yok → eleme
      total += bestForTok;
    }

    return total;
  }

  /* ---------------------------------------------------------------------
   * Sıralama — Türkçe alfabe sırasıyla
   * ------------------------------------------------------------------- */
  var collator = (function () {
    try {
      return new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
    } catch (e) {
      return { compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; } };
    }
  })();

  /** "Pamuk, Orhan" değil "Orhan Pamuk" girilse bile soyada göre sıralayabilmek
   *  için son kelimeyi soyadı kabul ediyoruz. Zaten "Soyad, Ad" biçiminde
   *  girilmişse olduğu gibi bırakıyoruz. */
  function authorSortKey(author) {
    var a = (author || '').trim();
    if (!a) return '￿';           // yazarsızlar en sona
    if (a.indexOf(',') !== -1) return a;
    var parts = a.split(/\s+/);
    if (parts.length < 2) return a;
    return parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ');
  }

  /** Başlıktaki "Bir/Bu/The/A/An" gibi ön ekler sıralamayı bozmasın. */
  function titleSortKey(title) {
    var t = (title || '').trim();
    if (!t) return '￿';
    return t.replace(/^(the|a|an|bir|bu)\s+/i, '');
  }

  /** Okuma ilerlemesi 0–1 arası.
   *  Öncelik sırası: gerçek sayfa sayacı → elle girilen yüzde → duruma göre kaba
   *  tahmin. Böylece sayfa sayısını bilmediğin kitaplarda da çubuk anlamlı olur. */
  function progressOf(book) {
    var pc = Number(book.page_count) || 0;
    var cp = Number(book.current_page) || 0;
    if (pc > 0) return Math.max(0, Math.min(1, cp / pc));
    if (book.progress_pct !== null && book.progress_pct !== undefined && book.progress_pct !== '') {
      return Math.max(0, Math.min(1, Number(book.progress_pct) / 100));
    }
    if (book.status === 'read') return 1;
    if (book.status === 'reading') return 0.5;
    return 0;
  }

  var SORTERS = {
    'title-asc':    function (a, b) { return collator.compare(titleSortKey(a.title), titleSortKey(b.title)); },
    'title-desc':   function (a, b) { return collator.compare(titleSortKey(b.title), titleSortKey(a.title)); },
    'author-asc':   function (a, b) { return collator.compare(authorSortKey(a.author), authorSortKey(b.author)) || collator.compare(titleSortKey(a.title), titleSortKey(b.title)); },
    'author-desc':  function (a, b) { return collator.compare(authorSortKey(b.author), authorSortKey(a.author)) || collator.compare(titleSortKey(a.title), titleSortKey(b.title)); },
    'progress-desc':function (a, b) { return progressOf(b) - progressOf(a); },
    'progress-asc': function (a, b) { return progressOf(a) - progressOf(b); },
    'added-desc':   function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); },
    'added-asc':    function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); },
    'shelf-asc':    function (a, b) { return collator.compare(a.shelf || '￿', b.shelf || '￿') || collator.compare(titleSortKey(a.title), titleSortKey(b.title)); },
  };

  /* ---------------------------------------------------------------------
   * Vurgulama — sonuçlarda eşleşen harfleri işaretle
   * ------------------------------------------------------------------- */

  /** Orijinal metin ile katlanmış metin harf harf hizalı olduğu için
   *  (FOLD tablosu birebir eşleme yapıyor) katlanmış metindeki indeksleri
   *  doğrudan orijinal metinde kullanabiliyoruz. */
  function highlight(text, qToks) {
    if (!text || !qToks || !qToks.length) return escapeHtml(text || '');
    var folded = fold(text);
    var marks = new Array(text.length);

    for (var t = 0; t < qToks.length; t++) {
      var q = qToks[t];
      if (!q) continue;
      var from = 0, at;
      while ((at = folded.indexOf(q, from)) !== -1) {
        for (var i = at; i < at + q.length && i < text.length; i++) marks[i] = true;
        from = at + 1;
      }
    }

    var out = '', open = false;
    for (var j = 0; j < text.length; j++) {
      if (marks[j] && !open) { out += '<mark>'; open = true; }
      else if (!marks[j] && open) { out += '</mark>'; open = false; }
      out += escapeHtml(text[j]);
    }
    if (open) out += '</mark>';
    return out;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------------
   * Dışa açılan yüz
   * ------------------------------------------------------------------- */

  /**
   * @param {Array} books   tüm kitaplar
   * @param {Object} opts   { query, sort, shelf, status, loaned }
   * @returns {Array} filtrelenmiş + sıralanmış kitaplar
   */
  function run(books, opts) {
    opts = opts || {};
    var qToks = tokens(opts.query || '');
    var out = [];

    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (b.deleted) continue;

      if (opts.shelf && (b.shelf || '') !== opts.shelf) continue;
      if (opts.status && b.status !== opts.status) continue;
      if (opts.loaned === true && !(b.loan_to && !b.loan_returned)) continue;

      if (qToks.length) {
        var s = scoreBook(b, qToks);
        if (s <= 0) continue;
        b.__score = s;
      } else {
        b.__score = 0;
      }
      out.push(b);
    }

    // Arama yapılmışsa alaka sırası öncelikli; kullanıcı açıkça bir sıralama
    // seçtiyse (varsayılan 'relevance' değilse) ona uyulur.
    var sortKey = opts.sort || 'title-asc';
    if (qToks.length && sortKey === 'relevance') {
      out.sort(function (a, b) {
        return (b.__score - a.__score) || collator.compare(titleSortKey(a.title), titleSortKey(b.title));
      });
    } else {
      out.sort(SORTERS[sortKey] || SORTERS['title-asc']);
    }

    return out;
  }

  window.Search = {
    run: run,
    tokens: tokens,
    normalize: normalize,
    fold: fold,
    highlight: highlight,
    escapeHtml: escapeHtml,
    progressOf: progressOf,
    authorSortKey: authorSortKey,
    collator: collator,
    SORTERS: SORTERS,
  };
})();
