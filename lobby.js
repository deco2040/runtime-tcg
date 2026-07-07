/* RUNTIME TCG — 멀티플레이 로비 (기능 1: 로비 대시보드 + 공개 채팅).
 *
 * 레트로 PC 대시보드: 좌측 = 프로필 카드(닉/회원·통계·승률) + 견본/커스텀 덱 선택 +
 * 매치메이킹·커스텀 매치 버튼, 우측 = 공개 채팅 사이드 패널. 좁은 화면에선 세로로 스택.
 * CRT 터미널 스킨(index.html 의 .crt-* 클래스, title.js 와 동일 톤). 게스트 자동 입장
 * (UI.Net.ensureGuest) → 최근 메시지 로드 + Supabase Realtime 구독 + 전송.
 * 백엔드 미설정 시 채팅/매칭은 우아하게 비활성(덱 선택·프로필은 로컬로 계속 동작).
 *
 * 라우팅: core.render() 가 UI.isLobbyActive() 로 분기(테마 전환 시 redraw 재사용).
 *   UI.renderLobby  = enterLobby (진입: 접속 + 구독 1회)
 *   UI.redrawLobby  = 순수 뷰 재그리기(테마 전환·덱 선택 등)
 *   UI.leaveLobby   = 정리 + 타이틀 복귀
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});
  var RT = window.RT;

  var active = false;
  var channel = null;
  var msgs = [];
  var presenceCount = 0;
  var status = ''; // 상태줄 텍스트('' 이면 정상)
  var draft = ''; // 입력 중 텍스트(재그리기에도 유지)
  var listEl = null; // 메시지 리스트 컨테이너(증분 append 용)
  var sending = false;
  var MAX_KEEP = 200; // 메모리에 유지할 최대 메시지 수

  // 덱 계열 글리프(title.js 와 동일)
  var GLY = { thread: '▲', memory: '■', process: '◇', generic: '●', mixed: '◆', none: '▦' };

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
      faint: dark ? 'rgba(255,176,0,.06)' : 'rgba(29,29,36,.04)',
      me: dark ? '#7ad0ff' : '#1a5fa8',
      ok: dark ? '#7ad0ff' : '#1a5fa8',
      bad: dark ? '#ff8a6a' : '#c0392b',
    };
  }

  // 통계 소스 — 세션 있으면 클라우드(profiles), 아니면 localStorage 로컬 기록(auth.js 와 동일)
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

  // ─────────────────────────────────────────── 진입 / 정리
  function enterLobby() {
    active = true;
    if (UI.exitToGuide) UI.exitToGuide(); // 게임 상태(G) 클리어 → render() 라우팅 안전
    status = UI.Net && UI.Net.enabled ? '접속 중…' : '';
    msgs = [];
    presenceCount = 0;
    redraw();
    connect();
  }

  function leaveLobby() {
    cleanup();
    active = false;
    if (UI.renderTitle) UI.renderTitle();
  }

  // 다른 화면(계정/덱빌더/매칭)으로 이탈 — 로비 정리 후 콜백
  function goTo(fn) {
    cleanup();
    active = false;
    if (fn) fn();
  }

  function cleanup() {
    if (channel) {
      try {
        var c = UI.Net && UI.Net.client && UI.Net.client();
        if (c && c.removeChannel) c.removeChannel(channel);
        else if (channel.unsubscribe) channel.unsubscribe();
      } catch (e) {}
      channel = null;
    }
  }

  // ─────────────────────────────────────────── 백엔드 접속
  function connect() {
    if (!UI.Net || !UI.Net.enabled) {
      redraw();
      return;
    }
    UI.Net.ensureGuest()
      .then(function (s) {
        if (!active) return; // 그새 나갔으면 중단
        if (!s) {
          status = '접속 실패 — 게스트 로그인이 비활성화됐을 수 있어요';
          redraw();
          return;
        }
        return loadRecent().then(subscribe);
      })
      .catch(function (e) {
        if (!active) return;
        status = '오류: ' + (e && e.message ? e.message : e);
        redraw();
      });
  }

  function loadRecent() {
    var c = UI.Net.client();
    return c
      .from('lobby_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(function (r) {
        if (r.error) throw r.error;
        msgs = (r.data || []).slice().reverse();
        redraw(true);
      });
  }

  function subscribe() {
    var c = UI.Net.client();
    var me = UI.Net.profile();
    channel = c
      .channel('lobby', { config: { presence: { key: UI.Net.userId() || 'anon' } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lobby_messages' },
        function (payload) {
          if (!active) return;
          pushMsg(payload.new);
        }
      )
      .on('presence', { event: 'sync' }, function () {
        if (!active || !channel) return;
        var st = channel.presenceState();
        presenceCount = Object.keys(st || {}).length;
        updateHeader();
      })
      .subscribe(function (st) {
        if (!active) return;
        if (st === 'SUBSCRIBED') {
          status = '';
          try {
            channel.track({ nick: (me && me.nickname) || 'guest' });
          } catch (e) {}
          redraw(true);
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
          status = '실시간 연결 오류 — 새로고침 해보세요';
          redraw();
        }
      });
  }

  // 새 메시지 반영 — 리스트가 화면에 있으면 증분 append(입력 포커스 유지), 아니면 전체 재그리기
  function pushMsg(m) {
    msgs.push(m);
    if (msgs.length > MAX_KEEP) msgs.shift();
    if (listEl && document.body.contains(listEl)) {
      var atBottom =
        listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
      listEl.appendChild(msgRow(m));
      if (atBottom) listEl.scrollTop = listEl.scrollHeight;
    } else {
      redraw(true);
    }
  }

  // ─────────────────────────────────────────── 전송
  function send() {
    var text = draft.trim();
    if (!text || sending) return;
    if (!UI.Net || !UI.Net.enabled) return;
    var c = UI.Net.client();
    var uid = UI.Net.userId();
    var me = UI.Net.profile();
    if (!c || !uid) return;
    sending = true;
    draft = '';
    var input = document.getElementById('lobby-input');
    if (input) input.value = '';
    c.from('lobby_messages')
      .insert({
        user_id: uid,
        nickname: (me && me.nickname) || 'guest',
        body: text.slice(0, 500),
      })
      .then(function (r) {
        sending = false;
        if (r.error) {
          status = '전송 실패: ' + r.error.message;
          draft = text; // 되돌림
          redraw();
        }
        // 성공 시엔 Realtime INSERT 로 자기 메시지가 되돌아오므로 로컬 추가 안 함(중복 방지)
      })
      .catch(function (e) {
        sending = false;
        status = '전송 실패: ' + (e && e.message ? e.message : e);
        draft = text;
        redraw();
      });
    var inp = document.getElementById('lobby-input');
    if (inp) inp.focus();
  }

  // ─────────────────────────────────────────── 채팅 행/헤더
  function msgRow(m) {
    var p = pal();
    var mine = UI.Net && UI.Net.userId && m.user_id === UI.Net.userId();
    return el(
      'div',
      {
        style: {
          padding: '3px 2px',
          fontSize: '12px',
          lineHeight: 1.5,
          wordBreak: 'break-word',
        },
      },
      [
        el(
          'span',
          {
            style: {
              fontWeight: 700,
              color: mine ? p.me : p.hi,
              marginRight: '7px',
            },
          },
          [(m.nickname || 'guest') + (mine ? ' (나)' : '')]
        ),
        el('span', { style: { color: p.amb } }, [String(m.body || '')]),
      ]
    );
  }

  function updateHeader() {
    var badge = document.getElementById('lobby-online');
    if (badge) badge.textContent = '● ONLINE ' + (presenceCount || 1);
  }

  // ─────────────────────────────────────────── 프로필 카드
  function statTile(p, label, value, color) {
    return el(
      'div',
      {
        style: {
          flex: '1 1 0',
          minWidth: '0',
          textAlign: 'center',
          border: '1px solid ' + p.line,
          padding: '6px 4px 5px',
          background: p.faint,
        },
      },
      [
        el(
          'div',
          {
            class: 'grot',
            style: { fontSize: '19px', fontWeight: 700, lineHeight: 1.05, color: color || p.hi },
          },
          [value]
        ),
        el(
          'div',
          { style: { fontSize: '9px', letterSpacing: '.12em', color: p.dim, marginTop: '3px' } },
          [label]
        ),
      ]
    );
  }

  function profileCard(p) {
    var me = UI.Net && UI.Net.profile && UI.Net.profile();
    var isMember = UI.Net && UI.Net.isMember && UI.Net.isMember();
    var nick = (me && me.nickname) || (UI.Net && UI.Net.enabled ? '접속 중…' : 'guest');
    var s = curStats();
    var rate = s.games > 0 ? Math.round((s.wins / s.games) * 100) + '%' : '—';

    var card = el('div', {
      style: {
        border: '1px solid ' + p.line,
        padding: '11px 12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
    });

    // 상단: 아바타 + 닉/뱃지 + 계정 버튼
    card.appendChild(
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '11px' } }, [
        (UI.avatarEl ? UI.avatarEl(me || { nickname: nick }, 40) : el('div', { class: 'grot', style: { width: '40px', height: '40px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: p.hi, border: '1px solid ' + p.line, background: p.faint } }, [isMember ? '◈' : '◇'])),
        el('div', { style: { flex: 1, minWidth: 0 } }, [
          el(
            'div',
            {
              class: 'grot',
              style: {
                fontSize: '16px', fontWeight: 700, color: p.hi,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            },
            [nick]
          ),
          el('div', { style: { fontSize: '10px', color: p.dim, letterSpacing: '.06em', marginTop: '2px' } }, [
            (isMember ? '● 정회원' : '○ 게스트') + '  ·  ' + (s.src === 'cloud' ? 'CLOUD' : 'LOCAL') + ' 기록',
          ]),
        ]),
        el(
          'button',
          {
            onclick: function () {
              if (UI.renderAuth) goTo(function () { UI.renderAuth('lobby'); });
            },
            class: 'crt-opt',
            style: { fontSize: '10px', flex: 'none', padding: '6px 9px' },
          },
          [isMember ? '👤 계정' : '👤 로그인']
        ),
      ])
    );

    // 통계 타일 4개
    card.appendChild(
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        statTile(p, 'GAMES', String(s.games), p.hi),
        statTile(p, 'WINS', String(s.wins), p.ok),
        statTile(p, 'LOSSES', String(s.losses), p.bad),
        statTile(p, 'WIN RATE', rate, p.amb),
      ])
    );
    return card;
  }

  // ─────────────────────────────────────────── 덱 선택
  function deckLabel(p, t) {
    return el('div', {
      style: {
        fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: '11px',
        letterSpacing: '.14em', color: p.amb, margin: '2px 0',
      },
    }, [t]);
  }

  function deckTile(p, k, sel, onClick, extra) {
    var d = UI.DECKS && UI.DECKS[k];
    if (!d) return null;
    // 구성별 대표색으로 글리프 틴트(메인 페이지와 동일). core 헬퍼 우선, 없으면 d.cls.
    var ccls = (UI.deckCoverCls ? UI.deckCoverCls(d.list) : d.cls) || 'generic';
    var col = (UI.CLS && UI.CLS[ccls]) || null;
    var gly = GLY[ccls] || GLY[d.cls] || GLY.generic;
    // 좌측 대표 카드 썸네일(메인과 동일한 coverThumb) + 우측 이름 열.
    var thumb = UI.deckCoverThumb ? UI.deckCoverThumb(d, 38) : null;
    var textCol = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1 1 auto' } }, [
      el('span', { style: { fontSize: '12px', fontWeight: 700, letterSpacing: '.04em', color: col || undefined } }, [(sel ? '▶ ' : '') + gly + ' ' + k]),
      el('span', {
        style: {
          fontSize: '10px', opacity: '.72',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      }, [(d.name || '(이름 없음)').replace(/^\w+ · /, '')]),
    ]);
    var kids = thumb ? [thumb, textCol] : [textCol];
    if (extra) kids.push(extra);
    return el('div', {
      onclick: onClick,
      class: 'crt-opt' + (sel ? ' on' : ''),
      style: {
        position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px',
        textAlign: 'left', cursor: 'pointer', paddingRight: extra ? '26px' : undefined, minHeight: '52px',
      },
    }, kids);
  }

  function deckGridBox() {
    return el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(158px,1fr))',
        gap: '6px', margin: '6px 0 12px',
      },
    });
  }

  function deckSection(p) {
    var wrap = el('div', {});
    var myDeck = UI.getMyDeck && UI.getMyDeck();
    var presets = (UI.presetKeys && UI.presetKeys()) || [];
    var customs = (UI.customKeys && UI.customKeys()) || [];

    // 견본 덱
    wrap.appendChild(deckLabel(p, '▸ 견본 덱 · SAMPLE'));
    var pg = deckGridBox();
    presets.forEach(function (k) {
      var t = deckTile(p, k, k === myDeck, function () { UI.setMyDeck(k); redraw(); });
      if (t) pg.appendChild(t);
    });
    wrap.appendChild(pg);

    // 커스텀 덱 + 새 덱 만들기
    wrap.appendChild(deckLabel(p, '▸ 커스텀 덱 · CUSTOM'));
    var cg = deckGridBox();
    customs.forEach(function (k) {
      var editBtn = el('button', {
        title: '편집',
        onclick: function (e) {
          e.stopPropagation();
          if (UI.openDeckBuilder) goTo(function () { UI.openDeckBuilder(k); });
        },
        style: {
          position: 'absolute', top: '3px', right: '4px', fontSize: '13px',
          padding: '1px 5px', color: 'inherit', background: 'transparent',
        },
      }, ['✎']);
      var t = deckTile(p, k, k === myDeck, function () { UI.setMyDeck(k); redraw(); }, editBtn);
      if (t) cg.appendChild(t);
    });
    cg.appendChild(
      el('button', {
        onclick: function () { if (UI.openDeckBuilder) goTo(function () { UI.openDeckBuilder(null); }); },
        class: 'crt-opt',
        style: {
          display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center',
          justifyContent: 'center', minHeight: '44px', textAlign: 'center', borderStyle: 'dashed',
        },
      }, [
        el('span', { style: { fontSize: '17px', fontWeight: 700, lineHeight: 1 } }, ['＋']),
        el('span', { style: { fontSize: '10px', letterSpacing: '.06em' } }, ['새 덱 만들기']),
      ])
    );
    wrap.appendChild(cg);

    // 선택된 덱 요약
    var d = UI.DECKS && UI.DECKS[myDeck];
    if (d && RT && RT.analyzeDeck) {
      var meta = RT.analyzeDeck(d.list || []);
      wrap.appendChild(
        el('div', {
          style: {
            fontSize: '10px', color: p.dim, lineHeight: 1.6,
            borderTop: '1px solid ' + p.line, paddingTop: '7px',
          },
        }, [
          '선택 ▸ ',
          el('span', { style: { color: p.hi, fontWeight: 700 } }, [(d.name || myDeck).replace(/^\w+ · /, '')]),
          '  ·  ' + (d.list || []).length + '장  ·  ' +
            (meta.singleClass ? 'single-class' : 'mixed'),
        ])
      );
    }
    return wrap;
  }

  // ─────────────────────────────────────────── 매치 버튼
  function actionButtons(p) {
    var on = !!(UI.Net && UI.Net.enabled);
    var mk = el('button', {
      class: 'crt-btn',
      disabled: !on,
      onclick: function () {
        if (!on) return;
        if (UI.Sound) UI.Sound.ui();
        if (UI.renderMatchmaking) goTo(UI.renderMatchmaking);
      },
      style: { flex: '1 1 160px', fontSize: '14px', textAlign: 'center', opacity: on ? '1' : '.5', cursor: on ? 'pointer' : 'default' },
    }, ['⚔ 매치메이킹']);
    var cs = el('button', {
      class: 'crt-btn ghost',
      disabled: !on,
      onclick: function () {
        if (on && UI.renderCustom) goTo(UI.renderCustom);
      },
      style: { flex: '1 1 160px', fontSize: '14px', textAlign: 'center', opacity: on ? '1' : '.5', cursor: on ? 'pointer' : 'default' },
    }, ['🔒 커스텀 매치']);
    // 리더보드 — 백엔드 미설정이어도 진입 가능(오프라인 안내 표시). 항상 활성.
    var lb = el('button', {
      class: 'crt-btn ghost',
      onclick: function () {
        if (UI.Sound) UI.Sound.ui();
        if (UI.renderLeaderboard) goTo(UI.renderLeaderboard);
      },
      style: { flex: '1 1 160px', fontSize: '14px', textAlign: 'center' },
    }, ['🏆 리더보드']);
    return el('div', { style: { display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '2px' } }, [mk, cs, lb]);
  }

  // ─────────────────────────────────────────── 채팅 사이드 패널
  function chatPanel(p) {
    var panel = el('div', {
      style: {
        flex: '1 1 250px', minWidth: 0, display: 'flex', flexDirection: 'column',
        border: '1px solid ' + p.line,
      },
    });

    // 패널 헤더
    panel.appendChild(
      el('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '10px', letterSpacing: '.1em', color: p.dim,
          padding: '7px 9px', borderBottom: '1px solid ' + p.line,
        },
      }, [
        el('span', { style: { fontWeight: 700, color: p.amb } }, ['💬 채팅 · CHAT']),
        el('span', { id: 'lobby-online' }, ['● ONLINE ' + (presenceCount || 1)]),
      ])
    );

    if (!UI.Net || !UI.Net.enabled) {
      panel.appendChild(offlinePanel(p));
      return panel;
    }

    // 메시지 리스트
    listEl = el('div', {
      id: 'lobby-list',
      style: {
        flex: 1, minHeight: '200px', maxHeight: '46vh', overflowY: 'auto',
        padding: '7px 9px',
      },
    });
    if (!msgs.length) {
      listEl.appendChild(
        el('div', { style: { color: p.dim, fontSize: '12px', padding: '8px 2px' } }, [
          status || '아직 메시지가 없어요 — 첫 인사를 남겨보세요.',
        ])
      );
    } else {
      msgs.forEach(function (m) { listEl.appendChild(msgRow(m)); });
    }
    panel.appendChild(listEl);

    // 상태줄(있으면)
    if (status) {
      panel.appendChild(
        el('div', {
          style: { fontSize: '10px', color: p.dim, padding: '0 9px 4px', minHeight: '13px' },
        }, [status])
      );
    }

    // 입력 + 전송
    var input = el('input', {
      id: 'lobby-input',
      type: 'text',
      maxlength: '500',
      placeholder: '메시지… (Enter)',
      value: draft,
      oninput: function (e) { draft = e.target.value; },
      onkeydown: function (e) {
        if (e.key === 'Enter') { e.preventDefault(); send(); }
      },
      style: {
        flex: 1, minWidth: 0, background: 'transparent', border: 'none',
        borderTop: '1px solid ' + p.line, color: p.amb,
        padding: '9px 10px', fontFamily: "'Space Mono',monospace", fontSize: '12px', outline: 'none',
      },
    });
    panel.appendChild(
      el('div', { style: { display: 'flex', alignItems: 'stretch', borderTop: '1px solid ' + p.line } }, [
        input,
        el('button', {
          onclick: send,
          style: {
            flex: 'none', color: p.amb, fontWeight: 700, fontSize: '12px',
            background: 'transparent', border: 'none', borderLeft: '1px solid ' + p.line,
            padding: '0 14px', cursor: 'pointer', fontFamily: "'Space Mono',monospace",
          },
        }, ['전송']),
      ])
    );
    return panel;
  }

  function offlinePanel(p) {
    return el(
      'div',
      { style: { padding: '13px', fontSize: '11px', lineHeight: 1.7, color: p.amb } },
      [
        el('div', { style: { fontWeight: 700, color: p.hi, marginBottom: '7px' } }, [
          '⚠ 멀티플레이 백엔드 미설정',
        ]),
        el('div', { style: { color: p.dim } }, [
          'config.js 에 Supabase URL·anon 키를 넣으면 채팅과 온라인 매칭이 활성화됩니다. ',
          '익명 로그인(Authentication → Providers → Anonymous)도 켜야 게스트 입장이 됩니다.',
        ]),
      ]
    );
  }

  // ─────────────────────────────────────────── 전체 재그리기
  // scrollBottom=true 면 채팅 리스트를 맨 아래로.
  function redraw(scrollBottom) {
    if (!active) return;
    var app = UI.app, clear = UI.clear;
    // 입력값 보존
    var live = document.getElementById('lobby-input');
    if (live) draft = live.value;
    clear();
    var p = pal();

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    // 헤더
    b.appendChild(
      el('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: p.dim,
          letterSpacing: '.08em', borderBottom: '1px solid ' + p.line,
          paddingBottom: '7px', marginBottom: '13px',
        },
      }, [
        el('span', { style: { fontWeight: 700, color: p.amb } }, ['▸ 멀티플레이 로비 · LOBBY']),
        el('span', {}, ['RUNTIME OS  v1.0']),
      ])
    );

    // 2단 레이아웃 — 좌: 프로필+덱+버튼, 우: 채팅. 좁으면 wrap 으로 스택.
    var row = el('div', {
      style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'stretch' },
    });

    var main = el('div', {
      style: { flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '13px' },
    });
    main.appendChild(profileCard(p));
    main.appendChild(deckSection(p));
    main.appendChild(actionButtons(p));

    row.appendChild(main);
    row.appendChild(chatPanel(p));
    b.appendChild(row);

    // 하단 네비 — 뒤로
    b.appendChild(
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' } }, [
        el('button', {
          class: 'crt-btn ghost', onclick: leaveLobby, style: { fontSize: '13px' },
        }, ['◂ 뒤로']),
      ])
    );

    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);

    if (scrollBottom && listEl) listEl.scrollTop = listEl.scrollHeight;
    // 입력 포커스 복원(값이 있었으면 커서를 끝으로)
    var inp = document.getElementById('lobby-input');
    if (inp && draft) {
      try {
        inp.focus();
        inp.setSelectionRange(draft.length, draft.length);
      } catch (e) {}
    }
  }

  // ─────────────────────────────────────────── exports
  UI.renderLobby = enterLobby;
  UI.redrawLobby = redraw;
  UI.leaveLobby = leaveLobby;
  UI.isLobbyActive = function () {
    return active;
  };
})();
