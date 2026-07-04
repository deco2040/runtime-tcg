/* RUNTIME TCG — theme module. 팔레트(THEMES)·SKIN 토큰·라이트/다크 전환. */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var THEMES = {
    light: {
      // 카드(라이트 기판 위 PCB 부품)
      bg: '#b7b8c0', pcb: '#e9eaee', pcb2: '#d9dae0', edge: '#1d1d24',
      gold: '#c8951b', goldEmpty: '#c4c5cc', heat: '#e0592b',
      silk: '#34343c', silkDim: '#6b6b75', die: '#c4c5cc', dieHi: '#eceef2',
      txt: '#1d1d24', txtDim: '#6b6b75', statIcon: '#34343c', selfPad: '#9c9da6', buff: '#2f7d3f',
      padEmpty: '#c9cad0', dieGradEnd: '#b6b7bf', chipTop: '#f6f7fa', chipBot: '#cccdd4', scrim: 'rgba(233,234,238,.82)',
      // v2 창(window) 토큰 — 카드_디자인_사양서_v2 §6.5/§6.4/§6.1
      face: '#d6d3c6', faceHi: '#f0eee6', faceLo: '#6b6a62',
      viewportBg: '#aeb2bd', effBg: '#e6e4da', effTxt: '#3a3a34',
      atkField: '#e6e4da', hpTrack: '#c9c6ba', hpFill: '#6b6a62',
      // 셸 / 크롬
      shell: '#b7b8c0', chassis: '#e9eaee', chassisAlt: '#ffffff', chassisSunk: '#d4d5db',
      ink: '#1d1d24', muted: '#6b6b75', faint: '#9c9da6', line: '#9c9da6',
      bevelHi: '#ffffff', bevelLo: '#c4c5cc', bevelLo2: '#aeafb6',
      boardFace: '#bcb9ac', cellFace: '#cfccc1', trace: 'rgba(29,29,36,.09)',
      own: '#147a76', enemy: '#b23a72', ally: '#3c8a66', rangeGold: '#c8951b',
      panelText: '#34343c'
    },
    // 다크 = 앰버 CRT 인광(기본). 따뜻한 흑갈색 새시 + 호박색 강조. own/enemy/ally·계열색은
    // 게임 정보 전달을 위해 유지(색 CRT 모니터 느낌) — index.html :root[data-theme="dark"] 와 값 일치.
    dark: {
      bg: '#0c0a05', pcb: '#17110a', pcb2: '#1f180d', edge: '#3d3220',
      gold: '#ffb000', goldEmpty: '#2a2010', heat: '#ff8a3a',
      silk: '#d8c49a', silkDim: '#8a7a55', die: '#2f2617', dieHi: '#3e3320',
      txt: '#f2e2c2', txtDim: '#b7a074', statIcon: '#e8cf9a', selfPad: '#8a7a55', buff: '#8fd6a0',
      padEmpty: '#0d0a04', dieGradEnd: '#241c10', chipTop: '#241c10', chipBot: '#140f07', scrim: 'rgba(8,6,2,.74)',
      // v2 창(window) 토큰 — 앰버 CRT
      face: '#2a2013', faceHi: '#453619', faceLo: '#120d05',
      viewportBg: '#2a2417', effBg: '#221a0d', effTxt: '#e6d3ac',
      atkField: '#221a0d', hpTrack: '#1c1509', hpFill: '#c8a24a',
      shell: '#0a0805', chassis: '#17110a', chassisAlt: '#1f180d', chassisSunk: '#0d0a04',
      ink: '#3d3220', muted: '#b7a074', faint: '#6b5c3c', line: '#2a2214',
      bevelHi: 'rgba(255,210,120,.06)', bevelLo: 'rgba(0,0,0,.5)', bevelLo2: 'rgba(0,0,0,.6)',
      boardFace: '#0a0805', cellFace: '#17110a', trace: 'rgba(255,176,0,.10)',
      own: '#2ec9c4', enemy: '#e0699a', ally: '#7BB528', rangeGold: '#ffb000',
      panelText: '#d8c49a'
    }
  };
  var SKIN = {};
  var themeMode = 'light';
  // 셸 정적 CSS(.btn/.bevel/.titlebar/body)는 game.html 의 :root[data-theme] 가 담당.
  // 인라인 JS 스타일은 SKIN 토큰을 사용 — 두 팔레트 값은 game.html CSS 와 일치시킬 것.
  function applyTheme(mode) {
    themeMode = (mode === 'dark') ? 'dark' : 'light';
    Object.keys(SKIN).forEach(function (k) { delete SKIN[k]; });
    Object.assign(SKIN, THEMES[themeMode]);
    try { document.documentElement.setAttribute('data-theme', themeMode); } catch (e) {}
    try { window.localStorage.setItem('rt_theme', themeMode); } catch (e) {}
    // 캐시된 툴팁 노드는 테마 색을 생성 시점에 굳히므로 재생성 유도(core 소유 노드 → 훅으로 폐기)
    if (UI.afterThemeApply) UI.afterThemeApply();
  }
  function initTheme() {
    var m = 'light';
    try { m = window.localStorage.getItem('rt_theme') || 'light'; } catch (e) {}
    applyTheme(m);
  }
  function toggleTheme() { applyTheme(themeMode === 'dark' ? 'light' : 'dark'); if (UI.rerenderForTheme) UI.rerenderForTheme(); }
  UI.SKIN = SKIN;
  UI.applyTheme = applyTheme;
  UI.initTheme = initTheme;
  UI.toggleTheme = toggleTheme;
  UI.getTheme = function () { return themeMode; };
})();
