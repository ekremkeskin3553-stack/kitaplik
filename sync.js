/* Kitaplık — Supabase senkronu
 *
 * Supabase'in JS kütüphanesi yerine doğrudan REST uçları kullanılıyor:
 * kimlik doğrulama için GoTrue (/auth/v1), veri için PostgREST (/rest/v1).
 * Böylece projede tek satır harici bağımlılık yok — ne CDN, ne paket, ne build.
 *
 * Çakışma çözümü: son yazan kazanır (updated_at karşılaştırması). Tek
 * kullanıcının kendi cihazları arasında bu fazlasıyla yeterli. Not: iki cihazın
 * saati ciddi şekilde kaymışsa eski bir düzenleme yeniyi ezebilir; pratikte
 * telefon/tablet saatleri ağdan senkron olduğu için bu sorun çıkmaz.
 */

(function () {
  'use strict';

  var cfg = window.KITAPLIK_CONFIG || {};
  var URL_BASE = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var ANON = cfg.SUPABASE_ANON_KEY || '';

  var SESSION_KEY = 'kitaplik.session';
  var session = null;          // { access_token, refresh_token, expires_at, user }
  var listeners = [];
  var syncing = false;

  /** Supabase yapılandırılmamışsa uygulama tamamen yerel çalışır. */
  function isConfigured() {
    return !!(URL_BASE && ANON);
  }

  function emit(evt, data) {
    listeners.forEach(function (fn) {
      try { fn(evt, data); } catch (e) { console.error(e); }
    });
  }

  function on(fn) { listeners.push(fn); }

  /* ------------------------------------------------------------------
   * Oturum
   * ---------------------------------------------------------------- */

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      session = raw ? JSON.parse(raw) : null;
    } catch (e) {
      session = null;
    }
    return session;
  }

  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
    emit('session', s);
  }

  function currentUser() {
    return session && session.user ? session.user : null;
  }

  function authHeaders() {
    return {
      'apikey': ANON,
      'Authorization': 'Bearer ' + (session ? session.access_token : ANON),
    };
  }

  function storeTokenResponse(json) {
    if (!json || !json.access_token) {
      throw new Error(json && (json.error_description || json.msg || json.message) || 'Oturum açılamadı');
    }
    saveSession({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in || 3600) * 1000,
      user: json.user || (session && session.user) || null,
    });
    return session;
  }

  function authFetch(path, body) {
    return fetch(URL_BASE + '/auth/v1' + path, {
      method: 'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          throw new Error(j.error_description || j.msg || j.message || ('Sunucu hatası (' + r.status + ')'));
        }
        return j;
      });
    });
  }

  function signIn(email, password) {
    return authFetch('/token?grant_type=password', { email: email, password: password })
      .then(storeTokenResponse);
  }

  function signUp(email, password) {
    return authFetch('/signup', { email: email, password: password })
      .then(function (j) {
        // E-posta doğrulaması açıksa token gelmez; kullanıcı postasını onaylamalı.
        if (!j.access_token) {
          return { needsConfirmation: true, email: email };
        }
        storeTokenResponse(j);
        return { needsConfirmation: false };
      });
  }

  function signOut() {
    var had = !!session;
    saveSession(null);
    return DB.clearBooks()
      .then(function () { return DB.setMeta('lastPulled', null); })
      .then(function () { if (had) emit('signedout'); });
  }

  /** Süresi dolmak üzereyse jetonu tazele. */
  function ensureFreshToken() {
    if (!session) return Promise.reject(new Error('Oturum yok'));
    if (session.expires_at - Date.now() > 60000) return Promise.resolve(session);
    if (!session.refresh_token) return Promise.reject(new Error('Oturum süresi doldu'));
    return authFetch('/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(storeTokenResponse)
      .catch(function (e) {
        saveSession(null);          // tazeleme başarısız → yeniden giriş gerek
        throw e;
      });
  }

  /* ------------------------------------------------------------------
   * Veri
   * ---------------------------------------------------------------- */

  // Sunucuya gönderilmeyecek, yalnızca istemcide anlamı olan alanlar.
  var LOCAL_ONLY = ['dirty', '__score', '__idx', '__idxAt'];

  var COLUMNS = [
    'id', 'title', 'author', 'isbn', 'publisher', 'published_year', 'page_count',
    'current_page', 'progress_pct', 'status', 'rating', 'cover_url', 'shelf', 'series', 'tags',
    'notes', 'loan_to', 'loan_date', 'loan_due', 'loan_returned',
    'created_at', 'updated_at', 'deleted',
  ];

  function toRow(book) {
    var row = {};
    COLUMNS.forEach(function (c) {
      if (book[c] !== undefined) row[c] = book[c];
    });
    row.user_id = currentUser() ? currentUser().id : undefined;
    return row;
  }

  function restFetch(path, opts) {
    opts = opts || {};
    var headers = authHeaders();
    headers['Content-Type'] = 'application/json';
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });

    return fetch(URL_BASE + '/rest/v1' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 300));
        });
      }
      var ct = r.headers.get('content-type') || '';
      return ct.indexOf('json') !== -1 ? r.json() : null;
    });
  }

  /** Bekleyen yerel değişiklikleri sunucuya yolla. */
  function push() {
    return DB.dirtyBooks().then(function (dirty) {
      if (!dirty.length) return 0;

      // Büyük ilk yüklemelerde istek boyutunu makul tutmak için parçalara böl.
      var chunks = [];
      for (var i = 0; i < dirty.length; i += 200) chunks.push(dirty.slice(i, i + 200));

      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return restFetch('/books', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: chunk.map(toRow),
          }).then(function () {
            return Promise.all(chunk.map(function (b) {
              return DB.markClean(b.id, b.updated_at);
            }));
          });
        });
      }, Promise.resolve()).then(function () { return dirty.length; });
    });
  }

  /** Sunucuda son çekimden sonra değişenleri al. */
  function pull() {
    return DB.getMeta('lastPulled', null).then(function (since) {
      var q = '/books?select=*&order=updated_at.asc&limit=1000';
      if (since) q += '&updated_at=gt.' + encodeURIComponent(since);

      return restFetch(q).then(function (rows) {
        if (!rows || !rows.length) return 0;

        return DB.allBooks().then(function (localList) {
          var localById = {};
          localList.forEach(function (b) { localById[b.id] = b; });

          var toWrite = [];
          var newest = since;

          rows.forEach(function (row) {
            if (!newest || row.updated_at > newest) newest = row.updated_at;

            var local = localById[row.id];
            // Yerelde gönderilmemiş ve daha yeni bir düzenleme varsa onu koru;
            // bir sonraki push'ta sunucuya gidecek.
            if (local && local.dirty === 1 && local.updated_at > row.updated_at) return;
            toWrite.push(row);
          });

          return DB.putManyRemote(toWrite)
            .then(function () { return DB.setMeta('lastPulled', newest); })
            .then(function () { return toWrite.length; });
        });
      });
    });
  }

  /**
   * Tam senkron turu. Aynı anda ikinci bir tur başlatılmaz.
   * @returns {Promise<{pushed:number, pulled:number}|null>} null → senkron yapılmadı
   */
  function sync() {
    if (!isConfigured() || !session) return Promise.resolve(null);
    if (syncing) return Promise.resolve(null);
    if (!navigator.onLine) { emit('offline'); return Promise.resolve(null); }

    syncing = true;
    emit('syncing');

    return ensureFreshToken()
      .then(push)
      .then(function (pushed) {
        return pull().then(function (pulled) {
          return { pushed: pushed, pulled: pulled };
        });
      })
      .then(function (res) {
        syncing = false;
        emit('synced', res);
        return res;
      })
      .catch(function (err) {
        syncing = false;
        emit('syncerror', err);
        console.warn('Senkron hatası:', err);
        return null;
      });
  }

  loadSession();

  window.Sync = {
    isConfigured: isConfigured,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    currentUser: currentUser,
    loadSession: loadSession,
    sync: sync,
    on: on,
    isSyncing: function () { return syncing; },
  };
})();
