/* RUNTIME TCG — sound module. WebAudio 합성 효과음(외부 파일 불필요). 독립 모듈: 게임 상태를 참조하지 않음. */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  /* ===== SOUND — WebAudio 합성 효과음 (외부 파일 불필요) ===== */
  var Sound = (function () {
    var ctx = null, master = null, enabled = true;
    function init() { if (ctx) return; var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; try { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.34; master.connect(ctx.destination); } catch (e) { ctx = null; } }
    function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
    function now() { return ctx ? ctx.currentTime : 0; }
    function tone(o) { if (!ctx) return; var t = (o.when || now()) + (o.delay || 0); var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.a || 0.005) + (o.d || 0.1));
      var pk = o.peak != null ? o.peak : 0.3;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + (o.a || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + (o.a || 0.005) + (o.d || 0.12));
      if (o.detune) osc.detune.value = o.detune;
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + (o.a || 0.005) + (o.d || 0.12) + 0.03);
    }
    function noise(o) { if (!ctx) return; var t = (o.when || now()) + (o.delay || 0); var dur = o.d || 0.12; var n = Math.floor(ctx.sampleRate * dur); var buf = ctx.createBuffer(1, n, ctx.sampleRate); var dt = buf.getChannelData(0);
      for (var i = 0; i < n; i++) dt[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.curve || 2);
      var s = ctx.createBufferSource(); s.buffer = buf; var f = ctx.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.value = o.freq || 1200; f.Q.value = o.q || 1;
      var g = ctx.createGain(); g.gain.value = o.peak != null ? o.peak : 0.2; s.connect(f); f.connect(g); g.connect(master); s.start(t);
    }
    function chord(freqs, type, a, d, peak, gap) { freqs.forEach(function (f, i) { tone({ f: f, type: type || 'triangle', a: a || 0.01, d: d || 0.3, peak: peak || 0.18, delay: i * (gap || 0.07) }); }); }
    function guard(fn) { return function () { if (!enabled) return; resume(); if (!ctx) return; try { fn.apply(null, arguments); } catch (e) {} }; }
    return {
      resume: resume, init: init,
      isOn: function () { return enabled; },
      toggle: function () { enabled = !enabled; if (enabled) resume(); return enabled; },
      hit: guard(function () { tone({ f: 210, f2: 70, type: 'sawtooth', a: 0.004, d: 0.14, peak: 0.32 }); noise({ d: 0.1, freq: 900, peak: 0.22, filter: 'lowpass', q: 0.7 }); }),
      bodyhit: guard(function () { tone({ f: 130, f2: 42, type: 'sawtooth', a: 0.004, d: 0.26, peak: 0.4 }); tone({ f: 62, f2: 38, type: 'sine', a: 0.005, d: 0.3, peak: 0.34 }); noise({ d: 0.18, freq: 600, peak: 0.3, filter: 'lowpass', q: 0.6 }); }),
      cast: guard(function () { tone({ f: 480, f2: 1180, type: 'sawtooth', a: 0.01, d: 0.2, peak: 0.16, detune: 6 }); tone({ f: 484, f2: 1190, type: 'sawtooth', a: 0.01, d: 0.2, peak: 0.16, detune: -6 }); tone({ f: 1600, f2: 2600, type: 'triangle', a: 0.005, d: 0.16, peak: 0.1, delay: 0.04 }); }),
      attack: guard(function () { tone({ f: 760, f2: 180, type: 'square', a: 0.004, d: 0.12, peak: 0.2 }); noise({ d: 0.08, freq: 1700, peak: 0.14 }); }),
      whoosh: guard(function () { noise({ d: 0.16, freq: 1500, peak: 0.16, filter: 'highpass', q: 0.4, curve: 1.2 }); tone({ f: 280, f2: 620, type: 'sine', a: 0.01, d: 0.12, peak: 0.05 }); }),
      crit: guard(function () { tone({ f: 160, f2: 50, type: 'sawtooth', a: 0.004, d: 0.3, peak: 0.42 }); tone({ f: 70, f2: 40, type: 'sine', a: 0.005, d: 0.34, peak: 0.36 }); noise({ d: 0.22, freq: 700, peak: 0.34, filter: 'lowpass', q: 0.6 }); tone({ f: 2200, type: 'triangle', a: 0.003, d: 0.08, peak: 0.12 }); }),
      heal: guard(function () { chord([523.25, 659.25, 783.99], 'triangle', 0.01, 0.32, 0.16, 0.06); tone({ f: 1046, type: 'sine', a: 0.01, d: 0.4, peak: 0.08, delay: 0.16 }); }),
      spawn: guard(function () { tone({ f: 300, f2: 720, type: 'square', a: 0.005, d: 0.13, peak: 0.2 }); tone({ f: 900, type: 'triangle', a: 0.005, d: 0.1, peak: 0.1, delay: 0.06 }); }),
      death: guard(function () { tone({ f: 320, f2: 48, type: 'sawtooth', a: 0.005, d: 0.34, peak: 0.3 }); noise({ d: 0.26, freq: 500, peak: 0.26, filter: 'lowpass', curve: 1.4 }); }),
      move: guard(function () { tone({ f: 420, f2: 520, type: 'triangle', a: 0.004, d: 0.07, peak: 0.1 }); }),
      draw: guard(function () { tone({ f: 660, f2: 880, type: 'triangle', a: 0.003, d: 0.06, peak: 0.07 }); }),
      win: guard(function () { chord([523.25, 659.25, 783.99, 1046.5], 'triangle', 0.01, 0.5, 0.2, 0.1); tone({ f: 1567, type: 'sine', a: 0.01, d: 0.6, peak: 0.12, delay: 0.4 }); }),
      lose: guard(function () { chord([392, 329.63, 261.63, 196], 'sawtooth', 0.01, 0.5, 0.16, 0.13); }),
      // UI 확인음 — 매치메이킹 버튼 등 짧은 상승 비프
      ui: guard(function () { tone({ f: 520, f2: 720, type: 'square', a: 0.003, d: 0.07, peak: 0.15 }); tone({ f: 1040, type: 'triangle', a: 0.003, d: 0.05, peak: 0.06, delay: 0.05 }); }),
      // 매칭 성사 — 상대 발견 상승 아르페지오 + 밝은 핑
      match: guard(function () { chord([440, 587.33, 880], 'triangle', 0.01, 0.28, 0.18, 0.08); tone({ f: 1174.66, type: 'sine', a: 0.008, d: 0.36, peak: 0.1, delay: 0.24 }); tone({ f: 300, f2: 760, type: 'square', a: 0.005, d: 0.12, peak: 0.12 }); }),
      // 턴 타이머 카운트다운 — 짧고 또렷한 고음 비프(막판 초읽기)
      tick: guard(function () { tone({ f: 1320, type: 'square', a: 0.002, d: 0.05, peak: 0.12 }); }),
      // 날씨 발동/공개 — 저음 스윕 + 필터 노이즈(환경이 바뀌는 느낌)
      weather: guard(function () { tone({ f: 220, f2: 84, type: 'sawtooth', a: 0.02, d: 0.5, peak: 0.18 }); tone({ f: 90, type: 'sine', a: 0.02, d: 0.55, peak: 0.14 }); noise({ d: 0.5, freq: 480, peak: 0.14, filter: 'lowpass', curve: 1.2 }); })
    };
  })();
  UI.Sound = Sound;
})();
