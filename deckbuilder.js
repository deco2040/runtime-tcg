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
  var bOrigin = 'title';       // 진입 맥락 — 취소/저장/삭제 후 복귀 화면('title'|'single'|'lobby')
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
    var deny = { Token1: 1, Token2: 1, Token21: 1, Token2b: 1, Token5: 1, Wall5: 1, Wall8: 1, Wall10: 1, __body0: 1, __body1: 1, 'overtime()': 1 };
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
  function bRemove(id) { var i = bDeck.list.lastIndexOf(id); if (i >= 0) { bDeck.list.splice(i, 1); if (bDeck.cover === id && bDeck.list.indexOf(id) < 0) bDeck.cover = null; bMsg = ''; if (Sound().move) Sound().move(); UI.render(); } }

  function openDeckBuilder(editKey, origin) {
    UI.exitToGuide && UI.exitToGuide();   // 진행 중 게임/튜토리얼 상태 정리(G=null)
    bOrigin = origin || 'title';          // 진입 맥락 저장 → 나갈 때 그 화면으로 복귀
    if (editKey && DECKS[editKey]) bDeck = { key: editKey, name: DECKS[editKey].name || '', list: DECKS[editKey].list.slice(), cover: DECKS[editKey].cover || null };
    else bDeck = { key: null, name: '', list: [], cover: null };
    bFilter = 'all'; bMsg = ''; active = true; _scrollPool = 0; _scrollDeck = 0;
    if (app) app.style.maxWidth = 'min(97vw, 1560px)';   // 편집 화면은 전폭을 넓게 — 카드가 크고 텍스트가 또렷하게
    UI.render();
  }
  function closeBuilder() { active = false; bDeck = null; hideCardTip(); hideBigDB(); if (app) app.style.maxWidth = '1180px'; }
  // 진입 맥락으로 복귀 — 멀티플레이 로비에서 왔으면 로비로, 아니면 타이틀(싱글은 titleMode 유지되어 싱글 화면).
  function returnFromBuilder() {
    if (bOrigin === 'lobby' && UI.renderLobby) UI.renderLobby();
    else UI.renderTitle();
  }
  function bCancel() { closeBuilder(); returnFromBuilder(); }
  function bSave() {
    var name = (bDeck.name || '').trim();
    if (!name) { bMsg = '덱 이름을 입력하세요'; UI.render(); return; }
    var v = RT.validateDeck(bDeck.list);
    if (!v.ok) { bMsg = '덱 규칙 위반: ' + v.errors[0]; UI.render(); return; }
    var key = bDeck.key || UI.nextCustomKey();
    UI.saveCustomDeck(key, name, bDeck.list, bDeck.cover);
    UI.setMyDeck(key);
    closeBuilder(); returnFromBuilder();
  }
  function bDelete() {
    if (!bDeck.key) return;
    var ok = true; try { ok = window.confirm('이 커스텀 덱을 삭제할까요?'); } catch (e) {}
    if (!ok) return;
    UI.deleteCustomDeck(bDeck.key);
    closeBuilder(); returnFromBuilder();
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
    b.appendChild(el('div', { class: 'grot', style: { fontSize: '12.5px', fontWeight: 500, color: AMB, marginTop: '7px', marginBottom: '15px', lineHeight: 1.5, textShadow: 'none' } }, ['카드를 클릭해 추가/제거 · 30장 · 덱 카드의 ★로 대표(표지) 카드 지정 · 규칙 준수 시 저장']));

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
    // 카드풀 긴 효과문(Singleton 등) 데스크톱 잘림 방지 — 인게임 손패와 동일하게 넘치면 폰트 자동 축소.
    if (UI.fitCards) requestAnimationFrame(function () { try { UI.fitCards(); } catch (e) {} });
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
    var mob = isMobileDB();
    var grid = el('div', { id: 'db-pool', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(' + (mob ? 102 : Math.round(FACE_W * poolScale() + 20)) + 'px,1fr))', gap: mob ? '10px 8px' : '16px 14px', maxHeight: '72vh', overflowY: 'auto', padding: '4px 2px' } });
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

  // 인게임 손패 카드 페이스(도감과 동일: window.__RT_UI.cardFaceEl). 테마별로 1회 생성해 캐시 → 클론 재사용.
  // 카드 데이터·테마·compact 여부에만 의존(덱 보유수량과 무관)하므로 매 렌더 재생성 없이 clone 으로 충분.
  var _faceCache = {}, _faceTheme = null;
  function faceFor(id, compact) {
    var api = window.__RT_UI;
    if (!api || !api.cardFaceEl) return null;
    var th = UI.getTheme();
    if (th !== _faceTheme) { _faceCache = {}; _faceTheme = th; }   // 테마 바뀌면 SKIN 색 반영 위해 캐시 무효화
    var key = id + (compact ? '|c' : '|f');
    if (!_faceCache[key]) {
      var n = null; try { n = api.cardFaceEl(id, { mode: 'idle', compact: !!compact }); } catch (e) {}
      if (!n) return null;
      _faceCache[key] = n;
    }
    var clone = _faceCache[key].cloneNode(true);
    clone.style.pointerEvents = 'none';   // 클릭은 래퍼(추가/제거)가 처리
    return clone;
  }

  // 손패 카드 페이스(고정 158×220)를 배율 확대. transform 은 레이아웃 크기를 안 바꾸므로
  // 확대분만큼 겉박스 크기를 직접 잡아줘 이웃과 겹치지 않게 한다(origin=top center → 좌우 대칭·상단 고정).
  var FACE_W = 158, FACE_H = 220;
  // 카드 풀 타일 배율 — 데스크톱은 확대(1.32, 텍스트 가독성), 모바일은 축소(0.62, 한 화면에 다수 카드).
  // 모바일 판정은 인게임 손패(core COMPACT: ≤900px 또는 터치+낮은높이)와 동일 기준으로 통일 —
  // 641~900px 폰/태블릿에서 손패는 미니인데 덱빌더만 큰 카드로 뜨던 불일치 제거.
  function isMobileDB() {
    if (UI.isCompact) return UI.isCompact();
    try { return window.matchMedia('(max-width:900px)').matches || (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-height:600px)').matches); }
    catch (e) { return (window.innerWidth || 1200) <= 900; }
  }
  function poolScale() { return isMobileDB() ? 0.62 : 1.32; }
  function scaledFace(node, sc) {
    if (!node) return null;
    if (!sc || sc === 1) return node;
    var inner = el('div', { style: { transform: 'scale(' + sc + ')', transformOrigin: 'top center', flex: 'none' } }, [node]);
    return el('div', { style: { width: Math.round(FACE_W * sc) + 'px', height: Math.round(FACE_H * sc) + 'px', display: 'flex', justifyContent: 'center', flex: 'none' } }, [inner]);
  }

  // 카드 풀 타일 — 인게임 손패 카드 모습 그대로 + 보유수량 배지 + 추가/제거 컨트롤 스트립.
  // 카드 클릭 = 1장 추가, 스트립의 − = 1장 제거. OP 카드(덱당 1장 제한)는 카드 타이틀바 금박 젬으로 표시됨.
  function poolTile(id, dark) {
    var c = CARDS[id], cl = CLS[c.cls] || CLS.generic, cnt = bCount(id), lim = bLimit(id);
    var full = cnt >= lim || bDeck.list.length >= 30;
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';
    var subTxt = dark ? '#c9a86a' : '#4a4a52';

    // 모바일: 미니 카드로 통일(작게·여러 장) + 🔍 탭 시 큰 데스크톱 카드. 데스크톱: 기존 확대(1.32) 카드.
    var mob = isMobileDB();
    var stripW = mob ? 94 : Math.round(FACE_W * poolScale());
    var faceRaw = faceFor(id, mob) || el('div', { class: 'grot', style: { width: '158px', minHeight: '96px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid ' + cl, color: readTxt, padding: '8px', textAlign: 'center', textShadow: 'none' } }, [c.name]);
    var face = mob ? faceRaw : scaledFace(faceRaw, poolScale());
    var faceBox = el('div', { style: { position: 'relative', display: 'flex', justifyContent: 'center' } }, [face]);
    if (cnt > 0) faceBox.appendChild(el('span', { class: 'grot', style: { position: 'absolute', top: '-7px', right: '-7px', minWidth: '23px', textAlign: 'center', fontSize: '13px', fontWeight: 700, background: AMB, color: dark ? '#0a0a0c' : '#f4f5f8', borderRadius: '12px', padding: '2px 7px', boxShadow: '0 1px 5px rgba(0,0,0,.5)', zIndex: 3, textShadow: 'none' } }, ['×' + cnt]));
    // 모바일 미니는 효과문이 안 보이므로 🔍 로 큰 카드 확인(탭=추가와 겹치지 않게 stopPropagation).
    if (mob) faceBox.appendChild(el('button', { title: '크게 보기', onclick: function (e) { e.stopPropagation(); showBigDB(id); }, class: 'grot', style: { position: 'absolute', top: '-7px', left: '-7px', fontSize: '11px', lineHeight: 1, padding: '2px 5px', background: dark ? 'rgba(10,10,12,.85)' : 'rgba(244,245,248,.92)', color: AMB, border: '1px solid ' + AMB, borderRadius: '10px', cursor: 'pointer', zIndex: 4, textShadow: 'none' } }, ['🔍']));
    // 클래스 단일 카드(◈) 배지는 카드 페이스 자체에 이미 표시되므로 중복 태그 생략(요청)

    var strip = el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', width: stripW + 'px', maxWidth: '100%' } }, [
      cnt > 0 ? el('button', { title: '1장 제거', onclick: function (e) { e.stopPropagation(); bRemove(id); }, class: 'grot', style: { fontSize: '13px', fontWeight: 700, lineHeight: 1, padding: '2px 9px', color: readTxt, background: 'transparent', border: '1.5px solid ' + (dark ? 'rgba(255,176,0,.6)' : 'rgba(29,29,36,.45)'), cursor: 'pointer', textShadow: 'none' } }, ['−']) : null,
      el('span', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: cnt > 0 ? readTxt : subTxt } }, [cnt + ' / ' + lim + '장']),
      el('span', { style: { flex: 1 } }),
      el('span', { class: 'grot', style: { fontSize: '11px', fontWeight: 700, color: full ? (dark ? '#ff9a4a' : '#c0392b') : subTxt } }, [full ? (cnt >= lim ? 'MAX' : '덱 30') : '＋ 추가'])
    ]);

    var border = cnt > 0 ? AMB : (dark ? 'rgba(255,176,0,.32)' : 'rgba(29,29,36,.28)');
    return el('div', {
      onclick: function () { bAdd(id); }, title: '클릭 시 1장 추가',
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid ' + border, boxShadow: cnt > 0 ? '0 0 0 2px ' + AMB : 'none', opacity: (full && cnt === 0) ? 0.5 : 1, cursor: 'pointer', padding: '8px 7px 7px' }
    }, [faceBox, strip]);
  }

  // ---- 카드 상세 호버 툴팁(현재 덱 행 위) — 큰 일러스트 + 전체 효과문 ----
  // 자립형 카드 노드(수량 컨트롤 없음, 효과문 클램프 없음). body 직속에 띄우므로 CRT 글로우 없이 또렷.
  function cardDetailNode(id, dark) {
    var c = CARDS[id], cl = CLS[c.cls] || CLS.generic, isP = c.kind === 'pointer';
    var lim = bLimit(id), oneOnly = lim === 1, singleNeed = c.deckRule ? String(c.deckRule).replace('Single', '') : null;
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';
    var badges = [];
    if (oneOnly) badges.push(poolBadge('OP 카드', '#e0a11f', '#1d1d24', '덱당 1장 제한'));
    if (singleNeed) badges.push(poolBadge('◈ ' + singleNeed + ' 클래스 단일', CLS[singleNeed] || '#8a6fb0', '#fff'));
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

  // 현재 덱의 미니 카드에 호버 → 실제 손패 카드 모습을 확대해 띄운다(요청). 손패 페이스 실패 시 상세 노드로 폴백.
  var DECK_PREVIEW_SC = 1.6;
  function showCardFace(id, anchor, dark) {
    var raw = faceFor(id, false);
    var node = raw ? scaledFace(raw, DECK_PREVIEW_SC) : cardDetailNode(id, dark);
    node.style.filter = 'drop-shadow(0 12px 30px rgba(0,0,0,.6))';
    var w = raw ? Math.round(FACE_W * DECK_PREVIEW_SC) : 212;
    var h = raw ? Math.round(FACE_H * DECK_PREVIEW_SC) : (node.offsetHeight || 320);
    var t = tipEl(); while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(node); t.style.display = 'block';
    var r = anchor.getBoundingClientRect(), gap = 12, vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    var left = r.right + gap;                                  // 기본은 카드 오른쪽, 공간 없으면 왼쪽
    if (left + w > vw - 8) left = r.left - w - gap;
    if (left < 8) left = Math.max(8, Math.min(left, vw - w - 8));
    var top = r.top + r.height / 2 - h / 2;                    // 세로 중앙 정렬 후 뷰포트 안으로 클램프
    if (top + h > vh - 8) top = vh - h - 8;
    if (top < 8) top = 8;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }

  // 모바일 🔍 탭 → 데스크톱 풀카드를 화면 중앙에 크게(탭하면 닫힘). showCardFace(호버 툴팁)와 별개.
  var _dbBig = null;
  function hideBigDB() { if (_dbBig && _dbBig.parentNode) _dbBig.parentNode.removeChild(_dbBig); _dbBig = null; }
  function showBigDB(id) {
    var raw = faceFor(id, false); if (!raw) return;
    hideBigDB();
    var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    var scl = Math.min(2.0, (vh * 0.82) / FACE_H, (vw * 0.92) / FACE_W); if (scl < 1) scl = 1;
    var node = scaledFace(raw, scl); node.style.filter = 'drop-shadow(0 16px 40px rgba(0,0,0,.6))';
    _dbBig = el('div', { onclick: hideBigDB, style: { position: 'fixed', inset: '0', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.62)', padding: '16px', cursor: 'zoom-out' } }, [node]);
    if (document.body) document.body.appendChild(_dbBig);
  }

  function builderDeckList(dark) {
    var col = el('div', { style: { flex: '1 1 320px', minWidth: '250px' } });
    col.appendChild(crtLabel('▸ CURRENT DECK'));
    var box = el('div', { id: 'db-decklist', style: { border: '1px solid ' + (dark ? 'rgba(255,176,0,.28)' : 'rgba(29,29,36,.22)'), padding: '9px 10px', maxHeight: '58vh', overflowY: 'auto' } });
    // 클래스 분포
    var byCls = { thread: 0, memory: 0, process: 0, generic: 0 };
    bDeck.list.forEach(function (id) { var cc = CARDS[id].cls; if (byCls[cc] != null) byCls[cc]++; });
    var dist = el('div', { style: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '13px' } });
    ['thread', 'memory', 'process', 'generic'].forEach(function (cc) { if (byCls[cc]) dist.appendChild(el('span', { class: 'grot', style: { color: CLS[cc], fontWeight: 700, textShadow: 'none' } }, [(GLY[cc] || '●') + ' ' + byCls[cc]])); });
    if (bDeck.list.length) box.appendChild(dist);
    if (bDeck.cover && CARDS[bDeck.cover]) box.appendChild(el('div', { class: 'grot', style: { fontSize: '11.5px', fontWeight: 700, color: AMB, marginBottom: '9px', textShadow: 'none' } }, ['★ 대표 카드: ' + CARDS[bDeck.cover].name]));
    if (!bDeck.list.length) { box.appendChild(el('div', { class: 'grot', style: { fontSize: '12.5px', color: AMB, padding: '12px 2px', textShadow: 'none' } }, ['비어 있음 — 왼쪽에서 카드를 추가하세요.'])); col.appendChild(box); return col; }
    var counts = {}; bDeck.list.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var readTxt = dark ? '#f6e3ba' : '#1d1d24';
    // 현재 덱도 손패 카드 모습(compact 미니) + ×수량 배지. 카드 클릭 = 1장 제거.
    var grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '11px 12px', alignItems: 'flex-start', paddingTop: '2px' } });
    deckPool().forEach(function (id) {
      if (!counts[id]) return;
      var c = CARDS[id], cl = CLS[c.cls] || CLS.generic;
      var face = faceFor(id, true) || el('div', { class: 'grot', style: { width: '94px', minHeight: '64px', border: '1px solid ' + cl, color: readTxt, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', textAlign: 'center', fontSize: '10px', textShadow: 'none' } }, [c.name]);
      var w = el('div', {
        onclick: function () { bRemove(id); },
        onmouseenter: function () { showCardFace(id, w, dark); },
        onmouseleave: hideCardTip,
        style: { position: 'relative', display: 'inline-flex', cursor: 'pointer' }
      }, [face]);
      w.appendChild(el('span', { class: 'grot', style: { position: 'absolute', top: '-7px', right: '-7px', minWidth: '19px', textAlign: 'center', fontSize: '11px', fontWeight: 700, background: AMB, color: dark ? '#0a0a0c' : '#f4f5f8', borderRadius: '10px', padding: '1px 5px', boxShadow: '0 1px 4px rgba(0,0,0,.5)', zIndex: 3, textShadow: 'none' } }, ['×' + counts[id]]));
      // 모바일: 호버가 없으므로 덱리스트 미니 카드에도 🔍 탭 확대(풀 타일과 동일). 탭=제거와 겹치지 않게 stopPropagation.
      if (isMobileDB()) w.appendChild(el('button', { title: '크게 보기', onclick: function (e) { e.stopPropagation(); showBigDB(id); }, class: 'grot', style: { position: 'absolute', bottom: '-7px', right: '-7px', fontSize: '11px', lineHeight: 1, padding: '2px 5px', background: dark ? 'rgba(10,10,12,.85)' : 'rgba(244,245,248,.92)', color: AMB, border: '1px solid ' + AMB, borderRadius: '10px', cursor: 'pointer', zIndex: 4, textShadow: 'none' } }, ['🔍']));
      // ★ 대표(표지) 카드 지정 토글 — 클릭 시 카드 제거와 겹치지 않게 stopPropagation.
      (function (cid, cname) {
        var isCover = bDeck.cover === cid;
        w.appendChild(el('button', {
          title: isCover ? '대표 카드 (클릭 시 해제)' : '대표(표지) 카드로 지정', class: 'grot',
          onclick: function (e) { e.stopPropagation(); bDeck.cover = isCover ? null : cid; bMsg = isCover ? '' : (cname + ' 을(를) 대표 카드로 지정'); UI.render(); },
          style: { position: 'absolute', top: '-8px', left: '-8px', fontSize: '12px', lineHeight: 1, padding: '2px 5px', background: isCover ? AMB : (dark ? 'rgba(10,10,12,.85)' : 'rgba(244,245,248,.92)'), color: isCover ? (dark ? '#0a0a0c' : '#f4f5f8') : AMB, border: '1px solid ' + AMB, borderRadius: '10px', cursor: 'pointer', zIndex: 4, textShadow: 'none' }
        }, [isCover ? '★' : '☆']));
      })(id, c.name);
      grid.appendChild(w);
    });
    box.appendChild(grid);
    col.appendChild(box);
    return col;
  }

  UI.openDeckBuilder = openDeckBuilder;
  UI.renderDeckBuilder = renderDeckBuilder;
  UI.isBuilderActive = function () { return active; };
})();
