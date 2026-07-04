/* RUNTIME TCG — title/menu screen. 덱 선택 + 모드 진입(대국/도전/게임방법). 순수 뷰: 상태는 UI 접근자 경유. */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var el = UI.el, SKIN = UI.SKIN, titlebar = UI.titlebar, clear = UI.clear, app = UI.app;
  var DECKS = UI.DECKS, RT = UI.RT, CLS = UI.CLS;
  function renderTitle() {
    clear();
    // 상태 스냅샷(읽기용) — 쓰기는 UI.setMyDeck/setOppDeck 로. render() 가 매번 title 을 다시 그린다.
    var myDeck = UI.getMyDeck(), oppDeck = UI.getOppDeck(), render = UI.render;
    var wrap = el('div', { class: 'bevel', style: { background: SKIN.chassis, color: SKIN.txt } });
    wrap.appendChild(titlebar('RUNTIME — NEW MATCH'));
    var body = el('div', { style: { padding: '22px clamp(14px,2.4vw,30px) 26px' } });
    body.appendChild(el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '30px', letterSpacing: '.05em' } }, ['▦ RUNTIME']));
    body.appendChild(el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.muted, marginBottom: '20px' } }, ['turn-based memory-grid TCG · ruleset v1 · seed cards v4']));

    body.appendChild(sectionLabel('내 덱'));
    body.appendChild(deckGrid(function (k) { return k === myDeck; }, function (k) { UI.setMyDeck(k); render(); }));
    body.appendChild(sectionLabel('상대 덱'));
    var oppRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '18px' } });
    oppRow.appendChild(chip('랜덤 (random)', oppDeck === '__random', function () { UI.setOppDeck('__random'); render(); }));
    Object.keys(DECKS).forEach(function (k) { oppRow.appendChild(chip(k, oppDeck === k, function () { UI.setOppDeck(k); render(); })); });
    body.appendChild(oppRow);

    var meta = RT.analyzeDeck(DECKS[myDeck].list);
    body.appendChild(el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.muted, lineHeight: 1.7, marginBottom: '16px' } }, [
      DECKS[myDeck].name + ' · 30장 · ' + (meta.singleClass ? '단일 클래스(' + (meta.classes[0] || 'generic') + ')' : '혼합덱'),
      el('br'), '규칙: 본체 HP 50 · 한 턴 2액션(선언/이동/포인터) · 기본 공격(인접·무료·턴1회) · 함수·트리거는 무료 · ' + G_capText()
    ]));
    var startRow = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } }, [
      el('button', { class: 'btn', style: { fontSize: '15px', padding: '12px 22px' }, onclick: UI.startMatch }, ['▶ 대국 시작']),
      el('button', { class: 'btn', style: { fontSize: '15px', padding: '12px 22px', background: SKIN.rangeGold, color: '#1d1d24', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.5), inset -2px -2px 0 rgba(0,0,0,.25), 2px 2px 0 rgba(0,0,0,.25)' }, onclick: UI.startChallenge }, ['🏆 도전 모드']),
      el('button', { class: 'btn ghost', style: { fontSize: '15px', padding: '12px 22px' }, onclick: function () { UI.renderTutorial(0); } }, ['📖 게임 방법'])
    ]);
    body.appendChild(startRow);
    body.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, marginTop: '8px' } }, [
      '도전 모드: 선택한 내 덱으로, 이길수록 강해지는 AI와 연속 대결 — ',
      el('b', { style: { color: SKIN.rangeGold } }, [myDeck + ' 덱 최고 ' + UI.bestStreak(myDeck) + '연승'])
    ]));
    var recs = UI.bestMap(), recKeys = Object.keys(recs).filter(function (k) { return recs[k] > 0 && DECKS[k]; }).sort(function (a, b) { return recs[b] - recs[a]; });
    if (recKeys.length) {
      body.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, marginTop: '4px' } }, [
        '덱별 기록 — ' + recKeys.map(function (k) { return k + ' ' + recs[k] + '연승'; }).join('  ·  ')
      ]));
    }
    wrap.appendChild(body);
    app.appendChild(wrap);
  }
  function G_capText() { return '턴 상한 ' + RT.DEFAULT_TURN_CAP + ' → 본체 HP 판정'; }
  function sectionLabel(t) { return el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '11px', letterSpacing: '.16em', color: SKIN.muted, margin: '4px 0 8px' } }, [t]); }
  function deckGrid(isSel, on) {
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: '9px', marginBottom: '18px' } });
    Object.keys(DECKS).forEach(function (k) {
      var d = DECKS[k], c = CLS[d.cls] || CLS.generic, on2 = isSel(k);
      grid.appendChild(el('button', {
        onclick: function () { on(k); },
        style: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '10px 11px', background: SKIN.chassisAlt, color: SKIN.txt, border: '1px solid ' + SKIN.ink, borderTop: '4px solid ' + c, boxShadow: on2 ? ('0 0 0 2px ' + SKIN.chassis + ', 0 0 0 4px ' + SKIN.silk) : 'inset 1px 1px 0 ' + SKIN.bevelHi + ', 2px 2px 0 rgba(0,0,0,.18)', cursor: 'pointer' }
      }, [
        el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '13px' } }, [k + (on2 ? '  ✓' : '')]),
        el('span', { style: { fontSize: '11px', color: SKIN.panelText } }, [d.name.replace(/^\w+ · /, '')]),
        el('span', { class: 'mono', style: { fontSize: '9px', color: c } }, [d.cls.toUpperCase()])
      ]));
    });
    return grid;
  }
  function chip(label, on, cb) {
    return el('button', { onclick: cb, class: 'mono', style: { fontSize: '11px', fontWeight: 700, padding: '5px 11px', border: '1px solid ' + SKIN.ink, background: on ? SKIN.silk : SKIN.chassis, color: on ? SKIN.chassis : SKIN.txt, boxShadow: on ? 'inset 1px 1px 0 rgba(255,255,255,.15)' : 'inset 1px 1px 0 ' + SKIN.bevelHi + ', inset -1px -1px 0 ' + SKIN.bevelLo2 } }, [label]);
  }
  UI.renderTitle = renderTitle;
})();
