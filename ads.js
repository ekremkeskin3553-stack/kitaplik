/* Kitaplık — reklam alanları
 *
 * Şu an yalnızca DENEME reklamları gösteriliyor: içerikleri kurgusal, hiçbir
 * gerçek markayla ilgisi yok. Amaç, düzenin gerçek reklamlarla nasıl
 * görüneceğini şimdiden görmek ve ileride gerçek reklam koduna geçerken
 * sayfaları hiç ellememek.
 *
 * GERÇEK REKLAMA GEÇİŞ
 * --------------------
 * config.js içindeki ADS.provider değerini 'adsense' yap ve aşağıdaki
 * renderAdsense fonksiyonunu doldur. Sayfaların hiçbiri değişmez; hepsi
 * Ads.slot() çağırıyor.
 *
 * NOT: Google AdSense yalnızca web siteleri içindir. Uygulama mağazalarına
 * paketlenmiş bir sürümde AdSense kullanmak kurallara aykırıdır; orada AdMob
 * gerekir.
 */

(function () {
  'use strict';

  var cfg = (window.KITAPLIK_CONFIG || {}).ADS || {};
  var enabled = cfg.enabled !== false;
  var provider = cfg.provider || 'placeholder';

  /* Alan ölçüleri yaygın reklam standartlarına göre seçildi ki gerçek
   * reklamlara geçince düzen kaymasın. */
  var SLOTS = {
    top:    { olcu: '970×90',  sinif: 'ad-top',    bicim: 'yatay' },
    left:   { olcu: '160×600', sinif: 'ad-rail',   bicim: 'dar-dikey' },
    right:  { olcu: '300×600', sinif: 'ad-rail',   bicim: 'dikey' },
    inline: { olcu: '336×280', sinif: 'ad-inline', bicim: 'kare' },
  };

  /* Kurgusal reklam içerikleri. Gerçek bir marka, ürün ya da fiyat değil;
   * yalnızca düzenin nasıl görüneceğini göstermek için. */
  var CREATIVES = [
    { tema: 'mor',    baslik: 'Sayfa Sayfa Yayınevi', alt: 'Yeni çıkanlarda sonbahar indirimi', cta: 'İncele',        simge: '📖' },
    { tema: 'yesil',  baslik: 'Kahve & Kitap',        alt: 'Şehrin en sessiz okuma köşesi',      cta: 'Yol tarifi',    simge: '☕' },
    { tema: 'turuncu',baslik: 'Kitap Kutusu',         alt: 'Ayda bir sürpriz kitap kapında',     cta: 'Abone ol',      simge: '📦' },
    { tema: 'mavi',   baslik: 'Sesli Kitap+',         alt: 'Yolda, koşuda, mutfakta dinle',      cta: 'İlk ay ücretsiz', simge: '🎧' },
    { tema: 'kirmizi',baslik: 'Okuma Kulübü',         alt: 'Her ay bir kitap, her ay yeni dostlar', cta: 'Katıl',      simge: '💬' },
    { tema: 'lacivert',baslik: 'Eski Sayfalar',       alt: 'Sahaf koleksiyonu, ikinci el hazineler', cta: 'Keşfet',    simge: '🔖' },
  ];

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Her alan farklı bir reklam göstersin diye sırayla dağıtıyoruz;
   *  başlangıç noktası rastgele ki her açılışta aynı sıra çıkmasın. */
  var sayac = Math.floor(Math.random() * CREATIVES.length);
  function nextCreative() {
    return CREATIVES[(sayac++) % CREATIVES.length];
  }

  function renderPlaceholder(key) {
    var s = SLOTS[key];
    var c = nextCreative();

    return '' +
      '<div class="ad-slot ' + s.sinif + ' ad-' + c.tema + ' ad-' + s.bicim + '" ' +
           'data-slot="' + key + '" role="complementary" aria-label="Deneme reklam alanı">' +
        '<span class="ad-flag">DENEME</span>' +
        '<div class="ad-body">' +
          '<span class="ad-emoji" aria-hidden="true">' + c.simge + '</span>' +
          '<span class="ad-head">' + escapeHtml(c.baslik) + '</span>' +
          '<span class="ad-sub">' + escapeHtml(c.alt) + '</span>' +
          '<span class="ad-cta">' + escapeHtml(c.cta) + '</span>' +
        '</div>' +
        '<span class="ad-size">' + escapeHtml(s.olcu) + '</span>' +
      '</div>';
  }

  /** Gerçek reklam sağlayıcısı bağlandığında burası doldurulacak.
   *  Şu an bilinçli olarak boş: yanlış yapılandırılmış bir reklam kodu
   *  sayfayı bozabileceği için, hazır olmadan devreye girmemeli. */
  function renderAdsense(key) {
    console.warn('[reklam] AdSense henüz yapılandırılmadı, deneme reklamı gösteriliyor:', key);
    return renderPlaceholder(key);
  }

  function slot(key) {
    if (!enabled || !SLOTS[key]) return '';
    if (provider === 'adsense') return renderAdsense(key);
    return renderPlaceholder(key);
  }

  /**
   * Sayfadaki sabit reklam alanlarını bir kez doldurur.
   * Alanlar sayfa değişse de yerinde kaldığı için reklamlar her gezinmede
   * yeniden yüklenmez — hem daha hızlı, hem gerçek reklamlarda gösterim
   * sayısını yapay olarak şişirmemek için doğrusu bu.
   */
  function mount() {
    if (!enabled) {
      // Reklamlar tümden kapalıysa kabuk da tek sütuna dönsün; aksi hâlde
      // boş yan sütunlar yer kaplamaya devam eder.
      document.body.classList.add('ads-off');
      return;
    }
    var eslesme = { 'ad-top': 'top', 'ad-left': 'left', 'ad-right': 'right' };
    Object.keys(eslesme).forEach(function (id) {
      var e = document.getElementById(id);
      if (e && !e.dataset.filled) {
        e.innerHTML = slot(eslesme[id]);
        e.dataset.filled = '1';
      }
    });
  }

  /** Kitaplık ekranında reklam gösterilsin mi? Kullanıcının kendi verisiyle
   *  baş başa olduğu yer; varsayılan olarak kapalı. */
  function setLibraryMode(onLibrary) {
    if (!enabled) return;
    var gizle = onLibrary && cfg.inLibrary === false;
    document.body.classList.toggle('ads-off', !!gizle);
  }

  window.Ads = {
    slot: slot,
    mount: mount,
    setLibraryMode: setLibraryMode,
    isEnabled: function () { return enabled; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
