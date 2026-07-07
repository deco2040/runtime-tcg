/* RUNTIME TCG — 네트워크/인증 기반 모듈 (Supabase).
 *
 * 멀티플레이 기능(채팅 로비·매치메이킹·회원·통계)의 공통 토대. config.js 의
 * window.RT_SUPABASE {url, anonKey} 를 읽어 @supabase/supabase-js 를 CDN(ESM)에서
 * 지연 로드한다. 백엔드 미설정/로드 실패 시 Net.enabled=false 로 우아하게 비활성.
 *
 * 공개 API (window.RTUI.Net):
 *   enabled            설정 완료 여부(boolean)
 *   ready()            → Promise<client|null>  (SDK 지연 로드)
 *   ensureGuest()      → Promise<session|null> 세션 없으면 익명 로그인 + 프로필 확보
 *   client()/session()/profile()   현재 캐시 접근자
 *   reloadProfile()    → Promise<profile|null>
 *   updateNickname(s)  → Promise<profile|null>
 *   randomNick()       재미있는 랜덤 닉네임 생성
 *   onAuth(cb)         인증 상태 변화 구독
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});
  var CFG = window.RT_SUPABASE || {};

  // placeholder/빈 값이면 미설정으로 간주
  var configured = !!(
    CFG.url &&
    CFG.anonKey &&
    CFG.url.indexOf('YOUR-') < 0 &&
    CFG.anonKey.indexOf('YOUR-') < 0
  );
  // url 정규화(https:// 누락 허용)
  var URL_ = configured
    ? /^https?:\/\//.test(CFG.url)
      ? CFG.url
      : 'https://' + CFG.url
    : null;

  var _client = null,
    _clientPromise = null,
    _session = null,
    _profile = null,
    _authSubs = [],
    _evtSubs = [], // (evt, session) 원자 이벤트 구독 — 비번 복구/이메일 인증 라우팅용
    _recovery = false, // 비밀번호 재설정 링크로 진입한 상태(PASSWORD_RECOVERY)
    _pendingEmail = null; // 정회원 전환 이메일 인증 대기 중인 주소(확인 전)

  var SDK_URL = 'https://esm.sh/@supabase/supabase-js@2';

  function loadClient() {
    if (!configured) return Promise.resolve(null);
    if (_client) return Promise.resolve(_client);
    if (_clientPromise) return _clientPromise;
    _clientPromise = import(SDK_URL)
      .then(function (mod) {
        _client = mod.createClient(URL_, CFG.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            storageKey: 'rt_auth',
          },
        });
        _client.auth.onAuthStateChange(function (evt, sess) {
          _session = sess || null;
          if (evt === 'PASSWORD_RECOVERY') _recovery = true;
          // 이메일 인증 링크 복귀(정회원 확정) → 게스트→정회원 승격
          if (evt === 'SIGNED_IN' || evt === 'USER_UPDATED') maybeConfirmUpgrade();
          _authSubs.forEach(function (cb) {
            try {
              cb(_session);
            } catch (e) {}
          });
          _evtSubs.forEach(function (cb) {
            try {
              cb(evt, _session);
            } catch (e) {}
          });
        });
        return _client;
      })
      .catch(function (e) {
        console.error('[net] Supabase SDK load failed', e);
        _clientPromise = null;
        return null;
      });
    return _clientPromise;
  }

  // 저장된(persisted) 세션 토큰이 localStorage 에 있는지 — 회원 세션 보호용.
  // 있으면 ensureGuest 가 함부로 익명 로그인으로 덮어쓰지 않는다.
  function hasStoredSession() {
    try {
      var raw = window.localStorage.getItem('rt_auth');
      if (!raw) return false;
      var o = JSON.parse(raw);
      return !!(
        o &&
        (o.access_token ||
          o.refresh_token ||
          (o.currentSession && o.currentSession.access_token))
      );
    } catch (e) {
      return false;
    }
  }

  // 부트 시 비파괴 세션 복원 — 저장된 세션이 있으면 그대로 로드(+프로필). 익명 폴백 없음.
  // 새로고침 후 회원 로그인 유지의 핵심 경로. 반환: Promise<session|null>.
  function restoreSession() {
    return loadClient().then(function (c) {
      if (!c) return null;
      return c.auth
        .getSession()
        .then(function (r) {
          var s = r && r.data && r.data.session;
          if (!s) return null;
          _session = s;
          return loadProfile().then(function () {
            // 복원 완료를 구독자(타이틀 헤더 등)에 통지
            _authSubs.forEach(function (cb) {
              try {
                cb(_session);
              } catch (e) {}
            });
            return s;
          });
        })
        .catch(function () {
          return null;
        });
    });
  }

  // 게스트(익명) 로그인 보장 — 세션 없으면 익명 로그인 후 프로필 확보.
  // 단, localStorage 에 저장된 세션이 있으면(회원) 익명 생성으로 덮어쓰지 않는다.
  function ensureGuest() {
    return loadClient().then(function (c) {
      if (!c) return null;
      return c.auth
        .getSession()
        .then(function (r) {
          var s = r && r.data && r.data.session;
          if (s) {
            _session = s;
            return s;
          }
          // 저장된 회원 세션이 있는데 순간 null 이면 익명 생성 금지 — 1회 재시도 후에도
          // 없을 때만 진짜 신규로 간주. (회원 세션이 익명으로 덮어써지는 로그아웃 버그 방지)
          if (hasStoredSession()) {
            return c.auth.getSession().then(function (r3) {
              var s3 = r3 && r3.data && r3.data.session;
              if (s3) {
                _session = s3;
                return s3;
              }
              return null; // 익명 생성하지 않음 — 저장된 세션 보호
            });
          }
          return c.auth.signInAnonymously().then(function (r2) {
            if (r2.error) {
              console.error('[net] anonymous sign-in failed', r2.error);
              return null;
            }
            _session = r2.data.session;
            return _session;
          });
        })
        .then(function (s) {
          if (!s) return null;
          return loadProfile().then(function () {
            return s;
          });
        });
    });
  }

  function loadProfile() {
    if (!_client || !_session) return Promise.resolve(null);
    var uid = _session.user.id;
    return _client
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
      .then(function (r) {
        if (r.data) {
          _profile = r.data;
          if (!_profile.avatar) { var la = getLocalAvatar(); if (la) _profile.avatar = la; }
          return _profile;
        }
        // 트리거 미설정 등으로 프로필이 없으면 클라에서 생성 시도(RLS insert 정책 필요)
        var nick = randomNick();
        return _client
          .from('profiles')
          .insert({ id: uid, nickname: nick, is_guest: !_session.user.email })
          .select()
          .maybeSingle()
          .then(function (r2) {
            _profile = r2.data || { id: uid, nickname: nick, is_guest: true };
            return _profile;
          })
          .catch(function () {
            _profile = { id: uid, nickname: nick, is_guest: true };
            return _profile;
          });
      });
  }

  // 다른 플레이어 프로필 조회(공개 닉네임·전적) — 상대 프로필 카드용(기능 4).
  // profiles 는 인증 유저 전체 읽기 허용이라 상대 user id 로 조회 가능.
  function fetchProfile(userId) {
    if (!userId) return Promise.resolve(null);
    return loadClient().then(function (c) {
      if (!c) return null;
      return c
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
        .then(function (r) {
          return (r && r.data) || null;
        })
        .catch(function () {
          return null;
        });
    });
  }

  function updateNickname(nick) {
    nick = (nick || '').trim().slice(0, 24);
    if (!_client || !_session || !nick) return Promise.resolve(_profile);
    return _client
      .from('profiles')
      .update({ nickname: nick })
      .eq('id', _session.user.id)
      .select()
      .maybeSingle()
      .then(function (r) {
        if (r.data) _profile = r.data;
        return _profile;
      });
  }

  // 아바타(이모지 프리셋 문자열). 로컬 우선 저장 → 게스트/오프라인/컬럼 미적용에도 항상 동작.
  // 백엔드 profiles.avatar 컬럼이 있으면 동기화(없어 실패해도 로컬은 유지).
  function getLocalAvatar() { try { return window.localStorage.getItem('rt_avatar') || ''; } catch (e) { return ''; } }
  function setLocalAvatar(av) { try { window.localStorage.setItem('rt_avatar', av || ''); } catch (e) {} }
  function updateAvatar(av) {
    av = (av || '').slice(0, 8);
    setLocalAvatar(av);
    if (_profile) _profile.avatar = av;
    if (!_client || !_session) return Promise.resolve(_profile);
    return _client
      .from('profiles')
      .update({ avatar: av })
      .eq('id', _session.user.id)
      .select()
      .maybeSingle()
      .then(function (r) { if (r && r.data) { _profile = r.data; _profile.avatar = av; } return _profile; })
      .catch(function () { return _profile; });   // 컬럼 미적용 시에도 로컬 유지
  }

  var ADJ = [
    'Async', 'Atomic', 'Idle', 'Lazy', 'Hot', 'Cold', 'Null', 'Prime',
    'Quantum', 'Static', 'Nested', 'Forked', 'Cached', 'Signed', 'Raw', 'Deep',
  ];
  var NOUN = [
    'Thread', 'Kernel', 'Packet', 'Cursor', 'Daemon', 'Stack', 'Buffer',
    'Vector', 'Token', 'Cache', 'Socket', 'Node', 'Proc', 'Heap', 'Pointer', 'Byte',
  ];
  function randomNick() {
    var a = ADJ[Math.floor(Math.random() * ADJ.length)];
    var n = NOUN[Math.floor(Math.random() * NOUN.length)];
    return a + n + Math.floor(Math.random() * 90 + 10);
  }

  // ─────────────────────────────────────────── 인증(기능 3: 회원/로그인)
  function refreshSession() {
    if (!_client) return Promise.resolve(null);
    return _client.auth.getSession().then(function (r) {
      _session = (r && r.data && r.data.session) || null;
      return _session;
    });
  }

  // profiles.is_guest 플립(승격/강등 반영)
  function flipMembership(isGuest) {
    if (!_client || !_session) return Promise.resolve(_profile);
    return _client
      .from('profiles')
      .update({ is_guest: isGuest })
      .eq('id', _session.user.id)
      .select()
      .maybeSingle()
      .then(function (r) {
        if (r.data) _profile = r.data;
        return _profile;
      })
      .catch(function () {
        return _profile;
      });
  }

  // 정회원 전환 — 익명 계정에 이메일/비번을 연결(같은 user id 유지 → 프로필·전적 보존).
  // 이메일 인증이 켜져 있으면 확인 링크 클릭 전까지는 게스트(is_guest=true) 유지 →
  // 링크 클릭 후 복귀 시 SIGNED_IN/USER_UPDATED 에서 정회원으로 승격(maybeConfirmUpgrade).
  function upgradeEmail(email, password) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      var redirectTo = appRedirect();
      var opts = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
      return c.auth
        .updateUser({ email: email, password: password }, opts)
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message };
          return refreshSession().then(function () {
            var u = _session && _session.user;
            // 이메일이 즉시 확정됨(대시보드에서 이메일 확인 OFF) → 바로 정회원
            if (u && u.email && u.email_confirmed_at) {
              _pendingEmail = null;
              return flipMembership(false).then(function () {
                return { ok: true, needConfirm: false };
              });
            }
            // 확인 대기 — 링크 클릭 전까지 게스트 유지
            _pendingEmail = email;
            return { ok: true, needConfirm: true, email: email };
          });
        });
    });
  }

  // 이메일 인증 링크 복귀 후 정회원 승격 — email 이 확정(confirmed)되었고 아직 게스트면 플립.
  function maybeConfirmUpgrade() {
    var u = _session && _session.user;
    if (!u || !u.email || !u.email_confirmed_at) return;
    if (_profile && _profile.is_guest === false) { _pendingEmail = null; return; }
    _pendingEmail = null;
    flipMembership(false).then(function () {
      loadProfile().then(function () {
        _authSubs.forEach(function (cb) { try { cb(_session); } catch (e) {} });
      });
    });
  }

  // 인증 메일 재전송 — 전환(email_change) 먼저, 실패 시 신규가입(signup) 폴백.
  function resendConfirmation(email) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      if (!c.auth.resend) return { ok: false, error: '재전송 미지원 SDK' };
      var redirectTo = appRedirect();
      var opts = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
      return c.auth
        .resend({ type: 'email_change', email: email, options: opts })
        .then(function (r) {
          if (!r.error) return { ok: true };
          return c.auth
            .resend({ type: 'signup', email: email, options: opts })
            .then(function (r2) {
              return r2.error ? { ok: false, error: r2.error.message } : { ok: true };
            });
        });
    });
  }

  // 회원가입 — 현재 세션이 게스트(익명)면 승격, 아니면 순수 signUp
  function signUpEmail(email, password) {
    if (_session && _session.user && !_session.user.email) {
      return upgradeEmail(email, password);
    }
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      var redirectTo = appRedirect();
      var opts = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
      return c.auth
        .signUp({ email: email, password: password, options: opts })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message };
          if (r.data.session) {
            _session = r.data.session;
            return loadProfile().then(function () {
              return { ok: true, needConfirm: false };
            });
          }
          _pendingEmail = email;
          return { ok: true, needConfirm: true, email: email }; // 이메일 확인 대기
        });
    });
  }

  // 기존 계정 로그인(현재 게스트 세션은 대체됨)
  function signInEmail(email, password) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      return c.auth
        .signInWithPassword({ email: email, password: password })
        .then(function (r) {
          if (r.error) return { ok: false, error: r.error.message };
          _session = r.data.session;
          return loadProfile().then(function () {
            return { ok: true };
          });
        });
    });
  }

  // OAuth 로그인(전체 페이지 리다이렉트) — 대시보드 provider 설정 + Site URL 화이트리스트 필요.
  // file:// 개발에선 리다이렉트 복귀가 안 되므로 배포된 https 사이트 전용.
  //
  // 게스트(익명) 세션이면 linkIdentity 로 같은 계정에 Google 을 연결 → user id 유지(전적 보존).
  // 수동 연결(Manual Linking) 미허용이면 일반 signInWithOAuth 로 폴백(새 계정 로그인).
  // 복귀 시 email 이 confirmed 되므로 maybeConfirmUpgrade 가 정회원(is_guest=false)으로 승격.
  function signInOAuth(provider) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      var redirectTo = appRedirect();
      var opts = redirectTo ? { redirectTo: redirectTo } : {};
      var isGuest = _session && _session.user && !_session.user.email;

      function plainOAuth() {
        return c.auth
          .signInWithOAuth({ provider: provider, options: opts })
          .then(function (r) {
            return r.error ? { ok: false, error: r.error.message } : { ok: true, redirecting: true };
          });
      }

      if (isGuest && c.auth.linkIdentity) {
        return c.auth
          .linkIdentity({ provider: provider, options: opts })
          .then(function (r) {
            if (!r.error) return { ok: true, redirecting: true };
            return plainOAuth(); // 수동 연결 미허용 등 → 폴백
          })
          .catch(function () {
            return plainOAuth();
          });
      }
      return plainOAuth();
    });
  }

  // 앱으로 복귀하는 리다이렉트 URL(해시 제거) — file:// 개발에선 origin 이 'null' 이라 미지정.
  function appRedirect() {
    var origin = location.origin && location.origin !== 'null';
    return origin ? location.href.split('#')[0].split('?')[0] : undefined;
  }

  // 비밀번호 재설정 메일 전송 — 링크 클릭 시 appRedirect 로 복귀 → SDK 가 PASSWORD_RECOVERY 발화.
  function resetPassword(email) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      var redirectTo = appRedirect();
      var opts = redirectTo ? { redirectTo: redirectTo } : undefined;
      return c.auth.resetPasswordForEmail(email, opts).then(function (r) {
        return r.error ? { ok: false, error: r.error.message } : { ok: true };
      });
    });
  }

  // 새 비밀번호 확정(재설정 링크 복귀 후) — 현재 세션(복구 세션)의 비밀번호 갱신.
  function updatePassword(newPass) {
    return loadClient().then(function (c) {
      if (!c) return { ok: false, error: '백엔드 미설정' };
      return c.auth.updateUser({ password: newPass }).then(function (r) {
        if (r.error) return { ok: false, error: r.error.message };
        _recovery = false;
        return refreshSession().then(function () {
          return { ok: true };
        });
      });
    });
  }

  // 로그아웃 → 항상 세션 유지되도록 새 게스트로 재로그인
  function signOut() {
    return loadClient().then(function (c) {
      if (!c) return null;
      return c.auth.signOut().then(function () {
        _session = null;
        _profile = null;
        return ensureGuest();
      });
    });
  }

  function isMember() {
    return !!(
      (_profile && _profile.is_guest === false) ||
      (_session && _session.user && _session.user.email)
    );
  }

  // 대국 결과 기록(기능 4) — outcome: 'win'|'loss'|'draw'.
  // 항상 localStorage 미러(오프라인/즉시), 세션 있으면 profiles 카운터도 증가(로그인 시 기기간 유지).
  function recordResult(outcome) {
    var col = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
    try {
      var k = 'rt_ai_record';
      var r = JSON.parse(window.localStorage.getItem(k) || '{}');
      r.games = (r.games || 0) + 1;
      r[col] = (r[col] || 0) + 1;
      window.localStorage.setItem(k, JSON.stringify(r));
    } catch (e) {}
    if (_client && _session) {
      var cur = _profile || {};
      var patch = { games: (cur.games || 0) + 1 };
      patch[col] = (cur[col] || 0) + 1;
      _client
        .from('profiles')
        .update(patch)
        .eq('id', _session.user.id)
        .select()
        .maybeSingle()
        .then(function (r) {
          if (r.data) _profile = r.data;
        })
        .catch(function () {});
    }
  }

  UI.Net = {
    enabled: configured,
    ready: loadClient,
    ensureGuest: ensureGuest,
    restore: restoreSession,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    signInOAuth: signInOAuth,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    resendConfirmation: resendConfirmation,
    pendingEmail: function () {
      return _pendingEmail;
    },
    clearPending: function () {
      _pendingEmail = null;
    },
    isRecovery: function () {
      return _recovery;
    },
    clearRecovery: function () {
      _recovery = false;
    },
    signOut: signOut,
    isMember: isMember,
    recordResult: recordResult,
    client: function () {
      return _client;
    },
    session: function () {
      return _session;
    },
    profile: function () {
      return _profile;
    },
    userId: function () {
      return _session && _session.user ? _session.user.id : null;
    },
    reloadProfile: loadProfile,
    fetchProfile: fetchProfile,
    updateNickname: updateNickname,
    updateAvatar: updateAvatar,
    localAvatar: getLocalAvatar,
    randomNick: randomNick,
    onAuth: function (cb) {
      _authSubs.push(cb);
      return function () {
        _authSubs = _authSubs.filter(function (f) {
          return f !== cb;
        });
      };
    },
    // 원자 인증 이벤트 구독 — (evt, session). evt: 'PASSWORD_RECOVERY'|'USER_UPDATED'|'SIGNED_IN'|…
    onEvent: function (cb) {
      _evtSubs.push(cb);
      return function () {
        _evtSubs = _evtSubs.filter(function (f) {
          return f !== cb;
        });
      };
    },
  };

  // 비밀번호 재설정/이메일 인증 링크로 진입한 경우(해시에 type=recovery 등) SDK 를 즉시 로드해
  // detectSessionInUrl 이 토큰을 처리하고 PASSWORD_RECOVERY/SIGNED_IN 이벤트를 발화하도록 한다.
  if (configured) {
    try {
      var _h = (location.hash || '') + '&' + (location.search || '');
      if (/type=recovery|type=signup|type=email_change|access_token=/.test(_h)) {
        if (/type=recovery/.test(_h)) _recovery = true;
        loadClient();
      }
    } catch (e) {}
  }
})();
