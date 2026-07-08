/* RUNTIME TCG — 계정 시스템 (멀티페이지).
 *
 * 게스트(익명) 세션 위에서 회원가입/로그인/계정관리/비밀번호를 각각 독립 화면으로 제공한다.
 * 파일은 하나지만 `page` 상태로 라우팅하며, core.render() 는 UI.isAuthActive()/redrawAuth()
 * 로 이 모듈 전체를 하나의 활성 화면으로 다룬다(테마 전환 시 redraw).
 *
 * page: 'login' | 'signup' | 'account' | 'forgot' | 'reset' | 'changepw' | 'verify'
 *   login    — 이메일/비번 로그인 (+ 회원가입·비번찾기·Google 링크)
 *   signup   — 이메일/비번/닉네임(유니크) + 약관동의 → 회원가입(순수 signUp: 게스트 로그아웃 후 새 계정, 커스텀 덱은 이어짐)
 *   account  — 회원 대시보드: 닉네임·아바타·통계 + 비번변경/로그아웃/회원탈퇴
 *   forgot   — 재설정 메일 요청
 *   reset    — 재설정 링크 복귀 후 새 비번 확정
 *   changepw — 로그인 회원 비번 변경
 *   verify   — 회원가입 이메일 인증 대기(재전송)
 *
 * 진입: UI.renderAuth(from[, page]) — from 은 'title'|'lobby'(뒤로 목적지).
 *   page 미지정 시 isRecovery→reset, 회원→account, 그 외→login.
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});

  var active = false;
  var page = 'login'; // 위 목록 중 하나
  var email = '';
  var pass = '';
  var pass2 = '';
  var nick = ''; // 회원가입 닉네임
  var agree = false; // 약관 동의(회원가입)
  var nickState = { status: 'idle', text: '' }; // idle|checking|ok|taken (닉네임 사용가능 표시)
  var delStage = 0; // 회원 탈퇴 확인 단계(0=기본, 1=확인 대기)
  var msg = ''; // 상태/에러 메시지
  var busy = false;
  var returnTo = 'title'; // 'title' | 'lobby'

  function el() {
    return UI.el.apply(null, arguments);
  }

  function pal() {
    var dark = UI.getTheme && UI.getTheme() === 'dark';
    return {
      amb: dark ? '#ffb000' : '#1d1d24',
      hi: dark ? '#ffd27a' : '#111319',
      dim: dark ? '#b3791f' : '#6b6b75',
      line: dark ? 'rgba(255,176,0,.22)' : 'rgba(29,29,36,.18)',
      err: dark ? '#ff8a6a' : '#c0392b',
      ok: dark ? '#7ad0ff' : '#1a5fa8',
    };
  }

  function inpStyle(p) {
    return {
      width: '100%', background: 'transparent', border: '1px solid ' + p.line, color: p.amb,
      padding: '9px 11px', marginBottom: '8px', fontFamily: "'Space Mono',monospace",
      fontSize: '13px', outline: 'none',
    };
  }

  // ─────────────────────────────────────────── 통계/닉네임/아바타 블록(계정 페이지 재사용)
  function curStats() {
    var prof = UI.Net && UI.Net.profile && UI.Net.profile();
    if (prof && UI.Net && UI.Net.enabled) {
      return {
        games: prof.games || 0, wins: prof.wins || 0,
        losses: prof.losses || 0, draws: prof.draws || 0, src: 'cloud',
      };
    }
    try {
      var r = JSON.parse(window.localStorage.getItem('rt_ai_record') || '{}');
      return { games: r.games || 0, wins: r.wins || 0, losses: r.losses || 0, draws: r.draws || 0, src: 'local' };
    } catch (e) {
      return { games: 0, wins: 0, losses: 0, draws: 0, src: 'local' };
    }
  }

  function doSaveNick() {
    var inp = document.getElementById('auth-nick');
    if (!inp) return;
    var v = (inp.value || '').trim();
    if (!v) { msg = '⚠ 닉네임을 입력하세요'; redraw(); return; }
    busy = true; msg = '닉네임 저장 중…'; redraw();
    UI.Net.updateNickname(v)
      .then(function (r) {
        busy = false;
        msg = r && r.ok ? '✔ 닉네임을 저장했어요' : '⚠ ' + ((r && r.error) || '저장 실패');
        redraw();
      })
      .catch(function (e) { busy = false; msg = '⚠ ' + (e && e.message ? e.message : e); redraw(); });
  }

  function nickBlock(p) {
    var prof = UI.Net.profile && UI.Net.profile();
    var wrap = el('div', { style: { margin: '14px 0 4px' } });
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim, marginBottom: '6px', letterSpacing: '.06em' } }, ['▸ 닉네임']));
    wrap.appendChild(
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('input', {
          id: 'auth-nick', type: 'text', maxlength: '24', value: (prof && prof.nickname) || '',
          style: { flex: 1, background: 'transparent', border: '1px solid ' + p.line, color: p.amb, padding: '8px 10px', fontFamily: "'Space Mono',monospace", fontSize: '13px', outline: 'none' },
        }),
        el('button', { class: 'crt-btn ghost', onclick: doSaveNick, disabled: busy, style: { fontSize: '12px' } }, ['저장']),
      ])
    );
    return wrap;
  }

  function doSetAvatar(av) {
    if (!(UI.Net && UI.Net.updateAvatar)) return;
    UI.Net.updateAvatar(av)
      .then(function () { msg = av ? '✔ 아바타를 변경했어요' : '✔ 이니셜 아바타로 변경'; redraw(); })
      .catch(function () { redraw(); });
  }
  function avatarBlock(p) {
    var prof = UI.Net.profile && UI.Net.profile();
    var nickv = (prof && prof.nickname) || 'guest';
    var cur = (prof && prof.avatar) || (UI.Net.localAvatar && UI.Net.localAvatar()) || '';
    var wrap = el('div', { style: { margin: '14px 0 4px', borderTop: '1px solid ' + p.line, paddingTop: '12px' } });
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim, marginBottom: '8px', letterSpacing: '.06em' } }, ['▸ 프로필 사진 · AVATAR']));
    wrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } }, [
      (UI.avatarEl ? UI.avatarEl({ nickname: nickv, avatar: cur }, 46) : null),
      el('div', { style: { fontSize: '11px', color: p.dim, lineHeight: 1.5 } }, ['대전 상대에게 이 아바타가 보입니다. 이모지를 고르거나 이니셜로 둘 수 있어요.']),
    ]));
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(42px,1fr))', gap: '6px' } });
    var crownOk = !(UI.crownUnlocked) || UI.crownUnlocked();
    (UI.AVA_EMOJI || []).forEach(function (em) {
      var locked = (em === '👑') && !crownOk;
      if (locked) {
        grid.appendChild(el('button', { disabled: true, title: '🔒 CHALLENGE 10단계 정복 시 해금', class: 'crt-opt', style: { fontSize: '20px', padding: '6px 0', textAlign: 'center', opacity: .38, cursor: 'not-allowed', position: 'relative' } }, [em, el('span', { style: { position: 'absolute', right: '3px', bottom: '1px', fontSize: '9px' } }, ['🔒'])]));
        return;
      }
      grid.appendChild(el('button', { onclick: function () { doSetAvatar(em); }, class: 'crt-opt' + (cur === em ? ' on' : ''), style: { fontSize: '20px', padding: '6px 0', textAlign: 'center' } }, [em]));
    });
    grid.appendChild(el('button', { onclick: function () { doSetAvatar(''); }, class: 'crt-opt' + (cur === '' ? ' on' : ''), style: { fontSize: '11px', padding: '6px 0', textAlign: 'center' } }, ['이니셜']));
    wrap.appendChild(grid);
    return wrap;
  }

  function statsBlock(p) {
    var s = curStats();
    var rate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
    var wrap = el('div', { style: { margin: '16px 0 4px', borderTop: '1px solid ' + p.line, paddingTop: '12px' } });
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim, marginBottom: '8px', letterSpacing: '.06em' } }, ['▸ 통계 · STATS  (AI 대국)']));
    wrap.appendChild(
      el('div', { style: { fontSize: '13px', color: p.amb, marginBottom: '6px' } }, [
        s.games + '판 · ',
        el('b', { style: { color: p.hi } }, [s.wins + '승']),
        ' ' + s.losses + '패 ' + s.draws + '무 · 승률 ',
        el('b', { style: { color: p.hi } }, [rate + '%']),
      ])
    );
    wrap.appendChild(
      el('div', { style: { height: '8px', border: '1px solid ' + p.line, position: 'relative', overflow: 'hidden', marginBottom: '12px' } }, [
        el('div', { style: { position: 'absolute', inset: '0', width: rate + '%', background: p.amb, opacity: '.7' } }),
      ])
    );
    var bm = (UI.bestMap && UI.bestMap()) || {};
    var keys = Object.keys(bm).filter(function (k) { return bm[k] > 0; }).sort(function (a, b) { return bm[b] - bm[a]; });
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim, margin: '4px 0 6px', letterSpacing: '.06em' } }, ['▸ 도전 모드 최고 연승']));
    if (keys.length) {
      var chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      keys.forEach(function (k) {
        chips.appendChild(el('span', { class: 'crt-opt', style: { fontSize: '11px' } }, [k + ' · 🏆' + bm[k]]));
      });
      wrap.appendChild(chips);
    } else {
      wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim } }, ['아직 도전 기록이 없어요.']));
    }
    if (s.src === 'local' && UI.Net && UI.Net.enabled) {
      wrap.appendChild(el('div', { style: { fontSize: '10px', color: p.dim, marginTop: '8px' } }, ['* 로그인하면 전적이 클라우드에 저장돼 다른 기기에서도 유지됩니다.']));
    }
    return wrap;
  }

  // ─────────────────────────────────────────── 진입/이탈/라우팅
  function enterAuth(from, toPage) {
    active = true;
    returnTo = from === 'lobby' ? 'lobby' : 'title';
    if (UI.exitToGuide) UI.exitToGuide();
    email = ''; pass = ''; pass2 = ''; nick = ''; agree = false;
    nickState = { status: 'idle', text: '' };
    delStage = 0; msg = ''; busy = false;
    // 초기 페이지 결정
    if (toPage) page = toPage;
    else if (UI.Net && UI.Net.isRecovery && UI.Net.isRecovery()) page = 'reset';
    else if (UI.Net && UI.Net.isMember && UI.Net.isMember()) page = 'account';
    else page = 'login';
    redraw();
    // 게스트 세션 확보(회원가입 업그레이드 대상) — 백엔드 켜져 있을 때만
    if (UI.Net && UI.Net.enabled) {
      UI.Net.ensureGuest()
        .then(function () {
          if (!active) return;
          // 세션 확보 후 회원 상태가 확인되면 기본 진입은 account 로 보정
          if (!toPage && page === 'login' && UI.Net.isMember && UI.Net.isMember()) page = 'account';
          redraw();
        })
        .catch(function () {});
    }
  }

  function go(toPage) {
    page = toPage; msg = ''; delStage = 0;
    nickState = { status: 'idle', text: '' };
    redraw();
  }

  function leaveAuth() {
    active = false;
    if (returnTo === 'lobby' && UI.renderLobby) UI.renderLobby();
    else if (UI.renderTitle) UI.renderTitle();
  }

  // 입력값 보존 — redraw 가 DOM 을 다시 그려도 타이핑 유지
  function capture() {
    var e = document.getElementById('auth-email');
    var pw = document.getElementById('auth-pass');
    var pw2 = document.getElementById('auth-pass2');
    var n = document.getElementById('auth-signup-nick');
    if (e) email = e.value;
    if (pw) pass = pw.value;
    if (pw2) pass2 = pw2.value;
    if (n) nick = n.value;
  }

  function validEmail() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((email || '').trim()); }
  function validate() {
    if (!validEmail()) return '이메일 형식을 확인하세요';
    if ((pass || '').length < 6) return '비밀번호는 6자 이상이어야 해요';
    return '';
  }

  // ─────────────────────────────────────────── 액션 핸들러
  function checkNick() {
    var v = (nick || '').trim();
    if (!v) { nickState = { status: 'idle', text: '' }; redraw(); return; }
    if (v.length < 2) { nickState = { status: 'taken', text: '2자 이상이어야 해요' }; redraw(); return; }
    if (!(UI.Net && UI.Net.checkNickname)) { nickState = { status: 'idle', text: '' }; return; }
    nickState = { status: 'checking', text: '확인 중…' }; redraw();
    var target = v;
    UI.Net.checkNickname(v).then(function (r) {
      if ((nick || '').trim() !== target) return; // 그 사이 값이 바뀌면 무시
      nickState = r && r.available
        ? { status: 'ok', text: '● 사용 가능' }
        : { status: 'taken', text: '○ 이미 사용 중' };
      redraw();
    });
  }

  function doSignup() {
    capture();
    var v = validate();
    if (v) { msg = '⚠ ' + v; redraw(); return; }
    var wantNick = (nick || '').trim();
    if (wantNick.length < 2) { msg = '⚠ 닉네임을 2자 이상 입력하세요'; redraw(); return; }
    if (!agree) { msg = '⚠ 약관에 동의해야 가입할 수 있어요'; redraw(); return; }
    if (nickState.status === 'taken') { msg = '⚠ ' + nickState.text.replace(/^[●○]\s*/, '') + '인 닉네임이에요'; redraw(); return; }
    busy = true; msg = '가입 처리 중…'; redraw();
    // 제출 직전 닉네임 최종 확인(경쟁 완화)
    var pre = UI.Net.checkNickname ? UI.Net.checkNickname(wantNick) : Promise.resolve({ available: true });
    pre.then(function (chk) {
      if (chk && chk.available === false) {
        busy = false; nickState = { status: 'taken', text: '○ 이미 사용 중' };
        msg = '⚠ 이미 사용 중인 닉네임이에요'; redraw(); return;
      }
      return UI.Net.signUpEmail(email.trim(), pass, wantNick).then(function (r) {
        if (!r || !r.ok) {
          busy = false; msg = '⚠ ' + ((r && r.error) || '가입 실패'); redraw(); return;
        }
        if (r.needConfirm) {
          // 순수 signUp — 아직 세션이 없어(로그아웃 상태) 닉네임은 인증 복귀 후 프로필 생성 시
          // user_metadata 로 반영된다. 여기서 updateNickname 을 부르면 세션이 없어 실패하므로 생략.
          busy = false; page = 'verify'; msg = ''; redraw(); return;
        }
        // 이메일 확인 OFF → 즉시 세션 → 닉네임 저장(유니크 충돌이면 표면화, 그래도 계정은 생성됨)
        return UI.Net.updateNickname(wantNick).then(function (nr) {
          busy = false;
          msg = nr && !nr.ok ? '✔ 회원가입 완료 (닉네임은 이미 사용 중 — 계정에서 변경하세요)' : '✔ 회원가입이 완료됐어요!';
          page = UI.Net.isMember && UI.Net.isMember() ? 'account' : 'login';
          redraw();
        });
      });
    }).catch(function (e) { busy = false; msg = '⚠ ' + (e && e.message ? e.message : e); redraw(); });
  }

  function doLogin() {
    capture();
    var v = validate();
    if (v) { msg = '⚠ ' + v; redraw(); return; }
    busy = true; msg = '로그인 중…'; redraw();
    UI.Net.signInEmail(email.trim(), pass)
      .then(function (r) {
        busy = false;
        if (!r || !r.ok) { msg = '⚠ ' + ((r && r.error) || '로그인 실패'); redraw(); return; }
        msg = ''; page = 'account'; redraw();
      })
      .catch(function (e) { busy = false; msg = '⚠ ' + (e && e.message ? e.message : e); redraw(); });
  }

  function doOAuth(provider) {
    busy = true; msg = provider + ' 로 이동 중…'; redraw();
    UI.Net.signInOAuth(provider).then(function (r) {
      if (!r || !r.ok) {
        busy = false;
        msg = '⚠ ' + ((r && r.error) || 'OAuth 실패 — 대시보드에서 provider 설정이 필요할 수 있어요');
        redraw();
      }
      // 성공 시 페이지가 리다이렉트됨
    });
  }

  function doLogout() {
    busy = true; msg = '로그아웃 중…'; redraw();
    UI.Net.signOut().then(function () {
      busy = false; msg = '게스트로 전환했어요'; page = 'login'; redraw();
    });
  }

  function doReset() {
    capture();
    if (!validEmail()) { msg = '⚠ 재설정 메일을 받을 이메일을 입력하세요'; redraw(); return; }
    busy = true; msg = '재설정 메일 전송 중…'; redraw();
    UI.Net.resetPassword(email.trim()).then(function (r) {
      busy = false;
      msg = r && r.ok
        ? '✔ 비밀번호 재설정 메일을 보냈어요 — 메일의 링크를 눌러 새 비밀번호를 설정하세요. (링크는 이 사이트로 돌아옵니다)'
        : '⚠ ' + ((r && r.error) || '실패');
      redraw();
    });
  }

  // 재설정 링크 복귀 → 새 비밀번호 확정
  function doRenew() {
    var a = document.getElementById('auth-newpass');
    var b = document.getElementById('auth-newpass2');
    if (a) pass = a.value;
    if (b) pass2 = b.value;
    if ((pass || '').length < 6) { msg = '⚠ 비밀번호는 6자 이상이어야 해요'; redraw(); return; }
    if (pass !== pass2) { msg = '⚠ 두 비밀번호가 일치하지 않아요'; redraw(); return; }
    busy = true; msg = '새 비밀번호 저장 중…'; redraw();
    UI.Net.updatePassword(pass).then(function (r) {
      busy = false;
      if (!r || !r.ok) { msg = '⚠ ' + ((r && r.error) || '실패 — 링크가 만료되었을 수 있어요. 다시 요청해 주세요.'); redraw(); return; }
      pass = ''; pass2 = '';
      if (UI.Net.clearRecovery) UI.Net.clearRecovery();
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (UI.Net.reloadProfile) UI.Net.reloadProfile().then(function () { redraw(); });
      msg = '✔ 비밀번호를 변경했어요 — 새 비밀번호로 로그인되었습니다.';
      page = UI.Net.isMember && UI.Net.isMember() ? 'account' : 'login';
      redraw();
    });
  }

  // 로그인 회원 비밀번호 변경
  function doChangePw() {
    var a = document.getElementById('auth-newpass');
    var b = document.getElementById('auth-newpass2');
    if (a) pass = a.value;
    if (b) pass2 = b.value;
    if ((pass || '').length < 6) { msg = '⚠ 비밀번호는 6자 이상이어야 해요'; redraw(); return; }
    if (pass !== pass2) { msg = '⚠ 두 비밀번호가 일치하지 않아요'; redraw(); return; }
    busy = true; msg = '비밀번호 변경 중…'; redraw();
    UI.Net.changePassword(pass).then(function (r) {
      busy = false;
      if (!r || !r.ok) { msg = '⚠ ' + ((r && r.error) || '변경 실패'); redraw(); return; }
      pass = ''; pass2 = '';
      msg = '✔ 비밀번호를 변경했어요'; page = 'account'; redraw();
    });
  }

  // 회원 탈퇴 실행(2단계 확인 후)
  function doDelete() {
    busy = true; msg = '탈퇴 처리 중…'; redraw();
    UI.Net.deleteAccount().then(function (r) {
      busy = false; delStage = 0;
      if (!r || !r.ok) { msg = '⚠ ' + ((r && r.error) || '탈퇴 실패'); redraw(); return; }
      msg = '탈퇴가 완료됐어요. 게스트로 전환했습니다.'; page = 'login'; redraw();
    }).catch(function (e) { busy = false; msg = '⚠ ' + (e && e.message ? e.message : e); redraw(); });
  }

  function doResend() {
    var addr = (UI.Net.pendingEmail && UI.Net.pendingEmail()) || email.trim();
    if (!addr) { msg = '⚠ 재전송할 이메일이 없어요'; redraw(); return; }
    busy = true; msg = '인증 메일 재전송 중…'; redraw();
    UI.Net.resendConfirmation(addr).then(function (r) {
      busy = false;
      msg = r && r.ok ? '✔ 인증 메일을 다시 보냈어요' : '⚠ ' + ((r && r.error) || '재전송 실패');
      redraw();
    });
  }

  // ─────────────────────────────────────────── 공용 뷰 조각
  function header(title) {
    var p = pal();
    return el('div', {
      style: { fontWeight: 700, color: p.amb, fontSize: '13px', letterSpacing: '.08em', borderBottom: '1px solid ' + p.line, paddingBottom: '7px', marginBottom: '14px' },
    }, [title]);
  }

  function field(id, type, ph, val, p, onEnter) {
    return el('input', {
      id: id, type: type, placeholder: ph, value: val,
      autocomplete: type === 'password' ? 'current-password' : 'email',
      oninput: function (e) {
        if (id === 'auth-email') email = e.target.value;
        else if (id === 'auth-pass') pass = e.target.value;
        else if (id === 'auth-pass2') pass2 = e.target.value;
      },
      onkeydown: function (e) { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } },
      style: inpStyle(p),
    });
  }

  // 인라인 텍스트 링크(페이지 이동)
  function linkRow(children) {
    return el('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '2px' } }, children);
  }
  function link(label, cb, p) {
    return el('button', { class: 'crt-btn ghost', onclick: cb, disabled: busy, style: { fontSize: '11px', padding: '4px 8px' } }, [label]);
  }

  function oauthBlock(p) {
    var wrap = el('div', {});
    wrap.appendChild(el('div', { style: { fontSize: '10px', color: p.dim, textAlign: 'center', margin: '10px 0 6px' } }, ['— 또는 —']));
    wrap.appendChild(el('button', {
      class: 'crt-btn ghost', onclick: function () { doOAuth('google'); }, disabled: busy,
      title: '배포된 https 사이트 + 대시보드 Google provider 설정 필요',
      style: { fontSize: '13px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' },
    }, [
      el('span', { style: { fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", fontSize: '15px', color: p.amb } }, ['G']),
      el('span', {}, ['Google 계정으로 계속']),
    ]));
    wrap.appendChild(el('div', { style: { fontSize: '10px', color: p.dim, textAlign: 'center', marginTop: '6px', lineHeight: 1.6 } }, [
      '게스트 상태에서 연결하면 지금까지의 전적·프로필이 그대로 유지돼요.',
    ]));
    return wrap;
  }

  // ─────────────────────────────────────────── 페이지 렌더러
  function loginPage(b, p) {
    b.appendChild(header('▸ 로그인 · LOGIN'));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '가입한 이메일로 로그인하면 다른 기기에서도 전적·프로필이 유지돼요.',
    ]));
    b.appendChild(field('auth-email', 'email', '이메일', email, p, doLogin));
    b.appendChild(field('auth-pass', 'password', '비밀번호', pass, p, doLogin));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doLogin, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['로그인']));
    b.appendChild(linkRow([
      link('회원가입 ▸', function () { go('signup'); }, p),
      link('비밀번호를 잊으셨나요?', function () { go('forgot'); }, p),
    ]));
    b.appendChild(oauthBlock(p));
  }

  function signupPage(b, p) {
    b.appendChild(header('▸ 회원가입 · SIGN UP'));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '간단한 정보로 가입해요. ',
      el('b', { style: { color: p.hi } }, ['지금까지 게스트로 쌓은 전적·프로필은 그대로 유지']),
      '됩니다.',
    ]));
    b.appendChild(field('auth-email', 'email', '이메일', email, p, doSignup));
    b.appendChild(field('auth-pass', 'password', '비밀번호 (6자 이상)', pass, p, doSignup));
    // 닉네임 + 사용가능 표시
    b.appendChild(el('input', {
      id: 'auth-signup-nick', type: 'text', maxlength: '24', placeholder: '닉네임 (표시 이름)', value: nick,
      oninput: function (e) { nick = e.target.value; nickState = { status: 'idle', text: '' }; },
      onblur: checkNick,
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doSignup(); } },
      style: Object.assign(inpStyle(p), { marginBottom: '4px' }),
    }));
    if (nickState.status !== 'idle') {
      var col = nickState.status === 'ok' ? p.ok : (nickState.status === 'taken' ? p.err : p.dim);
      b.appendChild(el('div', { style: { fontSize: '11px', color: col, margin: '0 0 8px 2px' } }, [nickState.text]));
    } else {
      b.appendChild(el('div', { style: { height: '4px' } }));
    }
    // 약관 동의
    b.appendChild(el('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '11px', color: p.dim, lineHeight: 1.6, margin: '4px 0 12px', cursor: 'pointer' } }, [
      el('input', { type: 'checkbox', checked: agree ? 'checked' : null, onchange: function (e) { agree = !!e.target.checked; }, style: { marginTop: '2px', accentColor: p.amb } }),
      el('span', {}, [
        el('a', { href: 'privacy/', target: '_blank', rel: 'noopener', style: { color: p.ok, textDecoration: 'underline', textUnderlineOffset: '2px' } }, ['개인정보처리방침']),
        ' 및 ',
        el('a', { href: 'terms/', target: '_blank', rel: 'noopener', style: { color: p.ok, textDecoration: 'underline', textUnderlineOffset: '2px' } }, ['이용약관']),
        '에 동의합니다.',
      ]),
    ]));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doSignup, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['회원가입']));
    b.appendChild(linkRow([
      link('◂ 이미 계정이 있나요? 로그인', function () { go('login'); }, p),
    ]));
    b.appendChild(oauthBlock(p));
  }

  function accountPage(b, p, ctx) {
    var prof = ctx.prof, mailAddr = ctx.mailAddr;
    b.appendChild(header('▸ 계정 · ACCOUNT'));
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.hi, fontWeight: 700, marginBottom: '4px' } }, ['✔ 회원으로 로그인됨']));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, marginBottom: '4px' } }, [mailAddr || '(이메일 확인 대기 중)']));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.amb, marginBottom: '10px' } }, [
      '닉네임 ', el('b', { style: { color: p.hi } }, [(prof && prof.nickname) || '—']),
    ]));

    // 닉네임 편집 + 아바타 + 통계
    if (prof) b.appendChild(nickBlock(p));
    b.appendChild(avatarBlock(p));
    b.appendChild(statsBlock(p));

    // 계정 액션 — 비번 변경 / 로그아웃
    b.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px', borderTop: '1px solid ' + p.line, paddingTop: '14px' } }, [
      el('button', { class: 'crt-btn ghost', onclick: function () { go('changepw'); }, disabled: busy, style: { fontSize: '12px', flex: 1 } }, ['🔑 비밀번호 변경']),
      el('button', { class: 'crt-btn ghost', onclick: doLogout, disabled: busy, style: { fontSize: '12px', flex: 1 } }, ['로그아웃']),
    ]));

    // 회원 탈퇴 — 2단계 확인
    var delWrap = el('div', { style: { marginTop: '18px', borderTop: '1px solid ' + p.line, paddingTop: '12px' } });
    if (delStage === 0) {
      delWrap.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () { delStage = 1; msg = ''; redraw(); }, disabled: busy, style: { fontSize: '11px', color: p.err, borderColor: p.err } }, ['회원 탈퇴']));
    } else {
      delWrap.appendChild(el('div', { style: { fontSize: '12px', color: p.err, lineHeight: 1.6, marginBottom: '10px' } }, [
        '정말 탈퇴하시겠어요? ',
        el('b', {}, ['계정과 전적·프로필이 영구 삭제']),
        '되며 되돌릴 수 없어요. (탈퇴 후에는 다시 게스트로 시작합니다.)',
      ]));
      delWrap.appendChild(el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button', { class: 'crt-btn', onclick: doDelete, disabled: busy, style: { fontSize: '12px', flex: 1, background: p.err, color: '#fff', borderColor: p.err } }, ['영구 탈퇴']),
        el('button', { class: 'crt-btn ghost', onclick: function () { delStage = 0; redraw(); }, disabled: busy, style: { fontSize: '12px', flex: 1 } }, ['취소']),
      ]));
    }
    b.appendChild(delWrap);
  }

  function forgotPage(b, p) {
    b.appendChild(header('▸ 비밀번호 찾기 · RESET'));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '가입한 이메일을 입력하면 재설정 링크를 보내드려요. 링크를 누르면 이 사이트로 돌아와 새 비밀번호를 설정합니다.',
    ]));
    b.appendChild(field('auth-email', 'email', '이메일', email, p, doReset));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doReset, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['재설정 메일 보내기']));
    b.appendChild(linkRow([link('◂ 로그인으로', function () { go('login'); }, p)]));
  }

  function resetPage(b, p) {
    b.appendChild(header('▸ 새 비밀번호 설정 · RENEW'));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '재설정 링크로 인증되었어요. 새 비밀번호를 입력하세요 (6자 이상).',
    ]));
    b.appendChild(el('input', { id: 'auth-newpass', type: 'password', placeholder: '새 비밀번호', autocomplete: 'new-password', oninput: function (e) { pass = e.target.value; }, style: inpStyle(p) }));
    b.appendChild(el('input', { id: 'auth-newpass2', type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password', oninput: function (e) { pass2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doRenew(); } }, style: inpStyle(p) }));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doRenew, disabled: busy, style: { fontSize: '13px', width: '100%' } }, ['비밀번호 변경']));
  }

  function changePwPage(b, p) {
    b.appendChild(header('▸ 비밀번호 변경 · CHANGE'));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '새 비밀번호를 입력하세요 (6자 이상). 변경 후에도 로그인 상태가 유지됩니다.',
    ]));
    b.appendChild(el('input', { id: 'auth-newpass', type: 'password', placeholder: '새 비밀번호', autocomplete: 'new-password', oninput: function (e) { pass = e.target.value; }, style: inpStyle(p) }));
    b.appendChild(el('input', { id: 'auth-newpass2', type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password', oninput: function (e) { pass2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doChangePw(); } }, style: inpStyle(p) }));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doChangePw, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['비밀번호 변경']));
    b.appendChild(linkRow([link('◂ 계정으로', function () { go('account'); }, p)]));
  }

  function verifyPage(b, p) {
    var addr = (UI.Net.pendingEmail && UI.Net.pendingEmail()) || email.trim() || '(이메일)';
    b.appendChild(header('▸ 이메일 인증 · VERIFY'));
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.amb, margin: '2px 0 4px' } }, [el('b', { style: { color: p.hi } }, [addr])]));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.7, marginBottom: '14px' } }, [
      '위 주소로 인증 메일을 보냈어요. 메일의 링크를 누르면 이 사이트로 돌아와 ',
      el('b', { style: { color: p.amb } }, ['회원가입이 완료']),
      '됩니다. 전적·프로필은 그대로 유지돼요.',
      el('br'), el('br'),
      '메일이 안 보이면 스팸함을 확인하거나 아래에서 재전송하세요.',
    ]));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doResend, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['인증 메일 재전송']));
    b.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () {
      if (UI.Net.reloadProfile) UI.Net.reloadProfile().then(function () {
        if (UI.Net.isMember && UI.Net.isMember()) { page = 'account'; msg = '✔ 회원가입 인증이 확인되었어요!'; }
        else msg = '아직 인증 전이에요 — 메일의 링크를 눌러 주세요.';
        redraw();
      });
    }, disabled: busy, style: { fontSize: '12px', width: '100%', marginBottom: '8px' } }, ['인증을 완료했어요 (새로고침)']));
    b.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () { page = 'login'; msg = ''; if (UI.Net.clearPending) UI.Net.clearPending(); redraw(); }, disabled: busy, style: { fontSize: '11px', width: '100%' } }, ['◂ 로그인으로']));
  }

  // ─────────────────────────────────────────── 셸 + 라우팅
  function redraw() {
    if (!active) return;
    capture();
    var app = UI.app, clear = UI.clear;
    clear();
    var p = pal();

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    var enabled = !!(UI.Net && UI.Net.enabled);
    var member = enabled && UI.Net.isMember && UI.Net.isMember();
    var prof = UI.Net && UI.Net.profile && UI.Net.profile();
    var sess = UI.Net && UI.Net.session && UI.Net.session();
    var mailAddr = sess && sess.user ? sess.user.email : '';
    var ctx = { enabled: enabled, member: member, prof: prof, sess: sess, mailAddr: mailAddr };

    if (!enabled) {
      // 백엔드 미설정 — 안내 + 로컬 통계만
      b.appendChild(header('▸ 계정 · ACCOUNT'));
      b.appendChild(el('div', { style: { fontSize: '12px', lineHeight: 1.7, color: p.dim } }, [
        'config.js 에 Supabase URL/anon 키를 넣으면 회원 기능(회원가입·로그인·클라우드 저장)이 활성화됩니다. 통계는 오프라인에서도 아래 로컬 기록으로 표시됩니다.',
      ]));
      b.appendChild(avatarBlock(p));
      b.appendChild(statsBlock(p));
    } else {
      // 회원 전용 페이지 보호 — 비회원이 account/changepw 로 오면 login 으로
      var pg = page;
      if ((pg === 'account' || pg === 'changepw') && !member) pg = 'login';
      if (pg === 'login' && member) pg = 'account';

      if (pg === 'login') loginPage(b, p);
      else if (pg === 'signup') signupPage(b, p);
      else if (pg === 'account') accountPage(b, p, ctx);
      else if (pg === 'forgot') forgotPage(b, p);
      else if (pg === 'reset') resetPage(b, p);
      else if (pg === 'changepw') changePwPage(b, p);
      else if (pg === 'verify') verifyPage(b, p);
      else loginPage(b, p);
    }

    if (msg) {
      var isErr = msg.indexOf('⚠') === 0;
      b.appendChild(el('div', { style: { fontSize: '12px', lineHeight: 1.6, color: isErr ? p.err : p.ok, margin: '12px 0 2px', minHeight: '16px' } }, [msg]));
    }

    b.appendChild(navRow(p));
    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);
  }

  function navRow(p) {
    return el('div', { style: { display: 'flex', gap: '10px', marginTop: '16px' } }, [
      el('button', { class: 'crt-btn ghost', onclick: leaveAuth, style: { fontSize: '13px' } }, ['◂ 뒤로']),
    ]);
  }

  UI.renderAuth = enterAuth;
  UI.redrawAuth = redraw;
  UI.leaveAuth = leaveAuth;
  UI.renderAccount = function (from) { enterAuth(from, 'account'); };
  UI.renderSignup = function (from) { enterAuth(from, 'signup'); };
  UI.renderLogin = function (from) { enterAuth(from, 'login'); };
  UI.isAuthActive = function () { return active; };

  // 비밀번호 재설정 링크 복귀 감지 → reset 페이지로 자동 진입.
  if (UI.Net && UI.Net.onEvent) {
    UI.Net.onEvent(function (evt) {
      if (evt !== 'PASSWORD_RECOVERY') return;
      if (active) { page = 'reset'; msg = ''; redraw(); }
      else enterAuth('title', 'reset');
    });
  }
})();
