/* RUNTIME TCG — 커스텀 덱 생성/편집 화면(deck builder). 순수 뷰: 상태·저장은 UI(core) 접근자 경유.
 * 타이틀 화면과 동일한 앰버 모노크롬 CRT 터미널 스킨(index.html .crt-* CSS) 을 사용한다.
 * 로드 순서: core.js 뒤(공유 헬퍼·UI.saveCustomDeck 준비). core.render() 가 UI.isBuilderActive()로 분기한다. */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var el = UI.el, clear = UI.clear, app = UI.app;
  var DECKS = UI.DECKS, RT = UI.RT, CARDS = UI.CARDS, CLS = UI.CLS, GLY = UI.GLY, richText = UI.richText;
  function Sound() { return UI.Sound || {}; }

  // 편집 상태
  var active = false;          // 빌더 화면 표시 중 여부(core.render 가 참조)
  var bDeck = null;            // { key, name, list:[cardId…] }
  var bFilter = 'all';         // 카드 풀 클래스 필터
  var bMsg = '';               // 일시 안내 메시지(추가 차단 등)
  var _pool = null;
  var _scrollPool = 0, _scrollDeck = 0;   // 재렌더(카드 추가/제거) 시 스크롤 위치 보존

  // 터미널 팔레트(테마별) — 다크=앰버 인광, 라이트=먹색
  var AMB = '#ffb000', AMB_HI = '#ffd27a', AMB_DIM = '#b3791f';
  // 카드 풀 클래스 구분 헤더 라벨(정렬 순서 = thread→memory→process→generic)
  var CLS_LABEL = { thread: 'THREAD · 스레드', memory: 'MEMORY · 메모리', process: 'PROCESS · 프로세스', generic: 'GENERIC · 제네릭' };
  function refreshPalette() {
    if (UI.getTheme() === 'dark') { AMB = '#ffb000'; AMB_HI = '#ffd27a'; AMB_DIM = '#b3791f'; }
    else { AMB = '#1d1d24'; AMB_HI = '#111319'; AMB_DIM = '#6b6b75'; }
  }

  // 덱 편성 가능한 카드 풀 — 토큰/벽/분신 등 소환 전용 카드는 제외
  function deckPool() {
    if (_pool) return _pool;
    var deny = { Token: 1, Token2: 1, Token2b: 1, Token5: 1, HalfClone: 1, Wall8: 1, Wall10: 1, __body0: 1, __body1: 1 };
    var order = { thread: 0, memory: 1, process: 2, generic: 3, none: 4 };
    _pool = Object.keys(CARDS).filter(function (id) { var c = CARDS[id]; return c && !deny[id] && (c.kind === 'object' || c.kind === 'pointer'); });
    function ord(cls) { return (cls in order) ? order[cls] : 9; }   // ⚠ 0이 falsy라 `order[cls]||9` 쓰면 thread(0)가 꼴찌로 밀림
    _pool.sort(function (a, b) {
      var ca = CARDS[a], cb = CARDS[b];
      if (ord(ca.cls) !== ord(cb.cls)) return ord(ca.cls) - ord(cb.cls);
      var ka = ca.kind === 'object' ? 0 : 1, kb = cb.kind === 'object' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a < b ? -1 : 1;
    });
    return _pool;
  }

  function bCount(id) { var n = 0; for (var i = 0; i < bDeck.list.length; i++) if (bDeck.list[i] === id) n++; return n; }
  function bLimit(id) { return (CARDS[id] && CARDS[id].deckLimit) || 2; }
  function bAdd(id) {
    if (bDeck.list.length >= 30) { bMsg = '덱은 30장까지입니다'; UI.render(); return; }
    if (bCount(id) >= bLimit(id)) { bMsg = CARDS[id].name + ' 은(는) 최대 ' + bLimit(id) + '장'; UI.render(); return; }
    bDeck.list.push(id); bMsg = ''; if (Sound().draw) Sound().draw(); UI.render();
  }
  function bRemove(id) { var i = bDeck.list.lastIndexOf(id); if (i >= 0) { bDeck.list.splice(i, 1); bMsg = ''; if (Sound().move) Sound().move(); UI.render(); } }

  function openDeckBuilder(editKey) {
    UI.exitToGuide && UI.exitToGuide();   // 진행 중 게임/튜토리얼 상태 정리(G=null)
    if (editKey && DECKS[editKey]) bDeck = { key: editKey, name: DECKS[editKey].name || '', list: DECKS[editKey].list.slice() };
    else bDeck = { key: null, name: '', list: [] };
    bFilter = 'all'; bMsg = ''; active = true; _scrollPool = 0; _scrollDeck = 0;
    UI.render();
  }
  function closeBuilder() { active = false; bDeck = null; hideCardTip(); }
  function bCancel() { closeBuilder(); UI.renderTitle(); }
  function bSave() {
    var name = (bDeck.name || '').trim();
    if (!name) { bMsg = '덱 이름을 입력하세요'; UI.render(); return; }
    var v = RT.validateDeck(bDeck.list);
    if (!v.ok) { bMsg = '덱 규칙 위반: ' + v.errors[0]; UI.render(); return; }
    var key = bDeck.key || UI.nextCustomKey();
    UI.saveCustomDeck(key, name, bDeck.list);
    UI.setMyDeck(key);
    closeBuilder(); UI.renderTitle();
  }
  function bDelete() {
    if (!bDeck.key) return;
    var ok = true; try { ok = window.confirm('이 커스텀 덱을 삭제할까요?'); } catch (e) {}
    if (!ok) return;
    UI.deleteCustomDeck(bDeck.key);
    closeBuilder(); UI.renderTitle();
  }

  // ---- 렌더 ----
  function renderDeckBuilder() {
    // 재렌더 직전 스크롤 위치 포착 → 카드 추가/제거로 다시 그려도 목록이 위로 튀지 않게
    var _p = document.getElementById('db-pool'); if (_p) _scrollPool = _p.scrollTop;
    var _d = document.getElementById('db-decklist'); if (_d) _scrollDeck = _d.scrollTop;
    hideCardTip();   // 재렌더 시 이전 호버 툴팁 정리
    clear();
    refreshPalette();
    var dark = UI.getTheme() === 'dark';
    var v = RT.validateDeck(bDeck.list), n = bDeck.list.length, meta = RT.analyzeDeck(bDeck.list);
    var hdrLine = dark ? 'rgba(255,176,0,.25)' : 'rgba(29,29,36,.20)';
    var titleGlow = dark ? '0 0 10px rgba(255,176,0,.55), 0 0 2px rgba(255,176,0,.9)' : '0 0 1px rgba(0,0,0,.12)';

    var monitor = el('div', { class: 'crt-monitor' });
    var screen = el('div', { class: 'crt-screen' });
    var b = el('div', { class: 'crt-body' });

    // 헤더
    b.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: AMB_DIM, letterSpacing: '.08em', borderBottom: '1px solid ' + hdrLine, paddingBottom: '7px', marginBottom: '14px' } }, [
      el('span', {}, ['RUNTIME OS  ·  DECK EDITOR']),
      el('span', {}, [(bDeck.key ? 'EDIT ' + bDeck.key : 'NEW DECK')])
    ]));
    b.appendChild(el('div', { class: 'grot', style: { fontWeight: 700, fontSize: 'clamp(22px,4.4vw,36px)', letterSpacing: '.1em', lineHeight: 1, color: AMB_HI, textShadow: titleGlow } }, ['커스텀 덱 편집']));
    b.appendChild(el('div', { class: 'grot', style: { fontSize: '12.5px', fontWeight: 500, color: AMB, marginTop: '7px', marginBottom: '15px', lineHeight: 1.5, textShadow: 'none' } }, ['카드를 클릭해 추가/제거 · 30장 · 카드별 최대 매수·단일클래스 규칙 준수 시 저장 가능']));

    // 상단 컨트롤: 이름 + 카운터 + 저장/삭제/취소
    var canSave = (n === 30 && v.ok && (bDeck.name || '').trim());
    var top = el('div', { style: { display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' } });
    var nameIn = el('input', { type: 'text', value: bDeck.name, placeholder: '덱 이름', maxlength: 24, class: 'grot', style: { flex: '1 1 180px', minWidth: '150px', padding: '11px 13px', fontSize: '16px', fontWeight: 700, color: dark ? '#f6e3ba' : '#1d1d24', background: dark ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.6)', border: '1px solid ' + (dark ? 'rgba(255,176,0,.45)' : 'rgba(29,29,36,.4)'), outline: 'none', textShadow: 'none' } });
    nameIn.addEventListener('input', function (e) { bDeck.name = e.target.value; });
    top.appendChild(nameIn);
    top.appendChild(el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '20px', color: canSave ? AMB : (dark ? '#ff9a4a' : '#c0392b'), minWidth: '82px', textAlign: 'center' } }, [n + ' / 30']));
    var saveBtn = el('button', { class: 'crt-btn', style: { fontSize: '14px', opacity: canSave ? 1 : 0.45 }, onclick: bSave }, ['💾 저장']);
    top.appendChild(saveBtn);
    if (bDeck.key) top.appendChild(el('button', { class: 'crt-btn ghost', style: { fontSize: '14px' }, onclick: bDelete }, ['🗑 삭제']));
    top.appendChild(el('button', { class: 'crt-btn ghost', style: { fontSize: '14px' }, onclick: bCancel }, ['✕ 취소']));
    b.appendChild(top);

    // 상태/검증 줄
    var msgColor = AMB_DIM, msgText;
    if (bMsg) { msgColor = dark ? '#E88A3A' : '#c0392b'; msgText = '⚠ ' + bMsg; }
    else if (!v.ok) { msgColor = dark ? '#E88A3A' : '#c0392b'; msgText = '⚠ ' + v.errors.join('  ·  '); }
    else if (n === 30) { msgColor = dark ? '#7BB528' : '#3c8a66'; msgText = '✓ 유효한 덱 — ' + (meta.singleClass ? '단일 클래스(' + (meta.classes[0] || 'generic') + ')' : '혼합덱') + ' · 저장 가능'; }
    else { msgText = (30 - n) + '장 더 필요 (30장 완성 시 저장)'; }
    b.appendChild(el('div', { class: 'grot', style: { fontSize: '13px', fontWeight: 600, color: msgColor, marginBottom: '13px', lineHeight: 1.5, minHeight: '17px', textShadow: 'none' } }, [msgText]));

    // 본문: 좌 카드풀 / 우 현재 덱
    var main = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' } });
    main.appendChild(builderPool(dark));
    main.appendChild(builderDeckList(dark));
    b.appendChild(main);

    screen.appendChild(b);
    monitor.appendChild(screen);
    app.appendChild(monitor);
    // 새로 그린 스크롤 영역에 이전 스크롤 위치 복원
    var np = document.getElementById('db-pool'); if (np) np.scrollTop = _scrollPool;
    var nd = document.getElementById('db-decklist'); if (nd) nd.scrollTop = _scrollDeck;
  }

  function crtLabel(t) { return el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '13px', letterSpacing: '.1em', color: AMB, margin: '2px 0 9px', textShadow: 'none' } }, [t]); }

  function builderPool(dark) {
    var col = el('div', { style: { flex: '2 1 380px', minWidth: '300px' } });
    col.appendChild(crtLabel('▸ CARD POOL'));
    var tabs = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } });
    [['all', '전체'], ['thread', 'thread'], ['memory', 'memory'], ['process', 'process'], ['generic', 'generic']].forEach(function (t) {
      tabs.appendChild(el('button', { onclick: function () { bFilter = t[0]; _scrollPool = 0; UI.render(); }, class: 'crt-opt' + (bFilter === t[0] ? ' on' : ''), style: { fontSize: '13px', padding: '8px 13px' } }, [t[1]]));
    });
    col.appendChild(tabs);
    // 배지 범례 — #3/#4 구분 마커 설명
    col.appendChild(el('div', { class: 'grot', style: { fontSize: '11px', fontWeight: 600, color: AMB, marginBottom: '10px', display: 'flex', gap: '14px', flexWrap: 'wrap' } }, [
      el('span', {}, ['① = 덱당 1장만']),
      el('span', {}, ['◈ = 단일 클래스 전용']),
      el('span', {}, ['정렬 thread→memory→process→generic'])
    ]));
    var grid = el('div', { id: 'db-pool', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '7px', maxHeight: '64vh', overflowY: 'auto', padding: '2px' } });
    var lastCls = null;
    deckPool().forEach(function (id) {
      var c = CARDS[id];
      if (bFilter !== 'all' && c.cls !== bFilter) return;
      // 전체 보기에선 클래스가 바뀔 때마다 구분 헤더(전폭)를 끼워 정렬 순서를 시각화(#1)
      if (bFilter === 'all' && c.cls !== lastCls) {
        lastCls = c.cls;
        grid.appendChild(el('div', { class: 'grot', style: { gridColumn: '1 / -1', fontSize: '13px', fontWeight: 700, letterSpacing: '.08em', color: CLS[c.cls] || AMB, borderBottom: '1px solid ' + (dark ? 'rgba(255,176,0,.28)' : 'rgba(29,29,36,.22)'), padding: '9px 2px 5px', marginTop: '3px' } }, [(GLY[c.cls] || '●') + '  ' + (CLS_LABEL[c.cls] || String(c.cls).toUpperCase())]));
      }
      grid.appendChild(poolTile(id, dark));
    });
    col.appendChild(grid);
    return col;
  }

  function poolBadge(txt, bg, fg, tip) { return el('span', { title: tip || '', style: { fontSize: '8.5px', fontWeight: 700, padding: '1px 4px', background: bg, color: fg || '#fff', whiteSpace: 'nowrap', lineHeight: 1.5, textShadow: 'none' } }, [txt]); }

  // 카드 일러스트 조회(window.RT_ART = art-map.js). 값은 문자열(경로) 또는 {src,pos,fit}.
  function cardArt(card) {
    var m = window.RT_ART; if (!m || !card) return null;
    var v = m[card.id]; if (!v) return null;
    if (typeof v === 'string') return { src: v, pos: '50% 50%', fit: 'cover' };
    if (!v.src) return null;
    return { src: v.src, pos: v.pos || '50% 50%', fit: v.fit || 'cover' };
  }
  // 일러스트 박스 — 이미지 있으면 표시, 없으면(로드 실패 포함) 클래스 글리프 폴백.
  function illo(card, cl, dark, h) {
    var a = cardArt(card); h = h || 60;
    var box = el('div', { style: { position: 'relative', height: h + 'px', background: dark ? '#0b0803' : '#c9ccd6', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, [
      el('span', { style: { fontSize: Math.round(h * 0.5) + 'px', lineHeight: 1, color: cl, opacity: .45, textShadow: 'none' } }, [GLY[card.cls] || '●'])
    ]);
    if (a) box.appendChild(el('img', { src: a.src, alt: '', loading: 'lazy', style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: a.fit, objectPosition: a.pos, display: 'block' }, onerror: function () { if (this.parentNode) this.parentNode.removeChild(this); } }));
    return box;
  }

  // 상세 카드 타일(#2) — 클래스색 타이틀바 + 일러스트 + 스탯 + 효과문 + 배지(#3/#4) + 수량 컨트롤.
  // 가독성: CRT 인광 글로우(text-shadow)를 본문에서 끄고, 폰트 키우고 대비 높인 별도 텍스트색 사용.
  function poolTile(id, dark) {
    var c = CARDS[id], cl = CLS[c.cls] || CLS.generic, cnt = bCount(id), lim = bLimit(id);
    var isP = c.kind === 'pointer', full = cnt >= lim || bDeck.list.length >= 30;
    var oneOnly = lim === 1, singleNeed = c.deckRule ? String(c.deckRule).replace('Single', '') : null;
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';        // 본문 고대비 텍스트(앰버 대신 밝은 크림/먹색)
    var subTxt = dark ? '#c9a86a' : '#4a4a52';
    var panelBg = dark ? 'rgba(0,0,0,.32)' : 'rgba(255,255,255,.62)';

    var badges = [];
    if (oneOnly) badges.push(poolBadge('① 1장', '#e0a11f', '#1d1d24', '이 카드는 덱에 1장만 넣을 수 있습니다'));
    if (singleNeed) badges.push(poolBadge('◈ ' + singleNeed + ' 단일', CLS[singleNeed] || '#8a6fb0', '#fff', singleNeed + ' 단일 클래스 덱에서만 사용 가능'));

    var title = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 6px', background: cl, color: '#fff', textShadow: 'none' } }, [
      el('span', { style: { fontSize: '12px', flex: 'none' } }, [isP ? '◆' : (GLY[c.cls] || GLY.generic)]),
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '12.5px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '.01em' } }, [c.name]),
      el('span', { class: 'grot', style: { fontSize: '8px', fontWeight: 700, background: 'rgba(0,0,0,.32)', padding: '1px 4px', flex: 'none', letterSpacing: '.03em' } }, [isP ? 'PTR' : 'UNIT'])
    ]);

    var body = el('div', { style: { padding: '5px 7px 6px', display: 'flex', flexDirection: 'column', gap: '3px', background: panelBg, textShadow: 'none' } }, [
      badges.length ? el('div', { style: { display: 'flex', gap: '3px', flexWrap: 'wrap' } }, badges) : null,
      el('div', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: readTxt, letterSpacing: '.02em' } }, [isP ? '◆ 포인터 · ' + String(c.cls).toUpperCase() : ('⚔ 공 ' + c.atk + '   ♥ 체 ' + c.hp)]),
      // 효과문은 3줄로 클램프(줄임표) — 카드 높이를 균일·컴팩트하게. 전문은 hover(title) 로 확인.
      el('div', { title: c.text || '', style: { fontSize: '10.5px', lineHeight: 1.4, color: readTxt, fontWeight: 500, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: '3', overflow: 'hidden' } }, richText(c.text || '')),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '1px' } }, [
        cnt > 0 ? el('button', { title: '1장 제거', onclick: function (e) { e.stopPropagation(); bRemove(id); }, class: 'grot', style: { fontSize: '13px', fontWeight: 700, lineHeight: 1, padding: '1px 8px', color: readTxt, background: 'transparent', border: '1.5px solid ' + (dark ? 'rgba(255,176,0,.6)' : 'rgba(29,29,36,.45)'), textShadow: 'none' } }, ['−']) : null,
        el('span', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: cnt > 0 ? readTxt : subTxt } }, [cnt + ' / ' + lim + '장']),
        el('span', { style: { flex: 1 } }),
        el('span', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: full ? (dark ? '#ff9a4a' : '#c0392b') : subTxt } }, [full ? (cnt >= lim ? 'MAX' : '덱 30') : '＋ 추가'])
      ])
    ]);

    var border = cnt > 0 ? AMB : (dark ? 'rgba(255,176,0,.32)' : 'rgba(29,29,36,.28)');
    return el('div', {
      onclick: function () { bAdd(id); }, title: '클릭 시 1장 추가',
      style: { display: 'flex', flexDirection: 'column', background: 'transparent', border: '1px solid ' + border, boxShadow: cnt > 0 ? '0 0 0 2px ' + AMB : 'none', opacity: (full && cnt === 0) ? 0.5 : 1, cursor: 'pointer', overflow: 'hidden' }
    }, [title, illo(c, cl, dark), body]);
  }

  // ---- 카드 상세 호버 툴팁(현재 덱 행 위) — 큰 일러스트 + 전체 효과문 ----
  // 자립형 카드 노드(수량 컨트롤 없음, 효과문 클램프 없음). body 직속에 띄우므로 CRT 글로우 없이 또렷.
  function cardDetailNode(id, dark) {
    var c = CARDS[id], cl = CLS[c.cls] || CLS.generic, isP = c.kind === 'pointer';
    var lim = bLimit(id), oneOnly = lim === 1, singleNeed = c.deckRule ? String(c.deckRule).replace('Single', '') : null;
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';
    var badges = [];
    if (oneOnly) badges.push(poolBadge('① 1장', '#e0a11f', '#1d1d24'));
    if (singleNeed) badges.push(poolBadge('◈ ' + singleNeed + ' 단일', CLS[singleNeed] || '#8a6fb0', '#fff'));
    var title = el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 8px', background: cl, color: '#fff', textShadow: 'none' } }, [
      el('span', { style: { fontSize: '14px', flex: 'none' } }, [isP ? '◆' : (GLY[c.cls] || GLY.generic)]),
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0 } }, [c.name]),
      el('span', { class: 'grot', style: { fontSize: '8.5px', fontWeight: 700, background: 'rgba(0,0,0,.32)', padding: '1px 5px', flex: 'none' } }, [isP ? 'POINTER' : 'UNIT'])
    ]);
    var body = el('div', { style: { padding: '7px 9px 9px', display: 'flex', flexDirection: 'column', gap: '5px', background: dark ? '#17110a' : '#f4f5f8', textShadow: 'none' } }, [
      badges.length ? el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, badges) : null,
      el('div', { class: 'grot', style: { fontSize: '13px', fontWeight: 700, color: readTxt } }, [isP ? '◆ 포인터 · ' + String(c.cls).toUpperCase() : ('⚔ 공 ' + c.atk + '   ♥ 체 ' + c.hp)]),
      el('div', { style: { fontSize: '12px', lineHeight: 1.55, color: readTxt, fontWeight: 500 } }, richText(c.text || ''))
    ]);
    return el('div', { style: { width: '212px', background: dark ? '#17110a' : '#f4f5f8', border: '1px solid ' + cl, boxShadow: '0 8px 24px rgba(0,0,0,.55)', overflow: 'hidden' } }, [title, illo(c, cl, dark, 116), body]);
  }
  var _tip = null;
  function tipEl() { if (_tip) return _tip; _tip = el('div', { style: { position: 'fixed', zIndex: 99999, pointerEvents: 'none', display: 'none', left: '0', top: '0' } }); if (document.body) document.body.appendChild(_tip); return _tip; }
  function showCardTip(id, anchor, dark) {
    var t = tipEl(); while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(cardDetailNode(id, dark)); t.style.display = 'block';
    var r = anchor.getBoundingClientRect(), w = 212, gap = 10;
    var left = r.left - w - gap; if (left < 8) left = r.right + gap;         // 기본은 행 왼쪽, 공간 없으면 오른쪽
    if (left + w > (window.innerWidth || 1200) - 8) left = Math.max(8, (window.innerWidth || 1200) - w - 8);
    t.style.left = left + 'px'; t.style.top = r.top + 'px';
    var th = t.offsetHeight || 240, vh = window.innerHeight || 800, top = r.top;
    if (top + th > vh - 8) top = Math.max(8, vh - th - 8);
    t.style.top = top + 'px';
  }
  function hideCardTip() { if (_tip) _tip.style.display = 'none'; }

  function builderDeckList(dark) {
    var col = el('div', { style: { flex: '1 1 250px', minWidth: '230px' } });
    col.appendChild(crtLabel('▸ CURRENT DECK'));
    var box = el('div', { id: 'db-decklist', style: { border: '1px solid ' + (dark ? 'rgba(255,176,0,.28)' : 'rgba(29,29,36,.22)'), padding: '9px 10px', maxHeight: '58vh', overflowY: 'auto' } });
    // 클래스 분포
    var byCls = { thread: 0, memory: 0, process: 0, generic: 0 };
    bDeck.list.forEach(function (id) { var cc = CARDS[id].cls; if (byCls[cc] != null) byCls[cc]++; });
    var dist = el('div', { style: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '13px' } });
    ['thread', 'memory', 'process', 'generic'].forEach(function (cc) { if (byCls[cc]) dist.appendChild(el('span', { class: 'grot', style: { color: CLS[cc], fontWeight: 700, textShadow: 'none' } }, [(GLY[cc] || '●') + ' ' + byCls[cc]])); });
    if (bDeck.list.length) box.appendChild(dist);
    if (!bDeck.list.length) { box.appendChild(el('div', { class: 'grot', style: { fontSize: '12.5px', color: AMB, padding: '12px 2px', textShadow: 'none' } }, ['비어 있음 — 왼쪽에서 카드를 추가하세요.'])); col.appendChild(box); return col; }
    var counts = {}; bDeck.list.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';
    deckPool().forEach(function (id) {
      if (!counts[id]) return;
      var c = CARDS[id], cl = CLS[c.cls] || CLS.generic, isP = c.kind === 'pointer';
      var oneOnly = ((c.deckLimit) || 2) === 1, singleOnly = !!c.deckRule;
      box.appendChild(el('button', {
        onclick: function () { bRemove(id); }, title: '클릭 시 1장 제거', class: 'crt-opt',
        onmouseenter: function (e) { showCardTip(id, e.currentTarget, dark); }, onmouseleave: hideCardTip,
        style: { display: 'flex', alignItems: 'center', gap: '6px', width: '100%', marginBottom: '4px', padding: '7px 9px', borderLeft: '3px solid ' + cl, color: readTxt, textShadow: 'none' }
      }, [
        el('span', { style: { fontSize: '13px', flex: 'none' } }, [isP ? '◆' : (GLY[c.cls] || GLY.generic)]),
        el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '13px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [c.name]),
        oneOnly ? el('span', { title: '덱당 1장', style: { fontSize: '11px', fontWeight: 700, flex: 'none', color: '#e0a11f' } }, ['①']) : null,
        singleOnly ? el('span', { title: '단일 클래스 전용', style: { fontSize: '11px', fontWeight: 700, flex: 'none', color: cl } }, ['◈']) : null,
        el('span', { class: 'grot', style: { fontSize: '13px', fontWeight: 700, flex: 'none' } }, ['×' + counts[id]]),
        el('span', { class: 'grot', style: { fontSize: '15px', fontWeight: 700, flex: 'none', opacity: .85 } }, ['−'])
      ]));
    });
    col.appendChild(box);
    return col;
  }

  UI.openDeckBuilder = openDeckBuilder;
  UI.renderDeckBuilder = renderDeckBuilder;
  UI.isBuilderActive = function () { return active; };
})();
