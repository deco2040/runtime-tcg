/* RUNTIME TCG — 유저 리더보드 (온라인 랭킹).
 *
 * profiles 테이블(0002_social)의 wins/losses/draws/games 카운터로 랭킹을 구성한다.
 * 별도 마이그레이션 없이 동작(profiles 는 인증 유저 전체 읽기 허용). 게스트 자동 입장 후 조회.
 * CRT 터미널 스킨(lobby.js 와 동일 톤). 정렬 2종(승수/승률), 내 행 하이라이트 + 순위권 밖이면 개인 순위 별도 표시.
 * 모바일 우선: ≤560px 에서 열 축약.
 *
 * 라우팅: core.render() 가 UI.isLeaderboardActive() 로 분기.
 *   UI.renderLeaderboard = enter (진입: 조회 1회 + 렌더)
 *   UI.redrawLeaderboard = 순수 뷰 재그리기(테마/리사이즈)
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});

  var active = false;
  var rows = null;       // 조회 결과(정렬 전 원본). null=미조회, []=빈 목록
  var loading = false;
  var err = '';          // 에러/상태 문구('' 이면 정상)
  var sortMode = 'wins'; // 'wins' | 'rate'
  var RATE_MIN = 10;     // 승률 랭킹 최소 판수

  function el() { return UI.el.apply(null, arguments); }
  function isNarrow() { try { return window.matchMedia('(max-width:560px)').matches; } catch (e) { return (window.innerWidth || 800) <= 560; } }

  function pal() {
    var dark = UI.getTheme && UI.getTheme() === 'dark';
    return {
      amb: dark ? '#ffb000' : '#1d1d24',
      hi: dark ? '#ffd27a' : '#111319',
      dim: dark ? '#b3791f' : '#6b6b75',
      line: dark ? 'rgba(255,176,0,.22)' : 'rgba(29,29,36,.18)',
      faint: dark ? 'rgba(255,176,0,.06)' : 'rgba(29,29,36,.04)',
      me: dark ? '#7ad0ff' : '#1a5fa8',
      ok: dark ? '#7ad0ff' : '#1a5fa8',
      bad: dark ? '#ff8a6a' : '#c0392b',
      gold: dark ? '#ffcf4d' : '#b8860b',
    };
  }

  // ─────────────────────────────────────────── 진입 / 정리
  function enter() {
    active = true;
    if (UI.exitToGuide) UI.exitToGuide(); // G 클리어 → render() 라우팅 안전
    if (!UI.Net || !UI.Net.enabled) { rows = []; err = 'offline'; redraw(); return; }
    fetchRows();
    redraw();
  }
  function leave() {
    active = false;
    if (UI.renderLobby) UI.renderLobby();
    else if (UI.renderTitle) UI.renderTitle();
  }

  function fetchRows() {
    if (loading) return;
    loading = true; err = '';
    var ready = (UI.Net && UI.Net.ready) ? UI.Net.ready() : Promise.resolve(null);
    ready
      .then(function (c) {
        if (!c) throw new Error('no-client');
        var ensure = (UI.Net && UI.Net.ensureGuest) ? UI.Net.ensureGuest() : Promise.resolve();
        return ensure.then(function () { return c; });
      })
      .then(function (c) {
        return c.from('profiles')
          .select('id,nickname,avatar,wins,losses,draws,games,is_guest')
          .gt('games', 0)
          .order('wins', { ascending: false })
          .limit(100);
      })
      .then(function (r) {
        loading = false;
        if (r && r.error) { err = RT_I18N.pick('조회 실패','Query failed'); rows = rows || []; }
        else { rows = (r && r.data) ? r.data : []; err = ''; }
        if (active) redraw();
      })
      .catch(function () {
        loading = false; err = RT_I18N.pick('연결 실패','Connection failed'); rows = rows || []; if (active) redraw();
      });
  }

  // ─────────────────────────────────────────── 랭킹 계산
  function winRate(p) { return p.games > 0 ? p.wins / p.games : 0; }
  function ranked() {
    var list = (rows || []).slice();
    if (sortMode === 'rate') {
      list = list.filter(function (p) { return (p.games || 0) >= RATE_MIN; });
      list.sort(function (a, b) { return (winRate(b) - winRate(a)) || (b.wins - a.wins) || (b.games - a.games); });
    } else {
      list.sort(function (a, b) { return (b.wins - a.wins) || (winRate(b) - winRate(a)) || (b.games - a.games); });
    }
    return list;
  }

  // ─────────────────────────────────────────── 뷰 조각
  function tab(p, label, mode) {
    var on = sortMode === mode;
    return el('button', {
      class: 'crt-opt' + (on ? ' on' : ''),
      onclick: function () { if (sortMode !== mode) { sortMode = mode; if (UI.Sound) UI.Sound.ui(); redraw(); } },
      style: { fontSize: '11px', padding: '7px 12px', flex: 'none' },
    }, [label]);
  }

  function medal(rank) { return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ''; }

  function headerRow(p, narrow) {
    var cell = function (t, w, align) { return el('div', { style: { flex: w, minWidth: 0, textAlign: align || 'left', fontSize: '9px', letterSpacing: '.1em', color: p.dim, fontWeight: 700 } }, [t]); };
    var kids = [cell('#', '0 0 34px', 'center'), cell('PLAYER', '2 1 0')];
    if (!narrow) kids.push(cell('판수', '0 0 46px', 'center'));
    kids.push(cell('W-L' + (narrow ? '' : '-D'), '0 0 ' + (narrow ? '58px' : '78px'), 'center'));
    kids.push(cell('승률', '0 0 ' + (narrow ? '46px' : '56px'), 'center'));
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderBottom: '1px solid ' + p.line } }, kids);
  }

  function playerRow(p, entry, rank, narrow, isMe) {
    var nick = entry.nickname || RT_I18N.pick('익명', 'Anon');
    var rate = entry.games > 0 ? Math.round(winRate(entry) * 100) + '%' : '—';
    var wld = narrow ? (entry.wins + '-' + entry.losses) : (entry.wins + '-' + entry.losses + '-' + (entry.draws || 0));
    var rankCol = rank <= 3 ? p.gold : p.dim;
    var rowBg = isMe ? (UI.getTheme && UI.getTheme() === 'dark' ? 'rgba(122,208,255,.12)' : 'rgba(26,95,168,.09)') : 'transparent';
    var rankBox = el('div', { style: { flex: '0 0 34px', textAlign: 'center', fontWeight: 800, fontSize: rank <= 3 ? '15px' : '12px', color: rankCol, fontFamily: "'Space Mono',monospace" } }, [medal(rank) || String(rank)]);
    var who = el('div', { style: { flex: '2 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' } }, [
      (UI.avatarEl ? UI.avatarEl(entry, narrow ? 24 : 28) : el('span')),
      el('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column' } }, [
        el('div', { class: 'grot', style: { fontSize: narrow ? '12px' : '13px', fontWeight: 700, color: isMe ? p.me : p.hi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [nick + (isMe ? RT_I18N.pick(' (나)', ' (you)') : '')]),
        (entry.is_guest === false ? el('div', { style: { fontSize: '8px', color: p.dim, letterSpacing: '.08em' } }, ['● 정회원']) : null),
      ]),
    ]);
    var kids = [rankBox, who];
    if (!narrow) kids.push(el('div', { style: { flex: '0 0 46px', textAlign: 'center', fontSize: '12px', color: p.dim, fontFamily: "'Space Mono',monospace" } }, [String(entry.games)]));
    kids.push(el('div', { style: { flex: '0 0 ' + (narrow ? '58px' : '78px'), textAlign: 'center', fontSize: '11px', color: p.hi, fontFamily: "'Space Mono',monospace" } }, [wld]));
    kids.push(el('div', { style: { flex: '0 0 ' + (narrow ? '46px' : '56px'), textAlign: 'center', fontSize: '12px', fontWeight: 700, color: p.amb, fontFamily: "'Space Mono',monospace" } }, [rate]));
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderBottom: '1px solid ' + p.faint, background: rowBg } }, kids);
  }

  function boardBody(p, narrow) {
    if (err === 'offline') {
      return el('div', { style: { padding: '20px 14px', fontSize: '12px', lineHeight: 1.7, color: p.dim, textAlign: 'center' } }, [
        el('div', { style: { fontWeight: 700, color: p.hi, marginBottom: '6px' } }, ['⚠ 멀티플레이 백엔드 미설정']),
        el('div', {}, ['리더보드는 멀티플레이 접속 시 표시됩니다.']),
      ]);
    }
    if (rows === null || loading) {
      return el('div', { style: { padding: '28px 14px', fontSize: '12px', color: p.dim, textAlign: 'center' } }, ['⏳ 랭킹 불러오는 중…']);
    }
    var list = ranked();
    if (!list.length) {
      return el('div', { style: { padding: '28px 14px', fontSize: '12px', color: p.dim, textAlign: 'center' } }, [
        sortMode === 'rate' ? RT_I18N.pick(RATE_MIN + '판 이상 플레이한 유저가 아직 없어요.', 'No players with ' + RATE_MIN + '+ games yet.') : RT_I18N.pick('아직 기록된 대전이 없어요 — 첫 승리의 주인공이 되어보세요!', 'No matches recorded yet — be the first to win!'),
      ]);
    }
    var myId = UI.Net && UI.Net.userId ? UI.Net.userId() : null;
    var TOP = 50, myRank = -1;
    for (var i = 0; i < list.length; i++) { if (myId && list[i].id === myId) { myRank = i + 1; break; } }
    var wrap = el('div', { style: { display: 'flex', flexDirection: 'column' } }, [headerRow(p, narrow)]);
    var listBox = el('div', { style: { maxHeight: '54vh', overflowY: 'auto' } });
    list.slice(0, TOP).forEach(function (entry, idx) {
      listBox.appendChild(playerRow(p, entry, idx + 1, narrow, !!(myId && entry.id === myId)));
    });
    wrap.appendChild(listBox);
    // 순위권(TOP) 밖이면 개인 순위 별도 표시
    if (myRank > TOP) {
      wrap.appendChild(el('div', { style: { padding: '5px 8px', fontSize: '9px', letterSpacing: '.1em', color: p.dim, textAlign: 'center', borderTop: '1px dashed ' + p.line } }, ['· · · 내 순위 · · ·']));
      wrap.appendChild(playerRow(p, list[myRank - 1], myRank, narrow, true));
    }
    return wrap;
  }

  // ─────────────────────────────────────────── 전체 재그리기
  function redraw() {
    if (!active) return;
    var app = UI.app, clear = UI.clear;
    clear();
    var p = pal(), narrow = isNarrow();

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    // 헤더
    b.appendChild(el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: p.dim,
        letterSpacing: '.08em', borderBottom: '1px solid ' + p.line,
        paddingBottom: '7px', marginBottom: '12px',
      },
    }, [
      el('span', { style: { fontWeight: 700, color: p.amb } }, ['🏆 리더보드 · LEADERBOARD']),
      el('span', {}, ['RUNTIME OS  v1.0']),
    ]));

    // 정렬 탭 + 새로고침
    b.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } }, [
      tab(p, RT_I18N.pick('🏅 승수','🏅 Wins'), 'wins'),
      tab(p, RT_I18N.pick('📈 승률(' + RATE_MIN + '판↑)', '📈 Win rate (' + RATE_MIN + '+)'), 'rate'),
      el('div', { style: { flex: '1 1 0' } }),
      el('button', {
        class: 'crt-opt', onclick: function () { if (UI.Sound) UI.Sound.ui(); fetchRows(); redraw(); },
        style: { fontSize: '11px', padding: '7px 11px', flex: 'none' },
      }, ['↻ 새로고침']),
    ]));

    // 표 프레임
    b.appendChild(el('div', { style: { border: '1px solid ' + p.line, marginBottom: '13px' } }, [boardBody(p, narrow)]));

    if (err && err !== 'offline') {
      b.appendChild(el('div', { style: { fontSize: '10px', color: p.bad, marginBottom: '8px', textAlign: 'center' } }, ['⚠ ' + err]));
    }

    // 하단 네비 — 뒤로(로비)
    b.appendChild(el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, [
      el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['◂ 로비로']),
    ]));

    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);
  }

  // ─────────────────────────────────────────── 로비 임베드
  // 독립적으로 profiles 를 조회해 상위 N명 컴팩트 표를 그려 컨테이너 노드를 즉시 반환.
  // (leaderboard 화면 전용 모듈 상태 rows/sortMode 를 건드리지 않음 — 승수 정렬 고정.)
  var _embedCache = { rows: null, ts: 0 };   // 로비 임베드 스냅샷 캐시(30초) — redraw 마다 재조회 방지
  function embedBoard(limit) {
    limit = limit || 12;
    var p = pal();
    var box = el('div', { style: { display: 'flex', flexDirection: 'column', border: '1px solid ' + p.line } });
    box.appendChild(
      el('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '10px', letterSpacing: '.1em', color: p.dim,
          padding: '7px 9px', borderBottom: '1px solid ' + p.line,
        },
      }, [
        el('span', { style: { fontWeight: 700, color: p.amb } }, [RT_I18N.pick('🏆 리더보드 · TOP ' + limit, '🏆 LEADERBOARD · TOP ' + limit)]),
        el('button', {
          class: 'crt-opt',
          onclick: function () { if (UI.Sound) UI.Sound.ui(); if (UI.renderLeaderboard) UI.renderLeaderboard(); },
          style: { fontSize: '9px', padding: '3px 7px', flex: 'none' },
        }, ['전체 ▸']),
      ])
    );
    var body = el('div', { style: { minHeight: '70px' } }, [
      el('div', { style: { padding: '16px 10px', fontSize: '11px', color: p.dim, textAlign: 'center' } }, ['⏳ 랭킹 불러오는 중…']),
    ]);
    box.appendChild(body);

    function fill(node) { while (body.firstChild) body.removeChild(body.firstChild); body.appendChild(node); }
    function msg(t) { fill(el('div', { style: { padding: '16px 10px', fontSize: '11px', color: p.dim, textAlign: 'center' } }, [t])); }
    function paint(list) {
      if (!list.length) { msg('아직 기록이 없어요 — 첫 승리의 주인공이 되어보세요!'); return; }
      var myId = UI.Net && UI.Net.userId ? UI.Net.userId() : null;
      var frag = el('div', { style: { display: 'flex', flexDirection: 'column' } }, [headerRow(p, true)]);
      var lb = el('div', { style: { maxHeight: '30vh', overflowY: 'auto' } });
      list.slice(0, limit).forEach(function (entry, idx) { lb.appendChild(playerRow(p, entry, idx + 1, true, !!(myId && entry.id === myId))); });
      frag.appendChild(lb);
      fill(frag);
    }

    if (!UI.Net || !UI.Net.enabled) { msg('⚠ 오프라인 — 랭킹 미표시'); return box; }

    // 30초 이내 캐시가 있으면 재조회 없이 즉시 렌더(덱 선택/테마 토글 등 잦은 redraw 시 네트워크 절약)
    if (_embedCache.rows && (Date.now() - _embedCache.ts) < 30000) { paint(_embedCache.rows); return box; }

    var ready = (UI.Net && UI.Net.ready) ? UI.Net.ready() : Promise.resolve(null);
    ready
      .then(function (c) {
        if (!c) throw new Error('no-client');
        var ensure = (UI.Net && UI.Net.ensureGuest) ? UI.Net.ensureGuest() : Promise.resolve();
        return ensure.then(function () { return c; });
      })
      .then(function (c) {
        return c.from('profiles')
          .select('id,nickname,avatar,wins,losses,draws,games,is_guest')
          .gt('games', 0).order('wins', { ascending: false }).limit(limit);
      })
      .then(function (r) {
        var list = (r && r.data) ? r.data.slice() : [];
        list.sort(function (a, b) { return (b.wins - a.wins) || (winRate(b) - winRate(a)) || (b.games - a.games); });
        _embedCache = { rows: list, ts: Date.now() };
        if (!document.body.contains(box)) return;
        paint(list);
      })
      .catch(function () { if (document.body.contains(box)) msg('⚠ 랭킹 조회 실패'); });
    return box;
  }

  // ─────────────────────────────────────────── exports
  UI.renderLeaderboard = enter;
  UI.redrawLeaderboard = redraw;
  UI.isLeaderboardActive = function () { return active; };
  UI.leaderboardEmbed = embedBoard;
})();
