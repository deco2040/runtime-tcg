/* RUNTIME TCG — 카드 풀 (seed cards v14.1 정합). engine.js가 kit(엔진 헬퍼)를 주입해 정의한다.
   engine.js보다 먼저 로드할 것. 텍스트/스탯/효과는 runtime-tcg-cards-v14-1.json 기준. */
(function () {
  window.RT_DEFINE_CARDS = function (kit) {
    var def = kit.def, CARDS = kit.CARDS, COLS = kit.COLS, ROWS = kit.ROWS, K = kit.K, P = kit.P,
        bestEnemyObj = kit.bestEnemyObj, bodyKey = kit.bodyKey, buffAdjThread = kit.buffAdjThread,
        cardCls = kit.cardCls, cheb = kit.cheb, diagonal = kit.diagonal, dmgAdjEnemies = kit.dmgAdjEnemies,
        fwd = kit.fwd, inB = kit.inB, line = kit.line, manh = kit.manh, ortho = kit.ortho,
        square = kit.square, unitKey = kit.unitKey, knight = kit.knight, ring = kit.ring,
        around8 = kit.around8, homeRow = kit.homeRow;

    // ---------------- shared effect helpers ----------------
    function strongestEnemy(G, owner) { var e = G.enemyObjects(owner); e.sort(function (a, b) { return G.effAtk(b) - G.effAtk(a); }); return e[0] || null; }
    // 적 = 적 인스턴스 + 적 본체(피해 대상): 데미지 셀렉터는 본체도 후보에 포함. 본체는 공격력 0이라 strongest 정렬에선 인스턴스 없을 때만 뽑힘.
    function strongestEnemyOrBody(G, owner) { var e = G.enemyObjects(owner).slice(); var eb = G.enemyBody(owner); if (eb) e.push(eb); e.sort(function (a, b) { return G.effAtk(b) - G.effAtk(a); }); return e[0] || null; }
    // 가장 약한(최저 HP) 적 — 본체 포함(본체는 HP 높아 인스턴스 없거나 본체가 더 낮을 때만 뽑힘). Switch [공격] 전용.
    function weakestEnemy(G, owner) { var e = G.enemyObjects(owner).slice(); var eb = G.enemyBody(owner); if (eb) e.push(eb); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }
    function nearestEnemyWithin(G, u, n) { var k = unitKey(G, u); if (!k) return null; var e = G.enemyObjects(u.owner).filter(function (x) { var xk = unitKey(G, x); return xk && cheb(xk, k) <= n; }); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }
    // 적 = 적 인스턴스 + 적 본체(피해 대상). 사거리 내 인스턴스가 있으면 기존과 동일(약한 대상 우선), 인스턴스가 사거리 밖일 때만 사거리 내 본체를 노림 — 결정타가 본체까지 닿게.
    function nearestEnemyOrBodyWithin(G, u, n) { var inst = nearestEnemyWithin(G, u, n); var k = unitKey(G, u); if (k) { var eb = G.enemyBody(u.owner), bk = bodyKey(1 - u.owner); if (eb && cheb(bk, k) <= n) { if (!inst) return eb; return G.curHp(eb) < G.curHp(inst) ? eb : inst; } } return inst; }
    function farthestEnemy(G, u, n) { var k = unitKey(G, u); if (!k) return null; var e = G.enemyObjects(u.owner).filter(function (x) { var xk = unitKey(G, x); return xk && (n == null || cheb(xk, k) <= n); }); var eb = G.enemyBody(u.owner), bk = bodyKey(1 - u.owner); if (eb && (n == null || cheb(bk, k) <= n)) e.push(eb); e.sort(function (a, b) { return manh(unitKey(G, b), k) - manh(unitKey(G, a), k); }); return e[0] || null; }
    function woundedAlly(G, owner) { var a = G.allyObjects(owner).filter(function (x) { return x.dmg > 0; }); a.sort(function (x, y) { return y.dmg - x.dmg; }); return a[0] || null; }
    // 옆칸 적(인스턴스+본체) 중 최저 HP — 데미지 전용 셀렉터. 옆칸에 본체가 붙어 있으면 본체도 대상.
    function pickAdjEnemy(G, u, ch) { if (ch && ch.target && G.board[ch.target]) return G.board[ch.target]; var e = G.adj(u).filter(function (x) { return x.owner !== u.owner; }); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }
    function inLineToBody(G, u, n) { var k = unitKey(G, u), q = P(k); var bk = bodyKey(1 - u.owner), b = P(bk); if (q[0] !== b[0]) return false; var dist = Math.abs(b[1] - q[1]); if (n && dist > n) return false; return (b[1] - q[1]) * fwd(u.owner) > 0; }
    function midEmpty(G) { for (var r = 2; r <= 3; r++) for (var c = 1; c <= COLS; c++) if (!G.board[K(c, r)]) return K(c, r); return null; }
    function allyThreads(G, p) { return G.allyObjects(p).filter(function (x) { return cardCls(x) === 'thread'; }); }
    function allyOfCls(G, p, cls) { return G.allyObjects(p).filter(function (x) { return cardCls(x) === cls; }); }
    function forwardDest(G, u) { var k = unitKey(G, u); if (!k) return null; var q = P(k), nr = q[1] + fwd(u.owner); return (inB(q[0], nr) && !G.board[K(q[0], nr)]) ? K(q[0], nr) : null; }
    function emptyAround(G, key) { var q = P(key); return around8(q[0], q[1]).filter(function (x) { return !G.board[x]; }); }
    // shoveToEmpty로 실제로 밀어낼 수 있는(직교 빈 칸 보유) 적 인스턴스만 — 최저 HP 우선 정렬
    function shoveableEnemies(G, owner) { var e = G.enemyObjects(owner).filter(function (x) { var k = unitKey(G, x); if (!k) return false; var q = P(k); return ortho(q[0], q[1]).some(function (c) { return !G.board[c]; }); }); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e; }
    function emptyCells(G) { var o = [], r, c, k; for (r = 1; r <= ROWS; r++) for (c = 1; c <= COLS; c++) { k = K(c, r); if (!G.board[k]) o.push(k); } return o; }
    function shuffleIn(G, arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(G.rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
    // 나이트 빈 칸(적 본체에 가장 가까운 순)
    function knightEmpty(G, u) { var k = unitKey(G, u); if (!k) return null; var q = P(k), bk = bodyKey(1 - u.owner); var cs = knight(q[0], q[1]).filter(function (x) { return !G.board[x]; }); if (!cs.length) return null; cs.sort(function (a, b) { return manh(a, bk) - manh(b, bk); }); return cs[0]; }
    // 3칸이내 빈 칸(적 본체 방향 가장 가까운) — Jump·goto (경로 무시 이동)
    function jumpEmpty(G, u) { var k = unitKey(G, u); if (!k) return null; var q = P(k), bk = bodyKey(1 - u.owner); var cs = square(q[0], q[1], 3).filter(function (x) { return !G.board[x]; }); if (!cs.length) return null; cs.sort(function (a, b) { return manh(a, bk) - manh(b, bk); }); return cs[0]; }

    // ============================================================ THREAD — objects
    def({ id: 'Fiber', cls: 'thread', kind: 'object', atk: 6, hp: 3, text: 'For(2) 「옆칸」 적 하나에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = pickAdjEnemy(G, u, ch); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Daemon', cls: 'thread', kind: 'object', atk: 5, hp: 4, text: 'Once 선언 시 「옆칸」 아군 thread 전부 공격력 +2',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { buffAdjThread(G, u, 2); } }] });
    def({ id: 'Worker', cls: 'thread', kind: 'object', atk: 4, hp: 3, text: 'For(3) 「1칸이내」 적 전부에게 3 피해',
      abilities: [{ kw: 'For', forCount: 3, trigger: 'onTurnStart', fn: function (G, u) { G.around(u).filter(function (x) { return x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 3, { attacker: u }); }); } }] });
    def({ id: 'Zygote', cls: 'thread', kind: 'object', atk: 4, hp: 2, text: 'Once 파괴 시 「홈칸」에 분신(공2 체2) 생성',
      abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u) { G.summon(u.owner, 'Token2', G.firstEmptyHome(u.owner), { cls: 'thread' }); } }] });
    def({ id: 'Interrupt', cls: 'thread', kind: 'object', atk: 6, hp: 3, text: 'When 「옆칸」에 적 인스턴스 진입 시 공격력만큼 피해 · 「옆칸」 다른 아군 thread 1장당 +2',
      abilities: [{ kw: 'When', trigger: 'onEnterRange', fn: function (G, u, ctx) { var m = ctx.mover; if (!m || m.owner === u.owner) return; var n = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).length; G.deal(m, G.effAtk(u) + n * 2, { attacker: u }); } }] });
    def({ id: 'Overflow', cls: 'thread', kind: 'object', atk: 4, hp: 2, require: { type: 'classOnBoard', cls: 'thread', n: 2 }, text: 'require 내 thread 2개+ 필드에 존재 · While 「옆칸」 아군 thread 1장당 공격력 +2', abilities: [] });
    def({ id: 'Race', cls: 'thread', kind: 'object', atk: 5, hp: 3, text: 'While 「옆칸」에 다른 아군 thread 있으면 공격력 +3', abilities: [] });
    def({ id: 'Kernel', cls: 'thread', kind: 'object', atk: 4, hp: 6, require: { type: 'classOnBoard', cls: 'thread', n: 2 }, text: 'require 내 thread 2개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +1',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { allyThreads(G, u.owner).forEach(function (x) { G.buffAtk(x, 1); }); } }] });
    def({ id: 'Salvo', cls: 'thread', kind: 'object', atk: 6, hp: 2, text: 'For(1) 「2칸이내」 적 하나에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyOrBodyWithin(G, u, 2); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Recursion', cls: 'thread', kind: 'object', atk: 3, hp: 3, text: 'When 피격 시 살아남으면 공격력 +2',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u) { if (G.curHp(u) > 0) G.buffAtk(u, 2); } }] });
    def({ id: 'Signal', cls: 'thread', kind: 'object', atk: 4, hp: 3, text: 'Once 선언 시 「옆칸」 아군 thread 1장 공격력 +4',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var t = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })[0]; if (t) G.buffAtk(t, 4); } }] });
    def({ id: 'Inline', cls: 'thread', kind: 'object', atk: 5, hp: 2, text: 'When 선언 시 「옆칸」 아군 thread 1장과 자기, 각각 공격력 +2',
      abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })[0]; if (t) { G.buffAtk(t, 2); G.buffAtk(u, 2); } } }] });
    def({ id: 'Panic', cls: 'thread', kind: 'object', atk: 6, hp: 2, text: 'Once 파괴 시 「옆칸」 적 전부 5 피해',
      abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); ortho(p[0], p[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 5, { attacker: u }); }); } }] });
    def({ id: 'Exec', cls: 'thread', kind: 'object', atk: 6, hp: 4, text: 'For(2) 「1칸이내」 적 전부에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u) { G.around(u).filter(function (x) { return x.owner !== u.owner; }).forEach(function (x) { G.deal(x, G.effAtk(u), { attacker: u }); }); } }] });
    def({ id: 'Compile', cls: 'thread', kind: 'object', atk: 2, hp: 4, require: { type: 'classOnBoard', cls: 'thread', n: 3 }, text: 'require 내 thread 3개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +2',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { allyThreads(G, u.owner).forEach(function (x) { G.buffAtk(x, 2); }); } }] });
    def({ id: 'Spike', cls: 'thread', kind: 'object', atk: 7, hp: 3, text: 'For(2) 「앞직선2·첫」 적에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, false); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 2)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Surge', cls: 'thread', kind: 'object', atk: 5, hp: 4, text: 'When 선언 시 「옆칸」에 아군 thread 있으면 공격력 +3',
      abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { if (G.adj(u).some(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })) G.buffAtk(u, 3); } }] });
    def({ id: 'Atomic', cls: 'thread', kind: 'object', atk: 5, hp: 3, text: 'When 「옆칸」 아군 thread 파괴 시 공격력 +2',
      abilities: [{ kw: 'When', trigger: 'onUnitDeath', fn: function (G, u, ctx) { var d = ctx.dead, k = unitKey(G, u); if (d && d.owner === u.owner && cardCls(d) === 'thread' && k && manh(k, ctx.atKey) === 1) G.buffAtk(u, 2); } }] });
    def({ id: 'Join', cls: 'thread', kind: 'object', atk: 4, hp: 4, text: 'Once 선언 시 「옆칸」 아군 thread 1장당 최대체력 +1',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var n = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).length; if (n) G.buffHp(u, n); } }] });
    def({ id: 'Scheduler', cls: 'thread', kind: 'object', atk: 3, hp: 4, text: 'For(2) 내 thread 1장 「1칸이동」',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onActive', ready: function (G, u) { return allyThreads(G, u.owner).some(function (x) { return forwardDest(G, x); }); },
        fn: function (G, u, ch) { var t = (ch.target && G.board[ch.target]) ? G.board[ch.target] : allyThreads(G, u.owner).filter(function (x) { return forwardDest(G, x); })[0]; if (!t) return; var dest = (ch.dest && G.moveCells(t).indexOf(ch.dest) >= 0) ? ch.dest : forwardDest(G, t); if (dest) G.move(t, dest, true); } }] });
    def({ id: 'Pool', cls: 'thread', kind: 'object', atk: 2, hp: 5, text: 'For(2) 「홈칸」에 분신(공2 체1) 생성',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', ready: function (G, u) { return !!G.firstEmptyHome(u.owner); }, fn: function (G, u) { G.summon(u.owner, 'Token21', G.firstEmptyHome(u.owner), { cls: 'thread' }); } }] });
    def({ id: 'Preempt', cls: 'thread', kind: 'object', atk: 6, hp: 3, text: 'Once 선언 시 이번 턴 자기 기본 공격 1회 추가',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.grantBonusAttack(u, 1); } }] });
    def({ id: 'Cluster', cls: 'thread', kind: 'object', atk: 3, hp: 4, text: 'While 내 필드 분신 1장당 공격력 +2', abilities: [] });
    def({ id: 'Forkbomb', cls: 'thread', kind: 'object', atk: 2, hp: 3, text: 'Once 파괴 시 「전개칸」 2곳에 분신(공1 체1) 생성',
      abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u, ctx) { var cells = emptyAround(G, ctx.atKey).slice(0, 2); cells.forEach(function (c) { G.summon(u.owner, 'Token1', c, { cls: 'thread' }); }); } }] });
    def({ id: 'Livelock', cls: 'thread', kind: 'object', atk: 7, hp: 4, mustAttack: true, text: 'While 「옆칸」에 공격 가능한 적이 있으면 반드시 하나를 기본 공격', abilities: [] });
    def({ id: 'TLS', cls: 'thread', kind: 'object', atk: 2, hp: 4, text: 'When 선언 시 내 필드에 memory 있으면 최대체력 +3',
      abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { if (allyOfCls(G, u.owner, 'memory').length) G.buffHp(u, 3); } }] });
    def({ id: 'Affinity', cls: 'thread', kind: 'object', atk: 3, hp: 2, text: 'While 내 필드에 process 있으면 「통로칸」에도 선언 가능', abilities: [] });

    // ============================================================ THREAD — pointers (함수)
    def({ id: 'boost()', cls: 'thread', kind: 'pointer', deckRule: 'threadSingle', need: 'allyThread', text: '내 thread 1장 공격력 +4', cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.owner === p) G.buffAtk(u, 4); } });
    def({ id: 'overclock()', cls: 'thread', kind: 'pointer', deckRule: 'threadSingle', need: 'allyThread', text: '내 thread 1장 공격력 2배(현재치만큼 증가)', cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.owner === p && cardCls(u) === 'thread') G.buffAtk(u, G.effAtk(u)); } });
    def({ id: 'crash()', cls: 'thread', kind: 'pointer', need: 'allyThread', text: '내 thread 1장과 그 thread의 「옆칸」 적 인스턴스가 서로에게 각자 공격력만큼 동시 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner !== p) return false; return G.adj(u).some(function (x) { return x.owner !== p && x.type === 'object'; }); },
      cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var e = G.adj(u).filter(function (x) { return x.owner !== p && x.type === 'object'; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (!e) return; var ua = G.effAtk(u), ea = G.effAtk(e); G.deal(e, ua, { attacker: u }); G.deal(u, ea, { attacker: e }); } });
    def({ id: 'strike()', cls: 'thread', kind: 'pointer', deckRule: 'threadSingle', need: 'enemy', text: '받은 피해가 있는 적 하나에게 8 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner !== p && u.dmg > 0; },
      cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 8, { attacker: { owner: p } }); } });
    def({ id: 'spawn()', cls: 'thread', kind: 'pointer', need: 'none', text: '「홈칸」에 분신(공5 체2) 생성', cast: function (G, p) { G.summon(p, 'Token5', G.firstEmptyHome(p), { cls: 'thread' }); } });
    def({ id: 'burst()', cls: 'thread', kind: 'pointer', need: 'enemy', text: '적 하나에게 (대상의 「옆칸」에 있는 내 thread 수 ×3) 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var n = G.adj(u).filter(function (x) { return x.owner === p && cardCls(x) === 'thread'; }).length; G.deal(u, n * 3, { attacker: { owner: p } }); } });
    def({ id: 'fork()', cls: 'thread', kind: 'pointer', need: 'allyThread', castCondition: { type: 'turnCount', n: 4 }, text: '조건 내 턴 4회+ · 내 thread 1장을 그 「전개칸」에 절반 능력치(올림)로 복제(후보 없으면 불발)',
      castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner !== p) return false; return emptyAround(G, tk).length > 0; },
      cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var cell = emptyAround(G, tk)[0]; if (!cell) return; var nu = G.summon(p, u.cardId, cell, { cls: cardCls(u) }); if (nu) { nu.baseAtk = Math.ceil((u.baseAtk + u.atkMod) / 2); nu.baseHp = Math.ceil(G.effMaxHp(u) / 2); } } });
    def({ id: 'rush()', cls: 'thread', kind: 'pointer', deckRule: 'threadSingle', need: 'allyThread', text: '내 thread 1장 앞으로 「1칸이동」 + 공격력 +1',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && !!forwardDest(G, u); },
      cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var dest = forwardDest(G, u); if (dest) { G.move(u, dest, true); G.buffAtk(u, 1); } } });
    def({ id: 'amplify()', cls: 'thread', kind: 'pointer', need: 'none', castCondition: { type: 'destroyedAlly', n: 2 }, text: '조건 이번 게임 아군 2장 이상 파괴됨 · 내 thread 전부 공격력 +3', cast: function (G, p) { allyThreads(G, p).forEach(function (x) { G.buffAtk(x, 3); }); } });
    def({ id: 'retry()', cls: 'thread', kind: 'pointer', need: 'allyThread', text: '내 thread 1장 이번 턴 기본 공격 1회 추가(이미 공격했어도 가능)',
      cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.owner === p) G.grantBonusAttack(u, 1); } });
    def({ id: 'reap()', cls: 'thread', kind: 'pointer', need: 'allyThread', text: '내 thread 1장 파괴, 적 하나에게 파괴한 thread의 공격력만큼 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.enemyObjects(p).length > 0; },
      cast: function (G, p, tk, o) { var u = G.board[tk]; if (!u) return; var atk = G.effAtk(u); var e = (o && o.second && G.board[o.second]) ? G.board[o.second] : strongestEnemyOrBody(G, p); G.destroy(u, { attacker: { owner: p } }); if (e && G.board[unitKey(G, e)]) G.deal(e, atk, { attacker: { owner: p } }); } });
    def({ id: 'jolt()', cls: 'thread', kind: 'pointer', need: 'enemy', text: '적 하나 3 피해, 대상의 「옆칸」에 내 thread 있으면 6 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var boost = G.adj(u).some(function (x) { return x.owner === p && cardCls(x) === 'thread'; }); G.deal(u, boost ? 6 : 3, { attacker: { owner: p } }); } });
    def({ id: 'fanout()', cls: 'thread', kind: 'pointer', need: 'none', text: '「홈칸」 빈 칸 2곳에 분신(공1 체1) 생성(부족 시 가능한 만큼)', cast: function (G, p) { for (var i = 0; i < 2; i++) { var cell = G.firstEmptyHome(p); if (!cell) break; G.summon(p, 'Token1', cell, { cls: 'thread' }); } } });
    def({ id: 'migrate()', cls: 'thread', kind: 'pointer', need: 'none', castCondition: { type: 'classOnBoard', cls: 'thread', n: 3 }, text: '조건 thread 3개+ · 내 thread 전부 앞으로 「1칸이동」(막히면 유지)',
      cast: function (G, p) { var ts = allyThreads(G, p).slice(); ts.sort(function (a, b) { return (P(unitKey(G, a))[1] - P(unitKey(G, b))[1]) * fwd(p); }); ts.forEach(function (t) { var d = forwardDest(G, t); if (d) G.move(t, d, true); }); } });
    def({ id: 'coalesce()', cls: 'thread', kind: 'pointer', need: 'allyThread', castCondition: { type: 'boardCount', n: 1, token: true }, text: '조건 분신 1+ · 내 분신 전부 파괴, 내 thread 1장 공격력 (파괴한 수 ×2, 최대 +6) 증가',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.allyObjects(p).some(function (x) { return x.token; }); },
      cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var toks = G.allyObjects(p).filter(function (x) { return x.token; }); var n = toks.length; toks.forEach(function (x) { G.destroy(x, { attacker: { owner: p } }); }); if (G.board[unitKey(G, u)]) G.buffAtk(u, Math.min(6, n * 2)); } });

    // ============================================================ MEMORY — objects
    def({ id: 'Cache', cls: 'memory', kind: 'object', atk: 0, hp: 12, text: 'While 「옆칸」 적 인스턴스 이동 불가', abilities: [] });
    def({ id: 'Mutex', cls: 'memory', kind: 'object', atk: 2, hp: 9, text: 'When 피격 시 가해 인스턴스에 3 피해',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { var a = ctx.attacker; if (a && a.uid != null && G.board[unitKey(G, a)]) G.deal(a, 3, { attacker: u }); } }] });
    def({ id: 'Heap', cls: 'memory', kind: 'object', atk: 1, hp: 14, text: 'While 「옆칸」 아군 받는 피해 -1', abilities: [] });
    def({ id: 'Stack', cls: 'memory', kind: 'object', atk: 0, hp: 10, text: 'While 「옆칸」 적 인스턴스 공격력 -2', abilities: [] });
    def({ id: 'Semaphore', cls: 'memory', kind: 'object', atk: 0, hp: 8, text: 'For(2) 적 인스턴스 하나 1턴 봉쇄',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : bestEnemyObj(G, u.owner); if (t) G.bind(t, 1); } }] });
    def({ id: 'Buffer', cls: 'memory', kind: 'object', atk: 0, hp: 11, text: 'When 피격 시 체력이 5 이하로 남으면 4 회복(턴당 1회)',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u) { if (G.curHp(u) > 0 && G.curHp(u) <= 5 && u.flags.bufTurn !== G.turnNo) { u.flags.bufTurn = G.turnNo; G.healInst(u, 4); } } }] });
    def({ id: 'Sentinel', cls: 'memory', kind: 'object', atk: 2, hp: 9, text: 'When 「옆칸」에 적 인스턴스 진입 시 그 적 인스턴스 1턴 봉쇄 + 2 피해',
      abilities: [{ kw: 'When', trigger: 'onEnterRange', fn: function (G, u, ctx) { var m = ctx.mover; if (!m || m.owner === u.owner) return; G.bind(m, 1); if (G.board[unitKey(G, m)]) G.deal(m, 2, { attacker: u }); } }] });
    def({ id: 'Firewall', cls: 'memory', kind: 'object', atk: 0, hp: 13, text: 'While 이 카드가 내 본체 「옆칸」에 있으면 내 본체 받는 피해 -2', abilities: [] });
    def({ id: 'Const', cls: 'memory', kind: 'object', atk: 2, hp: 10, text: 'While 자기 이동 불가 · 「옆칸」 적 인스턴스 봉쇄', abilities: [] });
    def({ id: 'Page', cls: 'memory', kind: 'object', atk: 1, hp: 9, text: 'Once 파괴 시 「홈칸」에 벽(공0 체8) 생성',
      abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u) { G.summon(u.owner, 'Wall8', G.firstEmptyHome(u.owner), { cls: 'memory' }); } }] });
    def({ id: 'Register', cls: 'memory', kind: 'object', atk: 3, hp: 7, text: 'For(1) 적 인스턴스 하나 공격력 0 (1턴)',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : strongestEnemy(G, u.owner); if (t) G.setAtkZeroTurns(t, 1); } }] });
    def({ id: 'Watchdog', cls: 'memory', kind: 'object', atk: 3, hp: 11, text: 'For(1) 「앞직선끝·첫」 적에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, ROWS, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Sweeper', cls: 'memory', kind: 'object', atk: 2, hp: 12, text: 'For(1) 「2칸이내」 적 하나 3 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyOrBodyWithin(G, u, 2); if (t) G.deal(t, 3, { attacker: u }); } }] });
    def({ id: 'Pin', cls: 'memory', kind: 'object', atk: 1, hp: 8, require: { type: 'turnCount', n: 3 }, text: 'require 내 턴 3회+ 진행 · When 선언 시 적 인스턴스 하나 2턴 봉쇄',
      abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = bestEnemyObj(G, u.owner); if (t) G.bind(t, 2); } }] });
    def({ id: 'Persist', cls: 'memory', kind: 'object', atk: 0, hp: 12, text: 'While 다른 내 memory 전부 최대체력 +2', abilities: [] });
    def({ id: 'Ward', cls: 'memory', kind: 'object', atk: 0, hp: 13, text: 'When 피격 시 가해 인스턴스에 2 피해',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { var a = ctx.attacker; if (a && a.uid != null && G.board[unitKey(G, a)]) G.deal(a, 2, { attacker: u }); } }] });
    def({ id: 'Trap', cls: 'memory', kind: 'object', atk: 1, hp: 11, text: 'Once 「옆칸」에 적 인스턴스 첫 진입 시 그 적 인스턴스에게 7 피해(게임 중 1회)',
      abilities: [{ kw: 'Once', trigger: 'onEnterRange', fn: function (G, u, ctx) { if (u.flags.trapUsed || !ctx.mover) return; u.flags.trapUsed = true; G.deal(ctx.mover, 7, { attacker: u }); } }] });
    def({ id: 'Cannon', cls: 'memory', kind: 'object', atk: 2, hp: 11, require: { type: 'turnCount', n: 6 }, text: 'require 내 턴 6회+ 진행 · While 「옆칸」 아군 memory 1장당 공격력 +2 · For(1) 「앞직선끝·첫」 적에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, ROWS, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Overrun', cls: 'memory', kind: 'object', atk: 4, hp: 9, require: { type: 'classOnBoard', cls: 'memory', n: 3 }, text: 'require 내 memory 3개+ 필드에 존재 · Once 선언 시 적 본체에 (내 memory 수 ×2, 최대 6) 피해',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var n = allyOfCls(G, u.owner, 'memory').length; G.deal(G.enemyBody(u.owner), Math.min(6, n * 2), { attacker: u }); } }] });
    def({ id: 'Latch', cls: 'memory', kind: 'object', atk: 1, hp: 8, text: 'When 내 턴 종료 시 「옆칸」 적 둘 이상이면 전부 2 피해',
      abilities: [{ kw: 'When', trigger: 'onTurnEnd', fn: function (G, u) { var e = G.adj(u).filter(function (x) { return x.owner !== u.owner; }); if (e.length >= 2) e.forEach(function (x) { G.deal(x, 2, { attacker: u }); }); } }] });
    def({ id: 'Checksum', cls: 'memory', kind: 'object', atk: 2, hp: 8, text: 'When 피격 시 가해 인스턴스 공격력 -1',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { var a = ctx.attacker; if (a && a.uid != null && G.board[unitKey(G, a)]) G.buffAtk(a, -1); } }] });
    def({ id: 'Collector', cls: 'memory', kind: 'object', atk: 2, hp: 9, text: 'For(1) 봉쇄된 적 인스턴스 하나에게 5 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', ready: function (G, u) { return G.enemyObjects(u.owner).some(function (x) { return G.isBound(x); }); },
        fn: function (G, u, ch) { var t = (ch.target && G.board[ch.target] && G.isBound(G.board[ch.target])) ? G.board[ch.target] : G.enemyObjects(u.owner).filter(function (x) { return G.isBound(x); })[0]; if (t) G.deal(t, 5, { attacker: u }); } }] });
    def({ id: 'Canary', cls: 'memory', kind: 'object', atk: 0, hp: 7, text: 'When 피격 시 가해 인스턴스 1턴 봉쇄',
      abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { var a = ctx.attacker; if (a && a.uid != null && G.board[unitKey(G, a)]) G.bind(a, 1); } }] });
    def({ id: 'Journal', cls: 'memory', kind: 'object', atk: 1, hp: 7, text: 'When 내 thread 파괴 시 카드 1장 뽑기(턴당 1회)',
      abilities: [{ kw: 'When', trigger: 'onUnitDeath', fn: function (G, u, ctx) { var d = ctx.dead; if (d && d.owner === u.owner && cardCls(d) === 'thread' && u.flags.jrnTurn !== G.turnNo) { u.flags.jrnTurn = G.turnNo; G.draw(u.owner, 1); } } }] });
    def({ id: 'Sandbox', cls: 'memory', kind: 'object', atk: 0, hp: 10, text: 'While 내 본체 피격 시 대신 이 카드가 받는다', abilities: [] });

    // ============================================================ MEMORY — pointers
    def({ id: 'free()', cls: 'memory', kind: 'pointer', deckRule: 'memorySingle', need: 'enemy', text: '내 본체 「2칸이내」 적 하나 6 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 6, { attacker: { owner: p } }); } });
    def({ id: 'lock()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나 2턴 봉쇄', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.bind(u, 2); } });
    def({ id: 'restore()', cls: 'memory', kind: 'pointer', deckRule: 'memorySingle', need: 'allyOrBody', text: '아군 1장 또는 내 본체 6 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : (woundedAlly(G, p) || G.body(p)); if (u) G.healInst(u, 6); } });
    def({ id: 'barrier()', cls: 'memory', kind: 'pointer', need: 'none', text: '내 본체가 받는 다음 피해를 최대 10 막음(초과분은 적용)', cast: function (G, p) { G.players[p].bodyShield = Math.max(G.players[p].bodyShield, 10); } });
    def({ id: 'purge()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나 공격력 0 (2턴)', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.setAtkZeroTurns(u, 2); } });
    def({ id: 'reflect()', cls: 'memory', kind: 'pointer', need: 'none', text: '이번 턴 내 memory가 피격 시 가해 인스턴스에 그 피해의 절반(올림)만큼 피해', cast: function (G, p) { G.players[p].memReflectTurn = G.turnNo; } });
    def({ id: 'compact()', cls: 'memory', kind: 'pointer', need: 'allyMemory', text: '내 memory 1장 전부 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : allyOfCls(G, p, 'memory').sort(function (a, b) { return b.dmg - a.dmg; })[0]; if (u) G.repair(u); } });
    def({ id: 'wall()', cls: 'memory', kind: 'pointer', need: 'none', text: '「통로칸」에 벽(공0 체10) 생성', cast: function (G, p) { var cell = midEmpty(G); G.summon(p, 'Wall10', cell || G.firstEmptyHome(p), { cls: 'memory' }); } });
    def({ id: 'freeze()', cls: 'memory', kind: 'pointer', need: 'ally', text: '내 인스턴스 1장의 「2칸이내」 적 인스턴스 전부 1턴 봉쇄',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.unitsInShape(u, square, 2).some(function (x) { return x.owner !== p && x.type === 'object'; }); },
      cast: function (G, p, tk) { var u = tk ? G.board[tk] : G.allyObjects(p).filter(function (a) { return G.unitsInShape(a, square, 2).some(function (x) { return x.owner !== p && x.type === 'object'; }); })[0]; if (!u) return; G.unitsInShape(u, square, 2).forEach(function (x) { if (x.owner !== p && x.type === 'object') G.bind(x, 1); }); } });
    def({ id: 'fortify()', cls: 'memory', kind: 'pointer', need: 'none', castCondition: { type: 'classOnBoard', cls: 'memory', n: 2 }, text: '조건 memory 2+ · 내 memory 전부 최대체력 +4', cast: function (G, p) { allyOfCls(G, p, 'memory').forEach(function (x) { G.buffHp(x, 4); }); } });
    def({ id: 'siphon()', cls: 'memory', kind: 'pointer', deckRule: 'memorySingle', need: 'enemy', text: '적 하나 4 피해 + 내 본체 4 회복', cast: function (G, p, tk) { var u = G.board[tk]; if (u) { G.deal(u, 4, { attacker: { owner: p } }); G.healInst(G.body(p), 4); } } });
    def({ id: 'segfault()', cls: 'memory', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 7 }, text: '조건 내 턴 7회+ · 적 본체 6 피해', cast: function (G, p) { G.deal(G.enemyBody(p), 6, { attacker: { owner: p } }); } });
    def({ id: 'defrag()', cls: 'memory', kind: 'pointer', need: 'allyMemory', text: '내 memory 1장 「1칸이동」 + 최대체력 +2',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.moveCells(u).length > 0; },
      cast: function (G, p, tk, o) { var u = tk ? G.board[tk] : allyOfCls(G, p, 'memory').filter(function (x) { return G.moveCells(x).length; })[0]; if (!u) return; var dest = (o && o.dest && G.moveCells(u).indexOf(o.dest) >= 0) ? o.dest : (forwardDest(G, u) || G.moveCells(u)[0]); if (dest) G.move(u, dest, true); G.buffHp(u, 2); } });
    def({ id: 'bind()', cls: 'memory', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 4 }, text: '조건 내 턴 4회+ · 적 인스턴스 전부 1턴 봉쇄', cast: function (G, p) { G.enemyObjects(p).forEach(function (x) { G.bind(x, 1); }); } });
    def({ id: 'mmap()', cls: 'memory', kind: 'pointer', need: 'ally', castCondition: { type: 'classOnBoard', cls: 'process', n: 1 }, text: '조건 process 1+ · 내 인스턴스 1장의 「전개칸」에 벽(공0 체5) 생성',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && emptyAround(G, tk).length > 0; },
      cast: function (G, p, tk) { var u = tk ? G.board[tk] : G.allyObjects(p).filter(function (a) { return emptyAround(G, unitKey(G, a)).length; })[0]; if (!u) return; var cell = emptyAround(G, unitKey(G, u))[0]; if (cell) G.summon(p, 'Wall5', cell, { cls: 'memory' }); } });
    def({ id: 'mprotect()', cls: 'memory', kind: 'pointer', need: 'ally', text: '아군 1장이 받는 다음 피해 1회를 전부 막음(🛡 보호막 표시)', cast: function (G, p, tk) { var u = tk ? G.board[tk] : (woundedAlly(G, p) || G.allyObjects(p)[0]); if (u) G.protect(u); } });
    def({ id: 'swapfile()', cls: 'memory', kind: 'pointer', need: 'allyMemory', castCondition: { type: 'classOnBoard', cls: 'memory', n: 2 }, text: '조건 memory 2+ · 내 memory 1장 최대체력 +3 + 카드 1장 뽑기', cast: function (G, p, tk) { var u = tk ? G.board[tk] : allyOfCls(G, p, 'memory')[0]; if (u) G.buffHp(u, 3); G.draw(p, 1); } });

    // ============================================================ PROCESS — objects
    def({ id: 'Longjmp', cls: 'process', kind: 'object', atk: 5, hp: 6, deckRule: 'processSingle', text: 'For(1) 「앞직선2·첫」 적에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 2)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Hook', cls: 'process', kind: 'object', atk: 3, hp: 6, text: 'When 포인터 시전 시 「1칸이내」 적 하나 2 피해',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { var t = nearestEnemyOrBodyWithin(G, u, 1); if (t) G.deal(t, 2, { attacker: u }); } }] });
    def({ id: 'Pipe', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 내 포인터로 피해를 준 대상에게 추가 2 피해',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u, ctx) { if (ctx.target && ctx.target.uid != null && G.board[unitKey(G, ctx.target)]) G.deal(ctx.target, 2, { attacker: u }); } }] });
    def({ id: 'Relay', cls: 'process', kind: 'object', atk: 4, hp: 6, text: 'When 턴당 첫 포인터 시전 시 자기와 「1칸이내」 아군 process 전부 공격력 +1',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { if (u.flags.relayTurn === G.turnNo) return; u.flags.relayTurn = G.turnNo; G.buffAtk(u, 1); G.around(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'process' && x.type === 'object'; }).forEach(function (x) { G.buffAtk(x, 1); }); } }] });
    def({ id: 'Raycast', cls: 'process', kind: 'object', atk: 6, hp: 5, deckRule: 'processSingle', text: 'For(1) 네 대각선 방향 2칸 내 적 하나에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : G.unitsInShape(u, diagonal, 2).filter(function (x) { return x.owner !== u.owner; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Jump', cls: 'process', kind: 'object', atk: 5, hp: 5, deckRule: 'processSingle', text: 'For(2) 「3칸이내」 빈 칸으로 이동(경로의 벽·인스턴스 무시)',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', ready: function (G, u) { return !!jumpEmpty(G, u); }, fn: function (G, u, ch) { var k = unitKey(G, u); var dest = (ch.dest && !G.board[ch.dest] && k && cheb(k, ch.dest) <= 3) ? ch.dest : jumpEmpty(G, u); if (dest) G.teleport(u, dest); } }] });
    def({ id: 'Exploit', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 선언 시 적 인스턴스 하나 공격력 -3',
      abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = strongestEnemy(G, u.owner); if (t) G.buffAtk(t, -3); } }] });
    def({ id: 'Reroute', cls: 'process', kind: 'object', atk: 3, hp: 6, require: { type: 'turnCount', n: 2 }, text: 'require 내 턴 2회+ 진행 · For(1) 적 인스턴스 하나를 그 「옆칸」 빈 칸으로 강제 이동',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', ready: function (G, u) { return shoveableEnemies(G, u.owner).length > 0; }, fn: function (G, u, ch) { var list = shoveableEnemies(G, u.owner); var t = (ch.target && G.board[ch.target] && list.indexOf(G.board[ch.target]) >= 0) ? G.board[ch.target] : list[0]; if (t) G.shoveToEmpty(t, u.owner); } }] });
    def({ id: 'Profiler', cls: 'process', kind: 'object', atk: 2, hp: 6, text: 'While 「1칸이내」 적 인스턴스 하나당 공격력 +1', abilities: [] });
    def({ id: 'Probe', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'For(1) 「3칸이내」 가장 먼 적 하나에게 공격력만큼 피해(동거리 시 내가 선택)',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var k = unitKey(G, u); var t = (ch.target && G.board[ch.target] && k && cheb(ch.target, k) <= 3) ? G.board[ch.target] : farthestEnemy(G, u, 3); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Async', cls: 'process', kind: 'object', atk: 4, hp: 5, deckRule: 'processSingle', text: 'For(1) 턴 중 자기 「1칸이동」',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onActive', ready: function (G, u) { return G.moveCells(u).length > 0; }, fn: function (G, u, ch) { var dest = (ch.dest && G.moveCells(u).indexOf(ch.dest) >= 0) ? ch.dest : (forwardDest(G, u) || G.moveCells(u)[0]); if (dest) G.move(u, dest, true); } }] });
    def({ id: 'Callback', cls: 'process', kind: 'object', atk: 3, hp: 5, text: 'When 파괴 시 「1칸이내」 적 하나 5 피해',
      abilities: [{ kw: 'When', trigger: 'onDeath', fn: function (G, u, ctx) { var t = G.boardUnits().filter(function (x) { return x.owner !== u.owner && (x.type === 'object' || x.type === 'body') && cheb(unitKey(G, x), ctx.atKey) <= 1; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t) G.deal(t, 5, { attacker: u }); } }] });
    def({ id: 'Hotfix', cls: 'process', kind: 'object', atk: 3, hp: 7, text: 'When 포인터 시전 시 아군 1장 1 회복',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { var t = woundedAlly(G, u.owner); if (t) G.healInst(t, 1); } }] });
    def({ id: 'Vector', cls: 'process', kind: 'object', atk: 6, hp: 5, require: { type: 'classOnBoard', cls: 'process', n: 2 }, text: 'require 내 process 2개+ 필드에 존재 · For(1) 「앞직선3·전부」 적 전부에게 공격력만큼 피해 · 직격(피해감소 무시)',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var k = unitKey(G, u), q = P(k); line(q[0], q[1], 0, fwd(u.owner), 3).map(function (c) { return G.board[c]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, G.effAtk(u), { attacker: u, direct: true }); }); } }] });
    def({ id: 'Lambda', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 턴당 첫 포인터 시전 시 「2칸이내」 적 하나 3 피해',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { if (u.flags.lamTurn === G.turnNo) return; u.flags.lamTurn = G.turnNo; var t = nearestEnemyOrBodyWithin(G, u, 2); if (t) G.deal(t, 3, { attacker: u }); } }] });
    def({ id: 'Cursor', cls: 'process', kind: 'object', atk: 4, hp: 4, text: 'For(1) 「앞직선3·첫」 적에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 3, false); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 3)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Spooler', cls: 'process', kind: 'object', atk: 2, hp: 6, text: 'When 턴당 첫 포인터 시전 시 카드 1장 뽑기',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { if (u.flags.spoolTurn !== G.turnNo) { u.flags.spoolTurn = G.turnNo; G.draw(u.owner, 1); } } }] });
    def({ id: 'Honeypot', cls: 'process', kind: 'object', atk: 2, hp: 6, text: 'For(1) 「3칸이내」 적 인스턴스 하나를 자기 「옆칸」 빈 칸으로 끌어당김 + 2 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart',
        ready: function (G, u) { var uk = unitKey(G, u); if (!uk) return false; var q = P(uk); if (!ortho(q[0], q[1]).some(function (c) { return !G.board[c]; })) return false; return G.enemyObjects(u.owner).some(function (x) { var xk = unitKey(G, x); return xk && cheb(xk, uk) <= 3; }); },
        fn: function (G, u, ch) { var uk = unitKey(G, u); if (!uk) return; var t = (ch.target && G.board[ch.target]) ? G.board[ch.target] : nearestEnemyWithin(G, u, 3); if (!t) return; var tk = unitKey(G, t); if (!tk) return; var q = P(uk); var cells = ortho(q[0], q[1]).filter(function (c) { return !G.board[c]; }); cells.sort(function (a, b) { return manh(a, tk) - manh(b, tk); }); var dest = cells[0]; if (dest && manh(dest, tk) < manh(tk, uk)) G.forceMove(t, dest); if (G.board[unitKey(G, t)]) G.deal(t, 2, { attacker: u }); } }] });
    def({ id: 'Cron', cls: 'process', kind: 'object', atk: 4, hp: 6, text: 'When 내 턴 시작 시 「앞직선2·첫」 적에게 2 피해',
      abilities: [{ kw: 'When', trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, false); if (t) G.deal(t, 2, { attacker: u }); else if (inLineToBody(G, u, 2)) G.deal(G.enemyBody(u.owner), 2, { attacker: u }); } }] });
    def({ id: 'Marshal', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 포인터 시전 시 자기 「1칸이동」 가능',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { var dest = forwardDest(G, u); if (dest && !G.isMoveLocked(u)) G.move(u, dest, true); } }] });
    def({ id: 'Thrash', cls: 'process', kind: 'object', atk: 3, hp: 5, text: 'While 적 인스턴스가 강제 이동될 때마다 그 적 인스턴스에게 2 피해', abilities: [] });
    def({ id: 'Offset', cls: 'process', kind: 'object', atk: 5, hp: 4, text: 'For(1) 「나이트」 도약 위치(체스 나이트 모양)의 적 하나에게 공격력만큼 피해',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : G.unitsInShape(u, function (c, r) { return knight(c, r); }, 0).filter(function (x) { return x.owner !== u.owner && x.type === 'object'; })[0]; if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Dispatch', cls: 'process', kind: 'object', atk: 3, hp: 4, text: 'For(2) 자기를 「나이트」 도약 위치(체스 나이트 모양) 빈 칸으로 재배치(강제 이동 아님)',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onActive', ready: function (G, u) { return !!knightEmpty(G, u); }, fn: function (G, u, ch) { var t = (ch.target && G.board[ch.target] && G.board[ch.target].owner === u.owner) ? G.board[ch.target] : u; var dest = (ch.dest && !G.board[ch.dest]) ? ch.dest : knightEmpty(G, t); if (dest) G.relocate(t, dest); } }] });
    def({ id: 'JIT', cls: 'process', kind: 'object', atk: 1, hp: 4, text: 'When 포인터 시전 시 자기 공격력 +1',
      abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { G.buffAtk(u, 1); } }] });
    def({ id: 'Fault', cls: 'process', kind: 'object', atk: 3, hp: 5, text: 'While 적 인스턴스가 봉쇄될 때마다 그 적 인스턴스에게 1 피해', abilities: [] });

    // ============================================================ PROCESS — pointers
    def({ id: 'memcpy()', cls: 'process', kind: 'pointer', need: 'enemy', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 적 인스턴스 하나를 그 「옆칸」 빈 칸으로 강제 이동',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner !== p && emptyAround(G, tk).some(function (c) { return manh(c, tk) === 1; }); },
      cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.shoveToEmpty(u, p); } });
    def({ id: 'goto()', cls: 'process', kind: 'pointer', need: 'allyProcess', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 내 process 1장 「3칸이내」 빈 칸으로 이동(경로의 벽·인스턴스 무시)',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && !!jumpEmpty(G, u); },
      cast: function (G, p, tk, o) { var u = G.board[tk]; if (!u) return; var dest = (o && o.dest && !G.board[o.dest] && cheb(tk, o.dest) <= 3) ? o.dest : jumpEmpty(G, u); if (dest) G.teleport(u, dest); } });
    def({ id: 'snipe()', cls: 'process', kind: 'pointer', deckRule: 'processSingle', need: 'none', text: '「앞직선4·첫」 적 7 피해 · 직격(피해감소 무시)', cast: function (G, p, tk, o) { var n = 4 + (o.rangeBonus || 0); var t = G.firstEnemyInLine(bodyKey(p), p, n, false); if (t) { G.deal(t, 7, { attacker: { owner: p }, direct: true }); return; } var bp = P(bodyKey(p)), eb = P(bodyKey(1 - p)); if (bp[0] === eb[0] && Math.abs(eb[1] - bp[1]) <= n) { var dr = fwd(p), blk = false; for (var kk = 1; kk < Math.abs(eb[1] - bp[1]); kk++) { if (G.board[K(bp[0], bp[1] + dr * kk)]) { blk = true; break; } } if (!blk) G.deal(G.enemyBody(p), 7, { attacker: { owner: p }, direct: true }); } } });
    def({ id: 'swap()', cls: 'process', kind: 'pointer', need: 'twoAlly', text: '내 인스턴스 2장 위치 교환', cast: function (G, p, tk, o) { var a = G.board[tk], b = o && o.second ? G.board[o.second] : null; if (!b) { var allies = G.allyObjects(p).filter(function (x) { return x !== a; }); b = allies[0]; } if (a && b) { var ka = unitKey(G, a), kb = unitKey(G, b); delete G.board[ka]; delete G.board[kb]; G.board[kb] = a; G.board[ka] = b; G.fireEnterTriggers(a); G.fireEnterTriggers(b); } } });
    def({ id: 'inject()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나 공격력 -4 (2턴)', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.debuffAtkTurns(u, 4, 2); } });
    def({ id: 'pull()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나를 내 본체 쪽으로 「1칸이동」',
      castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk), nr = q[1] - fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
      cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.pullToward(u, p); } });
    def({ id: 'push()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나를 적 진영 쪽으로 「1칸이동」',
      castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk), nr = q[1] + fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
      cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.pushAway(u, p); } });
    def({ id: 'chain()', cls: 'process', kind: 'pointer', deckRule: 'processSingle', need: 'enemy', text: '적 하나와 그 뒤 같은 열 첫 적 인스턴스(적 진영 방향)에게 각 4 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var back = G.chainBackEnemy(tk, p); G.deal(u, 4, { attacker: { owner: p } }); if (back && G.board[unitKey(G, back)]) G.deal(back, 4, { attacker: { owner: p } }); } });
    def({ id: 'proxy()', cls: 'process', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 4 }, text: '조건 내 턴 4회+ · 다음 시전하는 포인터 효과 2회 발동', cast: function (G, p) { G.turnFlags.proxyRepeat = true; } });
    def({ id: 'trace()', cls: 'process', kind: 'pointer', need: 'allyProcess', text: '내 process 1장을 적 인스턴스 하나의 「1칸이내」 빈 칸으로 이동(경로의 벽·인스턴스 무시) + 그 적 인스턴스에게 2 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner !== p) return false; var en = bestEnemyObj(G, p); return !!en && emptyAround(G, unitKey(G, en)).length > 0; },
      cast: function (G, p, tk, o) { var u = G.board[tk]; var en = (o && o.second && G.board[o.second]) ? G.board[o.second] : bestEnemyObj(G, p); if (!u || !en) return; var dest = emptyAround(G, unitKey(G, en))[0]; if (dest) G.teleport(u, dest); if (G.board[unitKey(G, en)]) G.deal(en, 2, { attacker: u }); } });
    def({ id: 'rotate()', cls: 'process', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 적 인스턴스 2장 위치 교환',
      cast: function (G, p) { var es = G.enemyObjects(p); if (es.length < 2) return; var a = es[0], b = es[1], ka = unitKey(G, a), kb = unitKey(G, b); delete G.board[ka]; delete G.board[kb]; G.board[kb] = a; G.board[ka] = b; G.afterForcedMove(a); G.afterForcedMove(b); } });
    def({ id: 'jitter()', cls: 'process', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 4 }, text: '조건 내 턴 4회+ · 적 인스턴스 전부 각자 「옆칸」 빈 칸으로 무작위 강제 이동(빈 칸 없으면 유지)',
      cast: function (G, p) { G.enemyObjects(p).slice().forEach(function (e) { var k = unitKey(G, e); if (!k) return; var opts = ortho(P(k)[0], P(k)[1]).filter(function (x) { return !G.board[x]; }); if (opts.length) G.forceMove(e, opts[Math.floor(G.rng() * opts.length)]); }); } });
    def({ id: 'splice()', cls: 'process', kind: 'pointer', need: 'enemy', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 내 인스턴스 1장과 적 인스턴스 하나 위치 교환',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner !== p && G.allyObjects(p).length > 0; },
      cast: function (G, p, tk, o) { var e = G.board[tk]; var a = (o && o.second && G.board[o.second]) ? G.board[o.second] : bestAllyForSplice(G, p); if (!e || !a) return; var ka = unitKey(G, a), ke = unitKey(G, e); delete G.board[ka]; delete G.board[ke]; G.board[ke] = a; G.board[ka] = e; G.fireEnterTriggers(a); G.afterForcedMove(e); } });
    def({ id: 'glitch()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나 4 피해 후 적 진영 쪽으로 「1칸이동」', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 4, { attacker: { owner: p } }); if (G.board[tk]) G.pushAway(u, p); } });
    def({ id: 'pipeline()', cls: 'process', kind: 'pointer', need: 'none', castCondition: { type: 'classOnBoard', cls: 'process', n: 2 }, text: '조건 process 2+ · 카드 2장 뽑기', cast: function (G, p) { G.draw(p, 2); } });
    def({ id: 'hop()', cls: 'process', kind: 'pointer', need: 'allyProcess', text: '내 process 1장 「1칸이동」, 이동 후 「옆칸」 적 있으면 그중 하나에게 2 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.moveCells(u).length > 0; },
      cast: function (G, p, tk, o) { var u = G.board[tk]; if (!u) return; var dest = (o && o.dest && G.moveCells(u).indexOf(o.dest) >= 0) ? o.dest : (forwardDest(G, u) || G.moveCells(u)[0]); if (dest) G.move(u, dest, true); var t = G.adj(u).filter(function (x) { return x.owner !== p; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t) G.deal(t, 2, { attacker: u }); } });

    // ============================================================ GENERIC — objects
    def({ id: 'Ripple', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'When 선언 시 「옆칸」 적 전부 2 피해', abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { dmgAdjEnemies(G, u, 2); } }] });
    def({ id: 'Bit', cls: 'generic', kind: 'object', atk: 1, hp: 2, text: 'For(3) 「옆칸」 적 하나에게 공격력만큼 피해', abilities: [{ kw: 'For', forCount: 3, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = pickAdjEnemy(G, u, ch); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
    def({ id: 'Flag', cls: 'generic', kind: 'object', atk: 2, hp: 5, text: 'While 「옆칸」 아군 공격력 +1', abilities: [] });
    def({ id: 'Var', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'When 턴 시작 시 자기 공격력 +1', abilities: [{ kw: 'When', trigger: 'onTurnStart', fn: function (G, u) { G.buffAtk(u, 1); } }] });
    def({ id: 'Value', cls: 'generic', kind: 'object', atk: 5, hp: 3, text: '능력 없음(공격형)' });
    def({ id: 'Coerce', cls: 'generic', kind: 'object', atk: 3, hp: 3, text: 'When 선언 시 적 인스턴스 하나 공격력 -2', abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = strongestEnemy(G, u.owner); if (t) G.buffAtk(t, -2); } }] });
    def({ id: 'Int', cls: 'generic', kind: 'object', atk: 4, hp: 5, text: '능력 없음(단단)' });
    def({ id: 'Bool', cls: 'generic', kind: 'object', atk: 2, hp: 3, text: 'Once 선언 시 아군 1장 최대체력 +2', abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var t = woundedAlly(G, u.owner) || G.adj(u).filter(function (x) { return x.owner === u.owner; })[0] || u; if (t) G.buffHp(t, 2); } }] });
    def({ id: 'Merge', cls: 'generic', kind: 'object', atk: 4, hp: 4, text: 'When 파괴 시 「옆칸」 적 하나에게 4 피해', abilities: [{ kw: 'When', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); var t = ortho(p[0], p[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== u.owner; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t) G.deal(t, 4, { attacker: u }); } }] });
    def({ id: 'Delete', cls: 'generic', kind: 'object', atk: 5, hp: 2, text: 'For(1) 「2칸이내」 체력 2 이하 적 인스턴스 하나 파괴',
      abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var k = unitKey(G, u); var t = (ch.target && G.board[ch.target]) ? G.board[ch.target] : G.enemyObjects(u.owner).filter(function (x) { var xk = unitKey(G, x); return xk && cheb(xk, k) <= 2 && G.curHp(x) <= 2; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t && cheb(unitKey(G, t), k) <= 2 && G.curHp(t) <= 2) G.destroy(t, { attacker: u }); } }] });
    def({ id: 'Pivot', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'For(1) 턴 중 자기 「1칸이동」', abilities: [{ kw: 'For', forCount: 1, trigger: 'onActive', ready: function (G, u) { return G.moveCells(u).length > 0; }, fn: function (G, u, ch) { var dest = (ch.dest && G.moveCells(u).indexOf(ch.dest) >= 0) ? ch.dest : (forwardDest(G, u) || G.moveCells(u)[0]); if (dest) G.move(u, dest, true); } }] });
    def({ id: 'Sonar', cls: 'generic', kind: 'object', atk: 2, hp: 4, text: 'For(2) 「2칸이내」 적 하나 2 피해', abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyOrBodyWithin(G, u, 2); if (t) G.deal(t, 2, { attacker: u }); } }] });
    def({ id: 'Loop', cls: 'generic', kind: 'object', atk: 3, hp: 5, text: 'For(2) 「옆칸」 적 하나에게 (내 필드 클래스 종류 수 ×2) 피해',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = pickAdjEnemy(G, u, ch); if (t) { var cls = {}; G.allyObjects(u.owner).forEach(function (x) { cls[cardCls(x)] = 1; }); G.deal(t, Object.keys(cls).length * 2, { attacker: u }); } } }] });
    def({ id: 'Stub', cls: 'generic', kind: 'object', atk: 1, hp: 6, text: 'While 「옆칸」 적 인스턴스 공격력 -1', abilities: [] });
    def({ id: 'Idle', cls: 'generic', kind: 'object', atk: 0, hp: 7, text: '능력 없음(큰 벽)' });
    def({ id: 'Debug', cls: 'generic', kind: 'object', atk: 2, hp: 4, text: 'While 「옆칸」 적 인스턴스가 받는 피해 +1', abilities: [] });
    def({ id: 'Symlink', cls: 'generic', kind: 'object', atk: 2, hp: 4, text: 'For(2) 내 다른 인스턴스 1장의 「전개칸」으로 이동',
      abilities: [{ kw: 'For', forCount: 2, trigger: 'onActive', ready: function (G, u) { return G.allyObjects(u.owner).some(function (a) { return a !== u && emptyAround(G, unitKey(G, a)).length; }); },
        fn: function (G, u, ch) { var anchor = (ch.target && G.board[ch.target] && G.board[ch.target] !== u) ? G.board[ch.target] : G.allyObjects(u.owner).filter(function (a) { return a !== u && emptyAround(G, unitKey(G, a)).length; })[0]; if (!anchor) return; var cell = emptyAround(G, unitKey(G, anchor))[0]; if (cell) G.teleport(u, cell); } }] });

    // ============================================================ GENERIC — pointers
    def({ id: 'malloc()', cls: 'generic', kind: 'pointer', need: 'none', text: '「홈칸」에 분신(공2 체3) 생성', cast: function (G, p) { G.summon(p, 'Token2b', G.firstEmptyHome(p), { cls: 'generic' }); } });
    def({ id: 'kill()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 하나 5 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 5, { attacker: { owner: p } }); } });
    def({ id: 'ping()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 하나 2 피해 + 카드 1장 뽑기', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 2, { attacker: { owner: p } }); G.draw(p, 1); } });
    def({ id: 'sync()', cls: 'generic', kind: 'pointer', need: 'none', text: '내 인스턴스 전부 3 회복', cast: function (G, p) { G.allyObjects(p).forEach(function (x) { G.healInst(x, 3); }); } });
    def({ id: 'flush()', cls: 'generic', kind: 'pointer', need: 'ally', text: '내 인스턴스 1장의 「옆칸」 적 전부 3 피해',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && G.adj(u).some(function (x) { return x.owner !== p; }); },
      cast: function (G, p, tk) { var u = tk ? G.board[tk] : G.allyObjects(p).filter(function (a) { return G.adj(a).some(function (x) { return x.owner !== p; }); })[0]; if (!u) return; G.adj(u).forEach(function (x) { if (x.owner !== p) G.deal(x, 3, { attacker: { owner: p } }); }); } });
    def({ id: 'shift()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 「1칸이동」', cast: function (G, p, tk, o) { var u = G.board[tk]; if (!u) return; var dest = (o && o.dest && G.moveCells(u).indexOf(o.dest) >= 0) ? o.dest : (forwardDest(G, u) || G.moveCells(u)[0]); if (dest) G.move(u, dest, true); } });
    def({ id: 'drop()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나에게 그 적 인스턴스의 공격력만큼 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, G.effAtk(u), { attacker: { owner: p } }); } });
    def({ id: 'assert()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 하나 3 피해 + 공격력 -1', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 3, { attacker: { owner: p } }); if (G.board[tk]) G.buffAtk(u, -1); } });
    def({ id: 'yield()', cls: 'generic', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 이번 턴 액션 +2', cast: function (G, p) { G.grantActions(2); } });
    def({ id: 'suspend()', cls: 'generic', kind: 'pointer', need: 'enemy', castCondition: { type: 'turnCount', n: 3 }, text: '조건 내 턴 3회+ · 적 인스턴스 1장을 소유자의 손으로 되돌림',
      cast: function (G, p, tk) { var u = G.board[tk]; if (!u || u.type !== 'object' || u.token) { if (u && u.token) G.destroy(u, { attacker: { owner: p } }); return; } var k = unitKey(G, u); delete G.board[k]; var opl = G.players[u.owner]; if (opl.hand.length < 10) opl.hand.push(u.cardId); else opl.graveyard.push(u.cardId); G.note(CARDS[u.cardId].name + ' 손으로 되돌림'); } });
    def({ id: 'cast()', cls: 'generic', kind: 'pointer', need: 'ally', text: '내 generic 인스턴스 1장 공격력↔체력 교환',
      castValid: function (G, p, tk) { var u = G.board[tk]; return !!u && u.owner === p && cardCls(u) === 'generic'; },
      cast: function (G, p, tk) { var u = tk ? G.board[tk] : allyOfCls(G, p, 'generic')[0]; if (!u || cardCls(u) !== 'generic') return; var a = G.effAtk(u), h = G.curHp(u); u.baseAtk = h; u.baseHp = a; u.atkMod = 0; u.hpMod = 0; u.dmg = 0; } });
    def({ id: 'throw()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 하나 4 피해, 대상의 「옆칸」 적 전부 2 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var q = P(tk); G.deal(u, 4, { attacker: { owner: p } }); ortho(q[0], q[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== p; }).forEach(function (x) { G.deal(x, 2, { attacker: { owner: p } }); }); } });
    def({ id: 'catch()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 하나 4 피해, 파괴 시 카드 1장 뽑기', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 4, { attacker: { owner: p } }); if (!G.board[tk]) G.draw(p, 1); } });
    def({ id: 'patch()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 최대체력 +3, 공격력 +1', cast: function (G, p, tk) { var u = G.board[tk]; if (u) { G.buffHp(u, 3); G.buffAtk(u, 1); } } });
    def({ id: 'clear()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나의 공격력 강화 효과 전부 해제(기본치로)', cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.atkMod > 0) u.atkMod = 0; } });
    def({ id: 'copy()', cls: 'generic', kind: 'pointer', need: 'none', text: '손의 generic 카드 1장을 복사해 손에 추가', cast: function (G, p) { var h = G.players[p].hand.filter(function (id) { return CARDS[id].cls === 'generic'; }); if (h.length && G.players[p].hand.length < 10) G.players[p].hand.push(h[0]); } });
    def({ id: 'exit()', cls: 'generic', kind: 'pointer', need: 'none', castCondition: { type: 'selfBodyHP', cmp: '<=', n: 18 }, text: '조건 내 본체 HP 18 이하 · 모든 적 3 피해', cast: function (G, p) { G.enemyObjects(p).forEach(function (x) { G.deal(x, 3, { attacker: { owner: p } }); }); var eb = G.enemyBody(p); if (eb) G.deal(eb, 3, { attacker: { owner: p } }); } });
    def({ id: 'mend()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 「홈칸」 빈 칸으로 이동 + 3 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : (woundedAlly(G, p) || G.allyObjects(p)[0]); if (!u) return; var cell = G.firstEmptyHome(p); if (cell && cell !== unitKey(G, u)) G.teleport(u, cell); G.healInst(u, 3); } });
    def({ id: 'halt()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 인스턴스 하나 1턴 봉쇄', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.bind(u, 1); } });
    def({ id: 'log()', cls: 'generic', kind: 'pointer', need: 'none', text: '카드 1장 뽑기, 이번 턴 포인터를 이미 시전했다면 1장 더 뽑기', cast: function (G, p) { G.draw(p, 1); if (G.turnFlags.pointerCastThisTurn > 1) G.draw(p, 1); } });
    def({ id: 'defer()', cls: 'process', kind: 'pointer', need: 'none', text: '다음 내 턴 액션 +2', cast: function (G, p) { G.players[p].deferredActions = (G.players[p].deferredActions || 0) + 2; } });
    // 후공 보정 카드('동전' 격) — 후공 첫 턴에 덱 외로 1장 지급. 덱 편성 불가(deckbuilder/도감 제외).
    def({ id: 'overtime()', cls: 'generic', kind: 'pointer', need: 'none', text: '이번 턴 액션 +3 · 후공 보정(덱 편성 불가)', cast: function (G, p) { G.grantActions(3); } });

    // ============================================================ IF — 선택 발동 능력 카드 (조건부·2분기)
    // kw:'If' = 능동 활성(For와 동일 회계). options=UI 분기 버튼, ch.opt=선택 인덱스, aiOpt=AI 분기.
    def({ id: 'Predicate', cls: 'thread', kind: 'object', atk: 4, hp: 3, text: 'If 선택 발동 · [저격] 「2칸이내」 적 하나 공격력만큼 피해 / [규합] 「옆칸」 아군 thread 전부 공격력 +2',
      abilities: [{ kw: 'If', forCount: 1, trigger: 'onActive', options: [{ label: '저격' }, { label: '규합' }],
        ready: function (G, u) { return !!nearestEnemyWithin(G, u, 2) || G.adj(u).some(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }); },
        fn: function (G, u, ch) { if ((ch.opt || 0) === 0) { var t = ch.target ? G.board[ch.target] : nearestEnemyOrBodyWithin(G, u, 2); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } else { G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 2); }); } },
        aiOpt: function (G, u) { var e = nearestEnemyWithin(G, u, 2); var allies = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).length; if (e && G.curHp(e) <= G.effAtk(u)) return 0; return allies >= 2 ? 1 : (e ? 0 : 1); } }] });
    def({ id: 'Cond', cls: 'thread', kind: 'object', atk: 5, hp: 3, text: 'If 선택 발동 · [강타] 「앞직선3·첫」 적에게 공격력만큼 피해 / [가속] 자기 이번 턴 기본 공격 1회 추가',
      abilities: [{ kw: 'If', forCount: 1, trigger: 'onTurnStart', options: [{ label: '강타' }, { label: '가속' }],
        ready: function (G, u) { return true; },
        fn: function (G, u, ch) { if ((ch.opt || 0) === 0) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 3, false); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 3)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } else { G.grantBonusAttack(u, 1); } },
        aiOpt: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 3, false); if (t && G.curHp(t) <= G.effAtk(u)) return 0; return G.canBasicAttack(u) ? 1 : 0; } }] });
    // ============================================================ SWITCH — 변신(폼 선택) 함수 능력 카드
    // kw:'Switch' = 능동 활성(For/If와 동일 회계). options=UI 폼 버튼, forms=변신 대상 카드 id, ch.opt=선택 인덱스.
    // 게임당 1회 영구 변신. 변신폼(form:true)은 실제 카드로 정의되어 도감/덱빌더에 변신폼으로 함께 표시된다.
    def({ id: 'Switch', cls: 'generic', kind: 'object', atk: 3, hp: 3, switchForms: ['Switch_ATK', 'Switch_DEF'], text: 'Switch 변신(게임당 1회) · [공격형] 공5·체1 / [방어형] 공0·체6',
      abilities: [{ kw: 'Switch', forCount: 1, trigger: 'onActive', options: [{ label: '공격형' }, { label: '방어형' }], forms: ['Switch_ATK', 'Switch_DEF'],
        ready: function (G, u) { return true; },
        fn: function (G, u, ch) { var fm = ['Switch_ATK', 'Switch_DEF']; G.transformUnit(u, fm[(ch.opt || 0)]); },
        aiOpt: function (G, u) { var myBody = G.body(u.owner); if (myBody && myBody.dmg >= 20 && G.enemyObjects(u.owner).length >= 2) return 1; return 0; } }] });
    def({ id: 'Branch', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'If 선택 발동 · [도약] 자기 「1칸이동」 후 「옆칸」 적 하나 2 피해 / [교란] 적 인스턴스 하나를 적 진영 쪽으로 「1칸이동」',
      abilities: [{ kw: 'If', forCount: 1, trigger: 'onActive', options: [{ label: '도약' }, { label: '교란' }],
        ready: function (G, u) { return G.moveCells(u).length > 0 || G.enemyObjects(u.owner).some(function (x) { var k = unitKey(G, x); if (!k) return false; var q = P(k), nr = q[1] + fwd(u.owner); return inB(q[0], nr) && !G.board[K(q[0], nr)]; }); },
        fn: function (G, u, ch) {
          if ((ch.opt || 0) === 0) { var dest = forwardDest(G, u) || G.moveCells(u)[0]; if (dest) G.move(u, dest, true); var t = G.adj(u).filter(function (x) { return x.owner !== u.owner; }).sort(function (a, b) { return G.curHp(a) - G.curHp(b); })[0]; if (t) G.deal(t, 2, { attacker: u }); }
          else {
            // 교란: 반드시 「밀 수 있는」(전방칸 in-bounds & 빈칸) 적을 골라 불발 방지.
            var pushable = function (x) { var k = unitKey(G, x); if (!k) return false; var q = P(k), nr = q[1] + fwd(u.owner); return inB(q[0], nr) && !G.board[K(q[0], nr)]; };
            var e = ch.target ? G.board[ch.target] : null;
            if (!e || !pushable(e)) {
              // 내 진영쪽으로 전진한(위협적인) 적 우선 → 동률이면 최약체.
              e = G.enemyObjects(u.owner).filter(pushable).sort(function (a, b) {
                var ka = unitKey(G, a), kb = unitKey(G, b); var adv = P(kb)[1] * fwd(u.owner) - P(ka)[1] * fwd(u.owner);
                return adv || (G.curHp(a) - G.curHp(b));
              })[0];
            }
            if (e) G.pushAway(e, u.owner);
          }
        },
        aiOpt: function (G, u) { var pushable = function (x) { var k = unitKey(G, x); if (!k) return false; var q = P(k), nr = q[1] + fwd(u.owner); return inB(q[0], nr) && !G.board[K(q[0], nr)]; }; if (G.moveCells(u).length === 0 && G.enemyObjects(u.owner).some(pushable)) return 1; return 0; } }] });
    def({ id: 'Guard', cls: 'memory', kind: 'object', atk: 1, hp: 9, text: 'If 선택 발동 · [수호] 내 본체 3 회복 / [응징] 「옆칸」 적 하나 3 피해',
      abilities: [{ kw: 'If', forCount: 1, trigger: 'onTurnStart', options: [{ label: '수호' }, { label: '응징' }],
        ready: function (G, u) { return true; },
        fn: function (G, u, ch) { if ((ch.opt || 0) === 0) { G.healInst(G.body(u.owner), 3); } else { var t = pickAdjEnemy(G, u, ch); if (t) G.deal(t, 3, { attacker: u }); } },
        aiOpt: function (G, u) { var adj = pickAdjEnemy(G, u, {}); var body = G.body(u.owner); if (body && body.dmg >= 3) return 0; return adj ? 1 : 0; } }] });

    // ============================================================ OP / signature cards
    def({ id: 'Mainframe', cls: 'thread', kind: 'object', atk: 4, hp: 4, deckLimit: 1, require: { type: 'classOnBoard', cls: 'thread', n: 4 }, text: '덱당 1 · require 내 thread 4개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +4',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { allyThreads(G, u.owner).forEach(function (x) { G.buffAtk(x, 4); }); } }] });
    def({ id: 'Hivemind', cls: 'thread', kind: 'object', atk: 3, hp: 3, deckLimit: 1, deckRule: 'threadSingle', text: '덱당 1 · thread 단일 덱 · While 「옆칸」 아군에게 적용되는 강화 효과를 자기도 받는다(누적 상한 +6)', abilities: [] });
    def({ id: 'Broadcast', cls: 'thread', kind: 'object', atk: 3, hp: 3, deckLimit: 1, require: { type: 'and', a: { type: 'classOnBoard', cls: 'thread', n: 3 }, b: { type: 'turnCount', n: 4 } }, text: '덱당 1 · require thread 3개+ · 내 턴 4회+ · Once 선언 시 내 thread 전부 이번 턴 기본 공격 1회 추가(이미 공격했어도 가능)',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { allyThreads(G, u.owner).forEach(function (x) { if (x !== u) G.grantBonusAttack(x, 1); }); } }] });
    def({ id: 'Singleton', cls: 'memory', kind: 'object', atk: 6, hp: 20, deckLimit: 1, require: { type: 'or', a: { type: 'turnCount', n: 5 }, b: { type: 'classOnBoard', cls: 'memory', n: 4 } }, text: '덱당 1 · require 내 턴 5회+ 또는 memory 4개+ 필드에 존재 · Once 선언 시 적 인스턴스 전부 1턴 봉쇄 · While 본체 받는 피해 -2',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.enemyObjects(u.owner).forEach(function (x) { G.bind(x, 1); }); } }] });
    def({ id: 'Bedrock', cls: 'memory', kind: 'object', atk: 0, hp: 15, deckLimit: 1, deckRule: 'memorySingle', text: '덱당 1 · memory 단일 덱 · While 내 memory 받는 피해 -1(최소 1)', abilities: [] });
    def({ id: 'ROM', cls: 'memory', kind: 'object', atk: 0, hp: 18, deckLimit: 1, require: { type: 'and', a: { type: 'turnCount', n: 4 }, b: { type: 'classOnBoard', cls: 'memory', n: 4 } }, text: '덱당 1 · require 내 턴 4회+ · memory 4개+ · While 이동 불가 · 받는 피해를 한 번에 최대 2까지만 받음(초과분 무효)', abilities: [] });
    def({ id: 'Snapshot', cls: 'memory', kind: 'object', atk: 0, hp: 6, deckLimit: 1, require: { type: 'and', a: { type: 'classOnBoard', cls: 'memory', n: 3 }, b: { type: 'turnCount', n: 7 } }, text: '덱당 1 · require memory 3개+ · 내 턴 7회+ · Once 선언 시 내 모든 인스턴스 전부 회복',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.allyObjects(u.owner).forEach(function (x) { G.repair(x); }); } }] });
    def({ id: 'Singularity', cls: 'process', kind: 'object', atk: 5, hp: 6, deckLimit: 1, require: { type: 'pointersCast', n: 5 }, text: '덱당 1 · require 포인터 시전 5회+ · 선언 후 이번 게임 내내 포인터를 액션 소비 없이 시전',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var pl = G.players[u.owner], me = u.owner; pl.pointerFree = true; var hi = -1; for (var i = 0; i < pl.hand.length; i++) { var cid = pl.hand[i], c = CARDS[cid]; if (c.kind !== 'pointer' || !G.castConditionMet(me, c)) continue; if (c.need && c.need !== 'none' && G.pointerLegalTargets(me, cid).length < (c.need === 'twoAlly' ? 2 : 1)) continue; hi = i; break; } G.turnFlags.extraPointerRange = 3; if (hi >= 0) { var tgts = G.pointerLegalTargets(me, pl.hand[hi]); G.cast(me, hi, tgts[0] || null, true, { rangeBonus: 3 }); } } }] });
    def({ id: 'Conduit', cls: 'process', kind: 'object', atk: 4, hp: 5, deckLimit: 1, deckRule: 'processSingle', text: '덱당 1 · process 단일 덱 · While 턴당 첫 포인터 효과 2회', abilities: [] });
    def({ id: 'Wormhole', cls: 'process', kind: 'object', atk: 4, hp: 5, deckLimit: 1, require: { type: 'and', a: { type: 'turnCount', n: 6 }, b: { type: 'classOnBoard', cls: 'process', n: 3 } }, text: '덱당 1 · require 내 턴 6회+ · process 3개+ · Once 선언 시 적 인스턴스 전부 무작위 빈 칸으로 재배치(강제 이동 아님)',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var es = G.enemyObjects(u.owner).slice(); var cells = shuffleIn(G, emptyCells(G)); es.forEach(function (e) { var k = unitKey(G, e); if (!k) return; var dest = cells.shift(); if (dest && !G.board[dest]) { delete G.board[k]; G.board[dest] = e; G.fx({ type: 'move', from: k, to: dest }); } }); } }] });
    def({ id: 'Overlord', cls: 'generic', kind: 'object', atk: 6, hp: 6, deckLimit: 1, require: { type: 'and', a: { type: 'turnCount', n: 4 }, b: { type: 'selfBodyHP', cmp: '>=', n: 28 } }, text: '덱당 1 · require 내 턴 4회+ · 내 본체 HP 28+ · Once 선언 시 적 본체 6 피해 · For(2) 적 하나에게 공격력만큼 피해',
      abilities: [
        { kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.deal(G.enemyBody(u.owner), 6, { attacker: u }); } },
        { kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : (bestEnemyObj(G, u.owner) || G.enemyBody(u.owner)); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }
      ] });
    def({ id: 'Polymorph', cls: 'generic', kind: 'object', atk: 4, hp: 4, deckLimit: 1, text: '덱당 1 · While 내 필드에 클래스 3종 이상이면 내 인스턴스 전부 공/체 +1', abilities: [] });
    def({ id: 'Sudo', cls: 'generic', kind: 'object', atk: 4, hp: 4, deckLimit: 1, require: { type: 'turnCount', n: 7 }, text: '덱당 1 · require 내 턴 7회+ · Once 선언 시 이번 턴 액션 +2',
      abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.grantActions(2); } }] });

    // ---------------- tokens / walls (분신·벽 — clsOverride로 생성 카드 클래스 상속)
    def({ id: 'Token1', cls: 'generic', kind: 'object', atk: 1, hp: 1, text: '분신' });
    def({ id: 'Token2', cls: 'generic', kind: 'object', atk: 2, hp: 2, text: '분신' });
    def({ id: 'Token21', cls: 'generic', kind: 'object', atk: 2, hp: 1, text: '분신' });
    def({ id: 'Token2b', cls: 'generic', kind: 'object', atk: 2, hp: 3, text: '분신' });
    def({ id: 'Token5', cls: 'generic', kind: 'object', atk: 5, hp: 2, text: '분신' });
    def({ id: 'Wall5', cls: 'memory', kind: 'object', atk: 0, hp: 5, text: '벽' });
    def({ id: 'Wall8', cls: 'memory', kind: 'object', atk: 0, hp: 8, text: '벽' });
    def({ id: 'Wall10', cls: 'memory', kind: 'object', atk: 0, hp: 10, text: '벽' });

    // ---------------- switch forms (변신폼 — form:true → 덱풀/도감 목록 제외, 변신폼 표시로만 노출)
    def({ id: 'Switch_ATK', cls: 'generic', kind: 'object', form: true, atk: 5, hp: 1, text: '변신폼(공격형) · Switch에서 변신' });
    def({ id: 'Switch_DEF', cls: 'generic', kind: 'object', form: true, atk: 0, hp: 6, text: '변신폼(방어형) · Switch에서 변신' });

    // ---------------- pointer-support internals ----------------
    function bestAllyForSplice(G, p) { var a = G.allyObjects(p).filter(function (x) { return !x.token; }); a.sort(function (x, y) { return G.effAtk(y) - G.effAtk(x); }); return a[0] || G.allyObjects(p)[0] || null; }
  };
})();
