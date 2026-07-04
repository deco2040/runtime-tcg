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
    dark: {
      bg: '#0e0e14', pcb: '#15161e', pcb2: '#1b1d27', edge: '#33343f',
      gold: '#C7A24A', goldEmpty: '#26261b', heat: '#E88A3A',
      silk: '#aeb8a6', silkDim: '#6f776a', die: '#3a3b46', dieHi: '#4a4b57',
      txt: '#e6e6ee', txtDim: '#6a6a7e', statIcon: '#c2c3cf', selfPad: '#8a8a9c', buff: '#8fd6a0',
      padEmpty: '#101018', dieGradEnd: '#2c2d38', chipTop: '#2a2b36', chipBot: '#191a22', scrim: 'rgba(10,10,16,.72)',
      // v2 창(window) 토큰 — 다크 PCB
      face: '#33333b', faceHi: '#55555f', faceLo: '#16161b',
      viewportBg: '#3c414d', effBg: '#2a2a30', effTxt: '#d8d6cc',
      atkField: '#2a2a30', hpTrack: '#22222a', hpFill: '#b8bcc8',
      shell: '#0b0b11', chassis: '#15161e', chassisAlt: '#1b1d27', chassisSunk: '#101018',
      ink: '#33343f', muted: '#8b90a0', faint: '#5a5c68', line: '#2a2b36',
      bevelHi: 'rgba(255,255,255,.05)', bevelLo: 'rgba(0,0,0,.45)', bevelLo2: 'rgba(0,0,0,.55)',
      boardFace: '#0b0b11', cellFace: '#131420', trace: 'rgba(199,162,74,.10)',
      own: '#2ec9c4', enemy: '#e0699a', ally: '#7BB528', rangeGold: '#C7A24A',
      panelText: '#c9cad6'
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
