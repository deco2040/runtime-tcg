/* RUNTIME TCG — 공개 채팅 로비 (멀티플레이 기능 1).
 *
 * CRT 터미널 스킨(index.html 의 .crt-* 클래스, title.js 와 동일 톤). 게스트 자동 입장
 * (UI.Net.ensureGuest) → 최근 메시지 로드 + Supabase Realtime 구독 + 전송.
 * 백엔드 미설정 시 설정 안내 패널을 표시(우아한 비활성).
 *
 * 라우팅: core.render() 가 UI.isLobbyActive() 로 분기(테마 전환 시 redraw 재사용).
 *   UI.renderLobby  = enterLobby (진입: 접속 + 구독 1회)
 *   UI.redrawLobby  = 순수 뷰 재그리기(테마 전환 등)
 *   UI.leaveLobby   = 정리 + 타이틀 복귀
 */
(function () {
  'use strict';
  var UI = (window.RTUI = window.RTUI || {});

  var active = false;
  var channel = null;
  var msgs = [];
  var presenceCount = 0;
  var status = ''; // 상태줄 텍스트('' 이면 정상)
  var draft = ''; // 입력 중 텍스트(재그리기에도 유지)
  var listEl = null; // 메시지 리스트 컨테이너(증분 append 용)
  var sending = false;
  var MAX_KEEP = 200; // 메모리에 유지할 최대 메시지 수

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
      me: dark ? '#7ad0ff' : '#1a5fa8',
    };
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

  // ─────────────────────────────────────────── 뷰
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
    if (badge)
      badge.textContent = '● ONLINE ' + (presenceCount || 1);
  }

  // 전체 재그리기. scrollBottom=true 면 리스트를 맨 아래로.
  function redraw(scrollBottom) {
    if (!active) return;
    var app = UI.app,
      clear = UI.clear;
    // 입력값 보존
    var live = document.getElementById('lobby-input');
    if (live) draft = live.value;
    clear();
    var p = pal();

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', {
      class: 'crt-screen',
      style: { display: 'flex', flexDirection: 'column' },
    });
    var b = el('div', {
      class: 'crt-body',
      style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
    });

    // 헤더
    b.appendChild(
      el(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            fontSize: '11px',
            color: p.dim,
            letterSpacing: '.08em',
            borderBottom: '1px solid ' + p.line,
            paddingBottom: '7px',
            marginBottom: '10px',
          },
        },
        [
          el('span', { style: { fontWeight: 700, color: p.amb } }, [
            '▸ 공개 로비 · LOBBY',
          ]),
          el('span', { id: 'lobby-online' }, [
            '● ONLINE ' + (presenceCount || 1),
          ]),
        ]
      )
    );

    // 내 닉네임 줄
    var me = UI.Net && UI.Net.profile && UI.Net.profile();
    var isMember = UI.Net && UI.Net.isMember && UI.Net.isMember();
    b.appendChild(
      el(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: p.dim,
            marginBottom: '8px',
          },
        },
        [
          el('span', {}, [
            '나 ▸ ',
            el('span', { style: { color: p.hi, fontWeight: 700 } }, [
              (me && me.nickname) || (UI.Net && UI.Net.enabled ? '접속 중…' : 'guest'),
            ]),
            isMember ? ' · 정회원' : ' · 게스트',
          ]),
          el(
            'button',
            {
              onclick: function () {
                if (UI.renderAuth) { cleanup(); active = false; UI.renderAuth('lobby'); }
              },
              style: {
                color: p.amb,
                fontSize: '11px',
                fontWeight: 700,
                background: 'transparent',
                border: '1px solid ' + p.line,
                padding: '3px 8px',
                cursor: 'pointer',
              },
            },
            [isMember ? '👤 계정' : '👤 로그인']
          ),
        ]
      )
    );

    if (!UI.Net || !UI.Net.enabled) {
      b.appendChild(offlinePanel(p));
    } else {
      // 메시지 리스트
      listEl = el('div', {
        id: 'lobby-list',
        style: {
          flex: 1,
          minHeight: '220px',
          maxHeight: '48vh',
          overflowY: 'auto',
          border: '1px solid ' + p.line,
          padding: '6px 8px',
          marginBottom: '9px',
        },
      });
      if (!msgs.length) {
        listEl.appendChild(
          el(
            'div',
            { style: { color: p.dim, fontSize: '12px', padding: '8px 2px' } },
            [status || '아직 메시지가 없어요 — 첫 인사를 남겨보세요.']
          )
        );
      } else {
        msgs.forEach(function (m) {
          listEl.appendChild(msgRow(m));
        });
      }
      b.appendChild(listEl);

      // 상태줄(있으면)
      if (status) {
        b.appendChild(
          el(
            'div',
            {
              style: {
                fontSize: '11px',
                color: p.dim,
                marginBottom: '6px',
                minHeight: '14px',
              },
            },
            [status]
          )
        );
      }

      // 입력 + 전송
      var input = el('input', {
        id: 'lobby-input',
        type: 'text',
        maxlength: '500',
        placeholder: '메시지 입력… (Enter 전송)',
        value: draft,
        oninput: function (e) {
          draft = e.target.value;
        },
        onkeydown: function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        },
        style: {
          flex: 1,
          background: 'transparent',
          border: '1px solid ' + p.line,
          color: p.amb,
          padding: '9px 11px',
          fontFamily: "'Space Mono',monospace",
          fontSize: '13px',
          outline: 'none',
        },
      });
      b.appendChild(
        el(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'stretch' } },
          [
            input,
            el(
              'button',
              { class: 'crt-btn', onclick: send, style: { fontSize: '13px' } },
              ['전송'],
            ),
          ]
        )
      );
    }

    // 하단 네비 — 뒤로 / 매치메이킹(준비중)
    b.appendChild(
      el(
        'div',
        {
          style: {
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            marginTop: '14px',
          },
        },
        [
          el(
            'button',
            {
              class: 'crt-btn ghost',
              onclick: leaveLobby,
              style: { fontSize: '13px' },
            },
            ['◂ 뒤로'],
          ),
          el(
            'button',
            {
              class: 'crt-btn ghost',
              onclick: function () {
                if (UI.renderMatchmaking) { cleanup(); active = false; UI.renderMatchmaking(); }
              },
              style: { fontSize: '13px' },
            },
            ['⚔ 매치메이킹'],
          ),
          el(
            'button',
            {
              class: 'crt-btn ghost',
              onclick: function () {
                if (UI.renderCustom) { cleanup(); active = false; UI.renderCustom(); }
              },
              style: { fontSize: '13px' },
            },
            ['🔒 커스텀 매치'],
          ),
        ]
      )
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

  function offlinePanel(p) {
    return el(
      'div',
      {
        style: {
          border: '1px solid ' + p.line,
          padding: '16px',
          fontSize: '12px',
          lineHeight: 1.7,
          color: p.amb,
        },
      },
      [
        el(
          'div',
          { style: { fontWeight: 700, color: p.hi, marginBottom: '8px' } },
          ['⚠ 멀티플레이 백엔드가 설정되지 않았어요'],
        ),
        el('div', { style: { color: p.dim } }, [
          'config.js 에 Supabase 프로젝트의 URL 과 anon 키를 넣으면 로비가 활성화됩니다. ',
          'Supabase 대시보드 → Project Settings → API 에서 값을 복사하세요. ',
          '익명 로그인(Authentication → Providers → Anonymous)도 켜야 게스트 입장이 됩니다.',
        ]),
      ]
    );
  }

  // ─────────────────────────────────────────── exports
  UI.renderLobby = enterLobby;
  UI.redrawLobby = redraw;
  UI.leaveLobby = leaveLobby;
  UI.isLobbyActive = function () {
    return active;
  };
})();
