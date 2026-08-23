# Kitaplık — Kendi Kopyanı Kurma Kılavuzu

> Bu dosya, uygulamayı kendi hesaplarınla sıfırdan kurmak isteyen biri için
> yazıldı. Doğrudan Claude Code'a (ya da benzeri bir yapay zekâ asistanına)
> verip "bu kılavuza göre kurulumu yap" diyebilirsin.

---

## 0. Önce şunu oku: kurmana gerek olmayabilir

Uygulama **çok kullanıcılı çalışacak şekilde tasarlandı**. Veritabanındaki
güvenlik kuralları (RLS) her hesabı kendi verisine hapsediyor — aynı kurulum
üzerinde 10 kişi hesap açsa, 10 ayrı bağımsız kitaplık olur, kimse kimsenin
kitabını göremez.

**Yani en kolay yol:** seni davet eden kişiden mevcut kurulumda kayıt olmanı
istemek. Adresi aç, kendi e-postanla kayıt ol, bitti. Kurulum yapmana,
hesap açmana, dosya indirmene gerek yok.

Bunun için karşı tarafın Supabase panelinde **Authentication → Providers →
Email → "Allow new users to sign up"** ayarının açık olması gerekir.

Aşağıdaki kurulumu yalnızca **tamamen bağımsız, kendi kontrolünde bir kopya**
istiyorsan yap.

---

## 1. Uygulama nedir, nasıl çalışır

Kişisel kitaplık uygulaması. Telefon, tablet ve bilgisayarda aynı kitaplığı
gösterir, internetsiz de çalışır.

**Mimari — üç parça:**

```
  Tarayıcı (PWA)          GitHub Pages              Supabase
  ──────────────          ────────────              ────────
  Arayüz + arama          Dosyaları barındırır      Postgres veritabanı
  IndexedDB (yerel)  ───► (statik, ücretsiz)   ◄─── Kimlik doğrulama (GoTrue)
  Service worker                                    REST API (PostgREST)
  (çevrimdışı)                                      RLS güvenlik kuralları
```

**Önemli teknik kararlar:**

- **Sıfır bağımlılık.** Harici kütüphane, CDN, npm paketi, derleme adımı yok.
  Dosyalar olduğu gibi çalışır. Supabase'in resmî JS kütüphanesi bile
  kullanılmıyor — REST uçları doğrudan `fetch` ile çağrılıyor.
- **Önce yerele yaz.** Her değişiklik önce IndexedDB'ye kaydedilir, sonra
  sunucuya gönderilir. Çevrimdışıyken de her şey çalışır.
- **Çakışma çözümü: son yazan kazanır** (`updated_at` damgasına göre).
  Damgayı istemci koyar; sunucuda tetikleyiciyle güncellenmez, yoksa hangi
  değişikliğin gerçekten daha yeni olduğu kaybolurdu.
- **Silme = işaretleme.** Kayıtlar gerçekten silinmez, `deleted: true`
  işaretlenir. Aksi hâlde bir cihazda silinen kitabı diğer cihaz "yeni kayıt"
  sanıp geri diriltirdi.
- **Arama tamamen istemcide.** Kişisel kitaplık birkaç bin kaydı geçmez;
  bellekteki dizide arama anında sonuç verir ve çevrimdışı çalışır.

**Dosyalar:**

| Dosya | İşi |
|---|---|
| `index.html` | Arayüz iskeleti |
| `styles.css` | Görünüm (açık/koyu tema otomatik) |
| `config.js` | **Doldurman gereken** Supabase ayarları |
| `search.js` | Türkçe duyarlı arama, puanlama, sıralama |
| `db.js` | Yerel depo (IndexedDB) |
| `sync.js` | Supabase kimlik doğrulama + veri senkronu |
| `ean.js` | EAN-13 barkod çözücü (iOS için — aşağıda açıklaması var) |
| `isbn.js` | Kamera taraması, ISBN doğrulama, künye çekme, adla arama |
| `app.js` | Arayüz akışı ve olaylar |
| `sw.js` | Service worker (çevrimdışı çalışma + otomatik güncelleme) |
| `manifest.webmanifest` | Ana ekrana eklenebilir uygulama tanımı |
| `schema.sql` | Supabase veritabanı kurulumu |

---

## 2. Özellikler

- **Barkod tarama** — kitabın arkasındaki barkodu okutup künyeyi doldurur
- **Elle giriş** — her alan elle girilebilir/düzeltilebilir
- **Adıyla arama** — ISBN kataloglarda yoksa kitap adı/yazarla arayıp seçme
- **Kapak görseli** — cihazdan seçme (kamera/galeri) veya internetten bağlantı
- **Türkçe duyarlı arama** — `gulun` → *Gülün Adı*, `Igdir`/`ıgdır` → *Iğdır
  Notları*, yazım hatası toleransı (`dostoyevsky` → Dostoyevski), harf sırası
  eşleşmesi (`hrp` → *Harry Potter*)
- **Alfabetik sıralama** — ada veya yazara göre, Türkçe alfabe sırasıyla;
  yazar sıralaması soyada göre ("Orhan Pamuk" → Pamuk)
- **Okuma istatistiği** — kitap adının yanında yüzde + ilerleme çubuğu
- **Raflar** — raf adı girilir, rafa göre filtrelenir ve gruplanır
- **Ödünç takibi** — kime/ne zaman verildi, iade tarihi, geciken ödünçler kırmızı
- **Cihazlar arası senkron** — Supabase üzerinden, otomatik
- **Çevrimdışı çalışma** — veri cihazda, internet gelince eşitlenir
- **Yedekleme** — JSON yedek alma/geri yükleme, Excel uyumlu CSV dışa aktarma
- **Otomatik güncelleme** — yeni sürüm yayınlanınca uygulama kendini yeniler

---

## 3. Kurulum

Üç adım: kaynak kodu al → Supabase kur → yayınla.

### 3.1 Kaynak kodu al

```bash
git clone https://github.com/ekremkeskin3553-stack/kitaplik.git
cd kitaplik
```

`git` yoksa GitHub sayfasından **Code → Download ZIP** ile de indirebilirsin.

### 3.2 Supabase kur

1. [supabase.com](https://supabase.com) üzerinde ücretsiz hesap aç
   (**Continue with GitHub** en kolayı)
2. **New project**
   - Eğer *"You need additional permissions to create a project"* uyarısı
     çıkarsa: **Organization** açılır listesinden **New organization** ile
     kendi organizasyonunu oluştur, sonra tekrar dene
   - **Name:** `kitaplik`
   - **Database Password:** **Generate a password** ile üret, **kopyala ve
     sakla** (uygulamanın buna ihtiyacı yok ama kaybedersen sıfırlaman gerekir)
   - **Region:** Türkiye'den kullanacaksan **Central EU (Frankfurt)**
   - **Security ayarları:**
     - `Enable Data API` → **açık kalsın** (uygulama bunu kullanıyor)
     - `Automatically expose new tables` → **açık kalsın**
     - `Enable automatic RLS` → **işaretle** (güvenlik için iyi olur)
3. Proje hazırlanınca (1-2 dakika) **SQL Editor → New query**, depodaki
   `schema.sql` dosyasının **tamamını** yapıştır ve **Run**.
   `Success. No rows returned` görmelisin.
4. **Project Settings → API Keys** bölümünden şu ikisini al:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **publishable** anahtar (eski adıyla **anon / public**)
5. Bunları `config.js` içine yaz:

```js
window.KITAPLIK_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...',
  SYNC_INTERVAL_MS: 60000,
  LOOKUP_SOURCES: ['google', 'openlibrary'],
};
```

> **Güvenlik:** publishable/anon anahtarının herkese açık olması **normaldir**,
> öyle tasarlanmıştır. Veriyi koruyan şey `schema.sql`'in kurduğu RLS
> kurallarıdır. Doğrulaması: kimliksiz bir istek bu anahtarla ne veri
> okuyabilir ne yazabilir — yazma denemesi
> `new row violates row-level security policy` hatası alır.
>
> **`service_role` / `secret` anahtarını asla bu dosyaya koyma.** O anahtar
> tüm güvenlik kurallarını atlar ve bu dosya herkese açık yayınlanıyor.

### 3.3 Yayınla

Statik dosya sunan herhangi bir yer olur. **HTTPS şart** — barkod tarama
kamera erişimi istiyor, `http://` üzerinden kamera açılmaz (`localhost`
istisnadır).

**GitHub Pages ile (ücretsiz):**

1. GitHub'da `kitaplik` adında **public** bir repo oluştur
2. Kodu gönder:

```bash
git remote set-url origin https://github.com/KULLANICI_ADIN/kitaplik.git
git add -A
git commit -m "Supabase bağlantısını yapılandır"
git push -u origin main
```

3. Repo → **Settings → Pages** → **Source: Deploy from a branch**,
   **Branch: main**, **Folder: / (root)** → **Save**
4. Birkaç dakika sonra adres hazır:
   `https://KULLANICI_ADIN.github.io/kitaplik/`

**Alternatifler:** Netlify veya Cloudflare Pages'e klasörü sürükleyip
bırakmak da çalışır, yapılandırma gerekmez.

### 3.4 Kimlik doğrulama ayarları

Supabase panelinde **Authentication → URL Configuration**:

- **Site URL:** `https://KULLANICI_ADIN.github.io/kitaplik/`
- **Redirect URLs:** `https://KULLANICI_ADIN.github.io/kitaplik/**`
  (sondaki `**` önemli)

> Bu adım atlanırsa doğrulama e-postasındaki bağlantı `localhost:3000`
> adresine gider ve hata verir. Sık yapılan hata.

**Kendi kişisel kullanımın için** e-posta doğrulamasını kapatabilirsin:
**Authentication → Providers → Email → Confirm email** kapalı. Kayıt olur
olmaz giriş yapmış olursun. Hesabını oluşturduktan sonra
**Allow new users to sign up** ayarını da kapatırsan yabancılar senin
projende hesap açamaz.

### 3.5 Cihazlara kur

Her cihazda (telefon, tablet, bilgisayar):

1. Adresi tarayıcıda aç
2. Tarayıcı menüsünden **Ana ekrana ekle**
3. Uygulamada **giriş yap** → **aynı e-posta ve aynı parola**

Eşleşme için ayrı bir işlem yok — **hesap bağlantının kendisi.** Aynı hesapla
giren her cihaz aynı kitaplığı görür. Eşitleme otomatiktir: açılışta, uygulamaya
geri dönüldüğünde, her 60 saniyede, her değişiklikten sonra ve internet gelince.

---

## 4. Bilinmesi gereken sınırlar ve tuzaklar

### Barkod tarama iOS'ta özel yol kullanıyor

Tarayıcıların `BarcodeDetector` özelliği iOS'ta **hiçbir tarayıcıda yok**
(Safari de, iOS'taki Chrome da). Bu yüzden `ean.js` içinde elle yazılmış bir
EAN-13/EAN-8 çözücü var: kamera karesini tuvale alıp orta bandı 24 yatay
çizgiyle tarıyor, her satırı ters çevrilmiş hâliyle de deniyor (telefon baş
aşağı tutulsa da okusun) ve sağlama hanesini doğruluyor.

Yanlış okumaya karşı üç koruma var: sağlama hanesi kontrolü, başlangıç
işaretinin solunda **sessiz alan** şartı, ve aynı kodun **üst üste iki kez**
okunması zorunluluğu. Sentetik testte 6/6 gerçek barkod okundu, 400 sahte
görüntüde hiç yanlış okuma olmadı. Gerçek kamerayla saha testi yapılmadı.

Android Chrome'da tarayıcının kendi çözücüsü kullanılıyor (daha hızlı).

### Künye her kitapta bulunamaz

Künye kaynakları Google Books ve Open Library. Bunlar uluslararası, gönüllü
katkıyla büyüyen kataloglar — **Türkiye'de basılan kitapların önemli bir kısmı
kayıtlı değil.** Bu uygulamanın eksiği değil, veri kapsamı sorunu; aynı sebeple
ücretli uygulamalarda da çıkmaz. Türkiye'de kitapların resmî kaydı Milli
Kütüphane ve ISBN Ajansı'nda ama bunların tarayıcıdan çağrılabilir açık bir
servisi yok.

Bu yüzden **"Adıyla ara"** özelliği var: ISBN boş dönerse kitap adı veya
yazarla arayıp listeden seçebilirsin. ISBN araması başarısız olduğunda bu
pencere kendiliğinden açılır.

Google Books zaman zaman hız sınırı (HTTP 429) uygular; o durumda Open Library
devreye girer.

### Kapak görselleri veritabanında duruyor

Cihazdan seçilen kapaklar kaydın içinde **data URI** olarak saklanıyor —
böylece ayrı bir dosya deposu kurmadan senkronla diğer cihazlara gidiyor.
Kaydetmeden önce 480 piksele küçültülüp JPEG'e sıkıştırılıyor (220 KB'ı aşarsa
kalite kademeli düşürülüyor). 7,5 MB'lık bir görsel ~6 KB'a, sıkışması zor
17 MB'lık bir fotoğraf ~61 KB'a iniyor.

**Tek kullanıcı için sorun değil.** Ama uygulamayı çok sayıda kişiye açacaksan
bu yaklaşım Supabase'in 500 MB'lık ücretsiz sınırını hızla doldurur; o durumda
kapakları **Supabase Storage**'a taşımak gerekir.

### Service worker ve güncelleme

Dosyalar çevrimdışı çalışma için önbelleğe alınıyor. `sw.js` içindeki `CACHE`
sürümünü **her değişiklikte artır** (`kitaplik-v6` → `kitaplik-v7`), yoksa
tarayıcı eski sürümü sunmaya devam eder.

Uygulama artık kendini otomatik güncelliyor: yeni service worker sayfayı
devraldığı anda sayfa bir kez kendini yeniliyor. Yine de **kurulumdan hemen
sonraki ilk güncellemede** bir kez elle yenilemek gerekebilir.

### Çıkış yapmak yerel kopyayı siler

Çıkış, o cihazdaki yerel veriyi temizler. Gönderilmemiş değişiklik varsa
uygulama önce göndermeyi dener, başarısız olursa kaç kaydın silineceğini
açıkça söyler. Yine de **kitapların olduğu cihazda çıkış yapmadan önce
eşitlendiğinden emin ol.**

### Çakışma çözümü

Aynı kitabı iki cihazda aynı anda düzenlersen sonuncusu kalır. Cihaz saatleri
ağdan senkron olduğu için pratikte sorun çıkarmaz, ama saati ciddi şekilde
kaymış bir cihaz eski bir düzenlemeyle yeniyi ezebilir.

---

## 5. Uygulamayı çok kullanıcıya açmak

Altyapı hazır (RLS her hesabı kendi verisine hapsediyor) ama gerçek anlamda
başkalarına açmadan önce dört eksik var:

| Eksik | Neden kritik |
|---|---|
| **Parola sıfırlama yok** | Kullanıcı parolasını unutunca kilitli kalır. En büyük eksik. |
| **E-posta gönderimi** | Supabase'in yerleşik e-postası saatte birkaç adetle sınırlı. Resend/Brevo/SendGrid gibi bir SMTP servisi bağlanmalı |
| **Kapaklar veritabanında** | Çok kullanıcıda 500 MB sınırı dolar; Supabase Storage'a taşınmalı |
| **Hesap silme + gizlilik metni** | Başkalarının e-postasını ve verisini tutmak KVKK/GDPR kapsamına girer |

Ayrıca **Allow new users to sign up** açık ve **Confirm email** açık olmalı
(yoksa sahte adreslerle kayıt olunur).

---

## 6. Geliştirme

Derleme adımı yok. Dosyaları düzenle, statik bir sunucuyla aç, bitti.

Node veya Python varsa:

```bash
npx serve .
# veya
python -m http.server 8765
```

Hiçbiri yoksa Windows'ta PowerShell'in `System.Net.HttpListener` sınıfıyla
birkaç satırlık bir sunucu yazılabilir (bu proje ilk geliştirilirken öyle
yapıldı — makinede ne Node ne Python vardı).

**Not:** service worker `file://` üzerinden çalışmaz, mutlaka bir sunucu
üzerinden aç.

Değişiklikten sonra `sw.js` içindeki `CACHE` sürümünü artırmayı unutma.
