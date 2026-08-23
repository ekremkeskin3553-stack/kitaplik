# Kitaplık

Kişisel kitaplık uygulaması. Telefon, tablet ve bilgisayarda aynı kitaplığı gösterir,
internetsiz de çalışır.

## Özellikler

- **Barkod tarama** — kitabın arkasındaki barkodu okutup künyeyi otomatik doldurur;
  her alan elle de girilebilir/düzeltilebilir
- **Arama** — kitap adı, yazar, raf, yayınevi, seri, etiket ve ISBN üzerinde
- **Türkçe duyarlı arama** — `gulun` yazınca **Gülün Adı**'nı, `ıgdır` ya da `Igdir`
  yazınca **Iğdır Notları**'nı bulur. Yazım hatasını tolere eder (`dostoyevsky` →
  Dostoyevski), harf sırasıyla da eşleşir (`hrp` → Harry Potter)
- **Alfabetik sıralama** — ada veya yazara göre, Türkçe alfabe sırasıyla.
  Yazar sıralaması soyada göredir ("Orhan Pamuk" → Pamuk)
- **Okuma istatistiği** — ana ekranda kitap adının yanında hem yüzde hem ilerleme çubuğu
- **Raflar** — raf adı girilir, rafa göre filtrelenir ve gruplanır
- **Ödünç takibi** — kime, ne zaman verildi, ne zaman iade edilecek;
  geciken ödünçler kırmızı işaretlenir
- **Cihazlar arası senkron** — Supabase üzerinden (isteğe bağlı)
- **Çevrimdışı çalışma** — veri cihazda tutulur, internet gelince eşitlenir
- **Yedekleme** — JSON yedek alma/geri yükleme, Excel için CSV dışa aktarma

## Kurulum

### 1. Supabase (cihazlar arası senkron için)

Senkron istemiyorsan bu adımı atla — uygulama tek cihazda sorunsuz çalışır.

1. [supabase.com](https://supabase.com) üzerinde ücretsiz bir proje aç
2. Sol menüden **SQL Editor → New query**, `schema.sql` dosyasının tamamını
   yapıştır ve **Run** de
3. **Project Settings → API** bölümünden şunları al:
   - **Project URL**
   - **Project API keys** altındaki **anon / public** anahtar
4. Bu ikisini `config.js` içine yaz:

```js
window.KITAPLIK_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGci...',
  ...
};
```

> **Güvenlik notu:** `anon` anahtarının herkese açık olması normaldir — Supabase
> bunun için tasarlanmıştır. Veriyi koruyan şey `schema.sql`'in kurduğu RLS
> kurallarıdır; herkes yalnızca kendi satırlarını görebilir. **`service_role`
> anahtarını asla bu dosyaya koyma**, o anahtar tüm kuralları atlar.

### 2. Yayınlama

Klasördeki tüm dosyaları statik olarak sunan herhangi bir yer işe yarar
(GitHub Pages, Netlify, Cloudflare Pages…). Derleme adımı yok.

**Önemli:** Barkod tarama kamera erişimi istediği için **HTTPS şarttır**.
`http://` üzerinden yayınlarsan kamera açılmaz (yalnızca `localhost` istisnadır).

### 3. Telefona / tablete kurma

Siteyi telefonda aç → tarayıcı menüsünden **Ana ekrana ekle**.
Uygulama tam ekran açılır ve çevrimdışı çalışır. Her cihazda aynı e-posta ile
giriş yaptığında kitaplığın hepsinde aynı olur.

## Bilinen sınırlar

- **Barkod tarama iOS Safari'de çalışmaz.** Tarayıcının `BarcodeDetector`
  desteğine dayanıyor; Android Chrome'da çalışır, iOS Safari henüz desteklemiyor.
  Desteklenmeyen cihazlarda tarama penceresi ISBN'i elle yazma alanına düşer,
  künye yine otomatik gelir.
- **Künye kaynakları** Google Books ve Open Library. Google Books zaman zaman
  hız sınırı (429) uygulayabiliyor; o durumda Open Library devreye giriyor.
  İkisinde de olmayan bir kitabın bilgilerini elle girmek gerekir.
- **Çakışma çözümü "son yazan kazanır"** kuralıyla, kaydın `updated_at` damgasına
  bakarak çalışır. Aynı kitabı iki cihazda aynı anda düzenlersen sonuncusu kalır.
  Cihaz saatleri ağdan senkron olduğu için pratikte sorun çıkarmaz.

## Dosyalar

| Dosya | İşi |
|---|---|
| `index.html` | Arayüz iskeleti |
| `styles.css` | Görünüm (açık/koyu tema otomatik) |
| `config.js` | **Senin dolduracağın** Supabase ayarları |
| `search.js` | Türkçe duyarlı arama, puanlama, sıralama |
| `db.js` | Yerel depo (IndexedDB) |
| `sync.js` | Supabase kimlik doğrulama + veri senkronu |
| `isbn.js` | Barkod okuma, ISBN doğrulama, künye çekme |
| `app.js` | Arayüz akışı ve olaylar |
| `sw.js` | Service worker (çevrimdışı çalışma) |
| `manifest.webmanifest` | Ana ekrana eklenebilir uygulama tanımı |
| `schema.sql` | Supabase veritabanı kurulumu |

Harici kütüphane, CDN ve derleme adımı yoktur; dosyalar olduğu gibi çalışır.

## Geliştirme

Dosyaları düzenledikten sonra `sw.js` içindeki `CACHE` sürümünü artır
(`kitaplik-v1` → `kitaplik-v2`), yoksa tarayıcı eski sürümü önbellekten
sunmaya devam eder.
