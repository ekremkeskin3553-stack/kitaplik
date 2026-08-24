/* Kitaplık — sosyal katman: veri erişimi
 *
 * Kişisel kitaplıktan farklı olarak bu katman SUNUCU-ÖNCELİKLİDİR.
 * Kendi kitaplarını cihazda tutmak mantıklı; başkalarının profillerini,
 * kulüplerini ve kitaplarını indirip saklamak değil. Bu yüzden buradaki
 * her şey doğrudan sunucudan okunur, yerel kopya tutulmaz. Çevrimdışıyken
 * kendi kitaplığın çalışmaya devam eder, sosyal kısım çalışmaz — bu
 * bilinçli bir ayrım.
 */

(function () {
  'use strict';

  var cfg = window.KITAPLIK_CONFIG || {};
  var URL_BASE = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var ANON = cfg.SUPABASE_ANON_KEY || '';

  var myProfileCache = null;

  function headers() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('kitaplik.session') || 'null'); } catch (e) {}
    return {
      'apikey': ANON,
      'Authorization': 'Bearer ' + (s && s.access_token ? s.access_token : ANON),
      'Content-Type': 'application/json',
    };
  }

  function rest(path, opts) {
    opts = opts || {};
    var h = headers();
    Object.keys(opts.headers || {}).forEach(function (k) { h[k] = opts.headers[k]; });

    return fetch(URL_BASE + '/rest/v1' + path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!r.ok) {
          var msg = (data && data.message) || ('Sunucu hatası (' + r.status + ')');
          var err = new Error(msg);
          err.status = r.status;
          err.code = data && data.code;
          throw err;
        }
        return data;
      });
    });
  }

  function myId() {
    var u = window.Sync && Sync.currentUser();
    return u ? u.id : null;
  }

  /* ------------------------------------------------------------------
   * Profiller
   * ---------------------------------------------------------------- */

  function myProfile(force) {
    var id = myId();
    if (!id) return Promise.resolve(null);
    if (myProfileCache && !force) return Promise.resolve(myProfileCache);

    return rest('/profiles?select=*&id=eq.' + id).then(function (rows) {
      myProfileCache = (rows && rows[0]) || null;
      return myProfileCache;
    });
  }

  function updateMyProfile(fields) {
    var id = myId();
    if (!id) return Promise.reject(new Error('Giriş yapılmamış.'));

    var allowed = ['username', 'display_name', 'bio', 'avatar_url', 'city', 'is_public'];
    var body = {};
    allowed.forEach(function (k) { if (fields[k] !== undefined) body[k] = fields[k]; });

    return rest('/profiles?id=eq.' + id, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: body,
    }).then(function (rows) {
      myProfileCache = (rows && rows[0]) || myProfileCache;
      return myProfileCache;
    });
  }

  /** Kullanıcı adı boşta mı? Kendi adını da boşta sayıyoruz. */
  function usernameAvailable(name) {
    name = String(name || '').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) {
      return Promise.resolve({ ok: false, reason: 'Yalnızca küçük harf, rakam ve alt çizgi; 3-20 karakter.' });
    }
    return rest('/profiles?select=id&username=eq.' + encodeURIComponent(name)).then(function (rows) {
      if (!rows.length) return { ok: true };
      if (rows[0].id === myId()) return { ok: true, mine: true };
      return { ok: false, reason: 'Bu kullanıcı adı alınmış.' };
    });
  }

  function profileByUsername(username) {
    return rest('/profile_stats?select=*&username=eq.' + encodeURIComponent(String(username).toLowerCase()))
      .then(function (rows) { return (rows && rows[0]) || null; });
  }

  /** İsim ya da kullanıcı adında geçenleri ara. */
  function searchProfiles(q) {
    q = String(q || '').trim();
    if (q.length < 2) return Promise.resolve([]);
    var pat = '*' + q.replace(/[%,()]/g, '') + '*';
    var filter = '(username.ilike.' + pat + ',display_name.ilike.' + pat + ')';
    return rest('/profile_stats?select=*&or=' + encodeURIComponent(filter) + '&limit=30');
  }

  /** Keşfet listesi: en çok kitabı herkese açık olanlar. */
  function discoverProfiles() {
    return rest('/profile_stats?select=*&order=public_book_count.desc&limit=30')
      .then(function (rows) {
        var me = myId();
        return (rows || []).filter(function (p) { return p.id !== me; });
      });
  }

  /* ------------------------------------------------------------------
   * Kitaplar (başkasının herkese açık rafı)
   * ---------------------------------------------------------------- */

  function publicBooks(userId) {
    return rest('/books?select=id,title,author,cover_url,shelf,series,rating,status,' +
                'page_count,current_page,progress_pct,published_year,publisher' +
                '&user_id=eq.' + userId + '&is_public=eq.true&deleted=eq.false' +
                '&order=title.asc&limit=500');
  }

  /* ------------------------------------------------------------------
   * Takip
   * ---------------------------------------------------------------- */

  function isFollowing(userId) {
    var me = myId();
    if (!me) return Promise.resolve(false);
    return rest('/follows?select=follower_id&follower_id=eq.' + me + '&following_id=eq.' + userId)
      .then(function (rows) { return !!(rows && rows.length); });
  }

  function follow(userId) {
    var me = myId();
    if (!me) return Promise.reject(new Error('Giriş yapılmamış.'));
    return rest('/follows', { method: 'POST', body: { follower_id: me, following_id: userId } });
  }

  function unfollow(userId) {
    var me = myId();
    if (!me) return Promise.reject(new Error('Giriş yapılmamış.'));
    return rest('/follows?follower_id=eq.' + me + '&following_id=eq.' + userId, { method: 'DELETE' });
  }

  /* ------------------------------------------------------------------
   * Engelleme ve şikâyet
   * ---------------------------------------------------------------- */

  function block(userId) {
    var me = myId();
    return rest('/blocks', { method: 'POST', body: { blocker_id: me, blocked_id: userId } });
  }

  function unblock(userId) {
    var me = myId();
    return rest('/blocks?blocker_id=eq.' + me + '&blocked_id=eq.' + userId, { method: 'DELETE' });
  }

  function report(targetType, targetId, reason) {
    var me = myId();
    return rest('/reports', {
      method: 'POST',
      body: { reporter_id: me, target_type: targetType, target_id: targetId, reason: reason },
    });
  }

  function clearCache() { myProfileCache = null; }

  window.Social = {
    rest: rest,
    myId: myId,
    myProfile: myProfile,
    updateMyProfile: updateMyProfile,
    usernameAvailable: usernameAvailable,
    profileByUsername: profileByUsername,
    searchProfiles: searchProfiles,
    discoverProfiles: discoverProfiles,
    publicBooks: publicBooks,
    isFollowing: isFollowing,
    follow: follow,
    unfollow: unfollow,
    block: block,
    unblock: unblock,
    report: report,
    clearCache: clearCache,
  };
})();
