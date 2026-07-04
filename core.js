/* RUNTIME TCG — core game screen (상태 + 매치 + 멀리건 + 보드 + AI + 공유 헬퍼).
 * 화면 모듈(title/tutorial)과 독립 모듈(sound/theme)은 window.RTUI 네임스페이스로 연결된다.
 * 로드 순서: cards → decks → engine → art-map → sound → theme → core → title → tutorial. */
(function () {
  'use strict';
  // 공유 네임스페이스. sound.js/theme.js 가 먼저 로드되어 UI.Sound / UI.SKIN 을 채워둔다.
  var UI = window.RTUI = window.RTUI || {};
  var Sound = UI.Sound;   // sound.js
  var SKIN = UI.SKIN;     // theme.js (in-place 로 갱신되는 공유 객체 참조)
  var RT = window.RT;
  var CARDS = RT.CARDS, DECKS = RT.DECKS, P = RT.P, K = RT.K, unitKey = RT.unitKey, cardCls = RT.cardCls;
  var bodyKey = RT.bodyKey;
  var CLS = { thread: '#d8472b', memory: '#2456a6', process: '#c8951b', generic: '#6b6b75', none: '#1d1d24' };
  var GLY = { thread: '▲', memory: '■', process: '◇', generic: '●', none: '▦' };
  var HUMAN = 0, AI = 1;

  function isBodyKey(k) { return k === bodyKey(0) || k === bodyKey(1); }
  // 음소거 토글 버튼 + 첫 제스처에 오디오 활성화(브라우저 정책)
  (function () {
    var btn = el('button', { class: 'btn ghost', style: { position: 'fixed', top: '8px', right: '8px', zIndex: 200, padding: '4px 9px', fontSize: '12px' } }, ['🔊 효과음']);
    btn.addEventListener('click', function () { var on = Sound.toggle(); btn.textContent = on ? '🔊 효과음' : '🔇 음소거'; btn.style.opacity = on ? '1' : '0.55'; });
    if (document.body) document.body.appendChild(btn);
    document.addEventListener('pointerdown', function () { Sound.resume(); }, true);
  })();

  var app = document.getElementById('app');
  // ---- 반응형: COMPACT(모바일/좁은 화면) 모드. 화면폭 ≤900px 에서 필드|손패 2단 가로 레이아웃으로 전환.
  var COMPACT = false, _rzT = null;
  function isTouchDevice() { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return 'ontouchstart' in window; } }
  // 컴팩트(모바일) = 좁은 폭 이거나, 터치기기의 낮은 높이(가로로 든 폰) — 큰 폰 가로에서도 데스크톱 레이아웃으로 안 빠지게.
  function computeCompact() {
    try { COMPACT = window.matchMedia('(max-width: 900px)').matches || (isTouchDevice() && window.matchMedia('(max-height: 600px)').matches); }
    catch (e) { COMPACT = (window.innerWidth || 1200) <= 900; }
  }
  function isPortrait() { return (window.innerHeight || 0) > (window.innerWidth || 0); }
  computeCompact();
  // 멀리건 인트로(코인플립·딜링) 중엔 재렌더 금지 — 모바일 URL바 접힘/방향전환이 resize 를 발생시켜
  // clear() 로 애니메이션(코인·딜)이 지워지는 걸 막는다. 코인은 fxLayer 라 살아남지만 딜 연출까지 보호.
  window.addEventListener('resize', function () { clearTimeout(_rzT); _rzT = setTimeout(function () { computeCompact(); if (mullPhase && mullBusy) return; render(); }, 150); });
  window.addEventListener('orientationchange', function () { computeCompact(); setTimeout(function () { if (mullPhase && mullBusy) return; render(); }, 80); });
  var G = null, sel = null, ptr = null, hover = null, hoverCell = null, pinned = null, toast = null, toastT = null, aiTimer = null, aiThinking = false, aiRevealPause = false, handScroll = 0;
  var myDeck = 'T1', oppDeck = '__random';
  var challenge = null;   // 도전 모드: { stage, wins, baseBest } 또는 null
  var tutorial = null;    // 실습 튜토리얼: { step, finished, steps } 또는 null
  var _bestMem = {};      // localStorage 불가 시 메모리 폴백 (덱별 최고연승 맵)
  function bestMap() { try { var v = window.localStorage.getItem('rt_challenge_bests'); var o = v ? JSON.parse(v) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return _bestMem; } }
  function bestStreak(deck) { return bestMap()[deck] || 0; }
  function setBestStreak(deck, n) { var m = bestMap(); if (n > (m[deck] || 0)) { m[deck] = n; _bestMem = m; try { window.localStorage.setItem('rt_challenge_bests', JSON.stringify(m)); } catch (e) {} } }

  // ---- tiny element helper
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (!props.hasOwnProperty(k)) continue;
      var v = props[k];
      if (k === 'style' && typeof v === 'object') { for (var s in v) e.style[s] = v[s]; }
      else if (k === 'style') e.style.cssText = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (v != null && v !== false) e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c == null || c === false) return; e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return e;
  }
  function clear() { while (app.firstChild) app.removeChild(app.firstChild); }
  function flash(m) { toast = m; clearTimeout(toastT); toastT = setTimeout(function () { toast = null; render(); }, 1600); render(); }
  function titlebar(t) {
    return el('div', { class: 'titlebar' }, [el('span', { class: 'dot' }), el('span', { class: 't' }, [t]), el('span', { class: 'dot' })]);
  }

  // ---- shared card-UI helpers
  var ATK_MAX = 10, HP_MAX = 16;
  function hexa(hex, a) { var h = hex.replace('#', ''); return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')'; }
  function statBar(label, value, max, color, baseVal) {
    var pct = Math.max(0, Math.min(100, value / max * 100));
    var changed = baseVal != null && value !== baseVal;
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, [
      el('span', { class: 'mono', style: { fontSize: '8px', color: SKIN.muted, width: '24px' } }, [label]),
      el('div', { style: { flex: 1, height: '9px', background: SKIN.chassisSunk, border: '1px solid ' + SKIN.ink, boxShadow: 'inset 1px 1px 0 ' + SKIN.bevelLo2, position: 'relative', overflow: 'hidden' } }, [
        el('div', { style: { position: 'absolute', inset: '0', width: pct + '%', background: color, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.35) 0 1px, transparent 1px 4px)' } })
      ]),
      el('span', { class: 'mono', style: { fontSize: '12px', fontWeight: 700, width: '17px', textAlign: 'right', color: changed ? SKIN.ally : color } }, [String(value)])
    ]);
  }
  function rangeGridEl(spec, accent) {
    var lbl = spec.code === 'cast' ? '시전 범위(본체 기준)' : '함수 범위';
    if (spec.kind === 'label') {
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
        el('span', { class: 'mono', style: { fontSize: '7px', color: SKIN.faint, letterSpacing: '.12em' } }, [lbl]),
        el('span', { class: 'mono', style: { fontSize: '9px', fontWeight: 700, color: SKIN.panelText, padding: '2px 5px', border: '1px solid ' + SKIN.line, background: SKIN.chassisAlt } }, [spec.text])
      ]);
    }
    var set = {}; spec.cells.forEach(function (c) { set[c[0] + ',' + c[1]] = 1; });
    var oc = 3, orow = spec.originBottom ? 5 : 3;
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5,5px)', gridTemplateRows: 'repeat(5,5px)', gap: '1px' } });
    for (var r = 1; r <= 5; r++) for (var c = 1; c <= 5; c++) {
      var dc = c - oc, dr = r - orow, cs = { width: '5px', height: '5px' };
      if (dc === 0 && dr === 0) cs.background = SKIN.selfPad;
      else if (set[dc + ',' + dr]) cs.background = accent;
      else { cs.background = SKIN.padEmpty; cs.boxShadow = 'inset 0 0 0 1px ' + SKIN.line; }
      grid.appendChild(el('div', { style: cs }));
    }
    return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
      el('span', { class: 'mono', style: { fontSize: '7px', color: SKIN.faint, letterSpacing: '.12em' } }, [lbl]),
      grid
    ]);
  }
  function artBox(card, hgt) {
    var cl = CLS[card.cls] || CLS.generic;
    return el('div', { style: { height: hgt + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg,' + hexa(cl, .16) + ',' + hexa(cl, .03) + '), ' + SKIN.die, borderTop: '1px solid ' + SKIN.line, borderBottom: '1px solid ' + SKIN.line } }, [
      el('span', { style: { fontSize: Math.round(hgt * 0.6) + 'px', color: cl, opacity: .8, lineHeight: 1, textShadow: '0 1px 0 rgba(255,255,255,.35)' } }, [GLY[card.cls]]),
      el('span', { class: 'mono', style: { position: 'absolute', right: '3px', bottom: '1px', fontSize: '6px', color: SKIN.faint, letterSpacing: '.12em' } }, ['ART'])
    ]);
  }
  function ownerColor(owner) { return owner === HUMAN ? SKIN.own : SKIN.enemy; }

  // ===== 칩(PCB) 스킨 + 테마 — 카드_디자인_사양서_v1 =====
  // 기본(light) = 레트로 PC + PCB 융합(기존 셸 팔레트). dark = 칩 다크 PCB(토글 선택 시).
  // SKIN 은 활성 테마 토큰을 담는 단일 객체(in-place 스왑) — 기존 SKIN.* 참조 유지.
  var SERIES_COLOR = { attack: '#E24B4A', control: '#378ADD', support: '#7BB528' };
  var SERIES_LABEL = { attack: '공격', control: '통제', support: '지원' };
  var CLASS_TAG = { thread: 'thr', memory: 'mem', process: 'prc', generic: 'gen', none: 'sys' };
  // v2 §6.3 계열 = 무채색 글리프 (색 없음): 공격=검 · 통제=자물쇠 · 지원=+
  var SERIES_PATH = {
    attack: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/>',
    control: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    support: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>'
  };
  function svgIco(paths, px, stroke, sw) {
    return el('span', { style: { display: 'inline-flex', lineHeight: 0, flex: 'none' },
      html: '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="' + (stroke || 'currentColor') + '" stroke-width="' + (sw || 2.2) + '" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>' });
  }
  function seriesIcon(card, px, color) { return svgIco(SERIES_PATH[deriveSeries(card)] || SERIES_PATH.support, px, color); }
  // v2 §6.2 오너 = 프레임(베벨 음영) + LED (테마 불변). 내=틸 / 적=마젠타
  var OWNER_FRAME = {}; OWNER_FRAME[HUMAN] = ['#2ec9c4', '#0c5551']; OWNER_FRAME[AI] = ['#f04b9a', '#7a1f4a'];
  var OWNER_LED = {}; OWNER_LED[HUMAN] = '#2ec9c4'; OWNER_LED[AI] = '#f04b9a';
  // 사양서 §4.1 명시 오버라이드 (다능력/예외 카드)
  var SERIES_OVERRIDE = { Const: 'control', Singleton: 'attack', Overlord: 'attack' };
  var _seriesCache = {};
  // 계열(공격/통제/지원) 도출 — 데이터에 displayCategory 없으면 효과문에서 추론
  function deriveSeries(card) {
    if (!card) return 'support';
    var id = card.id;
    if (id && _seriesCache[id]) return _seriesCache[id];
    var s = _computeSeries(card);
    if (id) _seriesCache[id] = s;
    return s;
  }
  function _computeSeries(card) {
    if (card.displayCategory) return card.displayCategory;
    if (SERIES_OVERRIDE[card.id]) return SERIES_OVERRIDE[card.id];
    var t = card.text || '';
    if (/반사/.test(t)) return 'control';                                  // 반사
    if (/봉쇄/.test(t)) return 'control';                                  // 구속
    if (/공격력\s*(-\d|영구\s*0|0\b)|약화/.test(t)) return 'control';       // 적 약화
    if (/밀어냄|밀어|강제\s*이동|내\s*쪽으로|당기/.test(t)) return 'control'; // 적 위치조작
    if (/받는\s*피해|피해받|피해\s*-\d|피해\s*절반|막음/.test(t)) return 'support'; // 방어·피해감소·실드
    if (/피해|공격력만큼/.test(t)) return 'attack';                        // 직접 피해
    if (/회복|체력\s*\+|공격력\s*\+|분신|생성|벽|복제|뽑기|드로|추가\s*(행동|이동)|이동|교환|점프|순간이동|복사|절반능력치|\+\d/.test(t)) return 'support';
    if (card.cls === 'thread') return 'attack';
    if (card.cls === 'memory') return 'control';
    if (card.cls === 'process') return 'support';
    if ((card.atk || 0) > 0 && (card.atk || 0) >= (card.hp || 0)) return 'attack';
    return 'support';
  }
  function seriesColor(card) { return SERIES_COLOR[deriveSeries(card)]; }
  function forRemaining(u) {
    var abs = (CARDS[u.cardId] && CARDS[u.cardId].abilities) || [], n = 0;
    abs.forEach(function (ab, idx) { if (ab.kw === 'For') n += Math.max(0, (ab.forCount || 1) - ((u.onceUsed && u.onceUsed['for' + idx]) || 0)); });
    return n;
  }
  // ===== v2 창(window) 부품 — 사양서 §10 매핑 =====
  // 베벨: 페이스에서 파생. raised = 상/좌 hi · 하/우 lo, sunken = 반전(§7).
  function raisedBev(hi, lo) { hi = hi || SKIN.faceHi; lo = lo || SKIN.faceLo; return { border: '2px solid', borderColor: hi + ' ' + lo + ' ' + lo + ' ' + hi }; }
  function sunkenBev() { return { border: '2px solid', borderColor: SKIN.faceLo + ' ' + SKIN.faceHi + ' ' + SKIN.faceHi + ' ' + SKIN.faceLo }; }
  // 오너 LED (내=틸 / 적=마젠타)
  function ledDot(owner, sz) { return el('span', { style: { width: (sz || 8) + 'px', height: (sz || 8) + 'px', flex: 'none', borderRadius: '50%', background: OWNER_LED[owner], border: '1px solid rgba(0,0,0,.45)', boxShadow: '0 0 0 1px rgba(255,255,255,.6), 0 0 4px ' + hexa(OWNER_LED[owner], .9) } }); }
  // 앱아이콘 = 계열(무채색 글리프). 타이틀바 좌측.
  function appIcon(card, sz) { sz = sz || 13; return el('span', { title: '계열 ' + SERIES_LABEL[deriveSeries(card)], style: { width: sz + 'px', height: sz + 'px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.28)' } }, [seriesIcon(card, Math.round(sz * 0.72), '#fff')]); }
  // 타이틀바 = 클래스색 배경 + [LED?][앱아이콘?][이름][배지?][우측컨트롤?]. 적=빗금(비활성 창).
  function winTitlebar(card, o) {
    o = o || {};
    var bg = CLS[card.cls] || CLS.generic, kids = [];
    if (o.led != null) kids.push(ledDot(o.led, o.ledPx));
    if (o.icon !== false) kids.push(appIcon(card, o.iconPx));
    var nameSt = { flex: 1, minWidth: 0, fontSize: (o.nameFs || 9) + 'px', fontWeight: 600, color: '#fff', letterSpacing: '.02em' };
    if (o.wrap) { nameSt.whiteSpace = 'normal'; nameSt.lineHeight = 1.05; nameSt.wordBreak = 'break-word'; } // 전체 이름 표시(줄바꿈 허용)
    else { nameSt.whiteSpace = 'nowrap'; nameSt.overflow = 'hidden'; nameSt.textOverflow = 'ellipsis'; }
    kids.push(el('span', { class: 'mono', style: nameSt }, [o.name != null ? o.name : card.name]));
    if (o.badge) kids.push(o.badge);
    if (o.right) kids.push(o.right);
    var st = { display: 'flex', alignItems: 'center', gap: (o.gap || 4) + 'px', padding: (o.pad || '3px 5px'), background: bg, color: '#fff', flex: 'none' };
    if (o.hatch) st.backgroundImage = 'repeating-linear-gradient(45deg,transparent,transparent 2px,rgba(0,0,0,.22) 2px,rgba(0,0,0,.22) 3px)';
    return el('div', { style: st }, kids);
  }
  // 사거리 = 타이틀바 우측 컨트롤(미니 그리드). 가운데=자기, 채운 칸=도달.
  function rangeCtrl(spec, d) {
    d = d || 3;
    if (spec.kind === 'label') return el('span', { class: 'mono', style: { fontSize: '7px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.3)', padding: '1px 3px', whiteSpace: 'nowrap', flex: 'none' } }, [spec.text]);
    var set = {}; spec.cells.forEach(function (c) { set[c[0] + ',' + c[1]] = 1; });
    var oc = 3, orow = spec.originBottom ? 5 : 3;
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5,' + d + 'px)', gridTemplateRows: 'repeat(5,' + d + 'px)', gap: '1px', padding: '2px', background: 'rgba(0,0,0,.3)', flex: 'none' } });
    for (var r = 1; r <= 5; r++) for (var c = 1; c <= 5; c++) {
      var dc = c - oc, dr = r - orow, cs = { width: d + 'px', height: d + 'px' };
      if (dc === 0 && dr === 0) cs.background = '#fff';
      else if (set[dc + ',' + dr]) cs.background = '#e8c86a';
      else cs.background = 'rgba(255,255,255,.18)';
      grid.appendChild(el('div', { style: cs }));
    }
    return grid;
  }
  // 기본 공격 뱃지 — 모든 유닛 공통(옆칸 1칸·무료·턴1회). 빨강 = 보드 ⚔칸/텍스트 「옆칸」과 동색.
  function basicAtkChip(compact) {
    var g = GLOSS['옆칸'];
    // 카드 시스템의 표준 다크칩(⚙/✕/라벨과 동일) — 클래스색 타이틀바 위에서도 항상 가독.
    return el('span', { class: 'mono', style: { fontSize: '7px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.3)', padding: '0 3px', flex: 'none', whiteSpace: 'nowrap', letterSpacing: '.02em', cursor: 'help', lineHeight: 1.5 }, onmouseenter: function (e) { showKwTip(e.currentTarget, g); }, onmouseleave: hideKwTip }, [compact ? '⚔' : '⚔옆칸']);
  }
  // 카드 일러스트 매핑(window.RT_ART = art-map.js) 조회. 값은 문자열(경로) 또는 {src,pos,fit}.
  // 라이브로 window.RT_ART 를 읽으므로 dev.html 에서 객체를 교체하면 즉시 반영된다.
  function cardArt(card) {
    var m = window.RT_ART; if (!m || !card) return null;
    var v = m[card.id]; if (!v) return null;
    if (typeof v === 'string') return { src: v, pos: '50% 50%', fit: 'cover' };
    if (!v.src) return null;
    return { src: v.src, pos: v.pos || '50% 50%', fit: v.fit || 'cover' };
  }
  // 뷰포트 위에 덮는 일러스트 이미지 레이어(글리프를 가림). 로드 실패 시 스스로 제거 → 글리프 폴백 노출.
  function artLayer(card) {
    var a = cardArt(card); if (!a) return null;
    return el('img', { src: a.src, alt: '', style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: a.fit, objectPosition: a.pos, display: 'block' }, onerror: function () { if (this.parentNode) this.parentNode.removeChild(this); } });
  }
  // 뷰포트 = 콘텐츠 영역(일러스트). 일러스트 있으면 이미지, 없으면 클래스 틴트 글리프.
  function viewportBox(card, hgt, opts) {
    opts = opts || {};
    var cl = CLS[card.cls] || CLS.generic, g = GLY[card.cls] || GLY.generic;
    var st = Object.assign({ position: 'relative', height: hgt + 'px', margin: opts.margin || '3px 2px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SKIN.viewportBg, overflow: 'hidden' }, sunkenBev());
    return el('div', { style: st }, [
      el('span', { style: { fontSize: Math.round(hgt * (opts.gScale || 0.44)) + 'px', lineHeight: 1, color: cl } }, [g]),
      artLayer(card)
    ]);
  }
  // 효과문 패널(sunken). richText 키워드 내장. flex 하한(§9).
  function effectPanel(card, opts) {
    opts = opts || {};
    var st = Object.assign({ margin: '3px 2px 0', background: SKIN.effBg, color: SKIN.effTxt, fontSize: (opts.fs || 8) + 'px', lineHeight: 1.4, padding: '3px 5px', minHeight: (opts.min != null ? opts.min : 26) + 'px', overflow: 'hidden' }, opts.flex ? { flex: 1 } : {}, sunkenBev());
    return el('div', { style: st }, richText(card.text));
  }
  // HP 뉴트럴 미터 — 정수1=칸1. 채움=hpFill, 저체력(≤34%)=heat. 빈칸=트랙.
  function hpMeter(cur, max, opts) {
    opts = opts || {}; max = Math.max(1, Math.round(max || 1)); cur = Math.max(0, Math.min(Math.round(cur), max));
    var low = cur / max <= 0.34, h = opts.h || 8;
    var wrap = el('div', { style: { flex: 1, display: 'flex', gap: '1px', minWidth: 0 } });
    for (var i = 0; i < max; i++) {
      var on = i < cur, cs = { flex: 1, minWidth: 0, height: h + 'px', background: on ? (low ? SKIN.heat : SKIN.hpFill) : 'transparent' };
      if (!on) cs.boxShadow = 'inset 0 0 0 1px rgba(128,128,128,.3)';
      wrap.appendChild(el('div', { style: cs }));
    }
    return wrap;
  }
  // 상태바 = 좌 ATK 필드 | 우 HP 뉴트럴 미터. (인스턴스 전용 — 포인터엔 없음)
  function statusStrip(atk, hp, maxHp, opts) {
    opts = opts || {};
    var atkEl = el('div', { style: Object.assign({ flex: '0 0 ' + (opts.atkW || 42) + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', padding: '2px 0', background: SKIN.atkField, color: SKIN.effTxt }, sunkenBev()) }, [
      svgIco(SERIES_PATH.attack, opts.icoPx || 10, 'currentColor', 2),
      el('b', { class: 'mono', style: { fontSize: (opts.fs || 11) + 'px', fontWeight: 700, color: opts.buffed ? SKIN.buff : 'inherit', lineHeight: 1 } }, [String(atk)])
    ]);
    // 모바일: 체력을 미터 대신 '숫자'로 표시(작은 카드에서 한눈에). 데스크톱: 기존 뉴트럴 미터.
    var hpEl = el('div', { style: Object.assign({ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: COMPACT ? 'center' : 'flex-start', gap: '3px', padding: '2px 4px', background: SKIN.hpTrack, color: SKIN.effTxt }, sunkenBev()) }, [
      el('span', { style: { fontSize: (opts.icoPx || 9) + 'px', lineHeight: 1, flex: 'none' } }, ['♥']),
      COMPACT
        ? el('b', { class: 'mono', style: { fontSize: (opts.fs || 11) + 'px', fontWeight: 700, lineHeight: 1, flex: 'none' } }, [String(hp)])
        : hpMeter(hp, maxHp, { h: opts.meterH || 8 })
    ]);
    return el('div', { style: { display: 'flex', gap: '3px', margin: opts.margin || '3px 2px 2px' } }, [atkEl, hpEl]);
  }

  // ---- keyword glossary + hover tooltips
  var GLOSS = {
    'If': { t: 'If · 선택 발동', d: '조건이 맞을 때, 내가 원하면 골라서 발동(횟수 제한 없음).' },
    'When': { t: 'When · 자동 발동', d: '조건이 맞을 때마다 강제로 자동 발동.' },
    'Once': { t: 'Once · 1회 발동', d: '조건이 맞으면 게임 중 딱 한 번만 발동.' },
    'While': { t: 'While · 지속 효과', d: '조건이 유지되는 동안 계속 적용되는 상시 효과.' },
    'For': { t: 'For(N) · 능동·턴1회', d: '내 턴마다 1번 직접 발동, 게임 전체에서 총 N번까지. 발동은 무료(액션 소비 X).' },
    'require': { t: 'require · 선언 조건', d: '이 인스턴스가 필드에 존재하기 위한 사전 조건.' },
    '시전 조건': { t: '시전 조건', d: '이 포인터를 시전하기 위한 사전 조건.' },
    '시전조건': { t: '시전 조건', d: '이 포인터를 시전하기 위한 사전 조건.' },
    'thread': { t: 'thread · 공격형', d: '공高체低 글래스캐논. 집단 ATK 시너지·근접 압박. process에 강하고 memory에 약함.' },
    'memory': { t: 'memory · 방어형', d: '공低체高. 벽·봉쇄·반사로 통제. thread에 강하고 process에 약함.' },
    'process': { t: 'process · 유틸형', d: '변칙 사거리·강제 이동·포인터 콤보. memory에 강하고 thread에 약함.' },
    'generic': { t: 'generic · 무클래스', d: '어느 덱에나 넣는 독립형. 단일 클래스 판정을 깨지 않는다.' },
    '본체': { t: '본체', d: '플레이어 거점(HP 50). 0 이하면 패배. 보드 칸이라 인접·사거리에 포함된다.' },
    '봉쇄': { t: '봉쇄(묶음)', d: '이동 불가 상태. 기본 공격·함수는 가능, 이동만 막힌다.' },
    '관통': { t: '관통(벽 너머)', d: '중간의 벽·유닛을 무시하고 직선상의 대상을 타격.' },
    '벽 너머': { t: '벽 너머(관통)', d: '중간의 벽·유닛을 무시하고 직선상의 대상을 타격.' },
    '분신': { t: '분신(토큰)', d: '덱 밖에서 생성되는 임시 인스턴스.' },
    '인스턴스': { t: '인스턴스(오브젝트)', d: '필드 칸에 놓이는 카드. 공격력·체력을 가진다.' },
    '포인터': { t: '포인터', d: '1회성 주문 카드. 필드에 남지 않고 시전에 액션 1을 쓴다.' },
    '공격력': { t: '공격력(ATK)', d: '함수·기본 공격이 참조하는 피해 수치.' },
    '체력': { t: '체력(HP)', d: '0 이하가 되면 파괴. 피해는 턴을 넘겨 누적된다.' },
    '회복': { t: '회복', d: '누적된 피해를 줄인다(최대 체력까지).' },
    '영구': { t: '영구', d: '효과가 해제 없이 지속된다.' },
    '옆칸': { t: '옆칸 = 기본 공격 범위', d: '상하좌우로 붙은 4칸(cross1). 모든 유닛의 기본 공격이 닿는 범위와 같은 모양 — 보드의 빨강 ⚔ 칸.' },
    '옆 칸': { t: '옆칸 = 기본 공격 범위', d: '상하좌우로 붙은 4칸(cross1). 모든 유닛의 기본 공격이 닿는 범위와 같은 모양 — 보드의 빨강 ⚔ 칸.' },
    '주위': { t: '주위', d: '대각선까지 포함해 둘러싼 8칸 = square(1).' },
    '밀어내기': { t: '밀어내기(넉백)', d: '대상을 적 진영 방향(시전자 반대편)으로 1칸 이동. 그 칸이 비어 있어야 하며, 벽·유닛·판 끝으로 막혔으면 시전 불가.' },
    '끌어당기기': { t: '끌어당기기', d: '대상을 시전자 본체 방향으로 1칸 이동. 시전자 앞칸이 비어 있어야 하며, 막혔으면 시전 불가.' },
    '1칸이동': { t: '1칸 이동', d: '상하좌우 인접한 빈 칸으로 1칸 옮긴다. 목적 칸이 막혔으면 이동/시전 불가.' },
    '앞 직선': { t: '앞 직선', d: '적 본체 방향으로 뻗는 직선 사거리.' },
    '대각선': { t: '대각선', d: '네 대각 방향으로 뻗는 사거리 = diagonal(N).' },
    '테두리': { t: '테두리', d: '특정 거리의 둘레 칸 = ring(N).' }
  };
  var kwtip = null;
  function ensureTip() {
    if (!kwtip) { kwtip = el('div', { style: { position: 'fixed', zIndex: 200, maxWidth: '244px', background: '#1d1d24', color: '#e9eaee', boxShadow: '3px 3px 0 rgba(28,28,38,.4)', padding: '8px 10px', display: 'none', pointerEvents: 'none' } }); document.body.appendChild(kwtip); }
    return kwtip;
  }
  function showKwTip(elm, g) {
    var t = ensureTip(); t.innerHTML = '';
    t.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, color: '#fff', marginBottom: '3px', letterSpacing: '.03em' } }, [g.t]));
    t.appendChild(el('div', { style: { fontSize: '11px', lineHeight: 1.5, color: '#cfd0d6' } }, [g.d]));
    t.style.display = 'block';
    var r = elm.getBoundingClientRect(), top = r.bottom + 6, left = Math.max(6, Math.min(r.left, window.innerWidth - 252));
    if (top + (t.offsetHeight || 70) > window.innerHeight) top = Math.max(6, r.top - (t.offsetHeight || 70) - 6);
    t.style.top = top + 'px'; t.style.left = left + 'px';
  }
  function hideKwTip() { if (kwtip) kwtip.style.display = 'none'; }
  var MODE_KW = { If: 1, When: 1, Once: 1, While: 1, For: 1 };
  // 옆칸 = 기본 공격과 같은 칸 → 텍스트에서도 빨강으로 색통일(보드 ⚔칸·기본공격 뱃지와 동색).
  var ATTACK_KW = { '옆칸': 1, '옆 칸': 1 };
  var KW_PHRASES = Object.keys(GLOSS).sort(function (a, b) { return b.length - a.length; });
  function richText(text) {
    if (!text) return [];
    var nodes = [], i = 0, buf = '';
    function flush() { if (buf) { nodes.push(document.createTextNode(buf)); buf = ''; } }
    while (i < text.length) {
      var m = null;
      for (var p = 0; p < KW_PHRASES.length; p++) { var ph = KW_PHRASES[p]; if (text.substr(i, ph.length) === ph) { m = ph; break; } }
      if (m) {
        flush();
        var isMode = MODE_KW[m];
        var style = isMode
          ? { fontFamily: "'Space Mono',monospace", fontSize: '9.5px', fontWeight: 700, color: '#fff', background: '#1d1d24', padding: '1px 5px', margin: '0 1px', borderRadius: '2px', cursor: 'help', whiteSpace: 'nowrap' }
          : ATTACK_KW[m]
            ? { color: SKIN.enemy, borderBottom: '1.5px solid ' + SKIN.enemy, cursor: 'help', fontWeight: 700 }
            : { borderBottom: '1px dotted #8a8a92', cursor: 'help', fontWeight: 600 };
        nodes.push(el('span', { style: style, onmouseenter: function (g) { return function (e) { showKwTip(e.currentTarget || e.target, g); }; }(GLOSS[m]), onmouseleave: hideKwTip }, [m]));
        i += m.length;
      } else { buf += text[i]; i++; }
    }
    flush();
    return nodes;
  }

  // ---- animation / fx layer (event-driven; overlays survive full re-renders)
  var prevPct = {}, fxHit = {}, fxSpawn = {}, drawPulse = false, fxTimer = null, feed = [], winSoundDone = false;
  var impactDelay = 0, idTimer = null, stopping = false, pendingPlay = null, lungingKeys = {}, lastBannerTurn = -1;
  var reviewMode = false; // 게임 종료 후 결과 오버레이를 닫고 최종 보드를 살펴보는 중
  var menuView = null;    // 모바일 메뉴 바텀시트: null | 'menu' | 'confirm' | 'rules'
  var RAF = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };
  function resetFx() { prevPct = {}; fxHit = {}; fxSpawn = {}; drawPulse = false; feed = []; actionToast = null; winSoundDone = false; reviewMode = false; }
  // hover card detail tooltip (board units + feed entries)
  var cardTip = null;
  function ensureCardTip() { if (!cardTip) { cardTip = el('div', { style: { position: 'fixed', zIndex: 120, width: '208px', background: SKIN.chassis, color: SKIN.txt, border: '1.5px solid ' + SKIN.ink, boxShadow: '4px 4px 0 rgba(0,0,0,.4)', display: 'none', pointerEvents: 'none', overflow: 'hidden' } }); document.body.appendChild(cardTip); } return cardTip; }
  function hideCardTip() { if (cardTip) cardTip.style.display = 'none'; }
  function showCardTip(rect, id, unit) {
    if (!id || !CARDS[id]) { hideCardTip(); return; }
    var t = ensureCardTip(); t.innerHTML = ''; t.appendChild(cardTipContent(id, unit)); t.style.display = 'block';
    var left = rect.right + 8; if (left + 214 > window.innerWidth) left = rect.left - 214; if (left < 6) left = 6;
    var top = rect.top; if (top + (t.offsetHeight || 200) > window.innerHeight) top = Math.max(6, window.innerHeight - (t.offsetHeight || 200) - 6);
    t.style.left = left + 'px'; t.style.top = Math.max(6, top) + 'px';
  }
  function cardTipContent(id, unit) {
    var card = CARDS[id], cl = CLS[card.cls] || CLS.generic, isP = card.kind === 'pointer';
    if (card.kind === 'body') { var bh = unit ? G.curHp(unit) : 0, bm = unit ? G.effMaxHp(unit) : 50; return el('div', { style: { padding: '9px 10px' } }, [el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '15px' } }, [(unit && unit.owner === HUMAN ? '내' : '상대') + ' 본체']), el('div', { class: 'mono', style: { fontSize: '12px', marginTop: '3px' } }, ['HP ' + bh + ' / ' + bm])]); }
    var atk = unit ? G.effAtk(unit) : card.atk, hp = unit ? G.curHp(unit) : card.hp;
    return el('div', {}, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', background: isP ? '#1d1d24' : cl, borderBottom: isP ? '2px solid ' + cl : 'none' } }, [
        el('span', { style: { fontSize: '12px', color: isP ? cl : '#fff' } }, [isP ? '◆' : GLY[card.cls]]),
        el('span', { style: { fontSize: '9px', color: isP ? cl : '#fff', letterSpacing: '.08em' } }, [isP ? '포인터' : card.cls]),
        unit ? el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '8px', color: '#fff', background: ownerColor(unit.owner), padding: '0 4px' } }, [unit.owner === HUMAN ? '내 유닛' : '상대 유닛']) : el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '8px', color: isP ? SKIN.faint : '#fff' } }, [isP ? 'POINTER' : 'OBJECT'])
      ]),
      el('div', { style: { padding: '7px 9px' } }, [
        el('div', { class: isP ? 'mono' : 'grot', style: { fontWeight: 700, fontSize: '16px', marginBottom: '5px' } }, [card.name]),
        isP ? null : el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' } }, [statBar('ATK', atk, ATK_MAX, SKIN.heat, unit ? card.atk : null), statBar('HP', hp, HP_MAX, SKIN.own)]),
        el('div', { style: { fontSize: '11px', color: SKIN.txt, lineHeight: 1.5, marginBottom: '6px' } }, richText(card.text)),
        (isP && RT.pointerRangeInfo(id)) ? el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.own, fontWeight: 700, marginBottom: '5px' } }, ['시전 사거리 · ' + RT.pointerRangeInfo(id).text]) : null,
        (isP && card.castCondition) ? el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.enemy, fontWeight: 700, marginBottom: '5px' } }, ['⚠ 조건 · ' + RT.castCondText(card.castCondition)]) : null,
        isP ? null : el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.enemy, fontWeight: 700, marginBottom: '5px' } }, ['⚔ 기본 공격 · 옆칸 1칸']),
        rangeGridEl(RT.cardRange(id), cl)
      ])
    ]);
  }
  function cardNm(id) { return CARDS[id] ? CARDS[id].name : id; }
  function sideLabel(o) { return o === HUMAN ? '나' : '상대'; }
  function labelAt(key) { var u = G.board[key]; if (!u) return '(' + key + ')'; var nm = u.type === 'body' ? (sideLabel(u.owner) + ' 본체') : (sideLabel(u.owner) + ' ' + cardNm(u.cardId)); return nm + ' (' + key + ')'; }
  function cardAtId(key) { var u = G.board[key]; return u ? u.cardId : null; }
  function pushFeed(en) { feed.unshift(en); if (feed.length > 26) feed.pop(); }
  function fxLayer() { var l = document.getElementById('fxlayer'); if (!l) { l = el('div', { id: 'fxlayer', style: { position: 'fixed', inset: '0', zIndex: 80, pointerEvents: 'none', overflow: 'hidden' } }); document.body.appendChild(l); } return l; }
  function rectOf(key) { var e = app.querySelector('[data-key="' + key + '"]'); return e ? e.getBoundingClientRect() : null; }
  function anim(node, frames, opts) { if (node.animate) { try { node.animate(frames, opts).onfinish = function () { node.remove(); }; return; } catch (e) {} } setTimeout(function () { node.remove(); }, 30); }
  function floatNum(rect, txt, color) {
    if (!rect) return;
    var n = el('div', { class: 'mono', style: { position: 'fixed', left: (rect.left + rect.width / 2) + 'px', top: (rect.top + 2) + 'px', transform: 'translateX(-50%)', color: color, fontWeight: 700, fontSize: '21px', textShadow: '0 1px 0 #e9eaee,0 0 4px rgba(255,255,255,.7)', zIndex: 90 } }, [txt]);
    fxLayer().appendChild(n);
    anim(n, [{ transform: 'translate(-50%,8px)', opacity: 0 }, { transform: 'translate(-50%,-4px)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-38px)', opacity: 0 }], { duration: 950, easing: 'ease-out' });
  }
  function travel(fromR, toR, glyph, color, size) {
    if (!fromR || !toR) return;
    var n = el('div', { style: { position: 'fixed', left: (fromR.left + fromR.width / 2) + 'px', top: (fromR.top + fromR.height / 2) + 'px', color: color, fontSize: (size || 18) + 'px', fontWeight: 700, zIndex: 90, textShadow: '0 1px 2px rgba(0,0,0,.35)' } }, [glyph]);
    fxLayer().appendChild(n);
    var dx = toR.left - fromR.left, dy = toR.top - fromR.top;
    anim(n, [{ transform: 'translate(-50%,-50%) scale(.7)' }, { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(1.15)' }], { duration: 260, easing: 'cubic-bezier(.5,0,.85,1)' });
  }
  function ringFx(rect, color) {
    if (!rect) return;
    var n = el('div', { style: { position: 'fixed', left: (rect.left + rect.width / 2) + 'px', top: (rect.top + rect.height / 2) + 'px', width: '12px', height: '12px', border: '2px solid ' + color, borderRadius: '50%', transform: 'translate(-50%,-50%)', zIndex: 88 } });
    fxLayer().appendChild(n);
    anim(n, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(4)', opacity: 0 }], { duration: 430, easing: 'ease-out' });
  }
  // ===== 타격감(juice) 프리미티브 =====
  function setImpactDelay(ms) { impactDelay = ms; clearTimeout(idTimer); idTimer = setTimeout(function () { impactDelay = 0; }, 90); }
  function screenShake(power) {
    if (!app) return; var name = power >= 2 ? 'hbShakeHard' : 'hbShake';
    app.style.animation = 'none'; void app.offsetWidth; app.style.animation = name + ' ' + (power >= 2 ? '0.42s' : '0.3s') + ' cubic-bezier(.36,.07,.19,.97)';
  }
  function hitstop(ms) {
    if (stopping || !document.getAnimations) return; var list;
    try { list = document.getAnimations(); } catch (e) { return; }
    stopping = true; list.forEach(function (a) { try { a.pause(); } catch (e) {} });
    setTimeout(function () { list.forEach(function (a) { try { a.play(); } catch (e) {} }); stopping = false; }, ms);
  }
  function flashTile(rect, color, dur) {
    if (!rect) return; var n = el('div', { style: { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', background: color, borderRadius: '3px', zIndex: 89, mixBlendMode: 'screen' } });
    fxLayer().appendChild(n); anim(n, [{ opacity: 0.95 }, { opacity: 0 }], { duration: dur || 170, easing: 'ease-out' });
  }
  function shockwave(rect, color, power) {
    if (!rect) return; var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var n = el('div', { style: { position: 'fixed', left: cx + 'px', top: cy + 'px', width: '10px', height: '10px', border: Math.round(3 * power) + 'px solid ' + color, borderRadius: '50%', transform: 'translate(-50%,-50%)', zIndex: 88 } });
    fxLayer().appendChild(n); anim(n, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .95 }, { transform: 'translate(-50%,-50%) scale(' + (3 + power) + ')', opacity: 0 }], { duration: 430, easing: 'cubic-bezier(.1,.7,.3,1)' });
  }
  function shards(rect, color, n, power) {
    if (!rect) return; var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (var i = 0; i < n; i++) (function () {
      var sz = 3 + Math.random() * 4 * power, p = el('div', { style: { position: 'fixed', left: cx + 'px', top: cy + 'px', width: sz + 'px', height: sz + 'px', background: color, borderRadius: '1px', boxShadow: '0 0 6px ' + color, zIndex: 90 } });
      fxLayer().appendChild(p); var ang = Math.random() * Math.PI * 2, dist = (28 + Math.random() * 42) * power, dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      anim(p, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.2)', opacity: 0 }], { duration: 380 + Math.random() * 260, easing: 'cubic-bezier(.2,.6,.3,1)' });
    })();
  }
  function punchNum(rect, txt, size, color) {
    if (!rect) return; var n = el('div', { class: 'grot', style: { position: 'fixed', left: (rect.left + rect.width / 2) + 'px', top: (rect.top + rect.height / 2) + 'px', transform: 'translate(-50%,-50%)', color: color, fontWeight: 800, fontSize: size + 'px', letterSpacing: '.02em', textShadow: '0 0 3px #000,0 2px 0 #000,2px 0 0 #000,-2px 0 0 #000,0 -2px 0 #000,2px 2px 0 #000,-2px 2px 0 #000', zIndex: 92, whiteSpace: 'nowrap' } }, [txt]);
    fxLayer().appendChild(n); anim(n, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-65%) scale(1.45)', opacity: 1, offset: .18 }, { transform: 'translate(-50%,-80%) scale(1)', opacity: 1, offset: .42 }, { transform: 'translate(-50%,-150%) scale(.95)', opacity: 0 }], { duration: 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
  function squashTile(key) {
    var e = app.querySelector('[data-key="' + key + '"]'); if (!e || !e.animate) return;
    try { e.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.2,.8)', offset: .25 }, { transform: 'scale(.88,1.14)', offset: .5 }, { transform: 'scale(1.04,.97)', offset: .75 }, { transform: 'scale(1,1)' }], { duration: 320, easing: 'ease-out' }); } catch (e2) {}
  }
  function orb(fromR, toR, color, dur) {
    if (!fromR || !toR) return; var dx = toR.left - fromR.left, dy = toR.top - fromR.top;
    var n = el('div', { style: { position: 'fixed', left: (fromR.left + fromR.width / 2) + 'px', top: (fromR.top + fromR.height / 2) + 'px', width: '18px', height: '18px', borderRadius: '50%', background: color, zIndex: 90, boxShadow: '0 0 16px 4px ' + color } });
    fxLayer().appendChild(n); anim(n, [{ transform: 'translate(-50%,-50%) scale(.45)', opacity: .5 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .16 }, { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(1.05)', opacity: 1 }], { duration: dur || 185, easing: 'cubic-bezier(.5,0,.9,1)' });
  }
  // 손패 → 필드로 카드가 날아가는 연출 (하스스톤식 카드 플레이)
  function cardFly(fromRect, toKey, color, label) {
    var to = rectOf(toKey); if (!fromRect || !to) return;
    var fcx = fromRect.left + fromRect.width / 2, fcy = fromRect.top + fromRect.height / 2;
    var tcx = to.left + to.width / 2, tcy = to.top + to.height / 2, dx = tcx - fcx, dy = tcy - fcy;
    var n = el('div', { class: 'grot', style: { position: 'fixed', left: (fcx - fromRect.width / 2) + 'px', top: (fcy - fromRect.height / 2) + 'px', width: fromRect.width + 'px', height: fromRect.height + 'px', background: '#fff', border: '2px solid #1d1d24', borderTop: '5px solid ' + color, boxShadow: '0 12px 26px rgba(0,0,0,.45)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontWeight: 800, fontSize: '13px', color: '#1d1d24', borderRadius: '4px', padding: '4px' } }, [label || '']);
    fxLayer().appendChild(n);
    var endScale = Math.max(0.3, to.width / fromRect.width);
    anim(n, [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy * 0.5 - 46) + 'px) scale(1.22) rotate(-3deg)', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + endScale + ') rotate(0deg)', opacity: 0.85 }
    ], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' });
  }
  // 공격 유닛이 대상으로 돌진했다 복귀 (clone 으로 리렌더 영향 없이)
  function lungeClone(fromKey, toKey) {
    var src = app.querySelector('[data-key="' + fromKey + '"]'), toR = rectOf(toKey);
    if (!src || !toR) return; var fr = src.getBoundingClientRect(); if (!fr.width) return;
    var clone = src.cloneNode(true); clone.removeAttribute('data-key');
    var s = clone.style; s.position = 'fixed'; s.left = fr.left + 'px'; s.top = fr.top + 'px'; s.width = fr.width + 'px'; s.height = fr.height + 'px'; s.margin = '0'; s.zIndex = 93; s.pointerEvents = 'none'; s.background = 'transparent'; s.border = 'none'; s.boxShadow = 'none';
    fxLayer().appendChild(clone);
    var dx = (toR.left - fr.left) * 0.6, dy = (toR.top - fr.top) * 0.6;
    lungingKeys[fromKey] = 1;
    var done = function () { if (clone.parentNode) clone.remove(); delete lungingKeys[fromKey]; if (G && G.winner === undefined) render(); };
    if (clone.animate) {
      var a = clone.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: 'translate(' + (-dx * 0.12) + 'px,' + (-dy * 0.12) + 'px) scale(1.04)', offset: 0.2 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.13)', offset: 0.45 },
        { transform: 'translate(0,0) scale(1)' }
      ], { duration: 400, easing: 'cubic-bezier(.3,.05,.3,1)' });
      a.onfinish = done;
    } else setTimeout(done, 400);
  }
  // 턴 시작 시네마틱 배너 (한 번 휙 지나감)
  function turnBanner(text, color) {
    var n = el('div', { class: 'grot', style: { position: 'fixed', left: 0, right: 0, top: '38%', textAlign: 'center', zIndex: 96, pointerEvents: 'none', fontWeight: 700, fontSize: 'clamp(28px,6vw,64px)', letterSpacing: '.12em', color: '#fff', textShadow: '0 0 18px ' + color + ',0 3px 0 rgba(0,0,0,.4)' } }, [text]);
    var bar = el('div', { style: { position: 'fixed', left: 0, right: 0, top: 'calc(38% - 14px)', height: 'clamp(54px,11vw,104px)', zIndex: 95, pointerEvents: 'none', background: 'linear-gradient(90deg,transparent,' + hexa(color, .32) + ',transparent)' } });
    fxLayer().appendChild(bar); fxLayer().appendChild(n);
    anim(bar, [{ opacity: 0, transform: 'scaleX(.3)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' });
    anim(n, [{ opacity: 0, transform: 'translateX(-40px) scale(.9)' }, { opacity: 1, transform: 'translateX(0) scale(1)', offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: 'translateX(40px) scale(1.05)' }], { duration: 1100, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
  // 피해 명중 순간 = 모든 연출을 한 번에 (타격감)
  function doImpact(key, amount, isBody) {
    var rect = rectOf(key), heavy = isBody || amount >= 5, power = isBody ? 2 : Math.min(2, 0.7 + amount * 0.18);
    if (rect) {
      flashTile(rect, isBody ? 'rgba(255,140,100,.95)' : 'rgba(255,255,255,.9)', heavy ? 200 : 150);
      shockwave(rect, isBody ? '#ff5a3c' : '#ffd34d', heavy ? 1.6 : 1);
      shards(rect, isBody ? '#ff7a4c' : (amount >= 5 ? '#ffd34d' : '#d8472b'), heavy ? 16 : Math.max(6, amount * 3), power);
      squashTile(key);
      var sz = isBody ? 42 : (amount >= 7 ? 36 : amount >= 4 ? 30 : 23);
      punchNum(rect, '−' + amount, sz, isBody ? '#ff5a3c' : (amount >= 5 ? '#ffe14d' : '#ff8a5c'));
    }
    if (isBody) Sound.bodyhit(); else if (amount >= 6) Sound.crit(); else Sound.hit();
    screenShake(heavy ? 2 : 1); hitstop(heavy ? 70 : 42);
  }
  function handleFx(ev) {
    if (!ev) return;
    if (ev.type === 'damage') {
      var d = impactDelay; impactDelay = 0; var bodyHit = isBodyKey(ev.key), key = ev.key, amt = ev.amount;
      setTimeout(function () { doImpact(key, amt, bodyHit); }, d);
      scheduleFxClear();
      if (ev.fatigue) {
        fatigueFx(key, amt);
        pushFeed({ actor: undefined, icon: '🃏', kind: 'fatigue', card: null, text: '덱 소진(피로) → ' + labelAt(key) + ' −' + amt + ' · 드로우 대신 본체 피해' });
      } else {
        pushFeed({ actor: ev.srcOwner, icon: '✸', kind: 'damage', card: ev.srcCard || cardAtId(ev.key), text: (ev.srcCard ? cardNm(ev.srcCard) : '피해') + ' → ' + labelAt(ev.key) + ' −' + ev.amount });
      }
    }
    else if (ev.type === 'heal') { floatNum(rectOf(ev.key), '+' + ev.amount, '#3c8a66'); ringFx(rectOf(ev.key), '#3c8a66'); Sound.heal(); pushFeed({ actor: G.board[ev.key] ? G.board[ev.key].owner : undefined, icon: '＋', kind: 'heal', card: cardAtId(ev.key), text: labelAt(ev.key) + ' +' + ev.amount + ' 회복' }); }
    else if (ev.type === 'attack') { setImpactDelay(180); lungeClone(ev.from, ev.to); Sound.whoosh(); }
    else if (ev.type === 'cast') { if (ev.player === HUMAN && pendingPlay) { cardFly(pendingPlay.rect, ev.targetKey || bodyKey(ev.player), CLS[(CARDS[ev.cardId] || {}).cls] || CLS.generic, cardNm(ev.cardId)); pendingPlay = null; } if (ev.player !== HUMAN) revealCard(ev.cardId, ev.player); var tr = ev.targetKey ? rectOf(ev.targetKey) : null; if (tr) { setImpactDelay(185); orb(rectOf(bodyKey(ev.player)), tr, '#3f7bd6', 185); ringFx(tr, '#2456a6'); } Sound.cast(); setActionToast(ev.player, '◆ ' + cardNm(ev.cardId) + ' 시전'); pushFeed({ actor: ev.player, icon: '◆', kind: 'cast', card: ev.cardId, text: cardNm(ev.cardId) + ' 시전' + (ev.targetKey ? ' → ' + labelAt(ev.targetKey) : '') }); }
    else if (ev.type === 'move') { var u = G.board[ev.to]; travel(rectOf(ev.from), rectOf(ev.to), GLY[(u && cardCls(u)) || 'generic'] || '◆', '#1d1d24', 16); Sound.move(); }
    else if (ev.type === 'spawn') { if (ev.key) fxSpawn[ev.key] = 1; scheduleFxClear(); var scol = CLS[(CARDS[ev.card] || {}).cls] || CLS.generic; if (ev.owner === HUMAN && pendingPlay) { cardFly(pendingPlay.rect, ev.key, scol, ev.card ? cardNm(ev.card) : ''); pendingPlay = null; } var sr = rectOf(ev.key); if (sr) { ringFx(sr, scol); shards(sr, scol, 8, 1.1); } Sound.spawn(); if (ev.card) { setActionToast(ev.owner, '＋ ' + cardNm(ev.card) + ' 선언'); pushFeed({ actor: ev.owner, icon: '＋', kind: 'spawn', card: ev.card, text: cardNm(ev.card) + ' 선언 (' + ev.key + ')' }); } }
    else if (ev.type === 'death') { var dcol = CLS[ev.cls] || '#6b6b75'; var r = rectOf(ev.key); if (r) { var n = el('div', { style: { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', background: hexa(dcol, .5), borderRadius: '3px', zIndex: 86 } }); fxLayer().appendChild(n); anim(n, [{ transform: 'scale(1)', opacity: .6 }, { transform: 'scale(.3) rotate(12deg)', opacity: 0 }], { duration: 360, easing: 'ease-in' }); shockwave(r, dcol, 1.3); shards(r, dcol, 18, 1.6); shards(r, '#1d1d24', 8, 1.3); } setTimeout(function () { screenShake(1); hitstop(40); }, 60); Sound.death(); pushFeed({ actor: ev.byOwner, icon: '✕', kind: 'death', card: ev.byCard || ev.victim, text: (ev.byCard ? cardNm(ev.byCard) + ' 로 ' : '') + sideLabel(ev.owner) + ' ' + cardNm(ev.victim) + ' (' + ev.key + ') 파괴' }); }
    else if (ev.type === 'stat') {
      // 자동/랜덤 대상 효과(버프·디버프·봉쇄)가 '어느 인스턴스'에 걸렸는지 명확히 — 해당 칸 위 플로팅 표시 + 링 + 토스트.
      var sr = rectOf(ev.key); if (!sr) return;
      var txt, col;
      if (ev.kind === 'atk') { txt = (ev.delta > 0 ? '+' : '−') + Math.abs(ev.delta) + ' ATK'; col = ev.delta > 0 ? '#2f7d3f' : SKIN.enemy; }
      else if (ev.kind === 'hp') { txt = (ev.delta > 0 ? '+' : '−') + Math.abs(ev.delta) + ' HP'; col = ev.delta > 0 ? '#3c8a66' : SKIN.enemy; }
      else if (ev.kind === 'zero') { txt = 'ATK 0'; col = SKIN.enemy; }
      else if (ev.kind === 'bind') { txt = '🔒 봉쇄' + (ev.delta ? ' ' + ev.delta + '턴' : ''); col = '#2456a6'; }
      else return;
      floatNum(sr, txt, col); ringFx(sr, col); flashTile(sr, hexa(col, .45), 240);
      setActionToast(ev.srcOwner != null ? ev.srcOwner : HUMAN, (ev.srcCard ? cardNm(ev.srcCard) + ' → ' : '') + labelAt(ev.key) + ' ' + txt);
      pushFeed({ actor: ev.srcOwner, icon: '◈', kind: 'stat', card: ev.srcCard, text: (ev.srcCard ? cardNm(ev.srcCard) + ' · ' : '') + labelAt(ev.key) + ' ' + txt });
    }
    else if (ev.type === 'draw') { if (ev.player === HUMAN) drawPulse = true; ejectCard(ev.player); Sound.draw(); }
  }
  // 상대(및 자동) 포인터 시전 시 어떤 카드인지 인지 가능한 속도로 큰 카드를 보여주고 사라지는 연출.
  function revealCard(cardId, owner) {
    var card = CARDS[cardId]; if (!card) return;
    if (owner !== HUMAN) aiRevealPause = true; // 상대가 카드를 낸 직후 AI 다음 동작을 잠시 늦춰 카드 확인 시간을 준다
    var cl = CLS[card.cls] || CLS.generic, isP = card.kind === 'pointer';
    var lbl = el('div', { class: 'grot', style: { position: 'fixed', left: '50%', top: '15%', transform: 'translateX(-50%)', zIndex: 111, fontWeight: 700, fontSize: '13px', color: '#fff', background: owner === HUMAN ? SKIN.own : SKIN.enemy, padding: '4px 14px', border: '1px solid ' + SKIN.ink, boxShadow: '2px 2px 0 rgba(0,0,0,.35)', pointerEvents: 'none', whiteSpace: 'nowrap' } }, [(owner === HUMAN ? '나' : '상대') + ' · ' + (isP ? '포인터 시전' : '카드') + ' — ' + card.name]);
    var wrap = el('div', { style: { position: 'fixed', left: '50%', top: '34%', transform: 'translate(-50%,-50%)', zIndex: 111, width: '216px', pointerEvents: 'none' } }, [
      el('div', { style: Object.assign({ background: SKIN.face, padding: '3px', boxShadow: '0 16px 34px rgba(0,0,0,.55)' }, raisedBev()) }, [
        winTitlebar(card, { iconPx: 15, nameFs: 12, hatch: owner !== HUMAN }),
        viewportBox(card, 92, { gScale: 0.5 }),
        el('div', { style: Object.assign({ margin: '3px 2px 0', background: SKIN.effBg, color: SKIN.effTxt, padding: '6px 7px', fontSize: '10.5px', lineHeight: 1.4 }, sunkenBev()) }, richText(card.text))
      ])
    ]);
    var L = fxLayer(); L.appendChild(lbl); L.appendChild(wrap);
    anim2(wrap, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.7) rotate(-4deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)' }], { duration: 300, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'both' });
    anim2(lbl, [{ opacity: 0, transform: 'translate(-50%,-6px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 260, easing: 'ease-out', fill: 'both' });
    setTimeout(function () {
      anim(wrap, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-58%) scale(.92)' }], { duration: 360, easing: 'ease-in' });
      anim(lbl, [{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-in' });
    }, 1550);
  }
  // like anim() but does NOT auto-remove the node on finish (for multi-stage reveals)
  function anim2(node, frames, opts) { if (node.animate) { try { node.animate(frames, opts); } catch (e) {} } }
  // 덱 소진(피로) 시스템 피해를 카드 효과와 확실히 구분되게 — 본체에 강한 경고 + 상단 배너.
  function fatigueFx(bodyKey, amt) {
    var r = rectOf(bodyKey);
    if (r) { punchNum(r, '🃏 −' + amt, 24, SKIN.heat); flashTile(r, hexa(SKIN.heat, .65), 320); screenShake(1); }
    var whose = (bodyKey === RT.bodyKey(HUMAN)) ? '내 ' : '상대 ';
    var t = el('div', { class: 'grot', style: { position: 'fixed', left: '50%', top: '108px', transform: 'translateX(-50%)', zIndex: 60, fontWeight: 700, fontSize: '13px', padding: '7px 15px', background: SKIN.heat, color: '#fff', border: '1px solid ' + SKIN.ink, boxShadow: '2px 2px 0 rgba(0,0,0,.35)', pointerEvents: 'none', whiteSpace: 'nowrap' } }, ['🃏 덱 소진(피로) · ' + whose + '본체 −' + amt + ' (드로우할 카드 없음)']);
    fxLayer().appendChild(t);
    anim(t, [{ opacity: 0, transform: 'translate(-50%,-8px)' }, { opacity: 1, transform: 'translate(-50%,0)', offset: .12 }, { opacity: 1, transform: 'translate(-50%,0)', offset: .82 }, { opacity: 0, transform: 'translate(-50%,-8px)' }], { duration: 1800, easing: 'ease-out' });
  }
  var actionToast = null, atTimer = null;
  function setActionToast(actor, text) { actionToast = { actor: actor, text: text }; clearTimeout(atTimer); atTimer = setTimeout(function () { actionToast = null; if (G && G.winner === undefined) render(); }, 1500); }
  function scheduleFxClear() { clearTimeout(fxTimer); fxTimer = setTimeout(function () { fxHit = {}; fxSpawn = {}; if (G && G.winner === undefined) render(); }, 360); }
  function tweenFill(key, cur, max, color, trackStyle) {
    var newPct = Math.max(0, Math.min(100, cur / max * 100));
    var old = prevPct[key] != null ? prevPct[key] : newPct;
    prevPct[key] = newPct;
    var fill = el('div', { style: { position: 'absolute', inset: '0', width: old + '%', background: color, transition: 'width .45s cubic-bezier(.4,0,.2,1)' } });
    if (old !== newPct) RAF(function () { fill.style.width = newPct + '%'; });
    return el('div', { style: trackStyle }, [fill]);
  }

  // =================================================================== TITLE / DECK SELECT

  // =================================================================== START + MULLIGAN
  function startMatch() { challenge = null; beginMatch(oppDeck === '__random' ? randomDeck() : oppDeck); }
  function beginMatch(opp) {
    var first = Math.random() < 0.5 ? 0 : 1;
    G = RT.newGame(myDeck, opp, { seed: (Date.now() & 0x7fffffff) >>> 0, first: first });
    G.oppKey = opp;
    if (challenge) applyChallengeHandicap(G, challenge.stage);
    sel = ptr = hover = pinned = null; mullPick = {};
    // mulligan intro state — coin flip(선후공) → deal → 필드 위 교체 선택 → play
    mullPhase = true; mullFirst = first; mullBusy = true; mullReady = false; mullCoinDone = false;
    mullHideIdx = G.players[HUMAN].hand.map(function (_, i) { return i; }); // 배분 전 전부 숨김
    resetFx(); G.onfx = handleFx;
    renderMulligan();
  }
  function randomDeck() { var ks = Object.keys(DECKS); return ks[Math.floor(Math.random() * ks.length)]; }
  // ---- 도전 모드: 스테이지가 오를수록 상대 AI가 강해진다(본체 HP·카드·선발 유닛 핸디캡)
  function startChallenge() { challenge = { stage: 1, wins: 0, deck: myDeck, baseBest: bestStreak(myDeck) }; beginMatch(randomDeck()); }
  function nextChallenge() { challenge.wins++; challenge.stage++; beginMatch(randomDeck()); }
  function endChallenge() { challenge = null; G = null; UI.renderTitle(); }
  function applyChallengeHandicap(g, stage) {
    if (stage <= 1) return;                                  // 1스테이지는 기본 난이도
    var b = g.body(AI); if (b) b.hpMod += (stage - 1) * 8;   // 점점 단단해지는 본체
    var extraCards = Math.min(stage - 1, 4); if (extraCards) g.draw(AI, extraCards); // 카드 우위
    var tokens = Math.min(Math.floor((stage - 1) / 2), 3);   // 선발 유닛(분신 공5/체2)
    for (var i = 0; i < tokens; i++) { var c = g.firstEmptyHome(AI); if (c) g.summon(AI, 'Token5', c); }
  }
  var mullPick = {}, mullBusy = false, mullPhase = false, mullReady = false, mullCoinDone = false, mullFirst = 0, mullHideIdx = [];
  var handFlyIn = null; // 멀리건→대국 전환 시 손패로 날아 들어오는 카드 인덱스(도착 전까지 숨김)
  // 멀리건을 실제 게임 필드(보드) 위에서 진행 — 선후공 코인플립 → 덱 디스펜서에서 딜링 → 필드 교체 선택 → 플레이.
  function renderMulligan() {
    clear(); // NOTE: do NOT reset mullPick here — that would wipe the selection on every click
    var wrap = el('div', { class: 'bevel', style: { background: SKIN.chassis, color: SKIN.txt, display: 'flex', flexDirection: 'column' } });
    if (COMPACT) { renderMulliganCompact(wrap); }
    else { renderMulliganDesktop(wrap); }

    // 배분 전/재배분 대상 카드는 숨겨 두고 애니메이션으로 등장시킨다.
    mullHideIdx.forEach(function (i) { var n = document.querySelector('[data-mull-idx="' + i + '"]'); if (n) n.style.opacity = '0'; });

    // 최초 진입: 선후공 코인플립 → 딜링(1회).
    if (!mullCoinDone) {
      mullCoinDone = true; mullBusy = true;
      runCoinFlip(function () {
        dealAiFlavor();
        var all = G.players[HUMAN].hand.map(function (_, i) { return i; });
        runMulliganDeal(all, function () { mullHideIdx = []; mullReady = true; mullBusy = false; renderMulligan(); });
      });
    }
  }
  // 선후공 코인플립 — 코인이 뒤집히며 결정된 선공에 착지.
  // 코인은 항상 fxLayer(뷰포트 고정, body 직속)에 그린다 → clear()/재렌더에도 지워지지 않아
  // 모바일 URL바 접힘 등으로 코인이 사라지던 문제 해결. 보드가 있으면 보드 중앙, 없으면 화면 중앙.
  function runCoinFlip(onDone) {
    var me = (mullFirst === HUMAN), meCol = '#2456a6', aiCol = '#c23c70';
    var parent = fxLayer(), cx, cy;
    var board = document.getElementById('board');
    if (board) { var r = board.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height * 0.42; }
    else { cx = (window.innerWidth || 360) / 2; cy = (window.innerHeight || 640) * 0.42; }
    function bs(pct, px) { return { position: 'fixed', left: cx + 'px', top: px + 'px', zIndex: 96, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }; }
    var cap = el('div', { class: 'mono', style: Object.assign(bs('30%', cy - 76), { fontSize: '12px', color: SKIN.muted }) }, ['선 · 후공 결정']);
    var coin = el('div', { class: 'grot', style: Object.assign(bs('48%', cy), { width: '86px', height: '86px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SKIN.gold, border: '3px solid ' + SKIN.ink, boxShadow: '0 12px 26px rgba(0,0,0,.4)', fontWeight: 700, fontSize: '24px', color: SKIN.ink }) }, ['?']);
    parent.appendChild(cap); parent.appendChild(coin);
    var flips = 0, TOTAL = 7;
    function half() {
      if (!coin.animate) { land(); return; }
      coin.animate([{ transform: 'translate(-50%,-50%) scaleY(1)' }, { transform: 'translate(-50%,-50%) scaleY(.05)' }], { duration: 90, easing: 'ease-in', fill: 'forwards' }).onfinish = function () {
        flips++;
        var settling = flips >= TOTAL;
        coin.textContent = settling ? (me ? '나' : '상대') : (flips % 2 === 0 ? '나' : '상대');
        coin.style.background = settling ? (me ? meCol : aiCol) : SKIN.gold;
        coin.style.color = settling ? '#fff' : SKIN.ink;
        Sound.move();
        coin.animate([{ transform: 'translate(-50%,-50%) scaleY(.05)' }, { transform: 'translate(-50%,-50%) scaleY(1)' }], { duration: 90, easing: 'ease-out', fill: 'forwards' }).onfinish = settling ? land : half;
      };
    }
    function land() {
      Sound.spawn();
      var banner = el('div', { class: 'grot', style: Object.assign(bs('66%', cy + 80), { fontWeight: 700, fontSize: '20px', color: (me ? meCol : aiCol), whiteSpace: 'nowrap' }) }, [me ? '선공 — 나' : '선공 — 상대(AI)']);
      parent.appendChild(banner);
      if (coin.animate) coin.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.22)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 300, easing: 'ease-out' });
      setTimeout(function () {
        [coin, cap, banner].forEach(function (n) { if (n.animate) { n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).onfinish = function () { n.remove(); }; } else n.remove(); });
        setTimeout(onDone, 250);
      }, 700);
    }
    setTimeout(half, 220);
  }
  // 상대 초기 패 배분 연출 — AI 디스펜서에서 뒷면 카드가 몇 장 배출(플레이버).
  function dealAiFlavor() {
    for (var i = 0; i < 5; i++) setTimeout(function () { ejectCard(AI); }, i * 110);
  }
  // 카드 뒷면(배출/반환 애니메이션용 플라이어). 카드 크기에 맞춰 생성.
  function cardBackEl(w, h, accent) {
    return el('div', { style: { position: 'fixed', width: w + 'px', height: h + 'px', zIndex: 90, pointerEvents: 'none', background: 'linear-gradient(135deg,' + SKIN.pcb2 + ',' + SKIN.pcb + ')', border: '1px solid ' + SKIN.edge, borderRadius: '5px', boxShadow: '0 10px 24px rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, [
      el('div', { style: { position: 'absolute', inset: '5px', border: '1px solid ' + hexa(SKIN.gold, .35), borderRadius: '3px' } }),
      el('span', { style: { fontSize: Math.round(h * 0.32) + 'px', color: hexa(SKIN.gold, .78), lineHeight: 1 } }, ['▦']),
      accent ? el('div', { style: { position: 'absolute', top: '6px', left: '6px', width: '16px', height: '4px', borderRadius: '2px', background: accent } }) : null
    ]);
  }
  function shoeEmitPoint() {
    // 딜링 배출점 = 내 덱 디스펜서 슬롯(실제 덱에서 카드가 나오는 지점).
    var slot = document.getElementById('deckslot-' + HUMAN) || document.getElementById('mullshoe');
    if (!slot) return null;
    var r = slot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function flashShoe() {
    var slot = document.getElementById('deckslot-' + HUMAN); if (!slot || !slot.animate) return;
    try { slot.animate([{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.5), inset 0 0 0 1px ' + SKIN.edge }, { boxShadow: 'inset 0 1px 3px rgba(0,0,0,.5), 0 0 10px 2px ' + hexa(SKIN.gold, .95) }, { boxShadow: 'inset 0 1px 3px rgba(0,0,0,.5), inset 0 0 0 1px ' + SKIN.edge }], { duration: 320, easing: 'ease-out' }); } catch (e) {}
  }
  // 슈 → 손패 슬롯으로 카드가 날아 나오는 배분 애니메이션. indices 순서대로 스태거.
  function runMulliganDeal(indices, onDone) {
    var nodes = indices.map(function (i) { return document.querySelector('[data-mull-idx="' + i + '"]'); }).filter(Boolean);
    if (!nodes.length) { if (onDone) onDone(); return; }
    var pending = nodes.length;
    nodes.forEach(function (node, k) { dealOne(node, k * 145, function () { if (--pending === 0 && onDone) onDone(); }); });
  }
  function dealOne(node, delay, onDone) {
    var emit = shoeEmitPoint(), cr = node.getBoundingClientRect();
    if (!emit || !node.animate) { node.style.opacity = '1'; if (onDone) onDone(); return; }
    node.style.opacity = '0';
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, dx = emit.x - cx, dy = emit.y - cy;
    var f = cardBackEl(cr.width, cr.height, ownerColor(HUMAN));
    f.style.left = cr.left + 'px'; f.style.top = cr.top + 'px';
    fxLayer().appendChild(f);
    var a;
    try {
      a = f.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.28) rotate(-9deg)', opacity: 0, offset: 0 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.34) rotate(-9deg)', opacity: 1, offset: .12 },
        { transform: 'translate(' + (dx * .45) + 'px,' + (dy * .45) + 'px) scale(.72) rotate(-3deg)', opacity: 1, offset: .45 },
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 1 }
      ], { duration: 430, delay: delay, easing: 'cubic-bezier(.25,.85,.3,1)', fill: 'both' });
    } catch (e) { f.remove(); node.style.opacity = '1'; if (onDone) onDone(); return; }
    setTimeout(function () { flashShoe(); Sound.draw(); }, delay);
    a.onfinish = function () {
      f.remove(); node.style.opacity = '1';
      try { node.animate([{ transform: node.style.transform + ' scale(1.06)' }, { transform: node.style.transform || 'none' }], { duration: 150, easing: 'ease-out' }); } catch (e) {}
      if (onDone) onDone();
    };
  }
  // 선택한 카드가 뒤집혀 슈로 되돌아가는 반환 애니메이션.
  function rejectOne(node, delay, onDone) {
    var emit = shoeEmitPoint(), cr = node.getBoundingClientRect();
    if (!emit || !node.animate) { if (onDone) onDone(); return; }
    node.style.visibility = 'hidden';
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, dx = emit.x - cx, dy = emit.y - cy;
    var f = cardBackEl(cr.width, cr.height, SKIN.enemy);
    f.style.left = cr.left + 'px'; f.style.top = cr.top + 'px';
    fxLayer().appendChild(f);
    var a;
    try {
      a = f.animate([
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
        { transform: 'translate(' + (dx * .5) + 'px,' + (dy * .5) + 'px) scale(.7) rotate(7deg)', opacity: 1, offset: .55 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.26) rotate(12deg)', opacity: 0, offset: 1 }
      ], { duration: 440, delay: delay, easing: 'cubic-bezier(.5,0,.75,.3)', fill: 'both' });
    } catch (e) { f.remove(); if (onDone) onDone(); return; }
    setTimeout(function () { Sound.whoosh(); }, delay + 120);
    a.onfinish = function () { f.remove(); flashShoe(); if (onDone) onDone(); };
  }
  function confirmMulligan() {
    if (mullBusy) return;
    var idx = Object.keys(mullPick).filter(function (k) { return mullPick[k]; }).map(Number);
    mullBusy = true;
    if (!idx.length) { proceedFromMulligan(); return; }
    // 1) 선택 카드들을 슈로 반환
    var nodes = idx.map(function (i) { return document.querySelector('[data-mull-idx="' + i + '"]'); }).filter(Boolean);
    if (!nodes.length) { applyMulliganAndDeal(idx); return; }
    var pending = nodes.length;
    nodes.forEach(function (node, k) { rejectOne(node, k * 95, function () { if (--pending === 0) applyMulliganAndDeal(idx); }); });
  }
  function applyMulliganAndDeal(idx) {
    // 2) 엔진 멀리건 적용(교체분 드로우). 임시로 onfx 해제 — 매치 슬롯이 없어 stray eject/사운드 방지.
    var savedFx = G.onfx; G.onfx = null;
    G.mulligan(HUMAN, idx);
    G.onfx = savedFx;
    // 새로 뽑힌 카드 = 손패 뒤쪽 idx.length 장. 이들만 덱에서 다시 배분(나머지는 유지).
    var hand = G.players[HUMAN].hand, startNew = Math.max(0, hand.length - idx.length);
    var dealIdx = []; for (var i = startNew; i < hand.length; i++) dealIdx.push(i);
    mullPick = {}; mullReady = false; mullHideIdx = dealIdx; // 교체분만 숨기고, 컨트롤 잠시 숨김
    renderMulligan(); // 코인/전체배분은 mullCoinDone=true 이므로 재실행 안 됨
    runMulliganDeal(dealIdx, function () { mullHideIdx = []; setTimeout(proceedFromMulligan, 420); });
  }
  function proceedFromMulligan() {
    // 멀리건 최종 패를 하단 손패 위치로 날려 넣는 전환 — 오버레이 카드를 클론해 fxLayer 에서 손패 슬롯으로 비행.
    // 1) 대국 렌더 '전에' 오버레이 카드의 화면 좌표+클론을 확보(렌더하면 오버레이가 사라짐). fxLayer 는 clear() 에도 살아남음.
    var parent = fxLayer();
    var srcCount = G.players[HUMAN].hand.length, flyers = [];
    for (var i = 0; i < srcCount; i++) {
      var node = document.querySelector('[data-mull-idx="' + i + '"]');
      if (!node) continue;
      var r = node.getBoundingClientRect();
      var clone = node.cloneNode(true);
      clone.style.position = 'fixed'; clone.style.margin = '0'; clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
      clone.style.width = r.width + 'px'; clone.style.height = r.height + 'px'; clone.style.zIndex = 92; clone.style.pointerEvents = 'none'; clone.style.transformOrigin = 'top left';
      parent.appendChild(clone);
      flyers.push({ i: i, r: r, clone: clone });
    }

    mullBusy = false; mullPhase = false;
    handFlyIn = flyers.map(function (f) { return f.i; }); // 도착 전까지 손패 카드 숨김
    // 2) 대국 시작 + 렌더(손패는 숨겨진 채). AI: 별도 멀리건 없이 유지.
    G.beginTurn();
    renderMatch();

    function reveal(idx) { var s = document.querySelector('[data-hand-idx="' + idx + '"]'); if (s) s.style.opacity = '1'; }
    function finish() {
      handFlyIn = null;
      for (var k = 0; k < srcCount; k++) reveal(k);
      if (G.active === AI && G.winner === undefined) runAI();
    }
    if (!flyers.length) { finish(); return; }

    // 3) 각 클론을 해당 손패 슬롯으로 비행(스태거) — 도착하면 클론 제거 + 실제 슬롯 공개 + 착지 팝.
    var pending = flyers.length;
    var doneOne = function () { if (--pending <= 0) finish(); };
    flyers.forEach(function (f, k) {
      var t = document.querySelector('[data-hand-idx="' + f.i + '"]');
      if (!t) { f.clone.remove(); doneOne(); return; }
      var tr = t.getBoundingClientRect();
      var dx = tr.left - f.r.left, dy = tr.top - f.r.top, sc = f.r.width ? tr.width / f.r.width : 1;
      if (!f.clone.animate) { f.clone.remove(); reveal(f.i); doneOne(); return; }
      var a;
      try {
        a = f.clone.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: 'translate(' + (dx * .5) + 'px,' + (dy * .5) + 'px) scale(' + ((1 + sc) / 2) + ')', opacity: 1, offset: .5 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 1, offset: 1 }
        ], { duration: 440, delay: k * 85, easing: 'cubic-bezier(.3,.8,.35,1)', fill: 'forwards' });
      } catch (e) { f.clone.remove(); reveal(f.i); doneOne(); return; }
      setTimeout(function () { Sound.draw(); }, k * 85 + 120);
      a.onfinish = function () {
        f.clone.remove(); reveal(f.i);
        var s = document.querySelector('[data-hand-idx="' + f.i + '"]');
        if (s && s.animate) { try { s.animate([{ transform: 'translateY(-7px) scale(1.06)' }, { transform: 'none' }], { duration: 170, easing: 'ease-out' }); } catch (e) {} }
        doneOne();
      };
    });
  }

  // =================================================================== MATCH
  function render() {
    // 재렌더 직전, 손패의 '실제' 가로 스크롤 위치를 그대로 포착해 둔다(탭/롱프레스로 손패가 다시 그려져도
    // 스크롤이 왼쪽으로 튀지 않게 — 저장값에 의존하지 않고 매번 DOM 에서 직접 읽어 정확).
    var _hr = document.getElementById('handrow'); if (_hr) handScroll = _hr.scrollLeft;
    if (!G) { UI.renderTitle(); return; }
    if (mullPhase) { renderMulligan(); return; } // 멀리건 단계에선 필드+멀리건 UI 유지
    if (app.querySelector('#board') || G) renderMatch();
  }

  function renderMatch() {
    clear();
    if (tutorial && !tutorial.finished) tutSync();
    var meTurn = G.active === HUMAN && G.winner === undefined && !aiThinking;
    if (meTurn && G.turnNo !== lastBannerTurn) { lastBannerTurn = G.turnNo; turnBanner('내 차례', '#2456a6'); }
    var wrap = el('div', { class: 'bevel', style: { background: SKIN.chassis, color: SKIN.txt, display: 'flex', flexDirection: 'column' } });

    if (COMPACT) {
      renderMatchCompact(wrap, meTurn);
    } else {
      wrap.appendChild(titlebar(tutorial ? 'RUNTIME — 튜토리얼 · 실습' : 'RUNTIME — MATCH.app   ·   turn ' + G.turnNo + ' / ' + G.TURN_CAP));
      // status strip
      var strip = el('div', { class: 'mono', style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '2px 12px', borderBottom: '1px solid ' + SKIN.ink, fontSize: '10px', flexWrap: 'wrap', color: SKIN.txt } }, [
        el('span', { style: { fontWeight: 700 } }, [meTurn ? '▶ 내 차례' : (G.winner !== undefined ? '종료' : '상대 차례…')]),
        el('span', { style: { color: SKIN.muted } }, ['내덱 ' + (DECKS[myDeck] ? myDeck : '') ]),
        el('span', { style: { color: SKIN.muted } }, ['상대 ' + (G.oppKey || '?')]),
        el('span', { style: { flex: 1 } })
      ]);
      if (challenge) strip.appendChild(el('span', { style: { fontWeight: 700, color: SKIN.rangeGold } }, ['🏆 스테이지 ' + challenge.stage + ' · ' + challenge.wins + '연승']));
      wrap.appendChild(strip);
      if (tutorial) wrap.appendChild(tutBanner());

      var main = el('div', { style: { display: 'flex', gap: '10px', padding: 'clamp(6px,1vw,10px)', alignItems: 'stretch', flexWrap: 'wrap' } });
      var left = el('div', { style: { flex: 2, minWidth: '340px', display: 'flex', flexDirection: 'column', gap: '7px' } });

      left.appendChild(deckDispenser(AI));
      left.appendChild(boardEl());
      left.appendChild(deckDispenser(HUMAN));
      left.appendChild(handBar(meTurn));
      left.appendChild(controls(meTurn));
      main.appendChild(left);
      main.appendChild(sidePanel());
      wrap.appendChild(main);
      app.appendChild(wrap);
    }

    var pop = fieldPopover(); if (pop) app.appendChild(pop);
    if (actionToast) app.appendChild(el('div', { class: 'grot', style: { position: 'fixed', left: '50%', top: '80px', transform: 'translateX(-50%)', zIndex: 55, fontWeight: 700, fontSize: '13px', padding: '7px 16px', background: actionToast.actor === HUMAN ? SKIN.own : SKIN.enemy, color: '#fff', border: '1px solid ' + SKIN.ink, boxShadow: '2px 2px 0 rgba(0,0,0,.3)', animation: 'popIn .25s ease', pointerEvents: 'none' } }, [(actionToast.actor === HUMAN ? '나 · ' : '상대 · ') + actionToast.text]));
    if (toast) {
      // 모바일: 손패와 겹치지 않게 화면 중앙에 띄움. 데스크톱: 기존 하단.
      var tStyle = COMPACT
        ? { position: 'fixed', left: '50%', top: '42%', transform: 'translate(-50%,-50%)', zIndex: 50, fontWeight: 700, fontSize: '13px', padding: '10px 20px', maxWidth: '86%', textAlign: 'center', background: SKIN.txt, color: SKIN.chassis, border: '1px solid ' + SKIN.ink, boxShadow: '3px 3px 0 rgba(0,0,0,.3)', pointerEvents: 'none' }
        : { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 50, fontWeight: 700, fontSize: '12px', padding: '9px 18px', background: SKIN.txt, color: SKIN.chassis, border: '1px solid ' + SKIN.ink, boxShadow: '3px 3px 0 rgba(0,0,0,.3)' };
      app.appendChild(el('div', { class: 'grot', style: tStyle }, [toast]));
    }
    if (tutorial && tutorial.finished) app.appendChild(tutDoneOverlay());
    else if (G.winner !== undefined) {
      if (reviewMode) app.appendChild(reviewBar());   // 오버레이 대신 결과 다시보기 버튼만
      else app.appendChild(resultOverlay());
    }
    else if (aiThinking) app.appendChild(bannerEl('상대 차례', '#c23c70'));
    // 모바일 메뉴(항복·규칙) 바텀시트 — 대국이 진행 중일 때만. 게임 종료/실습완료 오버레이 위에는 띄우지 않는다.
    if (menuView && G.winner === undefined && !(tutorial && tutorial.finished)) app.appendChild(menuOverlay());
  }

  // ── 모바일 대국 화면 ── 필드(중앙) + 손패(아래) + 미니 상단바(턴/액션/카운트/[턴 종료]).
  //   자잘한 요소(디스펜서·사이드패널·용어·기록)는 제거. 세로로 들면 90° 회전해 항상 가로로 표시(회전 안내 없음).
  // 모바일 셸 — 화면을 꽉 채움(회전 없음). 세로일 땐 renderMatch/Mulligan 이 가로 유도 오버레이를 덮는다.
  function sizeCompactWrap(wrap) {
    var W = window.innerWidth || 800, H = window.innerHeight || 400;
    wrap.style.position = 'fixed'; wrap.style.overflow = 'hidden'; wrap.style.margin = '0'; wrap.style.boxShadow = 'none';
    wrap.style.top = '0'; wrap.style.left = '0'; wrap.style.width = W + 'px'; wrap.style.height = H + 'px'; wrap.style.transform = 'none';
  }
  // 세로 유도 오버레이 — 대국/멀리건에서 가로(터치)일 때 게임 위에 덮어 "세로로 돌려주세요" 안내.
  function portraitGuide() {
    return el('div', { id: 'lsguide', style: { position: 'fixed', inset: '0', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', background: SKIN.chassis, color: SKIN.txt, textAlign: 'center', padding: '24px' } }, [
      el('div', { style: { fontSize: '58px', lineHeight: 1, animation: 'rotateGuide 2.2s ease-in-out infinite' } }, ['📱']),
      el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '19px', letterSpacing: '.03em' } }, ['세로로 돌려주세요']),
      el('div', { style: { fontSize: '13px', opacity: .72, maxWidth: '290px', lineHeight: 1.55 } }, ['RUNTIME 은 세로 모드로 플레이합니다.', el('br'), '기기를 세로로 세우면 게임이 이어집니다.'])
    ]);
  }
  // 덱/묘지/손패 카운트 칩 — 한글 라벨+숫자를 은은한 배경으로 묶어 또렷하게. 이모지 미사용(어느 폰에서도 동일 렌더).
  function pileStat(label, n, title) {
    return el('span', { class: 'mono', title: title, style: { display: 'inline-flex', alignItems: 'center', gap: '3px', flex: 'none', fontSize: '11px', fontWeight: 700, background: SKIN.chassisSunk, padding: '1px 6px', borderRadius: '3px', boxShadow: 'inset 0 0 0 1px ' + SKIN.line } }, [
      el('span', { style: { fontSize: '10px', color: SKIN.muted, fontWeight: 700 } }, [label]),
      el('span', { style: { minWidth: '9px', textAlign: 'right', color: SKIN.txt } }, [String(n)])
    ]);
  }
  // 가로 스탯 바 — 본체 HP+게이지 · 덱 · 묘 · 패(라벨 칩, 이모지 미사용). 상단(상대)/하단(나) 공용.
  function statBarH(owner, opts) {
    opts = opts || {};
    var me = owner === HUMAN, pl = G.players[owner], b = G.body(owner);
    var hp = b ? G.curHp(b) : 0, mx = b ? G.effMaxHp(b) : 1, accent = ownerColor(owner), low = mx && hp / mx <= 0.34;
    var kids = [
      el('span', { class: 'grot', style: { fontSize: '12px', fontWeight: 700, color: accent, flex: 'none' } }, [me ? '나' : '상대']),
      el('span', { style: { fontSize: '13px', color: low ? SKIN.heat : accent, flex: 'none' } }, ['♥']),
      el('b', { class: 'mono', style: { fontSize: '16px', fontWeight: 700, color: low ? SKIN.heat : accent, lineHeight: 1, flex: 'none' } }, [String(hp)]),
      el('span', { class: 'mono', style: { fontSize: '9px', color: SKIN.muted, flex: 'none' } }, ['/' + mx]),
      el('div', { style: { flex: 1, minWidth: '24px', height: '7px', background: SKIN.chassisSunk, border: '1px solid ' + SKIN.ink, position: 'relative', overflow: 'hidden' } }, [
        el('div', { style: { position: 'absolute', inset: '0', width: Math.max(0, Math.min(100, mx ? hp / mx * 100 : 0)) + '%', background: low ? SKIN.heat : accent } })
      ]),
      pileStat('덱', pl.deck.length, '남은 덱'),
      pileStat('묘', pl.graveyard.length, '묘지'),
      pileStat('패', pl.hand.length, '손패')
    ];
    if (opts.extra) opts.extra.forEach(function (n) { if (n) kids.push(n); });
    return el('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 10px', background: SKIN.chassisAlt, color: SKIN.txt, flex: 'none', flexWrap: 'wrap' }, opts.style || {}) }, kids);
  }
  function renderMatchCompact(wrap, meTurn) {
    sizeCompactWrap(wrap);
    // 안전영역(펀치홀·노치·홈 인디케이터) — 테두리 텍스트/버튼이 가려지지 않게 env() 로 안쪽으로 밀어줌.
    var SAL = 'env(safe-area-inset-left,0px)', SAR = 'env(safe-area-inset-right,0px)', SAT = 'env(safe-area-inset-top,0px)', SAB = 'env(safe-area-inset-bottom,0px)';

    // ── 상단: 상대 스탯 바(HP·덱·묘지·손패) ──
    wrap.appendChild(statBarH(AI, { style: { borderBottom: '1px solid ' + SKIN.ink, paddingTop: 'calc(4px + ' + SAT + ')', paddingLeft: 'calc(10px + ' + SAL + ')', paddingRight: 'calc(10px + ' + SAR + ')' } }));

    // 포인터 시전 안내(짧게)
    if (ptr) wrap.appendChild(el('div', { class: 'mono', style: { flex: 'none', fontSize: '11px', fontWeight: 700, color: SKIN.enemy, padding: '3px 10px', borderBottom: '1px solid ' + SKIN.ink, background: SKIN.chassisSunk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' } }, ['◆ ' + ptr.card.name + ' 시전 — 빨강 대상 선택']));

    // ── 필드(중앙) — 화면 폭을 꽉 채우는 보드 ──
    wrap.appendChild(el('div', { style: { flex: '1 1 auto', minHeight: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px calc(4px + ' + SAR + ') 4px calc(4px + ' + SAL + ')' } }, [boardEl(true)]));

    // ── 하단: (1) 나 스탯 바 — 상단 AI 바와 대칭(HP·덱·묘지·손패). 컨트롤은 분리해 줄바꿈 방지 ──
    wrap.appendChild(statBarH(HUMAN, { style: { borderTop: '1px solid ' + SKIN.ink, paddingLeft: 'calc(10px + ' + SAL + ')', paddingRight: 'calc(10px + ' + SAR + ')' } }));

    // ── 하단: (2) 컨트롤 바 — 한 줄 고정(nowrap): 턴 상태 · 액션 핍 · [턴 종료] ──
    var pips = el('div', { style: { display: 'flex', gap: '3px', alignItems: 'center', flex: 'none' } });
    for (var i = 0; i < 2; i++) pips.appendChild(el('span', { style: { width: '15px', height: '10px', border: '1px solid ' + SKIN.ink, background: i < G.actions ? SKIN.heat : SKIN.chassisSunk } }));
    wrap.appendChild(el('div', { style: { display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: '8px', padding: '5px calc(10px + ' + SAR + ') 5px calc(10px + ' + SAL + ')', background: SKIN.chassisAlt, color: SKIN.txt, borderTop: '1px solid ' + SKIN.ink } }, [
      el('span', { class: 'grot', style: { fontSize: '12px', fontWeight: 700, color: meTurn ? SKIN.own : SKIN.muted, flex: 'none', whiteSpace: 'nowrap' } }, [meTurn ? '▶ 내 차례' : (G.winner !== undefined ? '종료' : '상대 차례…')]),
      el('span', { class: 'mono', style: { fontSize: '9px', color: SKIN.muted, flex: 'none' } }, ['액션']),
      pips,
      challenge ? el('span', { class: 'mono', style: { fontSize: '11px', fontWeight: 700, color: SKIN.rangeGold, flex: 'none' } }, ['🏆' + challenge.wins]) : null,
      el('span', { style: { flex: 1, minWidth: '6px' } }),
      // ☰ 메뉴 — 항복·규칙 요약 바텀시트를 여는 작은 버튼(튜토리얼 중엔 숨김). 턴 종료 옆에 붙여 둔다.
      tutorial ? null : el('button', { class: 'btn ghost', title: '메뉴', style: { fontSize: '15px', fontWeight: 700, padding: '9px 12px', flex: 'none', lineHeight: 1, textAlign: 'center' }, onclick: function () { menuView = 'menu'; render(); } }, ['☰']),
      el('button', { class: 'btn', style: { fontSize: '14px', fontWeight: 700, padding: '9px 22px', flex: 'none', whiteSpace: 'nowrap', background: meTurn ? SKIN.own : SKIN.chassisSunk, color: meTurn ? '#fff' : SKIN.muted }, disabled: !meTurn ? 'disabled' : null, onclick: meTurn ? endTurn : null }, ['턴 종료'])
    ]));

    // ── 손패(맨 아래) ──
    wrap.appendChild(handBar(meTurn));

    // ── 눈에 띄는 취소 버튼 — 상단 중앙(드래그 중엔 숨김). 단, 필드 유닛 선택 시엔 상단이 공격 대상(상대 본체/전진 유닛)
    //    라인이라 여기 두면 대상을 가린다 → 그 경우는 fieldPopover 안의 ✕ 로 대체하고 상단 버튼은 숨긴다. ──
    if ((ptr || (sel && sel.type === 'hand')) && !(drag && drag.moved)) {
      wrap.appendChild(el('button', { style: { position: 'absolute', top: 'calc(50px + ' + SAT + ')', left: '50%', transform: 'translateX(-50%)', zIndex: 60, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '14px', padding: '9px 20px', color: '#fff', background: SKIN.enemy, border: '1px solid ' + SKIN.ink, boxShadow: '0 3px 0 rgba(0,0,0,.35), 0 6px 14px rgba(0,0,0,.4)', letterSpacing: '.03em' }, onclick: function () { sel = ptr = null; render(); } }, [ptr ? '✕ 시전 취소' : '✕ 선택 해제']));
    }

    if (!isPortrait() && isTouchDevice()) wrap.appendChild(portraitGuide()); // 가로(터치) → 세로 유도
    app.appendChild(wrap);
    // 재렌더 시 손패 가로 스크롤 위치 복원 — render() 진입 때 포착한 실제 위치를 그대로 다시 적용(왼쪽 튐 방지).
    // 동기 적용(플리커 없음) + iOS 관성 스크롤 레이어 대비 다음 프레임에 한 번 더 보정.
    var hr = document.getElementById('handrow');
    if (hr) { hr.scrollLeft = handScroll; RAF(function () { var h = document.getElementById('handrow'); if (h && Math.abs(h.scrollLeft - handScroll) > 1) h.scrollLeft = handScroll; }); }
  }

  // ── 데스크톱 멀리건 ── 실제 게임 필드(디스펜서·보드·사이드패널)를 블러 배경으로 깔고,
  //   그 위 정중앙에 멀리건 오버레이를 호버링. 카드는 위 3장·아래 2장 그리드. 코인/딜 애니는 fxLayer/덱 슬롯 사용.
  function renderMulliganDesktop(wrap) {
    // 뷰포트를 꽉 채우는 고정 셸 — 스크롤 없이 한 화면. 실제 게임 화면(디스펜서·보드·손패·컨트롤·사이드패널)을
    // 블러 배경으로 깔고, 그 위 정중앙에 멀리건 오버레이(위3·아래2, 뷰포트에 맞춰 자동 스케일).
    var W = window.innerWidth || 1180, H = window.innerHeight || 800;
    wrap.style.position = 'fixed'; wrap.style.top = '0'; wrap.style.left = '0';
    wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
    wrap.style.margin = '0'; wrap.style.overflow = 'hidden'; wrap.style.transform = 'none'; wrap.style.boxShadow = 'none';

    wrap.appendChild(titlebar('RUNTIME — MATCH.app   ·   멀리건 · 시작 패 교체'));
    var strip = el('div', { class: 'mono', style: { display: 'flex', alignItems: 'center', gap: '14px', padding: '4px 12px', borderBottom: '1px solid ' + SKIN.ink, fontSize: '11px', flexWrap: 'wrap', color: SKIN.txt, flex: 'none' } }, [
      el('span', { style: { fontWeight: 700 } }, ['◈ 멀리건']),
      el('span', { style: { color: SKIN.muted } }, ['내덱 ' + (DECKS[myDeck] ? myDeck : '')]),
      el('span', { style: { color: SKIN.muted } }, ['상대 ' + (G.oppKey || '?')]),
      el('span', { style: { flex: 1 } })
    ]);
    if (challenge) strip.appendChild(el('span', { style: { fontWeight: 700, color: SKIN.rangeGold } }, ['🏆 스테이지 ' + challenge.stage + ' · ' + challenge.wins + '연승']));
    wrap.appendChild(strip);

    // stage: 남은 높이를 채우는 무대(블러 배경 + 정중앙 멀리건 오버레이). 넘치는 배경은 크롭.
    var stage = el('div', { style: { position: 'relative', flex: '1 1 auto', minHeight: '0', overflow: 'hidden' } });

    // 배경(블러 · 상호작용 차단) — 실제 게임 화면 레이아웃. 세로 중앙 정렬, 넘치면 크롭.
    // 딜 배출점(deckslot-HUMAN)·코인 기준(#board)이 여기 존재해 애니메이션 좌표가 실제 필드에 정확히 맞음.
    var bg = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', filter: 'blur(3px)', transform: 'scale(1.02)', pointerEvents: 'none' } });
    var main = el('div', { style: { display: 'flex', gap: '13px', padding: 'clamp(10px,1.6vw,18px)', alignItems: 'stretch', flexWrap: 'wrap', width: '100%', maxWidth: '1180px' } });
    var left = el('div', { style: { flex: 2, minWidth: '340px', display: 'flex', flexDirection: 'column', gap: '7px' } });
    left.appendChild(deckDispenser(AI));
    left.appendChild(boardEl());
    left.appendChild(deckDispenser(HUMAN));
    // 멀리건 중엔 아직 손패가 없음 — 빈 손패 자리만(완료 시 최종 카드가 여기로 날아 들어옴). handBar 데스크톱 빈 상태와 동일 스타일.
    left.appendChild(el('div', { style: { position: 'relative', display: 'flex', gap: '7px', flexWrap: 'nowrap', justifyContent: 'center', minHeight: '40px', alignItems: 'flex-end', padding: '20px 6px 4px', marginTop: '-14px' } }, [
      el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.faint, padding: '12px' } }, ['손패 없음'])
    ]));
    left.appendChild(controls(false));
    main.appendChild(left);
    main.appendChild(sidePanel());
    bg.appendChild(main);
    stage.appendChild(bg);

    // 어둡게 덮는 스크림(블러 배경 대비 오버레이 가독성)
    stage.appendChild(el('div', { style: { position: 'absolute', inset: '0', background: 'rgba(12,12,18,.55)', pointerEvents: 'none' } }));

    // 멀리건 오버레이(정중앙 호버링): 헤더 · 안내 · 3+2 카드 그리드 · 컨트롤
    var ov = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '16px' } });
    ov.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } }, [
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '19px', color: SKIN.own, textShadow: '0 1px 4px rgba(0,0,0,.6)' } }, ['◈ 멀리건']),
      el('span', { class: 'mono', style: { fontSize: '12px', color: '#e9eaee', opacity: .85 } }, [(DECKS[myDeck] ? myDeck : '') + ' vs ' + (G.oppKey || '?')]),
      challenge ? el('span', { class: 'mono', style: { fontSize: '12px', fontWeight: 700, color: SKIN.rangeGold } }, ['🏆 스테이지 ' + challenge.stage + ' · ' + challenge.wins + '연승']) : null
    ]));
    ov.appendChild(el('div', { class: 'mono', style: { fontSize: '12px', color: '#e9eaee', opacity: .8, textAlign: 'center', minHeight: '15px', maxWidth: '92%', textShadow: '0 1px 3px rgba(0,0,0,.6)' } }, [mullReady ? '바꿀 카드를 클릭 → 덱으로 반환하고 새로 뽑습니다. 선택 안 하면 그대로 유지 (1회).' : '패를 나눠주는 중…']));

    // 3+2 그리드 (위 3장 · 아래 2장)
    var grid = el('div', { id: 'mullrow', style: { display: 'flex', flexDirection: 'column', gap: '13px', alignItems: 'center' } });
    var top = el('div', { style: { display: 'flex', gap: '13px', justifyContent: 'center', flexWrap: 'nowrap' } });
    var bot = el('div', { style: { display: 'flex', gap: '13px', justifyContent: 'center', flexWrap: 'nowrap' } });
    G.players[HUMAN].hand.forEach(function (id, i) { (i < 3 ? top : bot).appendChild(handCardEl(id, i, 'mull')); });
    grid.appendChild(top); grid.appendChild(bot);
    ov.appendChild(grid);

    // 딜 애니메이션 배출점(폴백 앵커) — 데스크톱은 덱 슬롯(deckslot-HUMAN)에서 배출되므로 미사용, 슬롯 부재 시만 사용.
    ov.appendChild(el('div', { id: 'mullshoe', style: { position: 'absolute', left: '50%', bottom: '8px', width: '2px', height: '2px', transform: 'translateX(-50%)', pointerEvents: 'none', opacity: 0 } }));

    var ctr = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', minHeight: '40px' } });
    if (mullReady) {
      ctr.appendChild(el('button', { class: 'btn', onclick: confirmMulligan }, ['✔ 확정 · 게임 시작']));
      ctr.appendChild(el('button', { class: 'btn ghost', onclick: function () { if (mullBusy) return; mullPick = {}; renderMulligan(); } }, ['↺ 선택 해제']));
    }
    ov.appendChild(ctr);
    stage.appendChild(ov);

    wrap.appendChild(stage);
    app.appendChild(wrap);
  }

  // ── 모바일 멀리건 ── 실제 게임 화면(상대바·필드·나바)을 블러 배경으로 깔고, 그 위에 멀리건 오버레이.
  // 카드는 위 2장·아래 3장 그리드로 한 화면에 표시(가로 스크롤 없음). 코인플립은 fxLayer 에서 보드 중앙에 재생.
  function renderMulliganCompact(wrap) {
    sizeCompactWrap(wrap);
    wrap.style.background = SKIN.chassis;

    // 배경: 게임 화면(필드 포함) — 블러 + 살짝 확대(가장자리 블러 여백 감춤). 상호작용 차단.
    var bg = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', filter: 'blur(3px)', transform: 'scale(1.04)', pointerEvents: 'none' } }, [
      statBarH(AI, { style: { borderBottom: '1px solid ' + SKIN.ink } }),
      el('div', { style: { flex: '1 1 auto', minHeight: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' } }, [boardEl(true)]),
      statBarH(HUMAN, { style: { borderTop: '1px solid ' + SKIN.ink } })
    ]);
    wrap.appendChild(bg);
    // 어둡게 덮는 스크림
    wrap.appendChild(el('div', { style: { position: 'absolute', inset: '0', background: 'rgba(12,12,18,.5)', pointerEvents: 'none' } }));

    // 멀리건 오버레이(중앙): 헤더 · 안내 · 2+3 카드 그리드 · 컨트롤
    var ov = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '9px', padding: 'calc(8px + env(safe-area-inset-top,0px)) calc(8px + env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) calc(8px + env(safe-area-inset-left,0px))' } });
    ov.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, [
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '16px', color: SKIN.own, textShadow: '0 1px 3px rgba(0,0,0,.55)' } }, ['◈ 멀리건']),
      el('span', { class: 'mono', style: { fontSize: '10px', color: '#e9eaee', opacity: .85 } }, [(DECKS[myDeck] ? myDeck : '') + ' vs ' + (G.oppKey || '?')]),
      challenge ? el('span', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, color: SKIN.rangeGold } }, ['🏆 ' + challenge.stage]) : null
    ]));
    ov.appendChild(el('div', { class: 'mono', style: { fontSize: '10.5px', color: '#e9eaee', opacity: .8, textAlign: 'center', minHeight: '14px', maxWidth: '92%' } }, [mullReady ? '바꿀 카드를 탭 → 덱으로 반환하고 새로 뽑습니다. 안 고르면 유지 (1회).' : '패를 나눠주는 중…']));

    // 2+3 그리드 (위 2장 · 아래 3장)
    var grid = el('div', { id: 'mullrow', style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } });
    var top = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'nowrap' } });
    var bot = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'nowrap' } });
    G.players[HUMAN].hand.forEach(function (id, i) { (i < 2 ? top : bot).appendChild(handCardEl(id, i, 'mull')); });
    grid.appendChild(top); grid.appendChild(bot);
    ov.appendChild(grid);
    // 딜 애니메이션 배출점(보이지 않는 앵커) — 화면 하단 중앙(=덱 방향)에서 카드가 날아 들어옴.
    ov.appendChild(el('div', { id: 'mullshoe', style: { position: 'absolute', left: '50%', bottom: '6px', width: '2px', height: '2px', transform: 'translateX(-50%)', pointerEvents: 'none', opacity: 0 } }));

    if (mullReady) {
      ov.appendChild(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn', style: { fontSize: '13px', padding: '9px 20px' }, onclick: confirmMulligan }, ['✔ 확정 · 시작']),
        el('button', { class: 'btn ghost', style: { fontSize: '12px', padding: '9px 15px' }, onclick: function () { if (mullBusy) return; mullPick = {}; renderMulligan(); } }, ['↺ 해제'])
      ]));
    }
    wrap.appendChild(ov);
    if (!isPortrait() && isTouchDevice()) wrap.appendChild(portraitGuide()); // 가로(터치) → 세로 유도
    app.appendChild(wrap);
  }

  // Compact action chips floating just ABOVE the selected own unit (#9): only the
  // essentials — ⚡ 발동 / ⚔ 공격 — so it never covers neighbouring cells.
  function popBtn(bg) { return { fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '11px', padding: '5px 9px', background: bg, color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }; }
  function fieldPopover() {
    if (!sel || sel.type !== 'board' || G.active !== HUMAN || aiThinking || G.winner !== undefined) return null;
    var u = G.board[sel.key]; if (!u || u.owner !== HUMAN || u.type !== 'object') return null;
    var btns = [];
    CARDS[u.cardId].abilities.forEach(function (ab, idx) {
      if (ab.kw !== 'For' || !G.canFireFor(u, idx)) return;
      var N = ab.forCount || 1, left = N - (u.onceUsed['for' + idx] || 0);
      var ready = G.forReady(u, idx);
      btns.push(el('button', { style: popBtn(ready ? '#3c8a66' : '#7a7a82'), onclick: ready ? function () { fireFor(u, idx, ab); } : function () { flash('이동/발동할 칸이 없음 — 발동 불가'); } }, ['⚡ 발동 ' + left + '/' + N]));
    });
    if (G.canBasicAttack(u)) btns.push(el('button', { style: popBtn('#c23c70'), onclick: function () { var t = G.basicAttackTargets(u); if (t.length === 1) { G.basicAttack(u, t[0]); render(); } else flash('빨강 대상을 클릭'); } }, ['⚔ 공격']));
    if (!btns.length) return null; // nothing to do → no popover (move via blue cells still works)
    btns.push(el('button', { style: popBtn('#6b6b75'), onclick: function () { sel = null; render(); } }, ['✕'])); // 취소를 팝오버 안에 둬서 별도 상단 버튼이 대상 칸을 가리지 않게
    var pop = el('div', { id: 'fieldpop', style: { position: 'fixed', zIndex: 70, display: 'flex', gap: '4px', background: '#1d1d24', padding: '4px', boxShadow: '2px 2px 0 rgba(28,28,38,.4)', whiteSpace: 'nowrap' } }, btns);
    var cell = app.querySelector('[data-key="' + sel.key + '"]');
    if (cell) {
      // 팝오버가 공격 대상 칸(빨강)을 덮으면 탭이 막힌다. 유닛 '아래쪽'(전방=상대 본체·전진 유닛이 있는 위쪽의 반대)에
      // 두는 걸 기본으로 하고, 대상 칸과 겹치거나 화면 밖이면 위/차선책으로 보정한다.
      app.appendChild(pop); // 실측용 선(先)부착 — renderMatch 의 이후 appendChild 는 위치 이동일 뿐(스타일 유지)
      var r = cell.getBoundingClientRect(), pr = pop.getBoundingClientRect();
      var vw = window.innerWidth || 360, vh = window.innerHeight || 640, M = 6;
      var su = G.board[sel.key];
      var avoid = (su ? G.basicAttackTargets(su) : []).map(function (k) { var e = app.querySelector('[data-key="' + k + '"]'); return e ? e.getBoundingClientRect() : null; }).filter(Boolean);
      var cx = r.left + r.width / 2;
      function rcAt(cy) { return { left: cx - pr.width / 2, right: cx + pr.width / 2, top: cy - pr.height / 2, bottom: cy + pr.height / 2 }; }
      function hits(x) { return avoid.some(function (a) { return !(x.right <= a.left || x.left >= a.right || x.bottom <= a.top || x.top >= a.bottom); }); }
      function fits(x) { return x.top >= M && x.bottom <= vh - M; }
      var belowY = r.bottom + M + pr.height / 2, aboveY = r.top - M - pr.height / 2, cy;
      if (fits(rcAt(belowY)) && !hits(rcAt(belowY))) cy = belowY;         // 기본: 아래(전방 라인 회피)
      else if (fits(rcAt(aboveY)) && !hits(rcAt(aboveY))) cy = aboveY;    // 아래가 막히면 위
      else cy = fits(rcAt(belowY)) ? belowY : aboveY;                     // 최후: 화면 안쪽 아무 쪽
      cx = Math.max(M + pr.width / 2, Math.min(vw - M - pr.width / 2, cx));
      cy = Math.max(M + pr.height / 2, Math.min(vh - M - pr.height / 2, cy));
      pop.style.left = cx + 'px'; pop.style.top = cy + 'px'; pop.style.transform = 'translate(-50%,-50%)';
    }
    return pop;
  }

  // 카드 디스펜서(전자기기) — HUD 바를 대체. 남은 덱 수 + 드로우 시 카드 배출 애니메이션.
  // HP 는 보드 본체 타일에 표시되므로 여기선 생략. slot 요소 id=deckslot-<owner> 가 eject 애니메이션 원점.
  function deckDispenser(owner) {
    var me = owner === HUMAN;
    var pl = G.players[owner];
    var dk = me ? myDeck : G.oppKey, d = DECKS[dk], dc = d ? (CLS[d.cls] || CLS.generic) : SKIN.muted;
    var count = pl.deck.length, accent = ownerColor(owner), low = count <= 3;
    var digit = low ? SKIN.heat : SKIN.gold;
    // 덱 두께 미터 — 남은 카드 1장 = 골드 슬리버 1개(엣지 커넥터 언어 재사용), 상한 24
    var CAP = 24, shown = Math.min(count, CAP);
    var meter = el('div', { style: { display: 'flex', gap: '1px', alignItems: 'stretch', height: '11px', padding: '2px', background: SKIN.padEmpty, borderRadius: '2px', boxShadow: 'inset 0 0 0 1px ' + SKIN.edge, overflow: 'hidden' } });
    for (var i = 0; i < CAP; i++) meter.appendChild(el('div', { style: { width: '2px', flex: 'none', background: i < shown ? SKIN.gold : 'transparent', boxShadow: i < shown ? 'inset 0 1px 0 rgba(255,255,255,.3)' : 'none' } }));
    // 배출구 슬롯 — 어두운 슬릿 + 튀어나온 다음 카드 모서리
    var slitPos = me ? { bottom: '3px' } : { top: '3px' }, cardPos = me ? { bottom: '5px' } : { top: '5px' };
    var slot = el('div', { id: 'deckslot-' + owner, style: { position: 'relative', width: '30px', height: '17px', flex: 'none', background: 'linear-gradient(180deg,' + SKIN.chipTop + ',' + SKIN.dieGradEnd + ')', borderRadius: '3px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.5), inset 0 0 0 1px ' + SKIN.edge, overflow: 'hidden' } }, [
      el('div', { style: Object.assign({ position: 'absolute', left: '4px', right: '4px', height: '3px', background: '#05060a', borderRadius: '2px', boxShadow: 'inset 0 1px 1px rgba(0,0,0,.9)' }, slitPos) }),
      count ? el('div', { style: Object.assign({ position: 'absolute', left: '6px', right: '6px', height: '7px', background: 'linear-gradient(180deg,' + SKIN.pcb + ',' + SKIN.pcb2 + ')', border: '1px solid ' + SKIN.edge, borderRadius: '2px', boxShadow: '0 1px 2px rgba(0,0,0,.4)' }, cardPos) }, [
        el('div', { style: { position: 'absolute', left: '2px', top: '1px', width: '5px', height: '2px', background: accent, borderRadius: '1px' } })
      ]) : null
    ]);
    var counter = el('div', { style: { display: 'flex', alignItems: 'center', gap: '3px', flex: 'none' } }, [
      el('span', { class: 'mono', style: { fontSize: '7px', fontWeight: 700, color: SKIN.silkDim, letterSpacing: '.12em' } }, ['DECK']),
      el('div', { class: 'mono', style: { fontSize: '15px', fontWeight: 700, color: digit, background: '#05060a', padding: '0 6px', borderRadius: '2px', minWidth: '26px', textAlign: 'center', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.7), 0 0 0 1px ' + SKIN.edge, textShadow: '0 0 6px ' + hexa(digit, .6) } }, [String(count)])
    ]);
    var device = el('div', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 8px', background: SKIN.pcb, borderRadius: '3px', boxShadow: 'inset 0 0 0 1px ' + SKIN.edge } }, [
      slot,
      el('div', { style: { flex: 1, minWidth: '24px', display: 'flex', justifyContent: 'center' } }, [meter]),
      counter
    ]);
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '2px 12px', background: me ? SKIN.chassisAlt : SKIN.chassisSunk, color: SKIN.txt, border: '1px solid ' + SKIN.ink, boxShadow: 'inset 1px 1px 0 ' + SKIN.bevelHi + ', inset -2px -2px 0 ' + SKIN.bevelLo } }, [
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '13px', color: accent, flex: 'none' } }, [me ? '나' : '상대']),
      el('span', { class: 'mono', title: d ? d.name : '', style: { fontSize: '9px', fontWeight: 700, color: '#fff', background: dc, padding: '2px 6px', whiteSpace: 'nowrap', flex: 'none' } }, [(d ? GLY[d.cls] + ' ' : '') + (dk || '?')]),
      device,
      el('span', { class: 'mono', title: '손패', style: { fontSize: '11px', color: SKIN.muted, flex: 'none' } }, ['패 ' + pl.hand.length]),
      pl.bodyShield ? el('span', { class: 'mono', title: '방어막', style: { fontSize: '10px', color: SKIN.ally, fontWeight: 700, flex: 'none' } }, ['방어 ' + pl.bodyShield]) : null
    ]);
  }
  // 드로우 시 슬롯에서 카드가 배출되는 애니메이션(전자기기 배출구). human=아래(손패쪽), ai=위.
  function ejectCard(owner) {
    var slot = document.getElementById('deckslot-' + owner);
    if (!slot) return;
    var r = slot.getBoundingClientRect(), me = owner === HUMAN, dir = me ? 1 : -1;
    var back = el('div', { style: { position: 'fixed', left: (r.left + r.width / 2) + 'px', top: (r.top + r.height / 2) + 'px', width: '26px', height: '36px', marginLeft: '-13px', marginTop: '-18px', background: 'linear-gradient(135deg,' + SKIN.pcb2 + ',' + SKIN.pcb + ')', border: '1px solid ' + SKIN.edge, borderRadius: '3px', zIndex: 88, boxShadow: '0 4px 10px rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
      el('span', { style: { fontSize: '15px', color: hexa(SKIN.gold, .85), lineHeight: 1 } }, ['▦'])
    ]);
    fxLayer().appendChild(back);
    anim(back, [
      { transform: 'translateY(0) scale(.6) rotate(0deg)', opacity: 0 },
      { transform: 'translateY(' + (dir * 9) + 'px) scale(1) rotate(' + (dir * -2) + 'deg)', opacity: 1, offset: .28 },
      { transform: 'translateY(' + (dir * 52) + 'px) scale(1.02) rotate(' + (dir * 3) + 'deg)', opacity: 1, offset: .7 },
      { transform: 'translateY(' + (dir * 96) + 'px) scale(.88)', opacity: 0 }
    ], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)' });
  }
  function gauge(cur, max, color) {
    return el('div', { style: { flex: 1, maxWidth: '220px', minWidth: '70px', height: '12px', background: SKIN.chassisSunk, border: '1px solid ' + SKIN.ink, boxShadow: 'inset 1px 1px 0 ' + SKIN.bevelLo, position: 'relative' } }, [
      el('div', { style: { position: 'absolute', inset: '0', width: Math.max(0, Math.min(100, cur / max * 100)) + '%', background: color } })
    ]);
  }

  // ---- board
  function highlights() {
    var H = {};
    // range layer: hovered or selected field object's function reach (suppressed during pointer targeting)
    if (!ptr) {
      var rk = hoverCell || (sel && sel.type === 'board' ? sel.key : null);
      if (rk && G.board[rk] && G.board[rk].type === 'object') {
        G.rangeCellsFor(G.board[rk]).forEach(function (k) { H[k] = 'range'; });
      }
    }
    // action layer (overrides range)
    if (ptr) {
      if (ptr.need === 'enemy' || ptr.need === 'cell') G.castZone(HUMAN, ptr.card.id).forEach(function (k) { if (!H[k]) H[k] = 'zone'; });
      pointerTargets(ptr).forEach(function (k) { H[k] = 'target'; });
    }
    else if (sel && sel.type === 'hand') { G.declareCells(HUMAN).forEach(function (k) { H[k] = 'declare'; }); }
    else if (sel && sel.type === 'board') {
      var u = G.board[sel.key];
      if (u) {
        G.moveCells(u).forEach(function (k) { H[k] = 'move'; });
        H[sel.key] = 'origin';
        if (u.owner === HUMAN && G.canBasicAttack(u)) G.basicAttackTargets(u).forEach(function (k) { H[k] = 'attack'; });
      }
    }
    return H;
  }
  function boardEl(fill) {
    var H = highlights();
    // PCB 기판: 솔더마스크 면 + 미세 트레이스 그리드
    var traceImg = 'linear-gradient(' + SKIN.trace + ' 1px, transparent 1px), linear-gradient(90deg,' + SKIN.trace + ' 1px, transparent 1px)';
    // fill(모바일 세로 대국): 화면 폭을 꽉 채우고, 세로 공간을 쓰도록 셀을 카드형(세로로 긴)으로 → 필드가 큼.
    var sizeStyle = fill
      ? { width: '100%', aspectRatio: '4 / 5', maxHeight: '100%', maxWidth: '560px', margin: '0 auto' }
      : { width: '100%', maxWidth: '640px', margin: '0 auto' };
    var grid = el('div', { id: 'board', onmouseleave: function () { hideCardTip(); if (hoverCell !== null) { hoverCell = null; render(); } }, style: Object.assign({ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gridTemplateRows: 'repeat(4,1fr)', gap: COMPACT ? '2px' : '6px', aspectRatio: '5/4', background: SKIN.boardFace, backgroundImage: traceImg, backgroundSize: '16px 16px', border: '1px solid ' + SKIN.ink, padding: COMPACT ? '3px' : '8px', boxShadow: 'inset 2px 2px 0 ' + SKIN.bevelLo }, sizeStyle) });
    for (var r = 1; r <= 4; r++) for (var c = 1; c <= 5; c++) grid.appendChild(cellEl(K(c, r), H[K(c, r)]));
    return grid;
  }
  function cellEl(key, hi) {
    var u = G.board[key], p = P(key);
    var addr = '0x' + (((p[1] - 1) * 5 + (p[0] - 1)).toString(16).toUpperCase());
    var st = { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid ' + SKIN.line, background: SKIN.cellFace, boxShadow: 'inset 0 0 0 1px ' + hexa(SKIN.trace, 1) + ', inset 1px 1px 2px rgba(0,0,0,.12)', padding: 0, overflow: 'hidden', minWidth: 0, minHeight: 0, cursor: 'pointer' };
    var marker = '', mc = '';
    if (hi === 'declare') { st.border = '2px dashed ' + SKIN.ally; st.background = hexa(SKIN.ally, .12); marker = '⊕'; mc = SKIN.ally; }
    else if (hi === 'move') { st.border = '2px dashed ' + SKIN.own; st.background = hexa(SKIN.own, .10); marker = '◆'; mc = SKIN.own; }
    else if (hi === 'target') { st.border = '2px solid ' + SKIN.enemy; st.background = hexa(SKIN.enemy, .16); marker = '×'; mc = SKIN.enemy; }
    else if (hi === 'attack') { st.border = '2px solid ' + SKIN.enemy; st.boxShadow = '0 0 0 2px ' + hexa(SKIN.enemy, .25); marker = '⚔'; mc = SKIN.enemy; }
    else if (hi === 'range') { st.background = hexa(SKIN.rangeGold, .16); st.boxShadow = 'inset 0 0 0 1.5px ' + hexa(SKIN.rangeGold, .5); }
    else if (hi === 'zone') { st.border = '1.5px dashed ' + hexa(SKIN.own, .75); st.background = hexa(SKIN.own, .2); st.boxShadow = 'inset 0 0 0 1px ' + hexa(SKIN.own, .3); } // 포인터 시전 사거리 — 점선 테두리로 또렷하게
    else if (hi === 'origin') { st.border = '3px solid ' + SKIN.silk; }
    else { // 진영 = 본체가 있는 홈 '1행'만: 내 홈(row4)=틸 / 상대 홈(row1)=마젠타 / 가운데(row2·3)=중립 통로.
      var tc = p[1] === RT.homeRow(HUMAN) ? SKIN.own : (p[1] === RT.homeRow(1 - HUMAN) ? SKIN.enemy : null);
      if (tc) { var tt = hexa(tc, .15); st.backgroundImage = 'linear-gradient(' + tt + ',' + tt + ')'; st.borderColor = hexa(tc, .6); }
    }
    var kids = [];
    if (!u) { kids.push(el('span', { class: 'mono', style: { fontSize: '9px', color: SKIN.faint, letterSpacing: '.05em' } }, [addr])); }
    if (marker && (!u || hi === 'target' || hi === 'attack')) kids.push(el('span', { class: 'mono', style: { position: 'absolute', top: u ? '1px' : '50%', left: u ? 'auto' : '50%', right: u ? '2px' : 'auto', transform: u ? 'none' : 'translate(-50%,-50%)', color: mc, fontWeight: 700, fontSize: u ? '14px' : '20px', pointerEvents: 'none', zIndex: 5, textShadow: '0 1px 2px rgba(0,0,0,.45)' } }, [marker]));
    if (u && u.type === 'body') kids.push(bodyTile(u));
    else if (u) kids.push(objTile(u, key));
    var props = { 'data-key': key, style: st, onclick: function () { if (suppressCellClick) { suppressCellClick = false; return; } clickCell(key); } };
    // 호버(범위 미리보기)는 데스크톱 전용. 터치에선 onmouseenter 가 합성돼 render() 로 셀을 재생성 →
    // 뒤이은 click 이 사라져 유닛 선택/이동/For 발동이 먹통이 됨. 그래서 터치기기에선 호버 핸들러를 달지 않는다.
    // 터치: 짧은 탭 = clickCell(선택/이동/능력/기본공격). 길게 누르기 = inspect(사거리+상세) — 손패 peek 과 통일.
    if (!isTouchDevice()) {
      props.onmouseenter = function (e) {
        if (u) showCardTip(e.currentTarget.getBoundingClientRect(), u.cardId, u); else hideCardTip();
        var nc = (u && u.type === 'object') ? key : null;
        if (nc !== hoverCell) { hoverCell = nc; render(); }
      };
      props.onmouseleave = hideCardTip;
    } else {
      props.onpointerdown = function (e) { if (e.pointerType === 'mouse') return; suppressCellClick = false; scheduleFieldPeek(key, e.clientX, e.clientY); };
      props.onpointermove = function (e) { if (!fpeek && (Math.abs(e.clientX - fpeekSX) + Math.abs(e.clientY - fpeekSY) > 10)) clearTimeout(fpeekT); };
      props.onpointerup = hideFieldPeek;
      props.onpointercancel = hideFieldPeek;
    }
    return el('button', props, kids);
  }
  function bodyTile(u) {
    var me = u.owner === HUMAN, hp = G.curHp(u), mx = G.effMaxHp(u), own = ownerColor(u.owner);
    var key = bodyKey(u.owner);
    var st = { width: '92%', height: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', background: me ? '#1d1d24' : '#3a2630', color: '#e9eaee', border: '2px solid ' + own, boxShadow: '3px 3px 0 ' + hexa(own, .3) };
    if (fxHit[key]) st.animation = 'hitShake .32s ease, hitFlash .5s ease';
    return el('div', { style: st }, [
      el('span', { style: { fontSize: '8px', letterSpacing: '.2em', color: me ? '#9db8e6' : '#e6a3bd' } }, [me ? '내 본체' : '적 본체']),
      el('span', { class: 'mono', style: { fontWeight: 700, fontSize: 'clamp(15px,3vw,24px)' } }, [String(hp)]),
      tweenFill('bt' + u.owner, hp, mx, own, { width: '76%', height: '5px', background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.4)', position: 'relative', overflow: 'hidden' })
    ]);
  }
  // 필드 셀 = 창(L1). 프레임=오너색 베벨 · 타이틀바=클래스색+LED(+적 빗금) · 뷰포트 · 마이크로 상태바.
  function objTile(u, key) {
    var card = CARDS[u.cardId], me = u.owner === HUMAN, cl = CLS[card.cls] || CLS.generic;
    var fr = OWNER_FRAME[u.owner];
    var own = OWNER_LED[u.owner]; // 순수 오너색(틸/마젠타) — 소유자 워시용
    var a = G.effAtk(u), hp = G.curHp(u), mx = G.effMaxHp(u);
    var bound = G.isBound(u);
    var seld = sel && sel.type === 'board' && sel.key === key;
    var st = Object.assign({ position: 'relative', width: '96%', height: '96%', display: 'flex', flexDirection: 'column', background: SKIN.face, padding: '1px', overflow: 'hidden', boxShadow: '2px 2px 0 rgba(0,0,0,.28)' }, raisedBev(fr[0], fr[1]));
    // 소유자 워시 — 카드 전체 면을 오너색으로 물들여 한눈에 내/적 구분. 적을 더 진하게.
    var wash = hexa(own, me ? 0.16 : 0.24);
    st.backgroundImage = 'linear-gradient(' + wash + ',' + wash + ')';
    st.borderColor = own; // 베벨 대신 솔리드 오너색 프레임으로 대비 강화
    if (seld) st.boxShadow = '0 0 0 2px ' + SKIN.face + ', 0 0 0 3px ' + SKIN.faceLo + ', 2px 2px 0 rgba(0,0,0,.28)';
    if (lungingKeys[key]) st.visibility = 'hidden';
    var myTurn = me && G.active === HUMAN && !aiThinking;
    if (fxHit[key]) st.animation = 'hitShake .32s ease, hitFlash .5s ease';
    else if (fxSpawn[key]) st.animation = 'popIn .35s ease';
    else if (myTurn && G.canBasicAttack(u) && !seld) st.animation = 'readyPulse 1.8s ease-in-out infinite';
    var attacked = myTurn && u.attackedTurn === G.turnNo;
    if (attacked && !G.canBasicAttack(u)) st.opacity = '.82'; // already acted this turn
    var atkBadge = myTurn ? (G.canBasicAttack(u) ? '⚔' : (u.attackedTurn === G.turnNo ? '⚔✓' : '')) : '';
    var forN = forRemaining(u);
    // For 발동 가능(내 턴 & 남은 횟수 & 대상 가능) 여부 — 배지 색/펄스로 강조.
    var forFire = myTurn && CARDS[u.cardId].abilities.some(function (ab, idx) { return ab.kw === 'For' && G.canFireFor(u, idx) && G.forReady(u, idx); });
    var badges = el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', flex: 'none' } }, [
      atkBadge ? el('span', { class: 'mono', style: { fontSize: '7px', fontWeight: 700, color: G.canBasicAttack(u) ? '#ffe14d' : 'rgba(255,255,255,.6)' } }, [atkBadge]) : null,
      bound ? el('span', { style: { fontSize: '7px', lineHeight: 1 } }, ['🔒']) : null
    ]);
    // 필드 For 잔여 횟수 = 뷰포트 좌상단 코너 배지(눈에 띄게). 발동가능=녹색+펄스, 남았지만 이번 턴 소진/불가=중립.
    var forBadge = forN ? el('span', { class: 'mono', title: 'For 함수 잔여 ' + forN + '회' + (forFire ? ' · 지금 발동 가능' : ''), style: { position: 'absolute', top: '1px', left: '1px', zIndex: 6, fontSize: '10px', fontWeight: 700, lineHeight: 1, color: '#fff', background: forFire ? '#3c8a66' : 'rgba(29,29,36,.82)', border: '1px solid ' + (forFire ? '#c4ea9f' : 'rgba(255,255,255,.4)'), borderRadius: '3px', padding: '1px 3px', boxShadow: forFire ? '0 0 0 1px rgba(0,0,0,.35), 0 0 7px rgba(60,138,102,.85)' : '0 1px 2px rgba(0,0,0,.4)', animation: forFire ? 'readyPulse 1.5s ease-in-out infinite' : 'none' } }, ['⟳' + forN]) : null;
    return el('div', { style: st }, [
      // 타이틀바(클래스색) — LED(오너) + 이름(축소) + 배지. 적 = 빗금(비활성 창).
      winTitlebar(card, { led: u.owner, ledPx: 9, icon: false, nameFs: 7, hatch: !me, pad: '2px 3px', gap: 2, right: badges }),
      // 뷰포트 — 셀을 채우는 일러스트(글리프). ATK0 오버레이. 오너색 옅은 워시로 소유자 강조.
      el('div', { style: Object.assign({ flex: 1, minHeight: '12px', margin: '2px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SKIN.viewportBg, backgroundImage: 'linear-gradient(' + hexa(own, me ? 0.14 : 0.2) + ',' + hexa(own, me ? 0.14 : 0.2) + ')', overflow: 'hidden' }, sunkenBev()) }, [
        el('span', { style: { fontSize: 'clamp(12px,2.2vw,22px)', lineHeight: 1, color: cl } }, [GLY[card.cls]]),
        artLayer(card),
        forBadge,
        u.atkZero ? el('span', { class: 'mono', style: { position: 'absolute', bottom: '0', right: '2px', fontSize: '7px', color: '#E24B4A', fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,.6)' } }, ['ATK0']) : null
      ]),
      // 마이크로 상태바 — ATK 필드 | HP 뉴트럴 미터
      statusStrip(a, hp, mx, { atkW: 26, fs: 9, icoPx: 8, meterH: 5, margin: '0 2px 2px', buffed: a > (card.atk || 0) })
    ]);
  }

  // ---- hand
  function handBar(meTurn) {
    var hand = G.players[HUMAN].hand;
    if (COMPACT) {
      // 모바일: 필드 아래 가로 스크롤 손패. 위(필드)로 끌어 시전 → touch-action:pan-x 로 가로 스크롤과 공존.
      // safe center: 카드가 넘칠 땐 왼쪽부터 정렬(양끝이 잘려 스크롤 못하는 문제 방지). 관성 스크롤 on.
      var row = el('div', { id: 'handrow', onscroll: function (e) { handScroll = e.currentTarget.scrollLeft; }, style: { position: 'relative', zIndex: 6, flex: 'none', display: 'flex', flexDirection: 'row', gap: '6px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain', alignItems: 'flex-end', justifyContent: 'safe center', touchAction: 'pan-x', padding: '4px calc(8px + env(safe-area-inset-right,0px)) calc(4px + env(safe-area-inset-bottom,0px)) calc(8px + env(safe-area-inset-left,0px))', borderTop: '2px solid ' + SKIN.ink, background: SKIN.chassisSunk } });
      if (!hand.length) row.appendChild(el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.faint, padding: '10px' } }, ['손패 없음']));
      hand.forEach(function (id, i) { var c = handCardEl(id, i, meTurn ? 'play' : 'idle'); c.setAttribute('data-hand-idx', i); if (handFlyIn && handFlyIn.indexOf(i) !== -1) c.style.opacity = '0'; if (drawPulse && i === hand.length - 1) c.style.animation = 'drawIn .42s ease'; row.appendChild(c); });
      if (drawPulse) drawPulse = false;
      return row;
    }
    // 가로 스크롤 컨테이너는 세로도 클리핑되므로(overflowX:auto → overflowY 강제 auto), 호버 시 떠오르는
    // 카드 윗부분이 잘린다. 상단 패딩으로 헤드룸을 주고 음수 마진으로 레이아웃 간격을 보정, z-index 로 위 요소 위에 그림.
    var row = el('div', { style: { position: 'relative', zIndex: 6, display: 'flex', gap: '7px', flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', justifyContent: hand.length > 6 ? 'flex-start' : 'center', minHeight: '40px', alignItems: 'flex-end', padding: '20px 6px 4px', marginTop: '-14px' } });
    if (!hand.length) row.appendChild(el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.faint, padding: '12px' } }, ['손패 없음']));
    hand.forEach(function (id, i) { var c = handCardEl(id, i, meTurn ? 'play' : 'idle'); c.setAttribute('data-hand-idx', i); if (handFlyIn && handFlyIn.indexOf(i) !== -1) c.style.opacity = '0'; if (drawPulse && i === hand.length - 1) c.style.animation = 'drawIn .42s ease'; row.appendChild(c); });
    if (drawPulse) drawPulse = false;
    return row;
  }
  // 손패 풀창(L0). 인스턴스 = 창(타이틀바+뷰포트+효과문+상태바). 포인터 = 다이얼로그(상태바 없이 시전 버튼).
  function handCardEl(id, i, mode) {
    // 모바일 손패는 작은 미니카드(칩) — 손가락을 대면 큰 미리보기가 떠서 내용 확인.
    if (COMPACT && (mode === 'play' || mode === 'idle')) return miniHandCard(id, i, mode);
    var card = CARDS[id], isP = card.kind === 'pointer';
    var playable = mode === 'play' ? (isP ? G.canCast(HUMAN, id) : G.canDeclare(HUMAN, id)) : false;
    var seld = (mode === 'play' && sel && sel.type === 'hand' && sel.i === i) || (ptr && ptr.i === i);
    var mullSel = mode === 'mull' && mullPick[i];
    var big = mode === 'mull', prev = mode === 'preview';
    var W, MINH, VPH;
    if (prev) { W = 186; MINH = 246; VPH = 116; }
    else if (big && COMPACT) {
      // 멀리건 2+3 그리드가 가로 스크롤 없이 한 화면에 들어오도록 하단 3장 기준으로 폭을 뷰포트에 맞춤.
      var avail = Math.min(window.innerWidth || 360, 480);
      W = Math.max(94, Math.min(150, Math.floor((avail - 40) / 3)));
      var rr = W / 150; MINH = Math.round(208 * rr); VPH = Math.round(90 * rr);
    }
    else if (big) {
      // 데스크톱 멀리건 위3·아래2 그리드 — 스크롤 없이 한 화면에 크게 들어오도록 뷰포트(가로 3장·세로 2행)에 맞춰 스케일.
      var vw = Math.min(window.innerWidth || 1180, 1180), vh = window.innerHeight || 800;
      var wByW = Math.floor((vw - 72) / 3);   // 가로 3장 + 여백
      var wByH = Math.floor((vh - 220) / 2 * 0.70); // 세로 2행 + 상/하단 크롬 여유, 카드 종횡비(176/250≈.70)
      W = Math.max(140, Math.min(230, Math.min(wByW, wByH)));
      var br = W / 176; MINH = Math.round(250 * br); VPH = Math.round(116 * br);
    }
    else { W = 150; MINH = 150; VPH = 92; }
    var shadow = '0 2px 5px rgba(0,0,0,.4)';
    // 프레임 = 창 페이스 + raised 베벨(손패는 뉴트럴). 링·그림자는 boxShadow(베벨과 분리).
    var st = Object.assign({ position: 'relative', width: W + 'px', minHeight: MINH + 'px', display: 'flex', flexDirection: 'column', background: SKIN.face, padding: '2px', cursor: mode === 'idle' ? 'default' : 'pointer', overflow: 'hidden', flex: 'none', transition: 'transform .1s', boxShadow: shadow }, raisedBev());
    // 터치: 손패 가로 스크롤은 브라우저(pan-x), 위(필드 방향) 드래그는 우리가 잡음. 데스크톱 hover 리프트엔 영향 없음.
    if (mode === 'play') st.touchAction = 'pan-x';
    if (playable && !seld && !mullSel) st.boxShadow = '0 0 0 2px ' + SKIN.face + ', 0 0 0 3px #7BB528, 0 3px 7px rgba(0,0,0,.5)';
    if (seld || mullSel) { st.boxShadow = '0 0 0 2px ' + SKIN.face + ', 0 0 0 4px ' + (mullSel ? '#c23c70' : SKIN.faceLo); st.transform = 'translateY(-6px)'; }
    if (mode === 'play' && !playable) st.opacity = .5;
    var props = { style: st };
    if (mode === 'mull') { props['data-mull-idx'] = i; props.onclick = function () { if (mullBusy) return; mullPick[i] = !mullPick[i]; renderMulligan(); }; }
    else if (mode === 'play') {
      props.onpointerdown = function (e) { startHandDrag(e, i); };
      props.onmouseenter = function (e) { var t = e.currentTarget; t.__z = t.style.zIndex; t.__tf = t.style.transform; t.__bs = t.style.boxShadow; t.style.zIndex = '30'; t.style.transform = 'translateY(-12px) scale(1.07) rotate(-1.5deg)'; t.style.boxShadow = '0 14px 26px rgba(0,0,0,.6)'; };
      props.onmouseleave = function (e) { var t = e.currentTarget; t.style.zIndex = t.__z || ''; t.style.transform = t.__tf || ''; t.style.boxShadow = t.__bs || ''; };
    }

    var reqBadge = card.require ? el('span', { class: 'mono', title: '선언 조건(require)', style: { fontSize: '7px', fontWeight: 700, background: 'rgba(0,0,0,.28)', color: '#fff', padding: '0 3px', flex: 'none' } }, ['⚙']) : null;

    // 멀리건 교체 대상 표시 — 카드 위에 반투명 뒷면 오버레이 + 「교체」리본(하스스톤식). 클릭은 통과.
    function mullWrap(node) {
      if (!mullSel) return node;
      node.appendChild(el('div', { style: { position: 'absolute', inset: '0', zIndex: 4, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundImage: 'linear-gradient(135deg,' + hexa(SKIN.enemy, .22) + ',' + hexa(SKIN.enemy, .07) + '), repeating-linear-gradient(45deg, rgba(29,29,36,.14) 0 6px, transparent 6px 12px)' } }, [
        el('span', { class: 'grot', style: { fontWeight: 700, fontSize: big ? '13px' : '11px', color: '#fff', background: SKIN.enemy, padding: '3px 13px', border: '1px solid ' + SKIN.ink, boxShadow: '2px 2px 0 rgba(0,0,0,.3)', transform: 'rotate(-6deg)', whiteSpace: 'nowrap' } }, ['🔄 교체'])
      ]));
      return node;
    }

    if (isP) {
      // 포인터 = 다이얼로그: 타이틀바(사거리 컨트롤) + 뷰포트(일러스트) + 효과·사거리·시전조건 패널 + [시전] 버튼.
      // 상태바 부재(=시전 버튼) 로 인스턴스와 실루엣 분리(§5). 일러스트는 뷰포트로 복원.
      var prI = RT.pointerRangeInfo(id);
      var condTxt = card.castCondition ? RT.castCondText(card.castCondition) : null;
      var condMet = card.castCondition ? G.castConditionMet(HUMAN, card) : true;
      return mullWrap(el('button', props, [
        winTitlebar(card, { iconPx: big ? 15 : 13, nameFs: big ? 10 : 9, badge: reqBadge, right: rangeCtrl(RT.cardRange(id), big ? 3.4 : 3) }),
        viewportBox(card, VPH, { gScale: 0.5 }),
        el('div', { style: Object.assign({ margin: '3px 2px 0', flex: 1, background: SKIN.effBg, color: SKIN.effTxt, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }, sunkenBev()) }, [
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start' } }, [
            el('div', { style: { width: '20px', height: '20px', flex: 'none', borderRadius: '50%', background: '#d8472b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' } }, ['⚡']),
            el('div', { style: { minWidth: 0, fontSize: big ? '9.5px' : '8.5px', lineHeight: 1.42 } }, richText(card.text))
          ]),
          prI ? el('div', { class: 'mono', style: { fontSize: '7.5px', fontWeight: 700, color: SKIN.own } }, ['◆ 시전 사거리 · ' + prI.text]) : null,
          condTxt ? el('div', { class: 'mono', style: { fontSize: '7.5px', fontWeight: 700, color: condMet ? SKIN.muted : SKIN.heat } }, [(condMet ? '✓' : '⚠') + ' 시전조건 · ' + condTxt]) : null,
          card.deckLimit ? el('div', { class: 'mono', style: { fontSize: '7px', color: SKIN.heat } }, ['덱당 ' + card.deckLimit]) : null
        ]),
        el('div', { style: { display: 'flex', justifyContent: 'center', margin: '3px 2px 2px' } }, [
          el('span', { class: 'mono', style: Object.assign({ fontSize: big ? '10px' : '9px', fontWeight: 700, color: SKIN.effTxt, background: SKIN.face, padding: '3px 22px' }, raisedBev()) }, ['▶ 시전'])
        ])
      ]));
    }

    // 인스턴스 = 창: 타이틀바 + 뷰포트 + 효과문 패널 + 상태바
    var titleBadge = el('span', { style: { display: 'flex', gap: '2px', flex: 'none' } }, [reqBadge, basicAtkChip(!big)]);
    return mullWrap(el('button', props, [
      winTitlebar(card, { iconPx: big ? 15 : 13, nameFs: big ? 10 : 9, badge: titleBadge, right: rangeCtrl(RT.cardRange(id), big ? 3.4 : 3) }),
      viewportBox(card, VPH, { gScale: 0.5 }),
      effectPanel(card, { fs: big ? 9.5 : 8, flex: true, min: 26 }),
      card.deckLimit ? el('div', { class: 'mono', style: { fontSize: '7px', color: SKIN.heat, margin: '2px 2px 0', textAlign: 'right' } }, ['덱당 ' + card.deckLimit]) : null,
      statusStrip(card.atk, card.hp, card.hp, { fs: big ? 12 : 11, icoPx: big ? 11 : 10, meterH: big ? 9 : 8 })
    ]));
  }

  // 모바일 손패 미니카드 — 이름·글리프·ATK/HP만. 탭=선택, 위로 드래그=시전, 꾹 누르면 큰 미리보기(peek).
  function miniHandCard(id, i, mode) {
    var card = CARDS[id], isP = card.kind === 'pointer';
    var playable = mode === 'play' ? (isP ? G.canCast(HUMAN, id) : G.canDeclare(HUMAN, id)) : false;
    var seld = (mode === 'play' && sel && sel.type === 'hand' && sel.i === i) || (ptr && ptr.i === i);
    var W = 94, H = 124, cl = CLS[card.cls] || CLS.generic;
    var st = Object.assign({ position: 'relative', width: W + 'px', height: H + 'px', display: 'flex', flexDirection: 'column', background: SKIN.face, padding: '1px', cursor: mode === 'idle' ? 'default' : 'pointer', overflow: 'hidden', flex: 'none', boxShadow: '0 2px 5px rgba(0,0,0,.4)', touchAction: 'pan-x', transition: 'transform .08s ease' }, raisedBev());
    if (playable && !seld) st.boxShadow = '0 0 0 2px ' + SKIN.face + ', 0 0 0 3px #7BB528, 0 3px 7px rgba(0,0,0,.5)';
    if (seld) { st.boxShadow = '0 0 0 2px ' + SKIN.face + ', 0 0 0 4px ' + SKIN.faceLo; st.transform = 'translateY(-6px)'; }
    if (mode === 'play' && !playable) st.opacity = .5;
    // 드래그 중인 카드는 손패에서 자리를 비운 것처럼 흐리게(하스스톤식 '집어든' 느낌)
    if (mode === 'play' && drag && drag.moved && drag.i === i) { st.opacity = .28; st.transform = 'translateY(2px)'; st.boxShadow = 'inset 0 0 0 2px ' + hexa(SKIN.ink, .3); }
    var props = { style: st };
    if (mode === 'play') props.onpointerdown = function (e) { startHandDrag(e, i); };
    else props.onpointerdown = function (e) { idlePeek(i); }; // 상대 턴 등 idle 에서도 꾹 눌러 카드 확인
    // 아트가 가운데 빈 공간을 채우도록 flex:1 (카드가 알차게 보이게)
    var art = el('div', { style: Object.assign({ position: 'relative', flex: '1 1 auto', minHeight: '22px', margin: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SKIN.viewportBg, backgroundImage: 'linear-gradient(' + hexa(cl, .1) + ',' + hexa(cl, .1) + ')', overflow: 'hidden' }, sunkenBev()) }, [
      el('span', { style: { fontSize: 'clamp(38px,15vw,60px)', lineHeight: 1, color: cl, opacity: .92 } }, [GLY[card.cls] || GLY.generic]),
      artLayer(card)
    ]);
    return el('button', props, [
      // 상단(타이틀바)을 키우고 이름 줄바꿈 허용 → 전체 이름이 한번에 보이게
      winTitlebar(card, { iconPx: 11, nameFs: 9, pad: '3px 4px', wrap: true, right: isP ? el('span', { class: 'mono', style: { fontSize: '8px', fontWeight: 700, color: '#fff', background: '#d8472b', padding: '0 3px', flex: 'none' } }, ['⚡']) : basicAtkChip(true) }),
      art,
      isP ? el('div', { class: 'mono', style: { flex: 'none', textAlign: 'center', fontSize: '9px', fontWeight: 700, color: '#d8472b', background: SKIN.effBg, padding: '3px 0', margin: '0 2px 2px', whiteSpace: 'nowrap', overflow: 'hidden' } }, ['◆ 드래그 시전'])
          : statusStrip(card.atk, card.hp, card.hp, { atkW: 32, fs: 13, icoPx: 11, margin: '0 2px 2px' })
    ]);
  }
  // 가로형 카드 상세 패널(모바일 peek 전용) — 왼쪽=카드(아트·ATK/HP), 오른쪽=이름·효과·사거리.
  function cardPreviewEl(id) {
    var card = CARDS[id], isP = card.kind === 'pointer', cl = CLS[card.cls] || CLS.generic;
    var left = el('div', { style: Object.assign({ flex: '0 0 118px', display: 'flex', flexDirection: 'column', background: SKIN.face, overflow: 'hidden' }, raisedBev()) }, [
      winTitlebar(card, { iconPx: 14, nameFs: 11, right: isP ? el('span', { class: 'mono', style: { fontSize: '8px', fontWeight: 700, color: '#fff', background: '#d8472b', padding: '1px 4px', flex: 'none' } }, ['⚡']) : basicAtkChip(false) }),
      viewportBox(card, 108, { gScale: 0.5 }),
      isP ? null : statusStrip(card.atk, card.hp, card.hp, { fs: 14, icoPx: 12, meterH: 9 })
    ]);
    var rows = [el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' } }, [
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '14px' } }, [card.name]),
      el('span', { class: 'mono', style: { fontSize: '9px', color: cl, fontWeight: 700 } }, [(card.cls || 'generic').toUpperCase()]),
      isP ? el('span', { class: 'mono', style: { fontSize: '9px', color: '#d8472b', fontWeight: 700 } }, ['포인터']) : null
    ])];
    rows.push(el('div', { style: { fontSize: '12.5px', lineHeight: 1.5 } }, richText(card.text)));
    var pr = isP ? RT.pointerRangeInfo(id) : null;
    if (pr) rows.push(el('div', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, color: SKIN.own } }, ['◆ 시전 사거리 · ' + pr.text]));
    if (card.castCondition) rows.push(el('div', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, color: SKIN.muted } }, ['시전조건 · ' + RT.castCondText(card.castCondition)]));
    if (card.deckLimit) rows.push(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.heat } }, ['덱당 ' + card.deckLimit + '장']));
    rows.push(rangeGridEl(RT.cardRange(id), cl)); // 인스턴스 함수 범위 / 포인터 시전 사거리 그리드(데스크톱 호버와 동일)
    var right = el('div', { style: Object.assign({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', background: SKIN.effBg, color: SKIN.effTxt, overflow: 'hidden' }, sunkenBev()) }, rows);
    return el('div', { style: Object.assign({ display: 'flex', gap: '3px', width: '360px', background: SKIN.chassis, padding: '3px' }, raisedBev()) }, [left, right]);
  }

  // 드래그 고스트 = 실제 카드(중간 크기)를 손가락 따라 이동(하스스톤/마듀식 반응형). 비상호작용.
  function dragGhostEl(id) {
    var card = CARDS[id], isP = card.kind === 'pointer';
    var st = Object.assign({ width: '124px', minHeight: '160px', display: 'flex', flexDirection: 'column', background: SKIN.face, padding: '2px', overflow: 'hidden' }, raisedBev());
    var head = winTitlebar(card, { iconPx: 12, nameFs: 10, right: isP ? el('span', { class: 'mono', style: { fontSize: '8px', fontWeight: 700, color: '#fff', background: '#d8472b', padding: '1px 4px', flex: 'none' } }, ['⚡']) : basicAtkChip(true) });
    if (isP) return el('div', { style: st }, [
      head, viewportBox(card, 64, { gScale: 0.5 }),
      el('div', { style: Object.assign({ flex: 1, margin: '3px 2px', padding: '5px 6px', background: SKIN.effBg, color: SKIN.effTxt, fontSize: '8.5px', lineHeight: 1.4, overflow: 'hidden' }, sunkenBev()) }, richText(card.text))
    ]);
    return el('div', { style: st }, [
      head, viewportBox(card, 60, { gScale: 0.5 }),
      effectPanel(card, { fs: 8, flex: true, min: 22 }),
      statusStrip(card.atk, card.hp, card.hp, { fs: 13, icoPx: 11, meterH: 7 })
    ]);
  }

  // ---- 손패 peek: 꾹 누르면 큰 카드 미리보기가 셸 중앙에 떠서 내용 확인(회전 셸과 함께 정렬)
  var peek = null, peekT = null;
  function schedulePeek(i) { clearTimeout(peekT); var id = G.players[HUMAN].hand[i]; if (!id) return; peekT = setTimeout(function () { showPeek(id); }, 430); } // 길게 눌러야 상세가 뜨도록(빠른 드래그와 구분)
  function showPeek(id) {
    hidePeek(false);
    var stage = app.querySelector('.bevel') || fxLayer();
    var box = el('div', { id: 'handpeek', style: { position: 'absolute', left: '50%', top: '44%', transform: 'translate(-50%,-50%) scale(.7)', opacity: '0', zIndex: 130, pointerEvents: 'none', transition: 'transform .12s ease, opacity .12s ease', filter: 'drop-shadow(0 10px 22px rgba(0,0,0,.55))' } }, [cardPreviewEl(id)]);
    stage.appendChild(box);
    void box.offsetWidth; // reflow → 트랜지션 발동
    box.style.transform = 'translate(-50%,-50%) scale(1)'; box.style.opacity = '1';
    peek = box;
  }
  function hidePeek() { clearTimeout(peekT); peekT = null; if (peek) { peek.remove(); peek = null; } }
  function idlePeek(i) { // 드래그/선택 없이 미리보기만 (idle 손패)
    schedulePeek(i);
    function done() { hidePeek(); document.removeEventListener('pointerup', done); document.removeEventListener('pointercancel', done); }
    document.addEventListener('pointerup', done);
    document.addEventListener('pointercancel', done);
  }

  // ---- 필드 유닛 롱프레스 inspect(터치): 데스크톱 hover(사거리+카드 상세) 대체. 손패 peek 과 동일 제스처.
  // 필드 인스턴스(내/적 무관)를 꾹 누르면 함수 범위가 보드에 켜지고 상세 카드(사거리 그리드 포함)가 뜬다.
  // 손가락을 떼면 사라진다. 짧은 탭은 suppressCellClick 없이 그대로 clickCell(선택/이동/능력/기본공격)로 처리.
  var fpeek = null, fpeekT = null, fpeekSX = 0, fpeekSY = 0, fpeekLit = [], suppressCellClick = false;
  function scheduleFieldPeek(key, sx, sy) { clearTimeout(fpeekT); fpeekSX = sx; fpeekSY = sy; if (!G.board[key]) return; fpeekT = setTimeout(function () { showFieldPeek(key); }, 430); }
  function showFieldPeek(key) {
    var u = G.board[key]; if (!u || !CARDS[u.cardId]) return;
    hideFieldPeek();
    suppressCellClick = true; // 롱프레스 뒤 합성되는 click 은 무시(선택/이동/발동 방지)
    if (u.type === 'object') { // 함수 범위를 보드에 라이트업(원본 인라인 스타일 저장 후 복원)
      G.rangeCellsFor(u).forEach(function (k) {
        var cell = app.querySelector('[data-key="' + k + '"]'); if (!cell) return;
        fpeekLit.push({ el: cell, bs: cell.style.boxShadow, bg: cell.style.background });
        cell.style.boxShadow = 'inset 0 0 0 2px ' + hexa(SKIN.rangeGold, .85);
        cell.style.background = hexa(SKIN.rangeGold, .2);
      });
    }
    var stage = app.querySelector('.bevel') || fxLayer();
    // 누르는 손가락에 상세창이 가리지 않도록 — 손가락이 화면 아래쪽이면 위에, 위쪽이면 아래에 띄운다.
    var vh = window.innerHeight || 700, boxTop = (fpeekSY > vh * 0.46) ? '24%' : '72%';
    var box = el('div', { id: 'fieldpeek', style: { position: 'absolute', left: '50%', top: boxTop, transform: 'translate(-50%,-50%) scale(.7)', opacity: '0', zIndex: 130, pointerEvents: 'none', transition: 'transform .12s ease, opacity .12s ease', filter: 'drop-shadow(0 10px 22px rgba(0,0,0,.55))' } }, [
      el('div', { style: { width: '230px', background: SKIN.chassis, color: SKIN.txt, border: '1.5px solid ' + SKIN.ink, boxShadow: '4px 4px 0 rgba(0,0,0,.4)', overflow: 'hidden' } }, [cardTipContent(u.cardId, u)])
    ]);
    stage.appendChild(box);
    void box.offsetWidth; // reflow → 트랜지션 발동
    box.style.transform = 'translate(-50%,-50%) scale(1)'; box.style.opacity = '1';
    fpeek = box;
  }
  function hideFieldPeek() {
    clearTimeout(fpeekT); fpeekT = null;
    if (fpeek) { fpeek.remove(); fpeek = null; }
    fpeekLit.forEach(function (o) { o.el.style.boxShadow = o.bs; o.el.style.background = o.bg; }); fpeekLit = [];
  }

  // ---- controls
  function controls(meTurn) {
    var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: COMPACT ? '7px' : '12px', padding: COMPACT ? '4px 7px' : '5px 12px', background: SKIN.chassisAlt, color: SKIN.txt, border: '1px solid ' + SKIN.ink, boxShadow: 'inset 1px 1px 0 ' + SKIN.bevelHi + ', inset -2px -2px 0 ' + SKIN.bevelLo, flexWrap: 'wrap' } });
    var pips = el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } });
    for (var i = 0; i < 2; i++) pips.appendChild(el('span', { style: { width: COMPACT ? '16px' : '22px', height: '12px', border: '1px solid ' + SKIN.ink, background: i < G.actions ? SKIN.heat : SKIN.chassisSunk } }));
    row.appendChild(pips);
    row.appendChild(el('span', { class: 'mono', style: { fontSize: '11px' } }, [G.actions + '/2 액션']));
    if (ptr) {
      var pi = RT.pointerRangeInfo(ptr.card.id);
      row.appendChild(el('span', { class: 'mono', style: { fontSize: '10px', color: SKIN.enemy, fontWeight: 700 } }, [COMPACT ? ('◆ ' + ptr.card.name + ' 시전') : ('◆ ' + ptr.card.name + ' 시전 — ' + (pi ? '시전 사거리 ' + pi.text + ' · ' : '') + '파란 구역 안 빨강 대상 클릭/드래그')]));
    } else if (!COMPACT) row.appendChild(el('span', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted } }, ['손패 카드를 드래그 또는 클릭 · 내 유닛 클릭 → 행동']));
    row.appendChild(el('span', { style: { flex: 1 } }));
    if (sel) row.appendChild(el('button', { class: 'btn ghost', style: { fontSize: '11px', padding: '6px 11px' }, onclick: function () { sel = ptr = null; render(); } }, ['선택 해제']));
    // ☰ 메뉴 — 항복·규칙 요약(모바일과 동일한 바텀시트). 턴 종료 옆에. 튜토리얼 중엔 숨김.
    if (!tutorial) row.appendChild(el('button', { class: 'btn ghost', title: '메뉴', style: { fontSize: '12px', padding: '9px 12px' }, onclick: function () { menuView = 'menu'; render(); } }, ['☰ 메뉴']));
    row.appendChild(el('button', { class: 'btn', disabled: !meTurn ? 'disabled' : null, onclick: meTurn ? endTurn : null }, ['턴 종료']));
    return row;
  }

  // ---- side panel: inspector + log
  function glossaryBox() {
    function line(k) {
      var g = GLOSS[k];
      return el('div', { style: { display: 'flex', gap: '7px', marginBottom: '3px' } }, [
        el('span', { class: 'mono', style: { fontWeight: 700, color: SKIN.txt, width: '46px', flex: 'none', fontSize: '10px' } }, [k]),
        el('span', { style: { fontSize: '10px', color: SKIN.panelText, lineHeight: 1.4 } }, [g.d])
      ]);
    }
    return el('div', { style: { borderTop: '1.5px solid ' + SKIN.line, paddingTop: '8px' } }, [
      el('div', { class: 'grot', style: { fontSize: '9px', letterSpacing: '.2em', color: SKIN.muted, marginBottom: '6px' } }, ['키워드']),
      line('If'), line('When'), line('Once'), line('While'), line('For'), line('require'),
      el('div', { style: { display: 'flex', gap: '10px', marginTop: '7px', flexWrap: 'wrap' } }, [
        el('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: SKIN.panelText } }, [
          el('span', { style: { width: '10px', height: '10px', flex: 'none', background: hexa(SKIN.rangeGold, .5), boxShadow: 'inset 0 0 0 1.5px ' + SKIN.rangeGold } }), '함수 범위'
        ]),
        el('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: SKIN.panelText } }, [
          el('span', { class: 'mono', style: { color: '#fff', background: SKIN.enemy, padding: '0 3px', flex: 'none', fontSize: '9px', fontWeight: 700 } }, ['⚔']), '옆칸 = 기본 공격'
        ])
      ]),
      el('div', { style: { fontSize: '9px', color: SKIN.muted, marginTop: '5px', lineHeight: 1.55 } }, ['🟡 함수 범위 = 능력이 닿는 칸(카드마다 다름) · 🔴 옆칸 = 기본 공격이 닿는 1칸(모든 유닛 공통) · 필드 카드에 커서를 올리면 함수 범위가 보드에 표시됩니다.'])
    ]);
  }
  function sidePanel() {
    var panel = el('div', { id: 'side', style: { flex: '0 0 300px', width: '300px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '10px', background: SKIN.chassisAlt, color: SKIN.txt, border: '1px solid ' + SKIN.ink, padding: '12px', boxShadow: 'inset 1px 1px 0 ' + SKIN.bevelHi + ', inset -2px -2px 0 ' + SKIN.bevelLo } });
    panel.appendChild(el('div', { id: 'inspector' }, [inspectorContent()]));
    panel.appendChild(glossaryBox());
    panel.appendChild(feedPanel());
    return panel;
  }
  function feedPanel() {
    var box = el('div', { style: { marginTop: 'auto', borderTop: '1.5px solid ' + SKIN.line, paddingTop: '8px' } }, [
      el('div', { class: 'grot', style: { fontSize: '9px', letterSpacing: '.22em', color: SKIN.muted, marginBottom: '5px' } }, ['전투 기록'])
    ]);
    var list = el('div', { style: { maxHeight: '184px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' } });
    if (!feed.length) list.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.faint } }, ['행동이 여기 기록됩니다.']));
    feed.forEach(function (en) {
      var col = en.actor === HUMAN ? SKIN.own : (en.actor === AI ? SKIN.enemy : SKIN.muted);
      var death = en.kind === 'death';
      list.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '5px', fontSize: '10.5px', lineHeight: 1.4, padding: '2px 5px', borderLeft: '3px solid ' + col, background: death ? hexa(col, .12) : (en.actor === AI ? hexa(SKIN.enemy, .05) : 'transparent'), cursor: en.card ? 'help' : 'default' }, onmouseenter: en.card ? function (e) { showCardTip(e.currentTarget.getBoundingClientRect(), en.card, null); } : null, onmouseleave: en.card ? hideCardTip : null }, [
        el('span', { class: 'mono', style: { fontSize: '8px', fontWeight: 700, color: col, flex: 'none', width: '16px' } }, [en.actor === HUMAN ? '나' : (en.actor === AI ? '상대' : '·')]),
        el('span', { style: { flex: 'none', color: col } }, [en.icon || '']),
        el('span', { style: { color: death ? col : SKIN.panelText, fontWeight: death ? 700 : 400 } }, [en.text])
      ]));
    });
    box.appendChild(list);
    return box;
  }
  function refreshInspector() { var ins = document.getElementById('inspector'); if (ins) { while (ins.firstChild) ins.removeChild(ins.firstChild); ins.appendChild(inspectorContent()); } }
  function forLeftLines(card, bu) {
    var lines = (card.abilities || []).map(function (ab, idx) {
      if (ab.kw !== 'For') return null;
      var N = ab.forCount || 1, left = bu ? (N - (bu.onceUsed['for' + idx] || 0)) : N;
      return el('div', { class: 'mono', style: { fontSize: '9.5px', fontWeight: 700, color: left > 0 ? SKIN.ally : SKIN.faint } }, ['⚡ For 발동 ' + left + ' / ' + N + (bu ? ' 남음' : ' (게임당)')]);
    }).filter(Boolean);
    if (!lines.length) return null;
    return el('div', { style: { marginBottom: '9px', display: 'flex', flexDirection: 'column', gap: '2px' } }, lines);
  }
  function inspectorContent() {
    var id = pinned ? pinned.id : null;
    if (!id || !CARDS[id] || CARDS[id].kind === 'body') return el('div', {}, [
      el('div', { class: 'grot', style: { fontSize: '9px', letterSpacing: '.18em', color: SKIN.muted, marginBottom: '6px' } }, ['INSPECTOR']),
      el('div', { style: { fontSize: '11px', color: SKIN.panelText, lineHeight: 1.7 } }, ['카드나 필드 유닛을 클릭하면 상세가 여기에 고정됩니다.'])
    ]);
    var card = CARDS[id], cl = CLS[card.cls] || CLS.generic, isP = card.kind === 'pointer';
    var bu = (pinned && pinned.key && G.board[pinned.key] && G.board[pinned.key].cardId === id) ? G.board[pinned.key] : null;
    var atk = bu ? G.effAtk(bu) : card.atk, hp = bu ? G.curHp(bu) : card.hp, mx = bu ? G.effMaxHp(bu) : card.hp;
    return el('div', {}, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 9px', marginBottom: '8px', background: isP ? '#1d1d24' : cl, borderBottom: isP ? '2px solid ' + cl : 'none' } }, [
        el('span', { style: { fontSize: '13px', color: isP ? cl : '#fff' } }, [isP ? '◆' : GLY[card.cls]]),
        el('span', { style: { fontSize: '10px', color: isP ? cl : '#fff', letterSpacing: '.1em' } }, [isP ? '포인터 · 1회성' : card.cls]),
        bu ? el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '8px', color: '#fff', background: ownerColor(bu.owner), padding: '0 4px' } }, [bu.owner === HUMAN ? '내 유닛' : '상대 유닛'])
           : el('span', { class: 'mono', style: { marginLeft: 'auto', fontSize: '8px', color: isP ? SKIN.faint : 'rgba(255,255,255,.9)' } }, [isP ? 'POINTER' : 'OBJECT'])
      ]),
      viewportBox(card, 64, { margin: '0', gScale: 0.52 }),
      el('div', { style: { padding: '9px 2px 0' } }, [
        el('div', { class: isP ? 'mono' : 'grot', style: { fontWeight: 700, fontSize: '21px', lineHeight: 1, marginBottom: '8px' } }, [card.name]),
        isP ? null : el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '7px' } }, [
          statBar('ATK', atk, ATK_MAX, SKIN.heat, bu ? card.atk : null),
          statBar('HP', hp, HP_MAX, SKIN.own)
        ]),
        (bu && hp < mx) ? el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.enemy, marginBottom: '6px' } }, ['피해 누적 ' + (mx - hp) + ' · 최대 ' + mx]) : null,
        (bu && bu.owner === HUMAN && bu.attackedTurn === G.turnNo) ? el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.faint, marginBottom: '6px' } }, ['⚔ 이번 턴 기본 공격 완료']) : null,
        card.deckLimit ? el('div', { class: 'mono', style: { fontSize: '9px', color: SKIN.rangeGold, marginBottom: '4px' } }, ['덱당 ' + card.deckLimit + '장 제한']) : null,
        el('div', { style: { fontSize: '12.5px', color: SKIN.txt, lineHeight: 1.6, marginBottom: '9px' } }, richText(card.text)),
        (isP && RT.pointerRangeInfo(id)) ? el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.own, fontWeight: 700, marginBottom: '8px' } }, ['◆ 시전 사거리 · ' + RT.pointerRangeInfo(id).text]) : null,
        (isP && card.castCondition) ? el('div', { class: 'mono', style: { fontSize: '10px', color: G.castConditionMet(HUMAN, card) ? SKIN.faint : SKIN.enemy, fontWeight: 700, marginBottom: '8px' } }, [(G.castConditionMet(HUMAN, card) ? '✓' : '⚠') + ' 시전조건 · ' + RT.castCondText(card.castCondition)]) : null,
        forLeftLines(card, bu),
        isP ? null : el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.enemy, fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' } }, [
          el('span', { style: { color: '#fff', background: SKIN.enemy, padding: '0 4px', flex: 'none' } }, ['⚔']),
          '기본 공격 · 옆칸 1칸 (무료·턴1회)'
        ]),
        rangeGridEl(RT.cardRange(id), cl)
      ])
    ]);
  }

  function bannerEl(text, color) {
    return el('div', { class: 'grot', style: { position: 'fixed', left: '50%', top: '42%', transform: 'translate(-50%,-50%)', zIndex: 40, fontWeight: 700, fontSize: '26px', letterSpacing: '.05em', padding: '18px 40px', background: color, color: '#e9eaee', border: '2px solid ' + color, boxShadow: '6px 6px 0 rgba(28,28,38,.25)', animation: 'bannerIn .4s ease both', pointerEvents: 'none' } }, [text]);
  }
  function resultOverlay() {
    var win = G.winner === HUMAN, draw = G.winner === 'draw';
    var color = draw ? '#6b6b75' : win ? '#3c8a66' : '#c23c70';
    var label = draw ? '무승부' : win ? '승리' : '패배';
    if (!winSoundDone) { winSoundDone = true; setTimeout(function () { if (win) Sound.win(); else if (!draw) Sound.lose(); }, 200); }
    var ov = el('div', { style: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(28,28,38,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    var stat = el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.muted, margin: '6px 0 18px' } }, ['turn ' + G.turnNo + ' · 내 본체 ' + G.curHp(G.body(0)) + ' · 상대 ' + G.curHp(G.body(1))]);
    // 결과 오버레이를 닫고 최종 보드를 살펴볼 수 있게 하는 보조 버튼 + 액션 버튼을 나란히 배치
    function viewBtn() { return el('button', { class: 'btn', style: { background: 'transparent', color: SKIN.txt, border: '1px solid ' + SKIN.ink }, onclick: function () { reviewMode = true; render(); } }, ['🔍 게임 보기']); }
    function btnRow(action) { return el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } }, [action, viewBtn()]); }
    var kids;
    if (challenge) {
      var streak = win ? (challenge.wins + 1) : challenge.wins;
      setBestStreak(challenge.deck, streak);                     // 덱별 최고치 즉시 저장(더 높을 때만)
      var isRecord = streak > challenge.baseBest && streak > 0;
      var recordLine = el('div', { class: 'mono', style: { fontSize: '11px', color: SKIN.muted, margin: '0 0 14px' } }, [
        challenge.deck + ' 덱 · ',
        isRecord ? el('b', { style: { color: SKIN.rangeGold } }, ['🎉 신기록! 최고 ' + streak + '연승']) : ('최고 기록 ' + bestStreak(challenge.deck) + '연승')
      ]);
      if (win) {
        kids = [
          el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '34px', letterSpacing: '.05em', color: SKIN.rangeGold } }, ['스테이지 ' + challenge.stage + ' 클리어']),
          el('div', { class: 'mono', style: { fontSize: '13px', fontWeight: 700, color: SKIN.rangeGold, margin: '6px 0 2px' } }, ['🏆 ' + streak + '연승']),
          stat, recordLine,
          el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, marginBottom: '12px' } }, ['다음 상대는 더 강해집니다 — 본체 +' + (challenge.stage * 8) + ' · 추가 카드/선발 유닛']),
          btnRow(el('button', { class: 'btn', onclick: function () { nextChallenge(); } }, ['다음 스테이지 ▶']))
        ];
      } else {
        kids = [
          el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '34px', letterSpacing: '.05em', color: SKIN.enemy } }, ['도전 종료']),
          el('div', { class: 'mono', style: { fontSize: '13px', fontWeight: 700, color: SKIN.txt, margin: '6px 0 2px' } }, ['최종 🏆 ' + challenge.wins + '연승 · 스테이지 ' + challenge.stage + ' 에서 패배']),
          stat, recordLine,
          btnRow(el('button', { class: 'btn', onclick: function () { endChallenge(); } }, ['타이틀로']))
        ];
      }
    } else {
      kids = [
        el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '38px', letterSpacing: '.06em', color: color } }, [label]),
        stat,
        btnRow(el('button', { class: 'btn', onclick: function () { G = null; UI.renderTitle(); } }, ['다시 하기']))
      ];
    }
    ov.appendChild(el('div', { style: { background: SKIN.chassis, color: SKIN.txt, border: '2px solid ' + SKIN.ink, boxShadow: '6px 6px 0 rgba(0,0,0,.4)', padding: '26px 34px', textAlign: 'center', animation: 'pop .35s ease both' } }, kids));
    return ov;
  }

  // ── 모바일 메뉴 바텀시트(항복 · 규칙 요약) — 컨트롤 바의 ☰ 로 연다. menuView: 'menu'|'confirm'|'rules'.
  //   규칙 설명은 GLOSS(키워드 사전)를 그대로 재사용해 간략히 보여준다.
  var RULE_ABILITY = ['If', 'When', 'Once', 'While', 'For'];        // 특수능력 발동 방식
  var RULE_RANGE = ['옆칸', '주위', '앞 직선', '대각선', '테두리', '관통']; // 사거리 키워드
  function ruleRows(keys) {
    return keys.map(function (k) {
      var g = GLOSS[k]; if (!g) return null;
      return el('div', { style: { padding: '6px 0', borderTop: '1px solid ' + SKIN.line } }, [
        el('div', { class: 'mono', style: { fontSize: '11px', fontWeight: 700, color: SKIN.own, marginBottom: '2px' } }, [g.t]),
        el('div', { style: { fontSize: '11px', lineHeight: 1.5, color: SKIN.muted } }, [g.d])
      ]);
    }).filter(Boolean);
  }
  function closeMenu() { menuView = null; render(); }
  function doSurrender() {
    menuView = null;
    if (G && G.winner === undefined) {
      G.winner = AI;                                  // 상대 승리로 즉시 종료 → resultOverlay(패배/도전 종료)
      if (G.note) G.note('★ 항복 — 상대 승리');
      reviewMode = false; winSoundDone = false;
    }
    render();
  }
  function menuOverlay() {
    var SAB = 'env(safe-area-inset-bottom,0px)';
    var back = el('div', { style: { position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(28,28,38,.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }, onclick: function (e) { if (e.target === back) closeMenu(); } });
    function header(title, backTo) {
      return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, [
        backTo ? el('button', { class: 'btn ghost', style: { fontSize: '12px', padding: '5px 10px' }, onclick: function () { menuView = backTo; render(); } }, ['‹ 뒤로']) : null,
        el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '15px', letterSpacing: '.03em', flex: 1 } }, [title]),
        el('button', { class: 'btn ghost', style: { fontSize: '13px', padding: '5px 11px', textAlign: 'center' }, onclick: closeMenu }, ['✕'])
      ]);
    }
    var kids;
    if (menuView === 'rules') {
      kids = [
        header('규칙 요약', 'menu'),
        el('div', { style: { overflowY: 'auto', maxHeight: '58vh', WebkitOverflowScrolling: 'touch' } }, [
          el('div', { class: 'grot', style: { fontSize: '11px', letterSpacing: '.16em', color: SKIN.muted, margin: '2px 0' } }, ['특수능력 · 발동 방식']),
          el('div', {}, ruleRows(RULE_ABILITY)),
          el('div', { class: 'grot', style: { fontSize: '11px', letterSpacing: '.16em', color: SKIN.muted, margin: '14px 0 2px' } }, ['사거리 키워드']),
          el('div', {}, ruleRows(RULE_RANGE))
        ])
      ];
    } else if (menuView === 'confirm') {
      kids = [
        header('항복', 'menu'),
        el('div', { style: { fontSize: '13px', lineHeight: 1.55, color: SKIN.txt, marginBottom: '14px' } }, ['정말 항복할까요? 이 대국은 패배로 기록됩니다.']),
        el('div', { style: { display: 'flex', gap: '10px' } }, [
          el('button', { class: 'btn', style: { flex: 1, textAlign: 'center', background: SKIN.enemy, color: '#fff' }, onclick: doSurrender }, ['항복하기']),
          el('button', { class: 'btn ghost', style: { flex: 1, textAlign: 'center' }, onclick: function () { menuView = 'menu'; render(); } }, ['취소'])
        ])
      ];
    } else {
      kids = [
        header('메뉴', null),
        el('button', { class: 'btn ghost', style: { display: 'block', width: '100%', textAlign: 'center', fontSize: '14px', padding: '11px' }, onclick: function () { menuView = 'rules'; render(); } }, ['📖 규칙 요약 (특수능력·사거리)']),
        el('button', { class: 'btn', style: { display: 'block', width: '100%', textAlign: 'center', fontSize: '14px', padding: '11px', background: SKIN.enemy, color: '#fff' }, onclick: function () { menuView = 'confirm'; render(); } }, ['🏳 항복'])
      ];
    }
    back.appendChild(el('div', { style: { width: '100%', maxWidth: '480px', margin: '0 auto', background: SKIN.chassis, color: SKIN.txt, borderTop: '2px solid ' + SKIN.ink, boxShadow: '0 -4px 18px rgba(0,0,0,.35)', padding: '14px 16px calc(16px + ' + SAB + ')', display: 'flex', flexDirection: 'column', gap: '10px', animation: 'drawIn .22s ease both' } }, kids));
    return back;
  }

  // 리뷰(게임 보기) 모드: 최종 보드를 그대로 두고 상단에 결과 오버레이를 다시 열 수 있는 바만 띄운다.
  function reviewBar() {
    var win = G.winner === HUMAN, draw = G.winner === 'draw';
    var color = draw ? '#6b6b75' : win ? '#3c8a66' : '#c23c70';
    var label = draw ? '무승부' : win ? '승리' : '패배';
    return el('div', { class: 'grot', style: { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 700, fontSize: '13px', padding: '8px 14px', background: SKIN.chassis, color: SKIN.txt, border: '2px solid ' + SKIN.ink, boxShadow: '3px 3px 0 rgba(0,0,0,.35)' } }, [
      el('span', { style: { color: color } }, ['게임 종료 · ' + label]),
      el('span', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted } }, ['보드를 살펴보는 중']),
      el('button', { class: 'btn', style: { fontSize: '11px', padding: '4px 10px' }, onclick: function () { reviewMode = false; render(); } }, ['결과 보기 ▲'])
    ]);
  }

  // =================================================================== interaction
  function clickHand(i) {
    if (G.active !== HUMAN || G.winner !== undefined || aiThinking) return;
    var id = G.players[HUMAN].hand[i], card = CARDS[id];
    pinned = { id: id }; // pin detail to the right panel
    sel = null;
    if (card.kind === 'pointer') {
      if (!G.canCast(HUMAN, id)) { flash(castWhy(card)); return; }
      // 모바일: 포인터는 탭이 아니라 필드로 드래그해서 놓을 때만 시전(오발동 방지).
      if (COMPACT) { flash('포인터는 필드로 드래그해서 시전하세요'); return; }
      if (card.need === 'none') { G.cast(HUMAN, i, null, false); afterAction(); return; }
      ptr = { i: i, card: card, need: card.need, picks: [] };
      // if no legal targets, just resolve with null (e.g., area pointers)
      if (pointerTargets(ptr).length === 0) { if (/ally|enemy|twoAlly|cell/.test(card.need)) { flash('대상 없음'); ptr = null; return; } G.cast(HUMAN, i, null, false); ptr = null; afterAction(); return; }
      render();
    } else {
      if (!G.canDeclare(HUMAN, id)) { flash(card.require ? 'require 미충족' : '선언 불가'); return; }
      sel = { type: 'hand', i: i }; ptr = null; render();
    }
  }
  function castWhy(card) {
    if (G.actions < 1) return '남은 액션 없음';
    if (card.castCondition && !G.castConditionMet(HUMAN, card)) return '시전 조건 미충족';
    if ((card.need === 'enemy' || card.need === 'cell') && G.castTargets(HUMAN, card.id).length === 0) return '시전 범위 내 대상 없음 (내 유닛·본체 2칸)';
    return '시전 불가';
  }
  function clickCell(key) {
    if (mullPhase || G.winner !== undefined || aiThinking || G.active !== HUMAN) return;
    var u = G.board[key];
    if (u && u.type === 'object') pinned = { id: u.cardId, key: key }; // pin detail of any clicked unit
    if (ptr) {
      var tg = pointerTargets(ptr);
      if (tg.indexOf(key) >= 0) {
        if (ptr.need === 'twoAlly') {
          ptr.picks.push(key);
          if (ptr.picks.length < 2) { render(); return; }
          G.cast(HUMAN, ptr.i, ptr.picks[0], false, { second: ptr.picks[1] }); ptr = null; afterAction(); return;
        }
        G.cast(HUMAN, ptr.i, key, false); ptr = null; afterAction(); return;
      }
      ptr = null; render(); return;
    }
    if (sel && sel.type === 'hand') {
      if (G.declareCells(HUMAN).indexOf(key) >= 0) { G.declare(HUMAN, sel.i, key); sel = null; afterAction(); return; }
      if (u && u.owner === HUMAN && u.type === 'object') { sel = { type: 'board', key: key }; render(); return; }
      sel = null; render(); return;
    }
    if (sel && sel.type === 'board') {
      var su = G.board[sel.key];
      if (su) {
        // basic attack an adjacent enemy object or the enemy body (free, once/turn)
        if (u && u.owner !== HUMAN && G.canBasicAttack(su) && G.basicAttackTargets(su).indexOf(key) >= 0) { G.basicAttack(su, key); render(); return; }
        if (G.moveCells(su).indexOf(key) >= 0) { G.move(su, key, false); sel = { type: 'board', key: key }; afterAction(); return; }
      }
      if (u && u.owner === HUMAN && u.type === 'object') { sel = { type: 'board', key: key }; render(); return; }
      sel = null; render(); return;
    }
    if (u && u.owner === HUMAN && u.type === 'object') { sel = { type: 'board', key: key }; render(); }
    else { sel = null; render(); }
  }
  function afterAction() { sel = null; ptr = null; pendingPlay = null; if (G.winner !== undefined) { render(); return; } render(); }
  function fireFor(u, idx, ab) {
    if (!G.forReady(u, idx)) { flash('이동/발동할 칸이 없음 — 발동 불가'); return; }
    var extra = {};
    if (ab.trigger === 'onActive') { var d = G.moveCells(u)[0]; if (d) extra.dest = d; }
    G.fireFor(u, idx, extra); render();
  }
  function pointerTargets(ptr) {
    var need = ptr.need, me = HUMAN, out = [];
    function ek(arr) { return arr.map(function (x) { return unitKey(G, x); }).filter(Boolean); }
    if (need === 'enemy' || need === 'cell') out = G.castTargets(me, ptr.card.id); // §8 castRange-limited
    else if (need === 'ally') out = ek(G.allyObjects(me));
    else if (need === 'allyThread') out = ek(G.allyObjects(me).filter(function (x) { return cardCls(x) === 'thread'; }));
    else if (need === 'allyProcess') out = ek(G.allyObjects(me).filter(function (x) { return cardCls(x) === 'process'; }));
    else if (need === 'allyOrBody') { out = ek(G.allyObjects(me)); out.push(bodyKey(me)); }
    else if (need === 'twoAlly') { out = ek(G.allyObjects(me)).filter(function (k) { return ptr.picks.indexOf(k) < 0; }); }
    // fizzle guard: drop targets the pointer can't actually affect (e.g. rush()/pull() into a blocked cell)
    if (ptr.card.castValid) out = out.filter(function (k) { return ptr.card.castValid(G, me, k, {}); });
    return out;
  }

  // ---- drag to declare/cast (hand → board). A press without movement falls back to clickHand.
  var drag = null;
  // Pointer Events 로 통일 — 마우스·터치·펜 동일 처리. 터치에선 손패 카드에 touch-action:pan-y 를 걸어
  // 세로 스크롤은 브라우저가, 가로(보드 방향) 드래그는 우리가 잡는다.
  function endDragListeners() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('pointercancel', onDragCancel);
  }
  function startHandDrag(e, i) {
    if (G.active !== HUMAN || G.winner !== undefined || aiThinking) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'mouse') e.preventDefault(); // 마우스: 텍스트 선택/네이티브 드래그 방지. 터치: 스크롤 허용 위해 보류.
    try { var hc = e.currentTarget; pendingPlay = { rect: hc.getBoundingClientRect(), id: G.players[HUMAN].hand[i] }; } catch (er) { pendingPlay = null; }
    drag = { i: i, moved: false, sx: e.clientX, sy: e.clientY, invalid: false, ghost: null, pid: e.pointerId };
    if (COMPACT) schedulePeek(i); // 꾹 누르면 큰 미리보기
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('pointercancel', onDragCancel);
  }
  function onDragMove(e) {
    if (!drag || (drag.pid != null && e.pointerId !== drag.pid)) return;
    if (!drag.moved) {
      if (peek) return; // 이미 상세보기(peek) 중이면 손가락이 흔들려도 드래그(시전)로 전환하지 않음 — 인스펙트 유지(토스트/재렌더 방지)
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) < 10) return; // 임계값(작은 흔들림 무시)
      // 모바일: '위로'(필드 방향) 우세일 때만 플레이 드래그 시작. 가로/아래 → 손패 좌우 스크롤에 양보하고 취소.
      if (COMPACT && !(dy < 0 && Math.abs(dy) > Math.abs(dx))) { endDragListeners(); drag = null; hidePeek(); return; }
      drag.moved = true; hidePeek(); beginDragVisual();
    }
    if (e.cancelable) e.preventDefault(); // 드래그 확정 후에만 기본동작(스크롤) 억제
    if (drag.ghost) { drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px'; }
  }
  function onDragUp(e) {
    if (drag && drag.pid != null && e.pointerId !== drag.pid) return;
    endDragListeners();
    var d = drag; drag = null;
    var wasPeeking = !!peek; hidePeek(); // 상세보기(peek)를 띄운 채 뗀 거면 '탭'으로 취급하지 않는다
    if (!d) return;
    // 길게 눌러 카드 상세만 확인한 경우: 선택/토스트/재렌더 없이 상세만 닫는다(손패 스크롤 유지·포인터 안내 토스트 방지)
    if (!d.moved) { if (!wasPeeking) clickHand(d.i); return; }
    if (d.ghost) d.ghost.remove();
    performDrop(d, cellKeyAt(e.clientX, e.clientY));
  }
  // 터치에서 브라우저가 가로 스크롤로 판단하면 pointercancel 발생 — 이동 전이면 그냥 스크롤로 넘긴다.
  function onDragCancel(e) {
    if (drag && drag.pid != null && e.pointerId !== drag.pid) return;
    endDragListeners();
    var d = drag; drag = null; hidePeek();
    if (!d) return;
    if (d.ghost) d.ghost.remove();
    if (d.moved) { sel = ptr = null; render(); }
  }
  function beginDragVisual() {
    var id = G.players[HUMAN].hand[drag.i]; if (!id) { drag.invalid = true; return; }
    var card = CARDS[id]; pinned = { id: id }; sel = null; ptr = null;
    if (card.kind === 'pointer') {
      if (!G.canCast(HUMAN, id)) { drag.invalid = true; flash(castWhy(card)); }
      else if (card.need !== 'none') ptr = { i: drag.i, card: card, need: card.need, picks: [] };
    } else {
      if (!G.canDeclare(HUMAN, id)) { drag.invalid = true; flash(card.require ? 'require 미충족' : '선언 불가'); }
      else sel = { type: 'hand', i: drag.i };
    }
    // 실제 카드가 손가락 위로 떠오르며(팝) 따라다님. invalid 이면 붉게 흐림.
    var g = el('div', { id: 'draghost', style: { position: 'fixed', zIndex: 95, pointerEvents: 'none', transformOrigin: 'center bottom', transform: 'translate(-50%,-108%) scale(.72) rotate(-3deg)', filter: 'drop-shadow(0 14px 22px rgba(0,0,0,.55))', opacity: drag.invalid ? .5 : 1, transition: 'transform .1s ease' } }, [dragGhostEl(id)]);
    g.style.left = drag.sx + 'px'; g.style.top = drag.sy + 'px';
    fxLayer().appendChild(g); drag.ghost = g;
    // 다음 프레임에 확대(집어드는 팝 애니메이션)
    void g.offsetWidth;
    g.style.transform = 'translate(-50%,-108%) scale(1.04) rotate(-3deg)';
    render();
  }
  function cellKeyAt(x, y) { try { var e = document.elementFromPoint(x, y); var c = e && e.closest ? e.closest('[data-key]') : null; return c ? c.getAttribute('data-key') : null; } catch (err) { return null; } }
  function performDrop(d, key) {
    var id = G.players[HUMAN].hand[d.i], card = id ? CARDS[id] : null;
    if (d.invalid || !card) { sel = ptr = null; render(); return; }
    if (card.kind === 'pointer') {
      // 무대상 포인터도 '필드 위'에 놓아야 시전(모바일). 필드 밖에 놓으면 취소.
      if (card.need === 'none') { if (COMPACT && !key) { flash('필드에 놓아 시전하세요'); sel = ptr = null; render(); return; } G.cast(HUMAN, d.i, null, false); afterAction(); return; }
      var legal = ptr ? pointerTargets(ptr) : [];
      if (key && legal.indexOf(key) >= 0) {
        if (card.need === 'twoAlly') G.cast(HUMAN, d.i, key, false, { second: legal.filter(function (k) { return k !== key; })[0] });
        else G.cast(HUMAN, d.i, key, false);
        afterAction(); return;
      }
      flash('시전 범위 밖 — 파란 구역 안 빨강 대상에 놓으세요'); sel = ptr = null; render(); return;
    }
    if (key && G.declareCells(HUMAN).indexOf(key) >= 0) { G.declare(HUMAN, d.i, key); afterAction(); return; }
    flash('내 본체 행 빈 칸에 놓으세요'); sel = ptr = null; render(); return;
  }

  function endTurn() {
    if (G.active !== HUMAN || G.winner !== undefined) return;
    if (tutorial) { // 실습에선 AI로 넘기지 않고 마지막 단계에서 완료 처리
      if (tutorial.step < tutorial.steps.length - 1) { flash('아직 남은 단계가 있어요 — 위 안내를 따라 주세요.'); return; }
      tutorial.finished = true; sel = ptr = null; renderMatch(); return;
    }
    sel = ptr = null;
    G.endTurn();
    if (G.active === AI && G.winner === undefined) runAI(); else render();
  }
  // AI 페이싱: 일반 동작은 STEP 간격, 상대가 카드를 낸 직후(revealCard)엔 REVEAL 간격만큼 더 쉬어
  // 무슨 카드를 냈는지 확인할 시간을 준다. (기존 360ms 고정 setInterval → 가변 setTimeout)
  var AI_STEP_MS = 500, AI_REVEAL_MS = 1400;
  function runAI() {
    aiThinking = true; render();
    clearTimeout(aiTimer);
    var tick = function () {
      if (G.winner !== undefined) { aiThinking = false; render(); return; }
      aiRevealPause = false;
      var did = RT.ai.step(G);
      render(); // 이 안에서 카드 시전이 있었다면 revealCard 가 aiRevealPause 를 세운다
      if (!did) { G.endTurn(); aiThinking = false; render(); return; }
      aiTimer = setTimeout(tick, aiRevealPause ? AI_REVEAL_MS : AI_STEP_MS);
    };
    aiTimer = setTimeout(tick, AI_STEP_MS);
  }

  // optional automation hook (used by the screenshot driver; harmless in normal play)
  window.__RT_UI = {
    game: function () { return G; },
    render: render,
    endTurn: endTurn,
    setSel: function (s) { sel = s; },
    setPtr: function (p) { ptr = p; },
    clickHand: clickHand,
    clickCell: clickCell,
    isAiThinking: function () { return aiThinking; },
    mullState: function () { return { phase: mullPhase, ready: mullReady, busy: mullBusy, pick: Object.keys(mullPick).filter(function (k) { return mullPick[k]; }).map(Number) }; },
    // dev.html(일러스트 개발자 페이지)용 — 실제 게임 카드 페이스를 그대로 렌더한 DOM 노드 반환.
    // opts.compact=true → 모바일 미니카드, opts.mode('idle'|'preview') 선택. 게임 상태(G) 없이 안전 렌더.
    cardFaceEl: function (id, opts) {
      opts = opts || {};
      if (!CARDS[id]) return null;
      var sc = COMPACT, sg = G, ss = sel, sp = ptr;
      if (opts.compact != null) COMPACT = !!opts.compact;
      sel = null; ptr = null;
      if (!G) G = { castConditionMet: function () { return true; }, canCast: function () { return false; }, canDeclare: function () { return false; } };
      try { return handCardEl(id, 0, opts.mode || 'idle'); }
      catch (e) { return null; }
      finally { COMPACT = sc; G = sg; sel = ss; ptr = sp; }
    },
    // 테마 토큰(SKIN) 스왑 — dev.html 라이트/다크 미리보기용. 재렌더는 호출측 책임.
    setTheme: function (mode) { UI.applyTheme(mode === 'dark' ? 'dark' : 'light'); },
    getTheme: function () { return UI.getTheme(); }
  };


  // ---- 실습: AI를 끄고 스크립트대로 선언 → 이동 → 공격 → 턴종료를 따라 하게 한다.
  function tutSteps() {
    return [
      { key: '선언', title: '① 유닛 선언', tip: '손패의 **Race** 카드를 아래쪽 **초록색 ⊕ 홈칸**(4곳 중 아무 데나)으로 드래그해 놓으세요. 가운데 칸은 내 본체라 놓을 수 없어요. 유닛을 필드에 올리는 것을 «선언»이라 합니다.',
        done: function () { return tutHumanUnits().length >= 1; } },
      { key: '이동', title: '② 앞으로 이동', tip: '방금 놓은 유닛을 **클릭**한 뒤, 한 칸 위의 **파란 ◆ 칸**을 눌러 전진하세요. 유닛은 상하좌우 빈 칸으로만 1칸씩 움직입니다.',
        done: function () { return tutHumanUnits().some(function (kr) { return kr.r !== 4; }); } },
      { key: '공격', title: '③ 기본 공격', tip: '이제 **「옆칸」에 적(회색 유닛)** 이 있습니다. 내 유닛을 클릭하고 나타나는 **⚔ 공격** 버튼(또는 빨강 ⚔ 칸)을 눌러 적을 파괴하세요. 무료·턴당 1회입니다.',
        done: function () { return tutHumanUnits().some(function (kr) { return kr.u.attackedTurn === G.turnNo; }); } },
      { key: '종료', title: '④ 턴 종료', tip: '잘했어요! 마지막으로 오른쪽 아래 **«턴 종료»** 를 누르세요. 실전이라면 이때 상대(AI) 차례로 넘어갑니다.' }
    ];
  }
  function tutHumanUnits() {
    var out = [];
    for (var k in G.board) { var u = G.board[k]; if (u && u.type === 'object' && u.owner === HUMAN) { var p = P(k); out.push({ u: u, c: p[0], r: p[1] }); } }
    return out;
  }
  function tutSync() {
    var steps = tutorial.steps;
    while (tutorial.step < steps.length - 1 && steps[tutorial.step].done && steps[tutorial.step].done()) tutorial.step++;
  }
  function startTutorialPractice() {
    challenge = null;
    G = RT.newGame('T1', 'T1', { seed: 1, first: HUMAN });
    G.oppKey = '튜토리얼';
    G.players[HUMAN].hand = ['Race'];                       // 선언할 유닛 1장만
    for (var c = 1; c <= 5; c++) G.summon(AI, 'Token2', K(c, 2)); // 앞줄에 연습용 표적(공2 체2)
    sel = ptr = hover = pinned = null; mullPick = {}; mullPhase = false;
    resetFx(); G.onfx = handleFx;
    G.beginTurn();                                          // 내 첫 턴(선공은 드로우 스킵 → 손패 유지)
    tutorial = { step: 0, finished: false, steps: tutSteps() };
    lastBannerTurn = -1;
    renderMatch();
  }
  function tutBanner() {
    var steps = tutorial.steps, i = Math.min(tutorial.step, steps.length - 1), s = steps[i];
    var chips = el('div', { style: { display: 'flex', gap: '4px', padding: '2px 12px 8px', flexWrap: 'wrap' } });
    steps.forEach(function (st, idx) {
      var state = idx < tutorial.step ? 'done' : (idx === tutorial.step ? 'cur' : 'todo');
      chips.appendChild(el('span', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, padding: '3px 8px', border: '1px solid ' + SKIN.ink, background: state === 'cur' ? SKIN.silk : (state === 'done' ? SKIN.ally : SKIN.chassisSunk), color: state === 'cur' || state === 'done' ? '#fff' : SKIN.muted } }, [(state === 'done' ? '✓ ' : (idx + 1) + '. ') + st.key]));
    });
    return el('div', { style: { background: SKIN.chassisAlt, borderBottom: '1px solid ' + SKIN.ink, color: SKIN.txt } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px 2px' } }, [
        el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '13px', color: SKIN.own } }, ['📖 튜토리얼 · ' + s.title]),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'btn ghost', style: { fontSize: '10px', padding: '3px 8px' }, onclick: function () { UI.renderTutorial(0); } }, ['✕ 가이드로'])
      ]),
      el('div', { style: { fontSize: '12px', lineHeight: 1.55, padding: '0 12px 6px', color: SKIN.panelText } }, UI.tutRich(s.tip)),
      chips
    ]);
  }
  function tutDoneOverlay() {
    var card = el('div', { class: 'bevel', style: { background: SKIN.chassis, color: SKIN.txt, maxWidth: '400px', width: '86%', textAlign: 'center' } }, [
      titlebar('RUNTIME — 튜토리얼 완료'),
      el('div', { style: { padding: '22px 22px 24px' } }, [
        el('div', { style: { fontSize: '38px', marginBottom: '6px' } }, ['🎉']),
        el('div', { class: 'grot', style: { fontWeight: 700, fontSize: '20px', marginBottom: '8px' } }, ['기본기 완성!']),
        el('div', { style: { fontSize: '13px', lineHeight: 1.6, color: SKIN.panelText, marginBottom: '18px' } }, ['선언 · 이동 · 기본 공격 · 턴 종료까지 모두 해냈어요. 이제 실전에서 덱을 골라 AI와 겨뤄보세요!']),
        el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
          el('button', { class: 'btn', style: { background: SKIN.own, color: '#fff' }, onclick: function () { tutorial = null; G = null; UI.renderTitle(); } }, ['▶ 실전 시작']),
          el('button', { class: 'btn ghost', onclick: function () { tutorial = null; UI.renderTutorial(0); } }, ['📖 가이드 다시'])
        ])
      ])
    ]);
    return el('div', { style: { position: 'fixed', inset: '0', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,16,.55)', animation: 'bannerIn .3s ease' } }, [card]);
  }

  // =================================================================== 모듈 연결(exports)
  // title.js / tutorial.js 가 소비하는 공유 헬퍼·상태 접근자. theme.js 가 호출하는 훅도 여기서 등록.
  UI.el = el; UI.clear = clear; UI.titlebar = titlebar; UI.hexa = hexa; UI.richText = richText; UI.app = app;
  UI.RT = RT; UI.CARDS = CARDS; UI.DECKS = DECKS; UI.CLS = CLS; UI.HUMAN = HUMAN; UI.AI = AI;
  UI.render = render;
  UI.startMatch = startMatch; UI.startChallenge = startChallenge; UI.startTutorialPractice = startTutorialPractice;
  UI.bestStreak = bestStreak; UI.bestMap = bestMap;
  UI.getMyDeck = function () { return myDeck; }; UI.setMyDeck = function (k) { myDeck = k; };
  UI.getOppDeck = function () { return oppDeck; }; UI.setOppDeck = function (k) { oppDeck = k; };
  UI.exitToGuide = function () { G = null; tutorial = null; };
  // theme.js 훅: 테마 전환 후 재렌더 / 캐시된 툴팁 노드 폐기(테마 색이 생성 시점에 굳으므로 재생성 유도)
  UI.rerenderForTheme = function () { if (G) render(); else if (UI.renderTitle) UI.renderTitle(); };
  UI.afterThemeApply = function () {
    try { if (cardTip && cardTip.remove) cardTip.remove(); } catch (e) {}
    try { if (kwtip && kwtip.remove) kwtip.remove(); } catch (e) {}
    cardTip = null; kwtip = null;
  };

  // boot
  UI.initTheme();
  (function () {
    var btn = el('button', { class: 'btn ghost', title: '라이트/다크 테마 전환', style: { position: 'fixed', top: '8px', right: '108px', zIndex: 200, padding: '4px 9px', fontSize: '12px' } }, [UI.getTheme() === 'dark' ? '🌙 다크' : '☀ 라이트']);
    btn.addEventListener('click', function () { UI.toggleTheme(); btn.textContent = UI.getTheme() === 'dark' ? '🌙 다크' : '☀ 라이트'; });
    if (document.body) document.body.appendChild(btn);
  })();
  // RT_NO_BOOT: dev.html 등에서 게임 메뉴를 띄우지 않고 렌더 헬퍼만 재사용할 때(카드 페이스 미리보기).
  // renderTitle 은 title.js(core 뒤에 로드)에 있으므로, 현재 스크립트 체인이 끝난 뒤 부트한다.
  G = null;
  if (!window.RT_NO_BOOT) {
    var _boot = function () { if (UI.renderTitle) UI.renderTitle(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
    else setTimeout(_boot, 0);
  }
})();
