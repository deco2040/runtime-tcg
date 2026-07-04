/* RUNTIME TCG — title/menu screen. 덱 선택 + 모드 진입(대국/도전/게임방법). 순수 뷰: 상태는 UI 접근자 경유.
 * 메인(타이틀) 화면 = 앰버 모노크롬 CRT 터미널. index.html .crt-* CSS 와 짝을 맞춘다(다크=호박 인광, 라이트=먹색). */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var el = UI.el, clear = UI.clear, app = UI.app;
  var DECKS = UI.DECKS, RT = UI.RT;
  var GLY = { thread: '▲', memory: '■', process: '◇', generic: '●', none: '▦' };
  // 터미널 팔레트(테마별로 renderTitle 진입 시 갱신) — 헬퍼들이 참조하므로 모듈 스코프에 둔다.
  var AMB = '#ffb000', AMB_HI = '#ffd27a', AMB_DIM = '#b3791f';

  function renderTitle() {
    clear();
    // 상태 스냅샷(읽기용) — 쓰기는 UI.setMyDeck/setOppDeck 로. render() 가 매번 title 을 다시 그린다.
    var myDeck = UI.getMyDeck(), oppDeck = UI.getOppDeck(), render = UI.render;
    // 테마별 팔레트 — 다크=앰버 인광, 라이트=먹색(페이퍼 화이트 화면). index.html .crt-monitor CSS 변수와 짝을 맞춤.
    var dark = UI.getTheme() === 'dark';
    if (dark) { AMB = '#ffb000'; AMB_HI = '#ffd27a'; AMB_DIM = '#b3791f'; }
    else { AMB = '#1d1d24'; AMB_HI = '#111319'; AMB_DIM = '#6b6b75'; }
    var hdrLine = dark ? 'rgba(255,176,0,.25)' : 'rgba(29,29,36,.20)';
    var titleGlow = dark ? '0 0 10px rgba(255,176,0,.55), 0 0 2px rgba(255,176,0,.9)' : '0 0 1px rgba(0,0,0,.12)';
    var ledCol = dark ? '#ffb000' : '#3c8a66';
    var brandCol = dark ? '#7a6b45' : '#8a857a', brandCol2 = dark ? '#5f5436' : '#9c968a';
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
    b.appendChild(el('div', { style: { fontSize: '11px', color: AMB_DIM, marginTop: '7px', marginBottom: '20px', letterSpacing: '.04em' } }, ['turn-based memory-grid TCG  ·  seed cards v4']));

    // ▸ MY DECK
    b.appendChild(crtLabel('▸ MY DECK'));
    b.appendChild(crtDeckGrid(function (k) { return k === myDeck; }, function (k) { UI.setMyDeck(k); render(); }));

    // ▸ OPPONENT
    b.appendChild(crtLabel('▸ OPPONENT'));
    var oppRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', margin: '8px 0 18px' } });
    oppRow.appendChild(crtChip('RANDOM', oppDeck === '__random', function () { UI.setOppDeck('__random'); render(); }));
    Object.keys(DECKS).forEach(function (k) { oppRow.appendChild(crtChip(k, oppDeck === k, function () { UI.setOppDeck(k); render(); })); });
    b.appendChild(oppRow);

    // ▸ SYSTEM — 덱 요약 + 규칙(터미널 정보 블록)
    var meta = RT.analyzeDeck(DECKS[myDeck].list);
    b.appendChild(crtLabel('▸ SYSTEM'));
    b.appendChild(crtInfo([
      ['DECK', DECKS[myDeck].name.replace(/^\w+ · /, '') + '  ·  30 cards  ·  ' + (meta.singleClass ? 'single-class(' + (meta.classes[0] || 'generic') + ')' : 'mixed')],
      ['RULES', 'HP50 · 2 actions/turn · basic atk(adj·free·1x) · fn/trigger free'],
      ['LIMIT', G_capText()]
    ]));

    // 실행 버튼
    var startRow = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '18px' } }, [
      el('button', { class: 'crt-btn', style: { fontSize: '15px' }, onclick: UI.startMatch }, ['▶ START']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '15px' }, onclick: UI.startChallenge }, ['🏆 CHALLENGE']),
      el('button', { class: 'crt-btn ghost', style: { fontSize: '15px' }, onclick: function () { UI.renderTutorial(0); } }, ['📖 HELP'])
    ]);
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
  function crtLabel(t) { return el('div', { style: { fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: '11px', letterSpacing: '.14em', color: AMB, margin: '2px 0 2px' } }, [t]); }
  function crtChip(label, on, cb) { return el('button', { onclick: cb, class: 'crt-opt' + (on ? ' on' : ''), style: { fontSize: '11px' } }, [label]); }
  function G_capText() { return '턴 상한 ' + RT.DEFAULT_TURN_CAP + ' → 본체 HP 판정'; }
  // 덱 선택 — 터미널 옵션 타일. GLY(클래스 글리프)로 계열 표시, 선택 시 인버스(호박색 채움).
  function crtDeckGrid(isSel, on) {
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: '7px', margin: '8px 0 18px' } });
    Object.keys(DECKS).forEach(function (k) {
      var d = DECKS[k], on2 = isSel(k), gly = GLY[d.cls] || GLY.generic;
      grid.appendChild(el('button', {
        onclick: function () { on(k); }, class: 'crt-opt' + (on2 ? ' on' : ''),
        style: { display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }
      }, [
        el('span', { style: { fontSize: '12px', fontWeight: 700, letterSpacing: '.04em' } }, [(on2 ? '▶ ' : '  ') + gly + ' ' + k]),
        el('span', { style: { fontSize: '10px', opacity: '.72' } }, [d.name.replace(/^\w+ · /, '')])
      ]));
    });
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
