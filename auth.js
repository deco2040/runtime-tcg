/* RUNTIME TCG — 계정 화면 (멀티플레이 기능 3: 회원/로그인).
 *
 * 게스트(익명) → 이메일/비번 정회원 전환(id·전적 유지), 기존 계정 로그인, OAuth,
 * 로그아웃. CRT 터미널 스킨. 백엔드 미설정 시 안내만 표시.
 *
 * 라우팅: core.render() 가 UI.isAuthActive() 로 분기(테마 전환 시 redraw).
 *   UI.renderAuth = enterAuth (진입: 게스트 세션 확보 후 상태별 폼)
 *   UI.redrawAuth = 순수 뷰 재그리기
 *   UI.leaveAuth  = 뒤로(로비에서 왔으면 로비로, 아니면 타이틀)
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});

  var active = false;
  var tab = 'signup'; // 'signup' | 'login'  (게스트일 때만 사용)
  var view = null; // null(기본) | 'forgot'(재설정 메일 요청) | 'renew'(새 비번 설정)
  var email = '';
  var pass = '';
  var pass2 = ''; // 새 비번 확인
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

  // 통계 소스 — 로그인/게스트 세션 있으면 클라우드(profiles), 아니면 localStorage 로컬 기록
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
    if (!v) { msg = '닉네임을 입력하세요'; redraw(); return; }
    busy = true; msg = '닉네임 저장 중…'; redraw();
    UI.Net.updateNickname(v)
      .then(function () { busy = false; msg = '✔ 닉네임을 저장했어요'; redraw(); })
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
  // 프로필 사진(아바타) 선택 — 이모지 프리셋 or 이니셜. 게스트도 로컬 저장으로 즉시 반영, 로그인 시 상대에게 노출.
  function avatarBlock(p) {
    var prof = UI.Net.profile && UI.Net.profile();
    var nick = (prof && prof.nickname) || 'guest';
    var cur = (prof && prof.avatar) || (UI.Net.localAvatar && UI.Net.localAvatar()) || '';
    var wrap = el('div', { style: { margin: '14px 0 4px', borderTop: '1px solid ' + p.line, paddingTop: '12px' } });
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: p.dim, marginBottom: '8px', letterSpacing: '.06em' } }, ['▸ 프로필 사진 · AVATAR']));
    wrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } }, [
      (UI.avatarEl ? UI.avatarEl({ nickname: nick, avatar: cur }, 46) : null),
      el('div', { style: { fontSize: '11px', color: p.dim, lineHeight: 1.5 } }, ['대전 상대에게 이 아바타가 보입니다. 이모지를 고르거나 이니셜로 둘 수 있어요.']),
    ]));
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(42px,1fr))', gap: '6px' } });
    var crownOk = !(UI.crownUnlocked) || UI.crownUnlocked();   // 👑 은 CHALLENGE 10단계 정복 시에만 해금
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

    // 도전 모드 최고 연승(항상 로컬 — rt_challenge_bests)
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

  function enterAuth(from) {
    active = true;
    returnTo = from === 'lobby' ? 'lobby' : 'title';
    if (UI.exitToGuide) UI.exitToGuide();
    email = '';
    pass = '';
    pass2 = '';
    msg = '';
    busy = false;
    // 재설정 링크로 진입한 상태면 곧장 새 비밀번호 설정 뷰
    view = (UI.Net && UI.Net.isRecovery && UI.Net.isRecovery()) ? 'renew' : null;
    redraw();
    // 게스트 세션 확보(승격 대상이 있어야 함) — 백엔드 켜져 있을 때만
    if (UI.Net && UI.Net.enabled) {
      UI.Net.ensureGuest()
        .then(function () {
          if (active) redraw();
        })
        .catch(function () {});
    }
  }

  function leaveAuth() {
    active = false;
    if (returnTo === 'lobby' && UI.renderLobby) UI.renderLobby();
    else if (UI.renderTitle) UI.renderTitle();
  }

  // 입력값 보존
  function capture() {
    var e = document.getElementById('auth-email');
    var p = document.getElementById('auth-pass');
    if (e) email = e.value;
    if (p) pass = p.value;
  }

  function validate() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      return '이메일 형식을 확인하세요';
    if ((pass || '').length < 6) return '비밀번호는 6자 이상이어야 해요';
    return '';
  }

  function doSignup() {
    capture();
    var v = validate();
    if (v) {
      msg = v;
      redraw();
      return;
    }
    busy = true;
    msg = '처리 중…';
    redraw();
    UI.Net.signUpEmail(email.trim(), pass)
      .then(function (r) {
        busy = false;
        if (!r || !r.ok) {
          msg = '⚠ ' + ((r && r.error) || '실패');
        } else if (r.needConfirm) {
          // 이메일 인증 대기 — 전용 뷰로 전환(재전송 버튼 제공)
          view = 'verify';
          msg = '';
        } else {
          msg = '✔ 정회원이 되었어요!';
        }
        redraw();
      })
      .catch(function (e) {
        busy = false;
        msg = '⚠ ' + (e && e.message ? e.message : e);
        redraw();
      });
  }

  function doLogin() {
    capture();
    var v = validate();
    if (v) {
      msg = v;
      redraw();
      return;
    }
    busy = true;
    msg = '로그인 중…';
    redraw();
    UI.Net.signInEmail(email.trim(), pass)
      .then(function (r) {
        busy = false;
        if (!r || !r.ok) {
          msg = '⚠ ' + ((r && r.error) || '로그인 실패');
          redraw();
        } else {
          msg = '';
          redraw();
        }
      })
      .catch(function (e) {
        busy = false;
        msg = '⚠ ' + (e && e.message ? e.message : e);
        redraw();
      });
  }

  function doOAuth(provider) {
    busy = true;
    msg = provider + ' 로 이동 중…';
    redraw();
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
    busy = true;
    msg = '로그아웃 중…';
    redraw();
    UI.Net.signOut().then(function () {
      busy = false;
      msg = '게스트로 전환했어요';
      redraw();
    });
  }

  function doReset() {
    capture();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      msg = '재설정 메일을 받을 이메일을 입력하세요';
      redraw();
      return;
    }
    busy = true;
    msg = '재설정 메일 전송 중…';
    redraw();
    UI.Net.resetPassword(email.trim()).then(function (r) {
      busy = false;
      msg = r && r.ok
        ? '✔ 비밀번호 재설정 메일을 보냈어요 — 메일의 링크를 눌러 새 비밀번호를 설정하세요. (링크는 이 사이트로 돌아옵니다)'
        : '⚠ ' + ((r && r.error) || '실패');
      redraw();
    });
  }

  // 재설정 링크로 복귀 → 새 비밀번호 확정
  function doRenew() {
    var a = document.getElementById('auth-newpass');
    var b = document.getElementById('auth-newpass2');
    if (a) pass = a.value;
    if (b) pass2 = b.value;
    if ((pass || '').length < 6) { msg = '비밀번호는 6자 이상이어야 해요'; redraw(); return; }
    if (pass !== pass2) { msg = '두 비밀번호가 일치하지 않아요'; redraw(); return; }
    busy = true;
    msg = '새 비밀번호 저장 중…';
    redraw();
    UI.Net.updatePassword(pass).then(function (r) {
      busy = false;
      if (!r || !r.ok) {
        msg = '⚠ ' + ((r && r.error) || '실패 — 링크가 만료되었을 수 있어요. 다시 요청해 주세요.');
        redraw();
        return;
      }
      // 성공 — 갱신된 세션으로 로그인 상태. 기본 계정 화면으로 복귀.
      view = null; pass = ''; pass2 = '';
      if (UI.Net.clearRecovery) UI.Net.clearRecovery();
      // URL 의 recovery 해시 제거(새로고침 시 재진입 방지)
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (UI.Net.reloadProfile) UI.Net.reloadProfile().then(function () { redraw(); });
      msg = '✔ 비밀번호를 변경했어요 — 새 비밀번호로 로그인되었습니다.';
      redraw();
    });
  }

  // ─────────────────────────────────────────── 뷰
  function field(id, type, ph, val, p) {
    return el('input', {
      id: id,
      type: type,
      placeholder: ph,
      value: val,
      autocomplete: type === 'password' ? 'current-password' : 'email',
      oninput: function (e) {
        if (id === 'auth-email') email = e.target.value;
        else pass = e.target.value;
      },
      onkeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (tab === 'login') doLogin();
          else doSignup();
        }
      },
      style: {
        width: '100%',
        background: 'transparent',
        border: '1px solid ' + p.line,
        color: p.amb,
        padding: '9px 11px',
        marginBottom: '8px',
        fontFamily: "'Space Mono',monospace",
        fontSize: '13px',
        outline: 'none',
      },
    });
  }

  function tabBtn(key, label, p) {
    var on = tab === key;
    return el(
      'button',
      {
        class: 'crt-opt' + (on ? ' on' : ''),
        onclick: function () {
          tab = key;
          msg = '';
          redraw();
        },
        style: { fontSize: '12px', flex: 1, textAlign: 'center' },
      },
      [label]
    );
  }

  // ── 정회원 전환: 이메일 인증 대기 뷰(재전송 · 확인 안내)
  function doResend() {
    var addr = (UI.Net.pendingEmail && UI.Net.pendingEmail()) || email.trim();
    if (!addr) { msg = '재전송할 이메일이 없어요'; redraw(); return; }
    busy = true; msg = '인증 메일 재전송 중…'; redraw();
    UI.Net.resendConfirmation(addr).then(function (r) {
      busy = false;
      msg = r && r.ok ? '✔ 인증 메일을 다시 보냈어요' : '⚠ ' + ((r && r.error) || '재전송 실패');
      redraw();
    });
  }
  function verifyView(b, p) {
    var addr = (UI.Net.pendingEmail && UI.Net.pendingEmail()) || email.trim() || '(이메일)';
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.hi, fontWeight: 700, marginBottom: '6px' } }, ['▸ 이메일 인증']));
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.amb, margin: '2px 0 4px' } }, [
      el('b', { style: { color: p.hi } }, [addr]),
    ]));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.7, marginBottom: '14px' } }, [
      '위 주소로 인증 메일을 보냈어요. 메일의 링크를 누르면 이 사이트로 돌아와 ',
      el('b', { style: { color: p.amb } }, ['정회원 전환이 완료']),
      '됩니다. 전적·프로필은 그대로 유지돼요.',
      el('br'), el('br'),
      '메일이 안 보이면 스팸함을 확인하거나 아래에서 재전송하세요.',
    ]));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doResend, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['인증 메일 재전송']));
    b.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () {
      // 인증 완료했는지 세션 재확인 → 정회원이면 자동으로 member 화면
      if (UI.Net.reloadProfile) UI.Net.reloadProfile().then(function () {
        if (UI.Net.isMember && UI.Net.isMember()) { view = null; msg = '✔ 정회원 인증이 확인되었어요!'; }
        else msg = '아직 인증 전이에요 — 메일의 링크를 눌러 주세요.';
        redraw();
      });
    }, disabled: busy, style: { fontSize: '12px', width: '100%', marginBottom: '8px' } }, ['인증을 완료했어요 (새로고침)']));
    b.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () { view = null; msg = ''; if (UI.Net.clearPending) UI.Net.clearPending(); redraw(); }, disabled: busy, style: { fontSize: '11px', width: '100%' } }, ['◂ 뒤로']));
  }

  // ── 비밀번호 찾기: 재설정 메일 요청 뷰
  function forgotView(b, p) {
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.hi, fontWeight: 700, marginBottom: '6px' } }, ['▸ 비밀번호 찾기']));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '가입한 이메일을 입력하면 재설정 링크를 보내드려요. 링크를 누르면 이 사이트로 돌아와 새 비밀번호를 설정합니다.',
    ]));
    b.appendChild(el('input', {
      id: 'auth-email', type: 'email', placeholder: '이메일', value: email, autocomplete: 'email',
      oninput: function (e) { email = e.target.value; },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doReset(); } },
      style: { width: '100%', background: 'transparent', border: '1px solid ' + p.line, color: p.amb, padding: '9px 11px', marginBottom: '8px', fontFamily: "'Space Mono',monospace", fontSize: '13px', outline: 'none' },
    }));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doReset, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } }, ['재설정 메일 보내기']));
    b.appendChild(el('button', { class: 'crt-btn ghost', onclick: function () { view = null; msg = ''; redraw(); }, disabled: busy, style: { fontSize: '12px', width: '100%' } }, ['◂ 로그인으로']));
  }

  // ── 비밀번호 찾기: 재설정 링크 복귀 후 새 비밀번호 설정 뷰
  function renewView(b, p) {
    b.appendChild(el('div', { style: { fontSize: '13px', color: p.hi, fontWeight: 700, marginBottom: '6px' } }, ['▸ 새 비밀번호 설정']));
    b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
      '재설정 링크로 인증되었어요. 새 비밀번호를 입력하세요 (6자 이상).',
    ]));
    b.appendChild(el('input', {
      id: 'auth-newpass', type: 'password', placeholder: '새 비밀번호', autocomplete: 'new-password',
      oninput: function (e) { pass = e.target.value; },
      style: { width: '100%', background: 'transparent', border: '1px solid ' + p.line, color: p.amb, padding: '9px 11px', marginBottom: '8px', fontFamily: "'Space Mono',monospace", fontSize: '13px', outline: 'none' },
    }));
    b.appendChild(el('input', {
      id: 'auth-newpass2', type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password',
      oninput: function (e) { pass2 = e.target.value; },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doRenew(); } },
      style: { width: '100%', background: 'transparent', border: '1px solid ' + p.line, color: p.amb, padding: '9px 11px', marginBottom: '8px', fontFamily: "'Space Mono',monospace", fontSize: '13px', outline: 'none' },
    }));
    b.appendChild(el('button', { class: 'crt-btn', onclick: doRenew, disabled: busy, style: { fontSize: '13px', width: '100%' } }, ['비밀번호 변경']));
  }

  function redraw() {
    if (!active) return;
    capture();
    var app = UI.app,
      clear = UI.clear;
    clear();
    var p = pal();

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    b.appendChild(
      el(
        'div',
        {
          style: {
            fontWeight: 700,
            color: p.amb,
            fontSize: '13px',
            letterSpacing: '.08em',
            borderBottom: '1px solid ' + p.line,
            paddingBottom: '7px',
            marginBottom: '14px',
          },
        },
        ['▸ 계정 · ACCOUNT']
      )
    );

    var enabled = !!(UI.Net && UI.Net.enabled);
    var member = enabled && UI.Net.isMember && UI.Net.isMember();
    var prof = UI.Net && UI.Net.profile && UI.Net.profile();
    var sess = UI.Net && UI.Net.session && UI.Net.session();
    var mailAddr = sess && sess.user ? sess.user.email : '';

    var special = view === 'forgot' || view === 'renew' || view === 'verify';
    if (view === 'renew') {
      renewView(b, p);
    } else if (view === 'forgot') {
      forgotView(b, p);
    } else if (view === 'verify') {
      verifyView(b, p);
    } else if (!enabled) {
      b.appendChild(
        el(
          'div',
          { style: { fontSize: '12px', lineHeight: 1.7, color: p.dim } },
          [
            'config.js 에 Supabase URL/anon 키를 넣으면 회원 기능(닉네임·클라우드 저장)이 활성화됩니다. 통계는 오프라인에서도 아래 로컬 기록으로 표시됩니다.',
          ]
        )
      );
    } else if (member) {
      // 정회원 상태
      b.appendChild(
        el('div', { style: { fontSize: '13px', color: p.hi, fontWeight: 700, marginBottom: '4px' } }, [
          '✔ 정회원으로 로그인됨',
        ])
      );
      b.appendChild(
        el('div', { style: { fontSize: '12px', color: p.dim, marginBottom: '4px' } }, [
          mailAddr || '(이메일 확인 대기 중)',
        ])
      );
      b.appendChild(
        el('div', { style: { fontSize: '12px', color: p.amb, marginBottom: '16px' } }, [
          '닉네임 ',
          el('b', { style: { color: p.hi } }, [(prof && prof.nickname) || '—']),
        ])
      );
      b.appendChild(
        el(
          'button',
          { class: 'crt-btn ghost', onclick: doLogout, disabled: busy, style: { fontSize: '13px' } },
          ['로그아웃']
        )
      );
    } else {
      // 게스트 상태 — 전환/로그인 탭
      b.appendChild(
        el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '12px' } }, [
          '지금은 게스트(',
          el('b', { style: { color: p.amb } }, [(prof && prof.nickname) || 'guest']),
          ')로 플레이 중이에요. 정회원이 되면 ',
          el('b', { style: { color: p.hi } }, ['다른 기기에서도 전적·프로필이 유지']),
          '됩니다.',
        ])
      );

      b.appendChild(
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px' } }, [
          tabBtn('signup', '정회원 전환', p),
          tabBtn('login', '기존 계정 로그인', p),
        ])
      );

      b.appendChild(field('auth-email', 'email', '이메일', email, p));
      b.appendChild(field('auth-pass', 'password', '비밀번호 (6자 이상)', pass, p));

      if (tab === 'signup') {
        b.appendChild(
          el(
            'button',
            { class: 'crt-btn', onclick: doSignup, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } },
            ['정회원으로 전환하기']
          )
        );
      } else {
        b.appendChild(
          el(
            'button',
            { class: 'crt-btn', onclick: doLogin, disabled: busy, style: { fontSize: '13px', width: '100%', marginBottom: '8px' } },
            ['로그인']
          )
        );
        b.appendChild(
          el(
            'button',
            { class: 'crt-btn ghost', onclick: function () { view = 'forgot'; msg = ''; redraw(); }, disabled: busy, style: { fontSize: '11px', width: '100%', marginBottom: '8px' } },
            ['비밀번호를 잊으셨나요?']
          )
        );
      }

      // OAuth (선택)
      b.appendChild(
        el('div', { style: { fontSize: '10px', color: p.dim, textAlign: 'center', margin: '4px 0 6px' } }, ['— 또는 —'])
      );
      b.appendChild(
        el(
          'button',
          {
            class: 'crt-btn ghost',
            onclick: function () {
              doOAuth('google');
            },
            disabled: busy,
            title: '배포된 https 사이트 + 대시보드 Google provider 설정 필요',
            style: { fontSize: '13px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' },
          },
          [
            el('span', { style: { fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", fontSize: '15px', color: p.amb } }, ['G']),
            el('span', {}, ['Google 계정으로 계속']),
          ]
        )
      );
      b.appendChild(
        el('div', { style: { fontSize: '10px', color: p.dim, textAlign: 'center', marginTop: '6px', lineHeight: 1.6 } }, [
          '게스트 상태에서 연결하면 지금까지의 전적·프로필이 그대로 유지돼요.',
        ])
      );
    }

    // 닉네임 편집(세션/프로필 있을 때) + 통계(항상, 오프라인은 로컬 기록) — 특수 뷰에선 숨김
    if (!special && enabled && prof) b.appendChild(nickBlock(p));
    if (!special) b.appendChild(avatarBlock(p));
    if (!special) b.appendChild(statsBlock(p));

    if (msg) {
      var isErr = msg.indexOf('⚠') === 0;
      b.appendChild(
        el(
          'div',
          {
            style: {
              fontSize: '12px',
              lineHeight: 1.6,
              color: isErr ? p.err : p.ok,
              margin: '12px 0 2px',
              minHeight: '16px',
            },
          },
          [msg]
        )
      );
    }

    b.appendChild(navRow(p));
    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);
  }

  function navRow(p) {
    return el(
      'div',
      { style: { display: 'flex', gap: '10px', marginTop: '16px' } },
      [
        el(
          'button',
          { class: 'crt-btn ghost', onclick: leaveAuth, style: { fontSize: '13px' } },
          ['◂ 뒤로']
        ),
      ]
    );
  }

  UI.renderAuth = enterAuth;
  UI.redrawAuth = redraw;
  UI.leaveAuth = leaveAuth;
  UI.isAuthActive = function () {
    return active;
  };

  // 비밀번호 재설정 링크 복귀 감지 → 계정 화면을 새 비밀번호 설정 뷰로 자동 진입.
  // net.js 가 recovery URL 을 감지하면 SDK 를 즉시 로드하고 PASSWORD_RECOVERY 를 발화한다.
  if (UI.Net && UI.Net.onEvent) {
    UI.Net.onEvent(function (evt) {
      if (evt !== 'PASSWORD_RECOVERY') return;
      if (active) { view = 'renew'; msg = ''; redraw(); }
      else enterAuth('title'); // enterAuth 가 isRecovery()로 renew 뷰 진입
    });
  }
})();
