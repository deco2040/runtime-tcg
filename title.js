/* RUNTIME TCG — title/menu screen. 덱 선택 + 모드 진입(대국/도전/게임방법). 순수 뷰: 상태는 UI 접근자 경유.
 * 메인(타이틀) 화면 = 앰버 모노크롬 CRT 터미널. index.html .crt-* CSS 와 짝을 맞춘다(다크=호박 인광, 라이트=먹색). */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var el = UI.el, clear = UI.clear, app = UI.app;
  var DECKS = UI.DECKS, RT = UI.RT;
  var GLY = { thread: '▲', memory: '■', process: '◇', generic: '●', mixed: '◆', none: '▦' };
  // 터미널 팔레트(테마별로 renderTitle 진입 시 갱신) — 헬퍼들이 참조하므로 모듈 스코프에 둔다.
  var AMB = '#ffb000', AMB_HI = '#ffd27a', AMB_DIM = '#b3791f';

  function renderTitle() {
    clear();
    // 커스텀 덱 삭제 등으로 선택이 무효하면 복구
    if (!DECKS[UI.getMyDeck()]) UI.setMyDeck((UI.presetKeys && UI.presetKeys()[0]) || 'T1');
    // 상태 스냅샷(읽기용) — 쓰기는 UI.setMyDeck/setOppDeck 로. render() 가 매번 title 을 다시 그린다.
    var myDeck = UI.getMyDeck(), oppDeck = UI.getOppDeck(), render = UI.render;
    // 테마별 팔레트 — 다크=앰버 인광, 라이트=먹색(페이퍼 화이트 화면). index.html .crt-monitor CSS 변수와 짝을 맞춤.
    var dark = UI.getTheme() === 'dark';
    if (dark) { AMB = '#ffb000'; AMB_HI = '#ffd27a'; AMB_DIM = '#b3791f'; }
    else { AMB = '#1d1d24'; AMB_HI = '#111319'; AMB_DIM = '#6b6b75'; }
    var hdrLine = dark ? 'rgba(255,176,0,.25)' : 'rgba(29,29,36,.20)';
    var titleGlow = dark ? '0 0 10px rgba(255,176,0,.55), 0 0 2px rgba(255,176,0,.9)' : '0 0 1px rgba(0,0,0,.12)';
    var ledCol = dark ? '#ffb000' : '#3c8a66';
    var brandCol = dark ? '#7a6b45' : '#86868f', brandCol2 = dark ? '#5f5436' : '#9c9da6';
    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    // 터미널 헤더 상태줄
    b.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: AMB_DIM, letterSpacing: '.08em', borderBottom: '1px solid ' + hdrLine, paddingBottom: '7px', marginBottom: '16px' } }, [
      el('span', {}, ['RUNTIME OS  v1.0']),
      el('span', {}, ['MEM 50/50K  ·  ONLINE'])
    ]));

    // 대형 타이틀(인광 글로우)
    b.appendChild(el('div', { class: 'grot', style: { fontWeight: 700, fontSize: 'clamp(30px,6.4vw,54px)', letterSpacing: '.16em', lineHeight: 1, color: AMB_HI, textShadow: titleGlow } }, ['RUNTIME']));
    b.appendChild(el('div', { style: { fontSize: '11px', color: AMB_DIM, marginTop: '7px', marginBottom: '14px', letterSpacing: '.04em' } }, ['turn-based memory-grid TCG  ·  seed cards v4']));

    // 프로필/게스트 정보 카드
    b.appendChild(crtProfile());

    var presets = (UI.presetKeys && UI.presetKeys()) || Object.keys(DECKS);
    var customs = (UI.customKeys && UI.customKeys()) || [];

    // ▸ 견본 덱 (SAMPLE)
    b.appendChild(crtLabel('▸ 견본 덱 · SAMPLE'));
    b.appendChild(crtDeckGrid(function (k) { return k === myDeck; }, function (k) { UI.setMyDeck(k); render(); }, presets));

    // ▸ 커스텀 덱 (CUSTOM) — 저장된 자작 덱 선택/편집 + 새 덱 만들기
    b.appendChild(crtLabel('▸ 커스텀 덱 · CUSTOM'));
    b.appendChild(crtCustomGrid(myDeck, customs, render));

    // ▸ OPPONENT
    b.appendChild(crtLabel('▸ OPPONENT'));
    var oppRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', margin: '8px 0 18px' } });
    oppRow.appendChild(crtChip('RANDOM', oppDeck === '__random', function () { UI.setOppDeck('__random'); render(); }));
    presets.forEach(function (k) { oppRow.appendChild(crtChip(k, oppDeck === k, function () { UI.setOppDeck(k); render(); })); });
    b.appendChild(oppRow);

    // ▸ SYSTEM — 덱 요약 + 규칙(터미널 정보 블록)
    var meta = RT.analyzeDeck(DECKS[myDeck].list);
    b.appendChild(crtLabel('▸ SYSTEM'));
    b.appendChild(crtInfo([
      ['DECK', DECKS[myDeck].name.replace(/^\w+ · /, '') + '  ·  30 cards  ·  ' + (meta.singleClass ? 'single-class(' + (meta.classes[0] || 'generic') + ')' : 'mixed')],
      ['RULES', 'HP40 · 2 actions/turn · basic atk(adj·free·1x) · fn/trigger free'],
      ['LIMIT', G_capText()]
    ]));

    // 실행 버튼
    var startRow = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '18px' } }, [
      el('button', { class: 'crt-btn', style: { fontSize: '16px' }, onclick: UI.startMatch }, ['▶ START']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '16px' }, onclick: UI.startChallenge }, ['🏆 CHALLENGE']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '16px' }, onclick: function () { if (UI.renderLobby) UI.renderLobby(); } }, ['🌐 LOBBY']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '16px' }, onclick: function () { if (UI.renderAuth) UI.renderAuth('title'); } }, ['👤 계정']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '16px' }, onclick: function () { UI.renderTutorial(0); } }, ['📖 HELP']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '16px' }, onclick: function () { window.open('cards.html', '_blank', 'noopener'); } }, ['📇 도감'])
    ]);
    // 💬 DISCORD — 커뮤니티 서버 초대. config.js 의 RT_DISCORD.invite 가 실제 링크일 때만 노출(미설정 시 숨김).
    var dc = window.RT_DISCORD && window.RT_DISCORD.invite;
    if (dc && dc.indexOf('YOUR-') === -1) {
      startRow.appendChild(el('button', {
        class: 'crt-btn ghost', style: { fontSize: '16px' },
        onclick: function () { window.open(dc, '_blank', 'noopener'); }
      }, ['💬 DISCORD']));
    }
    b.appendChild(startRow);
    b.appendChild(el('div', { style: { fontSize: '10px', color: AMB_DIM, marginTop: '10px', lineHeight: 1.7 } }, [
      'CHALLENGE — 선택한 내 덱으로 점점 강해지는 AI와 연속 대결. ',
      el('span', { style: { color: AMB } }, ['BEST ' + myDeck + ' ' + UI.bestStreak(myDeck) + 'W'])
    ]));
    var recs = UI.bestMap(), recKeys = Object.keys(recs).filter(function (k) { return recs[k] > 0 && DECKS[k]; }).sort(function (a, b) { return recs[b] - recs[a]; });
    if (recKeys.length) {
      b.appendChild(el('div', { style: { fontSize: '10px', color: AMB_DIM, marginTop: '4px' } }, [
        'LOG — ' + recKeys.map(function (k) { return k + ':' + recs[k] + 'W'; }).join('  ·  ')
      ]));
    }

    // 프롬프트 커서줄
    b.appendChild(el('div', { style: { fontSize: '13px', color: AMB, marginTop: '18px', fontWeight: 700, letterSpacing: '.05em' } }, [
      'READY', el('span', { class: 'crt-cursor' })
    ]));

    // 푸터 — 개인정보처리방침 · 이용약관(새 탭). 상대경로라 라이브·로컬 어디서든 동작.
    b.appendChild(el('div', { style: { fontSize: '10px', color: AMB_DIM, marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', letterSpacing: '.03em' } }, [
      footLink('개인정보처리방침', 'privacy/'),
      el('span', { style: { opacity: '.5' } }, ['·']),
      footLink('이용약관', 'terms/')
    ]));

    screen.appendChild(b);
    monitor.appendChild(screen);
    // 모니터 하판 — 전원 LED + 브랜드 + 모델명
    monitor.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 6px 2px' } }, [
      el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: ledCol, boxShadow: '0 0 7px ' + ledCol } }),
      el('span', { class: 'grot', style: { fontSize: '10px', letterSpacing: '.34em', color: brandCol, fontWeight: 700 } }, ['R U N T I M E']),
      el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '9px', color: brandCol2, letterSpacing: '.1em' } }, ['MODEL RT-50'])
    ]));
    app.appendChild(monitor);
  }
  function footLink(label, href) {
    return el('a', { href: href, target: '_blank', rel: 'noopener', style: { color: AMB_DIM, textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer' } }, [label]);
  }
  function crtLabel(t) { return el('div', { style: { fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: '11px', letterSpacing: '.14em', color: AMB, margin: '2px 0 2px' } }, [t]); }
  function crtChip(label, on, cb) { return el('button', { onclick: cb, class: 'crt-opt' + (on ? ' on' : ''), style: { fontSize: '12px' } }, [label]); }
  // 프로필/게스트 정보 카드 — UI.Net(클라우드 프로필) 있으면 그걸, 없으면 로컬 전적. 클릭 시 계정 화면.
  function crtProfile() {
    var dark = UI.getTheme() === 'dark';
    var Net = UI.Net, prof = null, member = false, sess = null;
    try { if (Net) { prof = Net.profile && Net.profile(); member = Net.isMember && Net.isMember(); sess = Net.session && Net.session(); } } catch (e) {}
    var nick = (prof && prof.nickname) || (member ? 'USER' : 'GUEST');
    var w, l, dr, g;
    if (prof && prof.games != null) { w = prof.wins || 0; l = prof.losses || 0; dr = prof.draws || 0; g = prof.games || 0; }
    else { var rec = {}; try { rec = JSON.parse(localStorage.getItem('rt_ai_record') || '{}'); } catch (e2) {} w = rec.wins || 0; l = rec.losses || 0; dr = rec.draws || 0; g = (rec.games != null ? rec.games : (w + l + dr)); }
    var wr = g > 0 ? Math.round(100 * w / g) : 0;
    var badge = member ? 'MEMBER' : 'GUEST';
    var ini = ((nick || '?').replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 2).toUpperCase()) || '::';
    var box = dark ? 'rgba(255,176,0,.30)' : 'rgba(29,29,36,.22)';
    var av = el('span', { class: 'grot', style: { flex: 'none', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: AMB_HI, border: '1px solid ' + box, letterSpacing: '.02em' } }, [ini]);
    var line1 = el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
      el('span', { style: { fontSize: '14px', fontWeight: 700, color: AMB_HI, letterSpacing: '.03em' } }, [nick]),
      el('span', { class: 'mono', style: { fontSize: '9px', color: AMB_DIM, border: '1px solid ' + box, padding: '1px 5px', letterSpacing: '.12em' } }, [badge])
    ]);
    var line2 = el('div', { class: 'mono', style: { fontSize: '10px', color: AMB_DIM, marginTop: '3px', letterSpacing: '.04em' } }, [
      g > 0 ? (w + 'W ' + l + 'L ' + dr + 'D  ·  WIN ' + wr + '%') : 'NO RECORD — 첫 대국을 시작하세요'
    ]);
    var cta = el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '10px', color: AMB, alignSelf: 'center', letterSpacing: '.06em', whiteSpace: 'nowrap' } }, [member ? '계정 ▸' : '로그인 ▸']);
    return el('div', {
      onclick: function () { if (UI.renderAuth) UI.renderAuth('title'); },
      style: { display: 'flex', alignItems: 'center', gap: '11px', padding: '10px 12px', margin: '0 0 20px', border: '1px solid ' + box, cursor: 'pointer' }
    }, [av, el('div', { style: { minWidth: '0' } }, [line1, line2]), cta]);
  }
  function G_capText() { return '턴 상한 ' + RT.DEFAULT_TURN_CAP + ' → 본체 HP 판정'; }
  // 덱 선택 — 터미널 옵션 타일. GLY(클래스 글리프)로 계열 표시, 선택 시 인버스(호박색 채움).
  function crtDeckGrid(isSel, on, keys) {
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(184px,1fr))', gap: '10px', margin: '10px 0 20px' } });
    (keys || Object.keys(DECKS)).forEach(function (k) {
      var d = DECKS[k], on2 = isSel(k), gly = GLY[d.cls] || GLY.generic;
      grid.appendChild(el('button', {
        onclick: function () { on(k); }, class: 'crt-opt' + (on2 ? ' on' : ''),
        style: { display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left', padding: '11px 13px', minHeight: '52px' }
      }, [
        el('span', { style: { fontSize: '15px', fontWeight: 700, letterSpacing: '.04em' } }, [(on2 ? '▶ ' : '  ') + gly + ' ' + k]),
        el('span', { style: { fontSize: '11px', opacity: '.72' } }, [d.name.replace(/^\w+ · /, '')])
      ]));
    });
    return grid;
  }
  // 커스텀 덱 그리드 — 저장된 자작 덱 타일(선택 + [편집]) + '새 덱 만들기' 타일
  function crtCustomGrid(myDeck, keys, render) {
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(184px,1fr))', gap: '10px', margin: '10px 0 20px' } });
    keys.forEach(function (k) {
      var d = DECKS[k], on2 = (k === myDeck), gly = GLY[d.cls] || GLY.generic;
      grid.appendChild(el('div', {
        onclick: function () { UI.setMyDeck(k); render(); }, class: 'crt-opt' + (on2 ? ' on' : ''),
        style: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left', padding: '11px 30px 11px 13px', minHeight: '52px', cursor: 'pointer' }
      }, [
        el('span', { style: { fontSize: '15px', fontWeight: 700, letterSpacing: '.04em' } }, [(on2 ? '▶ ' : '  ') + gly + ' ' + k]),
        el('span', { style: { fontSize: '11px', opacity: '.72', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [(d.name || '(이름 없음)') + ' · ' + d.list.length + '장']),
        el('button', { title: '편집', onclick: function (e) { e.stopPropagation(); UI.openDeckBuilder(k); }, style: { position: 'absolute', top: '5px', right: '6px', fontSize: '15px', padding: '1px 5px', color: 'inherit', background: 'transparent' } }, ['✎'])
      ]));
    });
    // 새 덱 만들기
    grid.appendChild(el('button', {
      onclick: function () { UI.openDeckBuilder(null); }, class: 'crt-opt',
      style: { display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', justifyContent: 'center', minHeight: '52px', textAlign: 'center', borderStyle: 'dashed' }
    }, [
      el('span', { style: { fontSize: '18px', fontWeight: 700, lineHeight: 1 } }, ['＋']),
      el('span', { style: { fontSize: '10px', letterSpacing: '.06em' } }, ['새 덱 만들기'])
    ]));
    return grid;
  }
  // 정보 블록 — [라벨] 값 줄들. 라벨은 흐린 호박, 값은 밝은 호박.
  function crtInfo(rows) {
    return el('div', { style: { margin: '4px 0 4px', lineHeight: 1.75, fontSize: '11px' } }, rows.map(function (r) {
      return el('div', { style: { display: 'flex', gap: '10px' } }, [
        el('span', { style: { color: AMB_DIM, minWidth: '48px', fontWeight: 700 } }, [r[0]]),
        el('span', { style: { color: AMB } }, [r[1]])
      ]);
    }));
  }
  UI.renderTitle = renderTitle;
})();
