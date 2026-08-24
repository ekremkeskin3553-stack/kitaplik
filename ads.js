/* Kitaplık — reklam alanları
 *
 * Şu an yalnızca yer tutucu ("deneme") reklamlar gösteriliyor. Amaç, düzenin
 * gerçek reklamlarla nasıl görüneceğini şimdiden görmek ve ileride gerçek
 * reklam koduna geçerken sayfaları hiç ellememek.
 *
 * GERÇEK REKLAMA GEÇİŞ
 * --------------------
 * config.js içindeki ADS.provider değerini 'adsense' yap ve client kimliğini
 * gir. Sonra aşağıdaki renderAdsense fonksiyonunu doldur. Sayfaların hiçbiri
 * değişmez; hepsi Ads.slot() çağırıyor.
 *
 * NOT: Google AdSense yalnızca web siteleri içindir. Uygulama mağazalarına
 * paketlenmiş bir sürümde AdSense kullanmak kurallara aykırıdır; orada AdMob
 * gerekir. Bu ayrım ileride önem kazanacak.
 */

(function () {
  'use strict';

  var cfg = (window.KITAPLIK_CONFIG || {}).ADS || {};
  var enabled = cfg.enabled !== false;
  var provider = cfg.provider || 'placeholder';

  /* Alan tanımları. Ölçüler yaygın reklam standartlarına göre seçildi ki
   * gerçek reklamlara geçince düzen kaymasın. */
  var SLOTS = {
    top:    { ad: 'Üst banner',   olcu: '970×90',  sinif: 'ad-top' },
    left:   { ad: 'Sol sütun',    olcu: '160×600', sinif: 'ad-rail' },
    right:  { ad: 'Sağ sütun',    olcu: '300×600', sinif: 'ad-rail' },
    inline: { ad: 'İçerik arası', olcu: '336×280', sinif: 'ad-inline' },
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Yer tutucu: gerçek reklamın kaplayacağı alanı aynı ölçüde gösterir. */
  function renderPlaceholder(key) {
    var s = SLOTS[key];
    return '' +
      '<div class="ad-slot ' + s.sinif + '" data-slot="' + key + '" aria-hidden="true">' +
        '<div class="ad-inner">' +
          '<span class="ad-label">REKLAM</span>' +
          '<span class="ad-size">' + escapeHtml(s.ad) + ' · ' + escapeHtml(s.olcu) + '</span>' +
          '<span class="ad-note">deneme alanı</span>' +
        '</div>' +
      '</div>';
  }

  /** Gerçek reklam sağlayıcısı bağlandığında burası doldurulacak.
   *  Şu an bilinçli olarak boş: yanlış yapılandırılmış bir reklam kodu
   *  sayfayı bozabileceği için, hazır olmadan devreye girmemeli. */
  function renderAdsense(key) {
    console.warn('[reklam] AdSense henüz yapılandırılmadı, yer tutucu gösteriliyor:', key);
    return renderPlaceholder(key);
  }

  /**
   * Bir reklam alanının HTML'ini döndürür.
   * @param {'top'|'left'|'right'|'inline'} key
   * @returns {string} kapalıysa boş metin
   */
  function slot(key) {
    if (!enabled || !SLOTS[key]) return '';
    if (provider === 'adsense') return renderAdsense(key);
    return renderPlaceholder(key);
  }

  /**
   * Sayfadaki sabit reklam alanlarını bir kez doldurur.
   * Alanlar sayfa değişse de yerinde kaldığı için reklamlar her gezinmede
   * yeniden yüklenmez — hem daha hızlı, hem gerçek reklamlarda gösterim
   * sayısını şişirmemek için doğrusu bu.
   */
  function mount() {
    if (!enabled) return;
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
