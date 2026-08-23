/* Kitaplık — yapılandırma
 *
 * Supabase projeni açtıktan sonra aşağıdaki iki değeri doldur.
 * Supabase panelinde: Project Settings → API
 *
 *   SUPABASE_URL      → "Project URL"
 *   SUPABASE_ANON_KEY → "Project API keys" bölümündeki  anon / public  anahtar
 *
 * DİKKAT: Buraya sadece "anon" anahtarını yaz. "service_role" anahtarını ASLA
 * bu dosyaya koyma — bu dosya herkese açık olarak yayınlanıyor.
 * anon anahtarının herkese açık olması normaldir; verini RLS (Row Level
 * Security) kuralları korur, schema.sql bunu kuruyor.
 *
 * Bu iki alan boş bırakılırsa uygulama "sadece bu cihaz" modunda çalışır:
 * her şey çalışır ama cihazlar arası senkron olmaz.
 */

window.KITAPLIK_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Senkron aralığı (ms). Uygulama açıkken bu sıklıkla sunucuyla eşitlenir.
  SYNC_INTERVAL_MS: 60000,

  // ISBN ile künye araması için kullanılacak kaynaklar (sırayla denenir).
  LOOKUP_SOURCES: ['google', 'openlibrary'],
};
