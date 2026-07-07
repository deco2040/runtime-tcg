/* RUNTIME TCG — 매치메이킹 (멀티플레이 기능 2, 마일스톤 2a: 페어링 + 방 핸드셰이크).
 *
 * 흐름: ensureGuest → rpc(find_or_create_match) → 열린 방 점유(게스트) 또는 새 방 대기(호스트).
 * 호스트는 rooms UPDATE 를 구독해 상대 입장을 감지. 성사되면 room:<id> Realtime 채널에
 * presence 로 양쪽 실시간 연결을 확인(핸드셰이크). 실제 대전 동기화(2b)는 이 채널 위에 붙는다.
 *
 * OnlineAdapter 심(UI.Online): 2b 가 sendAction/onState/onfx 를 여기에 연결 → UI/엔진은
 * 권위 주체(호스트/서버)를 몰라도 되게. 지금은 방/채널/인덱스만 노출.
 *
 * 라우팅: core.render() 가 UI.isMatchmakingActive() 로 분기.
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});

  var active = false;
  var mode = 'auto'; // auto(매치메이킹) | custom(코드 방)
  var phase = 'idle'; // idle | search | matched | offline | error | custommenu | creating | waitcode | joinform | joining
  var room = null;
  var myIdx = 0;
  var roomCode = '';  // custom 방 만들 때 생성한 코드
  var codeInput = ''; // custom 방 참여 코드 입력
  var roomCh = null; // room:<id> 대전/프레즌스 채널
  var pgCh = null; // rooms UPDATE 감지(호스트 대기용)
  var status = '';
  var bothReady = false;
  var matchStarted = false;
  var discTimer = null;
  var ghostTimer = null; // 유령 방(응답 없는 호스트) 감지 타이머 — 자동매칭 게스트 입장 시
  var oppProfile = null; // 상대 프로필(전적/승률) — 대국 전 카드용(기능 4)
  var matchedSfx = false; // 매칭 성사 효과음 1회만 재생(redraw 중복 방지)

  // phase 를 matched 로 전환하며 성사 효과음을 1회 재생(경로: 자동매칭/코드조인/호스트감지 공통)
  function toMatched() {
    disarmGhostCheck(); // 실접속 확인됨 — 유령 감시 해제
    phase = 'matched';
    status = '';
    if (!matchedSfx) { matchedSfx = true; if (UI.Sound) UI.Sound.match(); }
  }

  // 유령 방 감지 — 자동매칭에서 열린 방(호스트)에 게스트로 붙었는데 DB 상 full 이어도
  // 호스트가 실제로는 접속 중이 아닐 수 있다(탭 닫힘/크래시로 남은 stale open 방).
  // presence 가 6초 안에 2명에 도달하지 못하면 유령으로 판단 → 방 폐기 후 자동 재탐색.
  function armGhostCheck() {
    if (ghostTimer) return;
    ghostTimer = setTimeout(function () {
      ghostTimer = null;
      if (!active || matchStarted || mode !== 'auto') return;
      var n = roomCh ? Object.keys(roomCh.presenceState() || {}).length : 0;
      if (n < 2) recycleGhost();
    }, 6000);
  }
  function disarmGhostCheck() { if (ghostTimer) { clearTimeout(ghostTimer); ghostTimer = null; } }

  // 유령 방에서 나가 새 방으로 재탐색(내가 호스트가 되어 다시 대기)
  function recycleGhost() {
    try {
      if (room && UI.Net && UI.Net.client && UI.Net.client()) {
        UI.Net.client().rpc('leave_room', { p_id: room.id });
      }
    } catch (e) {}
    unsub();
    room = null;
    matchedSfx = false;
    phase = 'search';
    status = '상대를 찾는 중…';
    redraw();
    findMatch();
  }

  // 대국 중 상대 presence 가 사라지면(탭 닫힘/크래시) 유예 후 이탈 처리(끊김→승리)
  function armDisc() {
    if (discTimer) return;
    discTimer = setTimeout(function () {
      discTimer = null;
      if (matchStarted && roomCh && Object.keys(roomCh.presenceState() || {}).length < 2) {
        if (UI.onlineOpponentLeft) UI.onlineOpponentLeft('상대 연결이 끊겼습니다 — 승리');
      }
    }, 6000);
  }
  function disarmDisc() { if (discTimer) { clearTimeout(discTimer); discTimer = null; } }

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
      ok: dark ? '#7ad0ff' : '#1a5fa8',
    };
  }

  function enter() {
    disarmGhostCheck();
    active = true;
    mode = 'auto';
    phase = 'search';
    room = null;
    status = '';
    bothReady = false;
    oppProfile = null;
    matchedSfx = false;
    if (UI.exitToGuide) UI.exitToGuide();
    redraw();
    if (!UI.Net || !UI.Net.enabled) {
      phase = 'offline';
      redraw();
      return;
    }
    findMatch();
  }

  // ─────────────────────────────────────────── 커스텀 매치(기능 6): 방 만들기 / 코드 참여
  function enterCustom() {
    active = true;
    mode = 'custom';
    phase = 'custommenu';
    room = null; status = ''; bothReady = false; roomCode = ''; codeInput = ''; oppProfile = null; matchedSfx = false;
    if (UI.exitToGuide) UI.exitToGuide();
    redraw();
    if (!UI.Net || !UI.Net.enabled) { phase = 'offline'; redraw(); }
  }

  // 상대 프로필 1회 조회(방이 성사되면) — id 로 가드해 중복 조회 방지.
  function ensureOppProfile() {
    if (!room) return;
    var oppId = myIdx === 0 ? room.guest : room.host;
    if (!oppId) return;
    if (oppProfile && oppProfile.id === oppId) return;
    if (!UI.Net || !UI.Net.fetchProfile) return;
    UI.Net.fetchProfile(oppId).then(function (pr) {
      if (!active) return;
      if (pr) { oppProfile = pr; redraw(); }
    });
  }
  function genCode() {
    var cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += cs.charAt(Math.floor(Math.random() * cs.length));
    return s;
  }
  function startCreate() {
    roomCode = genCode();
    phase = 'creating'; status = ''; redraw();
    UI.Net.ensureGuest().then(function (s) {
      if (!active) return;
      if (!s) { phase = 'error'; status = '접속 실패 — 게스트 로그인 불가'; redraw(); return; }
      var nick = (UI.Net.profile() || {}).nickname || 'guest';
      return UI.Net.client().rpc('create_custom_room', { p_nick: nick, p_deck: myDeckList(), p_code: roomCode })
        .then(function (r) {
          if (!active) return;
          if (r.error) { phase = 'error'; status = '방 생성 오류: ' + r.error.message; redraw(); return; }
          room = r.data; myIdx = 0;
          joinRoomChannel();      // 호스트 대기 — presence 로 게스트 입장 감지
          phase = 'waitcode'; redraw();
        });
    }).catch(function (e) { if (active) { phase = 'error'; status = '오류: ' + (e && e.message ? e.message : e); redraw(); } });
  }
  function submitJoin() {
    var code = (codeInput || '').trim().toUpperCase();
    if (code.length < 3) { status = '코드를 입력하세요'; redraw(); return; }
    phase = 'joining'; status = ''; redraw();
    UI.Net.ensureGuest().then(function (s) {
      if (!active) return;
      if (!s) { phase = 'error'; status = '접속 실패 — 게스트 로그인 불가'; redraw(); return; }
      var nick = (UI.Net.profile() || {}).nickname || 'guest';
      return UI.Net.client().rpc('join_room_by_code', { p_nick: nick, p_deck: myDeckList(), p_code: code })
        .then(function (r) {
          if (!active) return;
          if (r.error) { phase = 'joinform'; status = '방을 찾을 수 없어요 (코드를 확인하세요)'; redraw(); return; }
          room = r.data; myIdx = room.host === UI.Net.userId() ? 0 : 1;
          joinRoomChannel();
          if (room.status === 'full') toMatched(); else phase = 'search';
          redraw();
        });
    }).catch(function (e) { if (active) { phase = 'joinform'; status = '오류: ' + (e && e.message ? e.message : e); redraw(); } });
  }

  function leave() {
    cleanup();
    active = false;
    if (UI.renderLobby) UI.renderLobby();
  }

  function cleanup() {
    disarmGhostCheck();
    try {
      if (room && UI.Net && UI.Net.client && UI.Net.client()) {
        UI.Net.client().rpc('leave_room', { p_id: room.id });
      }
    } catch (e) {}
    unsub();
    room = null;
    phase = 'idle';
  }
  function unsub() {
    var c = UI.Net && UI.Net.client && UI.Net.client();
    [pgCh, roomCh].forEach(function (ch) {
      if (ch && c) {
        try {
          c.removeChannel(ch);
        } catch (e) {}
      }
    });
    pgCh = null;
    roomCh = null;
  }

  function myDeckList() {
    var k = UI.getMyDeck && UI.getMyDeck();
    var d = UI.DECKS && UI.DECKS[k];
    return (d && d.list) || [];
  }
  function myDeckKey() {
    return (UI.getMyDeck && UI.getMyDeck()) || '';
  }

  function findMatch() {
    UI.Net.ensureGuest()
      .then(function (s) {
        if (!active) return;
        if (!s) {
          status = '접속 실패 — 게스트 로그인 불가';
          redraw();
          return;
        }
        var nick = (UI.Net.profile() || {}).nickname || 'guest';
        var c = UI.Net.client();
        return c
          .rpc('find_or_create_match', { p_nick: nick, p_deck: myDeckList() })
          .then(function (r) {
            if (!active) return;
            if (r.error) {
              phase = 'error';
              status = '매칭 오류: ' + r.error.message;
              redraw();
              return;
            }
            room = r.data;
            myIdx = room.host === UI.Net.userId() ? 0 : 1;
            // 양쪽 모두 방 채널에 즉시 입장 — presence 로 페어링을 감지(postgres_changes 미의존).
            joinRoomChannel();
            if (room.status === 'full') {
              // 기존 방에 게스트로 입장 — DB 상 full 이어도 호스트 실접속을 presence 로 확인한 뒤
              // 매치를 확정한다(유령 방 즉시 매칭 방지). presence 2 도달 시 sync 에서 toMatched,
              // 6초 내 미도달이면 armGhostCheck 가 폐기 후 재탐색.
              status = '상대 확인 중…';
              armGhostCheck();
            } else {
              status = '상대를 기다리는 중…';
            }
            redraw();
          });
      })
      .catch(function (e) {
        if (!active) return;
        phase = 'error';
        status = '오류: ' + (e && e.message ? e.message : e);
        redraw();
      });
  }

  // room:<id> 채널 — presence 로 양쪽 접속을 감지(핸드셰이크). 2b 게임 동기화도 이 채널 사용.
  // 호스트는 2명이 되는 순간 방 행을 재조회해 게스트 정보(닉/덱)와 full 상태를 확정한다.
  function joinRoomChannel() {
    var c = UI.Net.client();
    roomCh = c
      .channel('room:' + room.id, { config: { presence: { key: UI.Net.userId() || 'me' } } })
      .on('presence', { event: 'sync' }, function () {
        if (!roomCh) return;
        var n = Object.keys(roomCh.presenceState() || {}).length;
        if (matchStarted) { // 대국 중: 상대 이탈(끊김) fallback 감지
          if (n < 2) armDisc(); else disarmDisc();
          return;
        }
        if (!active) return;
        bothReady = n >= 2;
        if (n >= 2) {
          disarmGhostCheck(); // 상대 실접속 확인 — 유령 판정 취소
          if (phase !== 'matched') refetchRoom();
          else redraw();
        } else redraw();
      })
      // 대전 시작 신호(호스트 → 게스트) + 대전 행동 릴레이(2b). active 와 무관하게 처리.
      .on('broadcast', { event: 'begin' }, function () {
        if (!matchStarted) beginOnline();
      })
      .on('broadcast', { event: 'act' }, function (m) {
        if (matchStarted && UI.applyRemoteAction) UI.applyRemoteAction(m && m.payload);
      })
      .subscribe(function (st) {
        if (st === 'SUBSCRIBED') {
          try {
            roomCh.track({ idx: myIdx, nick: (UI.Net.profile() || {}).nickname || 'guest' });
          } catch (e) {}
        }
      });
  }

  // 호스트가 게스트 입장 감지 시 방 행 재조회 → 게스트 정보 확보 + full 확정
  function refetchRoom() {
    var c = UI.Net.client();
    c.from('rooms').select('*').eq('id', room.id).maybeSingle()
      .then(function (r) {
        if (!active) return;
        if (r.data) {
          room = r.data;
          if (room.status === 'full') toMatched();
        }
        redraw();
      })
      .catch(function () { if (active) redraw(); });
  }

  // 대국 시작(호스트 클릭 or 게스트가 begin 수신) — 양쪽이 같은 방정보로 결정적 엔진 구동
  function beginOnline() {
    if (matchStarted || !room) return;
    matchStarted = true;
    active = false; // 매치메이킹 화면 종료 → core 가 renderMatch 로 대국 보드 표시
    var oppNick = myIdx === 0 ? room.guest_nick : room.host_nick;
    var myNick = (UI.Net && UI.Net.profile && (UI.Net.profile() || {}).nickname) || (myIdx === 0 ? room.host_nick : room.guest_nick) || 'guest';
    UI.startOnlineMatch({
      deck0: room.host_deck,
      deck1: room.guest_deck,
      seed: room.seed,
      first: room.first_player,
      myIdx: myIdx,
      oppNick: oppNick,
      myNick: myNick,
      oppProfile: oppProfile,
      myProfile: (UI.Net && UI.Net.profile && UI.Net.profile()) || null,
      send: function (msg) {
        try {
          if (roomCh) roomCh.send({ type: 'broadcast', event: 'act', payload: msg });
        } catch (e) {}
      },
    });
  }

  // ── OnlineAdapter 심 — 2b 대전 동기화가 여기에 연결됨
  UI.Online = {
    currentRoom: function () { return room; },
    myIndex: function () { return myIdx; },
    channel: function () { return roomCh; },
    ready: function () { return bothReady; },
    started: function () { return matchStarted; },
    code: function () { return roomCode; },
    teardown: function () {
      matchStarted = false;
      disarmDisc();
      disarmGhostCheck();
      cleanup();
    },
  };

  // ─────────────────────────────────────────── 뷰
  function redraw() {
    if (!active) return;
    var app = UI.app,
      clear = UI.clear;
    clear();
    var p = pal();
    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    b.appendChild(
      el('div', {
        style: {
          fontWeight: 700, color: p.amb, fontSize: '13px', letterSpacing: '.08em',
          borderBottom: '1px solid ' + p.line, paddingBottom: '7px', marginBottom: '14px',
        },
      }, [mode === 'custom' ? '▸ 커스텀 매치 · CUSTOM' : '▸ 매치메이킹 · MATCHMAKING'])
    );

    if (phase === 'offline') {
      b.appendChild(el('div', { style: { fontSize: '12px', lineHeight: 1.7, color: p.dim } }, [
        'config.js 에 Supabase 키를 넣고 0003_rooms.sql 을 적용하면 멀티플레이 매칭이 활성화됩니다.',
      ]));
      b.appendChild(navRow(p, [backBtn(p)]));
    } else if (phase === 'custommenu') {
      b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, lineHeight: 1.6, marginBottom: '14px' } }, [
        '친구와 1:1 비공개 대전. 방을 만들어 코드를 공유하거나, 받은 코드로 참여하세요.',
      ]));
      b.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        el('button', { class: 'crt-btn', onclick: startCreate, style: { fontSize: '14px' } }, ['🔒 방 만들기 (코드 생성)']),
        el('button', { class: 'crt-btn ghost', onclick: function () { phase = 'joinform'; status = ''; codeInput = ''; redraw(); }, style: { fontSize: '14px' } }, ['🔑 코드로 참여']),
      ]));
      b.appendChild(navRow(p, [backBtn(p)]));
    } else if (phase === 'creating' || phase === 'joining') {
      b.appendChild(el('div', { style: { fontSize: '15px', color: p.amb, fontWeight: 700, margin: '14px 0' } }, [
        phase === 'creating' ? '방 만드는 중…' : '참여하는 중…', el('span', { class: 'crt-cursor' }),
      ]));
      b.appendChild(navRow(p, [el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['취소'])]));
    } else if (phase === 'waitcode') {
      b.appendChild(el('div', { style: { textAlign: 'center', margin: '6px 0 4px' } }, [
        el('div', { style: { fontSize: '12px', color: p.dim, marginBottom: '6px' } }, ['이 코드를 친구에게 공유하세요']),
        el('div', { class: 'grot', style: { fontSize: '44px', fontWeight: 700, letterSpacing: '.32em', color: p.hi, margin: '4px 0 4px', paddingLeft: '.32em' } }, [roomCode]),
        el('div', { style: { fontSize: '12px', color: bothReady ? p.ok : p.dim, marginTop: '8px' } }, [bothReady ? '● 상대 입장 — 준비 완료' : '○ 상대 입장 대기 중…', el('span', { class: 'crt-cursor' })]),
      ]));
      b.appendChild(navRow(p, [el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['취소'])]));
    } else if (phase === 'joinform') {
      b.appendChild(el('div', { style: { fontSize: '12px', color: p.dim, marginBottom: '10px' } }, ['친구가 만든 방 코드를 입력하세요']));
      b.appendChild(el('input', {
        id: 'join-code', type: 'text', maxlength: '8', placeholder: '예: AB2K', value: codeInput,
        oninput: function (e) { codeInput = (e.target.value || '').toUpperCase(); e.target.value = codeInput; },
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); submitJoin(); } },
        style: { width: '100%', textAlign: 'center', letterSpacing: '.3em', background: 'transparent', border: '1px solid ' + p.line, color: p.amb, padding: '11px', fontFamily: "'Space Mono',monospace", fontSize: '22px', fontWeight: 700, outline: 'none', marginBottom: '8px' },
      }));
      if (status) b.appendChild(el('div', { style: { fontSize: '12px', color: p.hi, marginBottom: '6px' } }, [status]));
      b.appendChild(navRow(p, [
        el('button', { class: 'crt-btn', onclick: submitJoin, style: { fontSize: '13px' } }, ['참여']),
        el('button', { class: 'crt-btn ghost', onclick: function () { phase = 'custommenu'; status = ''; redraw(); }, style: { fontSize: '13px' } }, ['◂ 뒤로']),
      ]));
    } else if (phase === 'matched') {
      b.appendChild(matchedView(p));
    } else if (phase === 'error') {
      b.appendChild(el('div', { style: { fontSize: '13px', color: p.hi, marginBottom: '14px' } }, [status || '오류']));
      b.appendChild(navRow(p, [
        el('button', { class: 'crt-btn ghost', onclick: retry, style: { fontSize: '13px' } }, ['다시 찾기']),
        backBtn(p),
      ]));
    } else {
      // search — 상대 대기 화면(디자인 중앙 정렬, #1)
      b.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '20px 0 8px' } }, [
        el('div', { style: { fontSize: '15px', color: p.amb, fontWeight: 700, margin: '10px 0 4px' } }, [
          (status || '상대를 찾는 중…'),
          el('span', { class: 'crt-cursor' }),
        ]),
        el('div', { style: { fontSize: '12px', color: p.dim, marginBottom: '18px', maxWidth: '360px', lineHeight: 1.6 } }, [
          '내 덱 ▸ ',
          el('b', { style: { color: p.hi } }, [myDeckKey() || '(없음)']),
          ' · 상대가 들어오면 자동으로 매칭됩니다.',
        ]),
        el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } }, [
          el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['취소']),
        ]),
      ]));
    }

    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);
  }

  // 프로필 미니 카드 — 닉네임 + 전적(승/패/무) + 승률 게이지(기능 4, 대국 전)
  function profileCard(p, nick, prof, mine) {
    var accent = mine ? p.hi : p.amb;
    var kids = [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' } }, [
        el('span', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: p.dim, letterSpacing: '.08em' } }, [mine ? '나' : '상대']),
        (prof && prof.is_guest) ? el('span', { style: { fontSize: '9px', color: p.dim, border: '1px solid ' + p.line, padding: '1px 4px' } }, ['게스트']) : null,
      ]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } }, [
        (UI.avatarEl ? UI.avatarEl({ nickname: nick, avatar: prof && prof.avatar }, 34) : null),
        el('div', { class: 'grot', style: { fontSize: '16px', fontWeight: 700, color: accent, wordBreak: 'break-all', lineHeight: 1.2, minWidth: 0 } }, [nick || '???']),
      ]),
    ];
    if (!prof) {
      kids.push(el('div', { style: { fontSize: '11px', color: p.dim } }, ['전적 불러오는 중…']));
    } else {
      var g = prof.games || 0, w = prof.wins || 0, l = prof.losses || 0, d = prof.draws || 0;
      var rate = g ? Math.round((w / g) * 100) : 0;
      kids.push(el('div', { style: { fontSize: '12px', color: p.amb, marginBottom: '5px' } }, [
        g + '판 · ', el('b', { style: { color: accent } }, [w + '승']), ' ' + l + '패 ' + d + '무',
      ]));
      kids.push(el('div', { style: { fontSize: '11px', color: p.dim, marginBottom: '4px' } }, ['승률 ', el('b', { style: { color: accent } }, [rate + '%'])]));
      kids.push(el('div', { style: { height: '6px', border: '1px solid ' + p.line, position: 'relative', overflow: 'hidden' } }, [
        el('div', { style: { position: 'absolute', inset: '0', width: rate + '%', background: accent, opacity: '.7' } }),
      ]));
    }
    return el('div', { style: { flex: 1, minWidth: '0', border: '1px solid ' + p.line, padding: '10px 12px', background: mine ? 'transparent' : 'rgba(127,127,127,.04)' } }, kids);
  }

  function matchedView(p) {
    ensureOppProfile();
    var oppNick = myIdx === 0 ? room.guest_nick : room.host_nick;
    var myNick = (UI.Net && UI.Net.profile && (UI.Net.profile() || {}).nickname) || (myIdx === 0 ? room.host_nick : room.guest_nick) || 'guest';
    var myDeck = myIdx === 0 ? room.host_deck : room.guest_deck;
    var oppDeck = myIdx === 0 ? room.guest_deck : room.host_deck;
    var iFirst = room.first_player === myIdx;
    var wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '22px', color: p.hi, margin: '6px 0 12px' } }, ['✔ 매치 성사!']));
    // 프로필 대결 카드(나 vs 상대)
    wrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'stretch', gap: '8px', margin: '0 0 14px' } }, [
      profileCard(p, myNick, (UI.Net && UI.Net.profile && UI.Net.profile()) || null, true),
      el('div', { class: 'grot', style: { fontSize: '13px', fontWeight: 700, color: p.dim, alignSelf: 'center', flex: 'none' } }, ['VS']),
      profileCard(p, oppNick, oppProfile, false),
    ]));
    wrap.appendChild(infoRow(p, '내 덱', myDeckKey() + ' (' + ((myDeck || []).length) + '장)'));
    wrap.appendChild(infoRow(p, '상대 덱', (oppDeck || []).length + '장'));
    wrap.appendChild(infoRow(p, '선공', iFirst ? '나' : '상대'));
    wrap.appendChild(infoRow(p, 'SEED', String(room.seed)));
    wrap.appendChild(
      el('div', { style: { fontSize: '12px', margin: '12px 0 4px', color: bothReady ? p.ok : p.dim } }, [
        bothReady ? '● 양쪽 실시간 연결됨 — 대전 준비 완료' : '○ 상대 실시간 연결 대기…',
      ])
    );
    var startCtl;
    if (myIdx === 0) {
      startCtl = el('button', {
        class: 'crt-btn', disabled: !bothReady,
        onclick: function () {
          if (!bothReady) return;
          try { if (roomCh) roomCh.send({ type: 'broadcast', event: 'begin', payload: {} }); } catch (e) {}
          beginOnline();
        },
        style: { fontSize: '13px', opacity: bothReady ? '1' : '.5', cursor: bothReady ? 'pointer' : 'default' },
      }, ['▶ 대전 시작']);
    } else {
      startCtl = el('div', { style: { fontSize: '12px', color: p.dim, alignSelf: 'center' } }, [
        bothReady ? '호스트가 시작하기를 기다리는 중…' : '연결 대기…',
      ]);
    }
    wrap.appendChild(navRow(p, [
      startCtl,
      el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['나가기']),
    ]));
    return wrap;
  }

  function infoRow(p, k, v) {
    return el('div', { style: { display: 'flex', gap: '10px', fontSize: '13px', padding: '3px 0', lineHeight: 1.6 } }, [
      el('span', { style: { color: p.dim, minWidth: '58px', fontWeight: 700 } }, [k]),
      el('span', { style: { color: p.amb } }, [v]),
    ]);
  }
  function navRow(p, kids) {
    return el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' } }, kids);
  }
  function backBtn(p) {
    return el('button', { class: 'crt-btn ghost', onclick: leave, style: { fontSize: '13px' } }, ['◂ 뒤로']);
  }
  function retry() {
    disarmGhostCheck();
    unsub();
    status = '';
    room = null;
    if (mode === 'custom') { phase = 'custommenu'; redraw(); return; }
    phase = 'search';
    redraw();
    findMatch();
  }

  UI.renderMatchmaking = enter;
  UI.renderCustom = enterCustom;
  UI.redrawMatchmaking = redraw;
  UI.leaveMatchmaking = leave;
  UI.isMatchmakingActive = function () {
    return active;
  };
})();
