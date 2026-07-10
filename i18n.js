/* RUNTIME TCG — 다국어(i18n) 시스템. KO(기본) ↔ EN 토글.
 *
 * 설계:
 *  - 언어 상태: localStorage 'rt_lang' ('ko'|'en'). 최초 방문 시 IP(국가)→ KR=ko, 그 외 en.
 *    IP 실패 시 navigator.language 폴백. 사용자가 토글로 오버라이드하면 그 값이 고정된다.
 *  - 크롬(버튼/메뉴/라벨 등 정적 문자열): MutationObserver 기반 DOM 텍스트 번역기.
 *    호출부를 고치지 않고, 텍스트 노드 '전체'가 사전(DICT)의 KO 키와 정확히 일치할 때만 EN 으로 교체.
 *    (숫자 포함 동적 문자열은 매칭 안 돼 한국어로 우아하게 폴백.)
 *  - 카드 효과문/GLOSS/튜토리얼/덱 이름/날씨: 소스레벨에서 lang 을 보고 EN 테이블을 고른다(core/tutorial 연동).
 *  - 미번역 문자열은 항상 한국어로 폴백(깨지지 않음).
 *
 * 로드 위치: core.js 앞(테이블 준비) — index.html 참조. window.RT_I18N 로 노출.
 */
(function () {
  'use strict';
  var LS_KEY = 'rt_lang';
  function stored() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function save(l) { try { localStorage.setItem(LS_KEY, l); } catch (e) {} }

  var I = window.RT_I18N = window.RT_I18N || {};
  I.lang = (function () { var s = stored(); return (s === 'en' || s === 'ko') ? s : (document.documentElement.getAttribute('data-lang') || 'ko'); })();

  // ---- 번역 테이블(EN). 미기재 키는 KO 폴백. 데이터는 i18n-en.js 가 window.RT_I18N.dict/card 에 채운다. ----
  I.dict = {};      // KO→EN 문자열 사전(크롬·GLOSS·날씨·튜토리얼·덱명·라벨 전부). DOM 번역기 + 소스레벨 공용.
  I.card = {};      // 카드 효과문 EN: { cardId: text } (richText 가 조각내므로 id 로 소스레벨 조회)

  // ---- API ----
  I.is = function (l) { return I.lang === l; };
  // 소스레벨/크롬 문자열 번역(정확 일치). EN 이 아니거나 매핑 없으면 원문. tutRich·라벨 등에서 직접 호출.
  I.t = function (s) { if (I.lang !== 'en' || s == null) return s; var v = I.dict[s]; return (v == null) ? s : v; };
  // 소스레벨 언어 분기 — DOM 번역기가 못 잡는 동적 문자열·INPUT placeholder 용. EN 이면 en, 아니면 ko.
  I.pick = function (ko, en) { return I.lang === 'en' ? en : ko; };
  // 카드 효과문(현재 언어).
  I.cardText = function (card) { if (!card) return ''; if (I.lang === 'en' && I.card[card.id] != null) return I.card[card.id]; return card.text || ''; };

  var _observer = null, _pending = false;
  // 텍스트 노드 전체가 DICT 키와 정확히 일치하면 교체. data-noi18n 하위/입력요소는 제외.
  function translateTree(root) {
    if (I.lang !== 'en' || !root || !root.querySelectorAll) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var t = n.nodeValue; if (!t) return NodeFilter.FILTER_REJECT;
        var trimmed = t.trim(); if (!trimmed) return NodeFilter.FILTER_REJECT;
        if (I.dict[trimmed] == null) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
        if (p.nodeName === 'INPUT' || p.nodeName === 'TEXTAREA' || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('[data-noi18n]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var batch = [], n;
    while ((n = walker.nextNode())) batch.push(n);
    for (var i = 0; i < batch.length; i++) {
      var node = batch[i], raw = node.nodeValue, key = raw.trim(), en = I.dict[key];
      if (en != null) node.nodeValue = raw.replace(key, en);   // 앞뒤 공백 보존
    }
  }
  I.translateTree = translateTree;

  function scheduleTranslate() {
    if (_pending || I.lang !== 'en') return;
    _pending = true;
    (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _pending = false;
      if (_observer) _observer.disconnect();
      try { translateTree(document.body); } catch (e) {}
      if (_observer && I.lang === 'en') _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }
  I.refresh = scheduleTranslate;

  // ---- 미번역 감시(대책): EN 모드에서 화면에 남은 한글을 전수 수집한다. ----
  // 콘솔에서 `RT_I18N.audit()` 실행 → 아직 한글인 텍스트노드/placeholder/title 를 중복 제거해 표로 출력하고 배열 반환.
  // DOM 번역기가 못 잡는 동적 조합/속성/사전 누락을 즉시 찾아 사전 추가나 소스 pick() 처리로 이어가기 위한 개발 도구.
  var HANGUL = /[가-힣]/;
  I.audit = function (root) {
    root = root || document.body;
    var hits = {}, order = [];
    function add(text, kind, el) {
      var t = (text == null ? '' : String(text)).trim();
      if (!t || !HANGUL.test(t)) return;
      if (!hits[t]) { hits[t] = { text: t, kind: kind, count: 0, sample: el }; order.push(t); }
      hits[t].count++;
    }
    // 1) 텍스트 노드
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
        if (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('[data-noi18n]')) return NodeFilter.FILTER_REJECT;
        return HANGUL.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var n; while ((n = walker.nextNode())) add(n.nodeValue, 'text', n.parentNode);
    // 2) placeholder / title / aria-label 속성
    var els = root.querySelectorAll('[placeholder],[title],[aria-label]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.closest('[data-noi18n]')) continue;
      add(e.getAttribute('placeholder'), 'placeholder', e);
      add(e.getAttribute('title'), 'title', e);
      add(e.getAttribute('aria-label'), 'aria-label', e);
    }
    var list = order.map(function (k) { return hits[k]; });
    try {
      if (I.lang !== 'en') console.warn('[i18n.audit] 현재 언어가 EN 이 아닙니다 — EN 으로 전환 후 실행하세요.');
      console.log('[i18n.audit] 미번역 한글 ' + list.length + '종 (총 ' + list.reduce(function (s, x) { return s + x.count; }, 0) + '개 노드)');
      if (console.table) console.table(list.map(function (x) { return { kind: x.kind, count: x.count, text: x.text.slice(0, 80) }; }));
    } catch (e2) {}
    return list;
  };

  function startObserver() {
    if (_observer || typeof MutationObserver === 'undefined') return;
    _observer = new MutationObserver(function () { scheduleTranslate(); });
    if (I.lang === 'en' && document.body) _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // 언어 전환 — 저장 + data-lang + 재렌더 + 크롬 번역 리프레시.
  I.setLang = function (l, opts) {
    if (l !== 'en' && l !== 'ko') return;
    var changed = I.lang !== l;
    I.lang = l;
    if (!(opts && opts.noSave)) save(l);
    try { document.documentElement.setAttribute('data-lang', l); document.documentElement.setAttribute('lang', l); } catch (e) {}
    // 카드 페이스 캐시(테마별) 무효화 — 언어 바뀌면 효과문 재생성 필요.
    try { if (window.__RT_UI && window.__RT_UI.clearFaceCache) window.__RT_UI.clearFaceCache(); } catch (e) {}
    var UI = window.RTUI;
    if (l === 'en') { startObserver(); scheduleTranslate(); }
    else if (_observer) { _observer.disconnect(); }
    if (changed && UI && UI.render) { try { UI.render(); } catch (e) {} }
    if (l === 'en') scheduleTranslate();
  };
  I.toggle = function () { I.setLang(I.lang === 'en' ? 'ko' : 'en'); };

  // ---- 최초 언어 자동 선택(IP 기반). 저장된 값이 있으면 건너뜀. ----
  I.autoDetect = function () {
    if (stored()) { if (I.lang === 'en') { startObserver(); scheduleTranslate(); } return; }   // 사용자 지정 우선
    function pick(l) { I.setLang(l, { noSave: true }); }   // 자동값은 저장 안 함(토글해야 고정)
    // navigator 즉시 폴백값(네트워크 전에라도 반영)
    var navLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    var guess = navLang.indexOf('ko') === 0 ? 'ko' : 'en';
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; pick(guess); } }, 1500);
    try {
      fetch('https://ipapi.co/country/', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (cc) {
        if (done) return; done = true; clearTimeout(to);
        cc = (cc || '').trim().toUpperCase();
        pick(cc === 'KR' ? 'ko' : (cc ? 'en' : guess));
      }).catch(function () { if (!done) { done = true; clearTimeout(to); pick(guess); } });
    } catch (e) { if (!done) { done = true; clearTimeout(to); pick(guess); } }
  };

  if (I.lang === 'en') { if (document.body) startObserver(); else document.addEventListener('DOMContentLoaded', startObserver); }
  // 자동 감지는 DOM 준비 후(렌더 존재) 실행 — core 부팅과 무관하게 안전.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(I.autoDetect, 0); });
  else setTimeout(I.autoDetect, 0);
})();
