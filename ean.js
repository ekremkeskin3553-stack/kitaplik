/* Kitaplık — EAN-13 / EAN-8 barkod çözücü
 *
 * Neden var: barkod okuma normalde tarayıcının BarcodeDetector özelliğine
 * bırakılır, ama iOS'ta hiçbir tarayıcı bunu desteklemiyor. Hazır bir kütüphane
 * eklemek yerine, yalnızca kitap barkodlarını (EAN-13) çözen dar kapsamlı bir
 * okuyucu yazmak hem çok daha küçük hem de projenin "sıfır bağımlılık"
 * yapısını bozmuyor.
 *
 * EAN-13 yapısı (toplam 95 modül):
 *   başlangıç işareti  101
 *   6 sol hane         her biri 7 modül  (L veya G kodlamasıyla)
 *   orta işaret        01010
 *   6 sağ hane         her biri 7 modül  (R kodlamasıyla)
 *   bitiş işareti      101
 *
 * 13. hane barkodda çizili değildir; sol hanelerin L/G kodlama sırasından
 * çıkarılır. Bu yüzden ilk haneyi ayrıca "okumak" gerekmez, desenden gelir.
 */

(function () {
  'use strict';

  /* Her hane 4 çubuk/boşluk genişliğiyle ifade edilir (toplam 7 modül).
   * L ve R kodları aynı genişliklere sahiptir — R, L'nin bit karşıtıdır ve
   * karşıtlık genişlikleri değiştirmez, sadece çubukla mı boşlukla mı
   * başlandığını değiştirir. G kodu ise L'nin ters çevrilmişidir.
   * Bu yüzden tek bir tablo üç kodlamaya da yetiyor. */
  var L_WIDTHS = [
    [3, 2, 1, 1], // 0
    [2, 2, 2, 1], // 1
    [2, 1, 2, 2], // 2
    [1, 4, 1, 1], // 3
    [1, 1, 3, 2], // 4
    [1, 2, 3, 1], // 5
    [1, 1, 1, 4], // 6
    [1, 3, 1, 2], // 7
    [1, 2, 1, 3], // 8
    [3, 1, 1, 2], // 9
  ];

  var G_WIDTHS = L_WIDTHS.map(function (w) { return w.slice().reverse(); });

  /* Sol hanelerin L/G sırası 13. haneyi belirler. 1 = G, 0 = L. */
  var PARITY_TO_FIRST = {
    '000000': 0, '001011': 1, '001101': 2, '001110': 3, '010011': 4,
    '011001': 5, '011100': 6, '010101': 7, '010110': 8, '011010': 9,
  };

  var MAX_VARIANCE = 0.48;        // desen eşleşmesinde izin verilen sapma
  var MAX_INDIVIDUAL_VARIANCE = 0.7;

  /**
   * Ölçülen 4 genişliğin beklenen desene ne kadar uyduğunu döndürür.
   * Küçük değer = iyi eşleşme. Uymuyorsa Infinity.
   * Genişlikler orantısal karşılaştırılır, böylece barkodun ekrandaki
   * büyüklüğü ya da uzaklığı sonucu etkilemez.
   */
  function variance(counters, pattern) {
    var total = 0, patternTotal = 0, i;
    for (i = 0; i < counters.length; i++) {
      total += counters[i];
      patternTotal += pattern[i];
    }
    if (total < patternTotal) return Infinity;   // desenden küçük, olamaz

    var unit = total / patternTotal;
    var maxVar = unit * MAX_INDIVIDUAL_VARIANCE;
    var v = 0;
    for (i = 0; i < counters.length; i++) {
      var expected = pattern[i] * unit;
      var diff = Math.abs(counters[i] - expected);
      if (diff > maxVar) return Infinity;
      v += diff;
    }
    return v / total;
  }

  /** Bir haneyi çöz. side: 'left' → L/G dener, 'right' → R dener.
   *  @returns {{digit:number, isG:boolean}|null} */
  function decodeDigit(counters, side) {
    var best = MAX_VARIANCE, bestDigit = -1, bestG = false;

    for (var d = 0; d < 10; d++) {
      var v = variance(counters, L_WIDTHS[d]);   // L ve R aynı genişlikler
      if (v < best) { best = v; bestDigit = d; bestG = false; }

      if (side === 'left') {
        var vg = variance(counters, G_WIDTHS[d]);
        if (vg < best) { best = vg; bestDigit = d; bestG = true; }
      }
    }
    return bestDigit < 0 ? null : { digit: bestDigit, isG: bestG };
  }

  /** EAN-13 sağlama hanesi doğru mu? */
  function checksumOk(digits) {
    if (digits.length === 13) {
      var sum = 0;
      for (var i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * digits[i];
      return (10 - (sum % 10)) % 10 === digits[12];
    }
    if (digits.length === 8) {
      var s8 = 0;
      for (var j = 0; j < 7; j++) s8 += (j % 2 === 0 ? 3 : 1) * digits[j];
      return (10 - (s8 % 10)) % 10 === digits[7];
    }
    return false;
  }

  /**
   * Gri tonlamalı tek bir satırı siyah/beyaz koşu dizisine çevirir.
   * Koşu = arka arkaya gelen aynı renkteki piksel sayısı. Barkod okuma
   * tamamen bu genişliklerin oranına dayanır.
   */
  function toRuns(gray) {
    // Eşik olarak satırın en açık ve en koyu değerinin ortası kullanılıyor;
    // bu, farklı ışık koşullarında sabit bir eşikten çok daha iyi çalışıyor.
    var min = 255, max = 0, i;
    for (i = 0; i < gray.length; i++) {
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
    if (max - min < 40) return null;      // kontrast yok, bu satırda barkod yok

    var threshold = (min + max) / 2;
    var runs = [];
    var isBlack = gray[0] < threshold;
    var len = 1;
    for (i = 1; i < gray.length; i++) {
      var b = gray[i] < threshold;
      if (b === isBlack) {
        len++;
      } else {
        runs.push({ len: len, black: isBlack });
        isBlack = b;
        len = 1;
      }
    }
    runs.push({ len: len, black: isBlack });
    return runs;
  }

  /** Üç koşunun 1:1:1 oranında olup olmadığına bakar (başlangıç/bitiş işareti). */
  function isGuard(runs, i) {
    if (i + 2 >= runs.length) return false;
    if (!runs[i].black) return false;
    var a = runs[i].len, b = runs[i + 1].len, c = runs[i + 2].len;
    var avg = (a + b + c) / 3;
    if (avg < 1) return false;
    var tol = avg * 0.7;
    return Math.abs(a - avg) <= tol && Math.abs(b - avg) <= tol && Math.abs(c - avg) <= tol;
  }

  function widthsAt(runs, i) {
    return [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len];
  }

  /** Başlangıç işaretinin runs[start] konumunda olduğunu varsayıp EAN-13 çözer. */
  function decodeEan13At(runs, start) {
    var i = start + 3;                    // başlangıç işaretini atla
    if (i + 56 > runs.length) return null;

    var digits = [];
    var parity = '';
    var k;

    // 6 sol hane — her biri boşlukla başlar
    for (k = 0; k < 6; k++) {
      if (runs[i].black) return null;     // hizalama bozuk
      var l = decodeDigit(widthsAt(runs, i), 'left');
      if (!l) return null;
      digits.push(l.digit);
      parity += l.isG ? '1' : '0';
      i += 4;
    }

    // Orta işaret: 5 koşu, hepsi ~1 modül
    var mid = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len];
    var midAvg = (mid[0] + mid[1] + mid[2] + mid[3] + mid[4]) / 5;
    for (k = 0; k < 5; k++) {
      if (Math.abs(mid[k] - midAvg) > midAvg * 0.8) return null;
    }
    i += 5;

    // 6 sağ hane — her biri çubukla başlar
    for (k = 0; k < 6; k++) {
      if (!runs[i].black) return null;
      var r = decodeDigit(widthsAt(runs, i), 'right');
      if (!r) return null;
      digits.push(r.digit);
      i += 4;
    }

    var first = PARITY_TO_FIRST[parity];
    if (first === undefined) return null;   // geçersiz kodlama sırası

    var all = [first].concat(digits);
    if (!checksumOk(all)) return null;      // sağlama tutmuyorsa okuma hatalı
    return all.join('');
  }

  /** Bir satırda barkod ara. Bulamazsa null. */
  function decodeRow(gray) {
    var runs = toRuns(gray);
    if (!runs || runs.length < 59) return null;

    for (var i = 0; i + 58 < runs.length; i++) {
      if (!isGuard(runs, i)) continue;

      // Sessiz alan kontrolü: gerçek barkodun solunda en az birkaç modül
      // genişliğinde boşluk vardır. Bu şart olmadan gürültülü görüntülerde
      // rastgele çubuk dizileri geçerli bir barkod gibi çözülebiliyor.
      var moduleW = (runs[i].len + runs[i + 1].len + runs[i + 2].len) / 3;
      if (i === 0) {
        // Görüntünün en solundan başlıyorsa sessiz alanı göremeyiz; bu
        // durumda barkod büyük ihtimalle kırpılmış, atla.
        continue;
      }
      if (runs[i - 1].black || runs[i - 1].len < moduleW * 3) continue;

      var res = decodeEan13At(runs, i);
      if (res) return res;
    }
    return null;
  }

  /**
   * Bir karedeki barkodu bul.
   * Tek bir satır yetmez: barkodun bir kısmı parlamada kaybolmuş ya da
   * parmakla kapanmış olabilir. Bu yüzden görüntünün ortasındaki bandı
   * birçok yatay çizgiyle tarıyoruz. Ayrıca her satır ters çevrilerek de
   * deneniyor, böylece telefon baş aşağı tutulsa da okuyor.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w  @param {number} h
   * @returns {string|null} 13 haneli ISBN/EAN veya null
   */
  function decodeFrame(ctx, w, h) {
    var img;
    try {
      img = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return null;                       // farklı kaynaktan gelen görüntü
    }
    var data = img.data;

    var ROWS = 24;
    var bandTop = Math.floor(h * 0.18);
    var bandHeight = Math.floor(h * 0.64);
    var gray = new Uint8Array(w);

    for (var r = 0; r < ROWS; r++) {
      var y = bandTop + Math.floor((bandHeight * r) / (ROWS - 1));
      if (y < 0 || y >= h) continue;

      var off = y * w * 4;
      for (var x = 0; x < w; x++) {
        var p = off + x * 4;
        // Yeşil kanal ağırlıklı hızlı gri dönüşümü
        gray[x] = (data[p] * 77 + data[p + 1] * 151 + data[p + 2] * 28) >> 8;
      }

      var hit = decodeRow(gray);
      if (hit) return hit;

      // Ters yönde dene (barkod ters duruyorsa)
      var rev = new Uint8Array(w);
      for (var q = 0; q < w; q++) rev[q] = gray[w - 1 - q];
      hit = decodeRow(rev);
      if (hit) return hit;
    }
    return null;
  }

  window.EAN = {
    decodeFrame: decodeFrame,
    decodeRow: decodeRow,
    checksumOk: checksumOk,
    _toRuns: toRuns,
  };
})();
