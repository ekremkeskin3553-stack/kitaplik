/* Kitaplık — sosyal ekranlar ve sayfa yönlendirici
 *
 * Uygulama tek sayfaydı; artık birden çok ekran var. Derleme adımı ve
 * kütüphane eklemeden, adres çubuğunun # kısmıyla yönlendirme yapıyoruz:
 *
 *   #/            kitaplığım (varsayılan)
 *   #/kesfet      insanları keşfet / ara
 *   #/profil      kendi profilim (düzenlenebilir)
 *   #/u/<ad>      birinin profili ve herkese açık rafı
 *
 * Bu yaklaşımın GitHub Pages'te ayrıca bir yapılandırma gerektirmemesi gibi
 * bir avantajı da var: sunucu tarafında yönlendirme kuralı yazmak gerekmiyor.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = Search.escapeHtml;
  var view = null;          // sosyal ekranların çizildiği kap
  var current = '';

  function el() {
    if (!view) view = $('social-view');
    return view;
  }

  /* ------------------------------------------------------------------
   * Kitaplık ekranı ile sosyal ekranlar arasında geçiş
   * ---------------------------------------------------------------- */
  function showLibrary(on) {
    ['stats', 'list', 'empty'].forEach(function (id) {
      var e = $(id);
      if (e) e.classList.toggle('hidden-by-router', !on);
    });
    $('search-wrap').classList.toggle('hidden-by-router', !on);
    $('filters').classList.toggle('hidden-by-router', !on);
    $('fab-row').classList.toggle('hidden-by-router', !on);
    el().hidden = on;
  }

  function setBusy(msg) {
    el().innerHTML = '<div class="page-busy">' + esc(msg || 'Yükleniyor…') + '</div>';
  }

  function setError(msg, retry) {
    el().innerHTML = '<div class="page-error"><p>' + esc(msg) + '</p>' +
      (retry ? '<button class="btn" id="page-retry">Tekrar dene</button>' : '') + '</div>';
    if (retry) $('page-retry').addEventListener('click', retry);
  }

  function requireLogin() {
    if (Sync.currentUser()) return true;
    el().innerHTML = '<div class="page-error"><p>Bu bölüm için giriş yapman gerekiyor.</p>' +
      '<button class="btn primary" id="page-login">Giriş yap</button></div>';
    $('page-login').addEventListener('click', function () {
      if (window.KitaplikApp && KitaplikApp.openAuth) KitaplikApp.openAuth();
    });
    return false;
  }

  /* ------------------------------------------------------------------
   * Ortak parçalar
   * ---------------------------------------------------------------- */

  function backBar(title, sub) {
    return '<div class="page-head">' +
      '<button class="icon-btn" id="page-back" aria-label="Geri">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
      '</button>' +
      '<div class="page-title"><strong>' + esc(title) + '</strong>' +
        (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
    '</div>';
  }

  function wireBack() {
    var b = $('page-back');
    if (b) b.addEventListener('click', function () { location.hash = '#/'; });
  }

  function avatarHtml(p, size) {
    var initials = (p.display_name || p.username || '?').trim().slice(0, 2);
    return '<span class="avatar avatar-' + (size || 'md') + '">' +
      (p.avatar_url
        ? '<img src="' + esc(p.avatar_url) + '" alt="" loading="lazy" onerror="this.remove()">'
        : '<span>' + esc(initials) + '</span>') +
    '</span>';
  }

  function personRow(p) {
    var sub = [];
    if (p.public_book_count) sub.push(p.public_book_count + ' kitap');
    if (p.follower_count) sub.push(p.follower_count + ' takipçi');
    if (p.city) sub.push(p.city);
    return '<a class="person-row" href="#/u/' + encodeURIComponent(p.username) + '">' +
      avatarHtml(p, 'sm') +
      '<span class="person-info">' +
        '<span class="person-name">' + esc(p.display_name || p.username) + '</span>' +
        '<span class="person-sub">@' + esc(p.username) +
          (sub.length ? ' · ' + esc(sub.join(' · ')) : '') + '</span>' +
      '</span>' +
    '</a>';
  }

  /* ==================================================================
   * KEŞFET
   * ================================================================ */
  function renderDiscover() {
    if (!requireLogin()) return;

    el().innerHTML =
      backBar('Keşfet', 'Kitapseverleri bul') +
      '<div class="page-body">' +
        '<div class="search-wrap page-search">' +
          '<input id="disc-q" type="search" autocomplete="off" placeholder="İsim veya kullanıcı adı…">' +
        '</div>' +
        '<div id="disc-list" class="person-list"></div>' +
      '</div>';
    wireBack();

    var listEl = $('disc-list');
    var input = $('disc-q');

    function paint(rows, bos) {
      if (!rows.length) {
        listEl.innerHTML = '<p class="page-note">' + esc(bos) + '</p>';
        return;
      }
      listEl.innerHTML = rows.map(personRow).join('');
    }

    listEl.innerHTML = '<p class="page-note">Yükleniyor…</p>';
    Social.discoverProfiles()
      .then(function (rows) { paint(rows, 'Henüz kimse kitaplığını herkese açmamış.'); })
      .catch(function (e) { listEl.innerHTML = '<p class="page-note">Yüklenemedi: ' + esc(e.message) + '</p>'; });

    var t;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim();
      t = setTimeout(function () {
        if (q.length < 2) {
          Social.discoverProfiles().then(function (rows) {
            paint(rows, 'Henüz kimse kitaplığını herkese açmamış.');
          });
          return;
        }
        listEl.innerHTML = '<p class="page-note">Aranıyor…</p>';
        Social.searchProfiles(q)
          .then(function (rows) { paint(rows, '“' + q + '” için kimse bulunamadı.'); })
          .catch(function (e) { listEl.innerHTML = '<p class="page-note">' + esc(e.message) + '</p>'; });
      }, 250);
    });
  }

  /* ==================================================================
   * KENDİ PROFİLİM
   * ================================================================ */
  function renderMyProfile() {
    if (!requireLogin()) return;
    setBusy('Profil yükleniyor…');

    Social.myProfile(true).then(function (p) {
      if (!p) {
        setError('Profil bulunamadı. Bu beklenmedik bir durum — çıkış yapıp tekrar girmeyi dene.');
        return;
      }

      el().innerHTML =
        backBar('Profilim') +
        '<div class="page-body">' +
          '<div class="profile-head">' + avatarHtml(p, 'lg') +
            '<div><strong>' + esc(p.display_name || p.username) + '</strong>' +
            '<span class="muted">@' + esc(p.username) + '</span></div>' +
          '</div>' +

          '<label class="field"><span>Kullanıcı adı</span>' +
            '<input id="pf-username" type="text" value="' + esc(p.username) + '" ' +
              'autocomplete="off" maxlength="20" inputmode="latin">' +
          '</label>' +
          '<div id="pf-username-msg" class="hint"></div>' +

          '<label class="field"><span>Görünen ad</span>' +
            '<input id="pf-name" type="text" value="' + esc(p.display_name || '') + '" maxlength="60">' +
          '</label>' +

          '<label class="field"><span>Hakkında</span>' +
            '<textarea id="pf-bio" rows="3" maxlength="300">' + esc(p.bio || '') + '</textarea>' +
          '</label>' +

          '<label class="field"><span>Şehir</span>' +
            '<input id="pf-city" type="text" value="' + esc(p.city || '') + '" maxlength="40">' +
          '</label>' +

          '<label class="check"><input id="pf-public" type="checkbox"' + (p.is_public ? ' checked' : '') + '>' +
            '<span>Profilim herkese açık olsun</span></label>' +
          '<p class="hint">Kapalıyken kimse profilini ve kitaplarını göremez — ' +
            'kitapları tek tek açmış olsan bile.</p>' +

          '<div id="pf-msg" class="hint"></div>' +
          '<button class="btn primary block" id="pf-save">Kaydet</button>' +

          '<hr class="page-sep">' +
          '<h3 class="page-h3">Kitaplarımın görünürlüğü</h3>' +
          '<p class="hint">Kitapların varsayılan olarak gizlidir. Herkese açtıklarını ' +
            'profilini ziyaret edenler görebilir.</p>' +
          '<div id="pf-visibility" class="vis-box"></div>' +
        '</div>';
      wireBack();
      wireProfileForm(p);
      renderVisibility();
    }).catch(function (e) {
      setError('Profil yüklenemedi: ' + e.message, renderMyProfile);
    });
  }

  function wireProfileForm(p) {
    var msg = $('pf-msg');
    var unameMsg = $('pf-username-msg');
    var t;

    $('pf-username').addEventListener('input', function () {
      var v = this.value.trim().toLowerCase();
      this.value = v;
      clearTimeout(t);
      unameMsg.textContent = '';
      unameMsg.className = 'hint';
      if (!v || v === p.username) return;
      t = setTimeout(function () {
        Social.usernameAvailable(v).then(function (r) {
          unameMsg.textContent = r.ok ? 'Bu kullanıcı adı uygun.' : r.reason;
          unameMsg.className = 'hint ' + (r.ok ? 'ok' : 'error');
        });
      }, 350);
    });

    $('pf-save').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      msg.textContent = 'Kaydediliyor…';
      msg.className = 'hint';

      Social.updateMyProfile({
        username: $('pf-username').value.trim().toLowerCase(),
        display_name: $('pf-name').value.trim(),
        bio: $('pf-bio').value.trim(),
        city: $('pf-city').value.trim(),
        is_public: $('pf-public').checked,
      }).then(function () {
        btn.disabled = false;
        msg.textContent = 'Kaydedildi.';
        msg.className = 'hint ok';
      }).catch(function (e) {
        btn.disabled = false;
        // Veritabanı hata kodlarını insanca anlat
        var m = e.message;
        if (e.code === '23505') m = 'Bu kullanıcı adı alınmış.';
        else if (e.code === '23514') m = 'Kullanıcı adı yalnızca küçük harf, rakam ve alt çizgi içerebilir (3-20 karakter).';
        msg.textContent = m;
        msg.className = 'hint error';
      });
    });
  }

  /** Kitap görünürlüğü özeti ve toplu açma/kapama. */
  function renderVisibility() {
    var box = $('pf-visibility');
    if (!box) return;

    DB.allBooks().then(function (all) {
      var live = all.filter(function (b) { return !b.deleted; });
      var acik = live.filter(function (b) { return b.is_public; }).length;

      box.innerHTML =
        '<p class="vis-count"><b>' + acik + '</b> / ' + live.length + ' kitap herkese açık</p>' +
        '<div class="vis-actions">' +
          '<button class="btn small" id="vis-all">Tümünü aç</button>' +
          '<button class="btn small" id="vis-none">Tümünü gizle</button>' +
        '</div>' +
        '<p class="hint">Tek tek açmak için kitabı düzenle ekranındaki ' +
          '“Bu kitap profilimde herkese görünsün” kutusunu kullan.</p>';

      function setAll(value) {
        var hedef = live.filter(function (b) { return !!b.is_public !== value; });
        if (!hedef.length) return;
        var soru = value
          ? hedef.length + ' kitap herkese açılacak. Onaylıyor musun?'
          : hedef.length + ' kitap gizlenecek. Onaylıyor musun?';
        if (!confirm(soru)) return;

        Promise.all(hedef.map(function (b) {
          b.is_public = value;
          return DB.putLocal(b);
        })).then(function () {
          if (window.KitaplikApp && KitaplikApp.reload) KitaplikApp.reload();
          return Sync.sync();
        }).then(renderVisibility);
      }

      $('vis-all').addEventListener('click', function () { setAll(true); });
      $('vis-none').addEventListener('click', function () { setAll(false); });
    });
  }

  /* ==================================================================
   * BAŞKASININ PROFİLİ
   * ================================================================ */
  function renderUser(username) {
    if (!requireLogin()) return;
    setBusy('Profil yükleniyor…');

    Social.profileByUsername(username).then(function (p) {
      if (!p) {
        el().innerHTML = backBar('Bulunamadı') +
          '<div class="page-body"><p class="page-note">@' + esc(username) +
          ' adlı bir kullanıcı yok, ya da profili herkese kapalı.</p></div>';
        wireBack();
        return;
      }

      var benMiyim = p.id === Social.myId();

      el().innerHTML =
        backBar(p.display_name || p.username, '@' + p.username) +
        '<div class="page-body">' +
          '<div class="profile-head">' + avatarHtml(p, 'lg') +
            '<div>' +
              '<strong>' + esc(p.display_name || p.username) + '</strong>' +
              '<span class="muted">@' + esc(p.username) + (p.city ? ' · ' + esc(p.city) : '') + '</span>' +
              '<span class="muted">' + p.public_book_count + ' kitap · ' +
                p.follower_count + ' takipçi · ' + p.following_count + ' takip</span>' +
            '</div>' +
          '</div>' +
          (p.bio ? '<p class="profile-bio">' + esc(p.bio) + '</p>' : '') +
          (benMiyim ? '' :
            '<div class="profile-actions">' +
              '<button class="btn primary" id="pu-follow">…</button>' +
              '<button class="btn" id="pu-block">Engelle</button>' +
            '</div>') +
          '<hr class="page-sep">' +
          '<h3 class="page-h3">Herkese açık kitapları</h3>' +
          '<div id="pu-books" class="list"></div>' +
        '</div>';
      wireBack();

      if (!benMiyim) wireFollow(p);
      loadUserBooks(p.id);
    }).catch(function (e) {
      setError('Profil yüklenemedi: ' + e.message, function () { renderUser(username); });
    });
  }

  function wireFollow(p) {
    var btn = $('pu-follow');
    var takipte = false;

    function paint() {
      btn.textContent = takipte ? 'Takibi bırak' : 'Takip et';
      btn.className = takipte ? 'btn' : 'btn primary';
      btn.disabled = false;
    }

    Social.isFollowing(p.id).then(function (v) { takipte = v; paint(); });

    btn.addEventListener('click', function () {
      btn.disabled = true;
      var op = takipte ? Social.unfollow(p.id) : Social.follow(p.id);
      op.then(function () { takipte = !takipte; paint(); })
        .catch(function (e) { paint(); alert('İşlem başarısız: ' + e.message); });
    });

    $('pu-block').addEventListener('click', function () {
      if (!confirm('@' + p.username + ' engellensin mi? Birbirinizin profilini ve ' +
                   'kitaplarını göremezsiniz.')) return;
      Social.block(p.id).then(function () {
        location.hash = '#/kesfet';
      }).catch(function (e) { alert('Engellenemedi: ' + e.message); });
    });
  }

  function loadUserBooks(userId) {
    var box = $('pu-books');
    box.innerHTML = '<p class="page-note">Yükleniyor…</p>';

    Social.publicBooks(userId).then(function (books) {
      if (!books.length) {
        box.innerHTML = '<p class="page-note">Herkese açık kitabı yok.</p>';
        return;
      }
      box.innerHTML = books.map(function (b) {
        var pct = Math.round(Search.progressOf(b) * 100);
        return '<div class="card card-static">' +
          '<span class="card-cover">' +
            (b.cover_url
              ? '<img src="' + esc(b.cover_url) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '<span>' + esc((b.title || '?').slice(0, 2)) + '</span>') +
          '</span>' +
          '<span class="card-main">' +
            '<span class="card-title-row">' +
              '<span class="card-title">' + esc(b.title) + '</span>' +
              '<span class="card-pct" data-done="' + (pct === 100 ? 1 : 0) + '">%' + pct + '</span>' +
            '</span>' +
            (b.author ? '<span class="card-author">' + esc(b.author) + '</span>' : '') +
            '<span class="bar"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
            (b.shelf ? '<span class="card-meta"><span class="tag shelf">' + esc(b.shelf) + '</span></span>' : '') +
          '</span>' +
        '</div>';
      }).join('');
    }).catch(function (e) {
      box.innerHTML = '<p class="page-note">Kitaplar yüklenemedi: ' + esc(e.message) + '</p>';
    });
  }

  /* ==================================================================
   * Yönlendirici
   * ================================================================ */
  function route() {
    var hash = location.hash || '#/';
    if (hash === current) return;
    current = hash;

    var parts = hash.replace(/^#\/?/, '').split('/');
    var page = parts[0] || '';

    if (!page) { showLibrary(true); el().innerHTML = ''; return; }

    showLibrary(false);
    el().scrollTop = 0;
    window.scrollTo(0, 0);

    if (page === 'kesfet') return renderDiscover();
    if (page === 'profil') return renderMyProfile();
    if (page === 'u' && parts[1]) return renderUser(decodeURIComponent(parts[1]));

    el().innerHTML = backBar('Sayfa yok') +
      '<div class="page-body"><p class="page-note">Böyle bir sayfa bulunamadı.</p></div>';
    wireBack();
  }

  window.addEventListener('hashchange', route);

  window.Pages = { route: route, showLibrary: showLibrary };
})();
