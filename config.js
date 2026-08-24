/* Kitaplık — yapılandırma
 *
 * Supabase panelinde: Project Settings → API Keys
 *
 *   SUPABASE_URL      → "Project URL"
 *   SUPABASE_ANON_KEY → "publishable" anahtar (eski adıyla "anon / public")
 *
 * DİKKAT: Buraya sadece publishable / anon anahtarını yaz. "service_role" ya da
 * "secret" anahtarını ASLA bu dosyaya koyma — bu dosya herkese açık yayınlanıyor
 * ve o anahtar tüm güvenlik kurallarını atlar.
 *
 * Publishable anahtarın herkese açık olması normaldir; verini RLS (Row Level
 * Security) kuralları korur, schema.sql bunu kuruyor. Kimliksiz bir istek
 * bu anahtarla veri okuyamaz ve yazamaz.
 *
 * Bu iki alan boş bırakılırsa uygulama "sadece bu cihaz" modunda çalışır:
 * her şey çalışır ama cihazlar arası senkron olmaz.
 */

window.KITAPLIK_CONFIG = {
  SUPABASE_URL: 'https://dguvuqeeykufobsnkuqy.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_NKCTb52EVHEzCRNZTM7Egg_AD1r84f4',

  // Senkron aralığı (ms). Uygulama açıkken bu sıklıkla sunucuyla eşitlenir.
  SYNC_INTERVAL_MS: 60000,

  // ISBN ile künye araması için kullanılacak kaynaklar (sırayla denenir).
  LOOKUP_SOURCES: ['google', 'openlibrary'],

  /* Reklam alanları.
   *   enabled  : false yaparsan tüm reklam alanları kaybolur
   *   provider : 'placeholder' → deneme alanları
   *              'adsense'     → gerçek reklamlar (ads.js içinde doldurulmalı)
   *   inLibrary: kendi kitaplığında da reklam gösterilsin mi
   *
   * Not: Kişisel kitaplık, kullanıcının kendi verisiyle baş başa olduğu yer.
   * Oraya reklam koymak dönüşüm getirmez ama rahatsızlık verir; varsayılan
   * olarak kapalı bırakıldı. Ziyaretçi trafiği zaten ana sayfa, keşfet ve
   * profil sayfalarında.
   */
  ADS: {
    enabled: true,
    provider: 'placeholder',
    inLibrary: false,
  },
};
