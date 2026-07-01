/* RUNTIME TCG — 카드 풀. engine.js가 kit(엔진 내부 헬퍼)를 주입해 정의한다.
   카드 본문은 engine.js 원문에서 한 줄도 바꾸지 않고 이전했다. engine.js보다 먼저 로드할 것. */
(function () {
  window.RT_DEFINE_CARDS = function (kit) {
    var def = kit.def, CARDS = kit.CARDS, COLS = kit.COLS, ROWS = kit.ROWS, K = kit.K, P = kit.P,
        bestEnemyObj = kit.bestEnemyObj, bodyKey = kit.bodyKey, buffAdjThread = kit.buffAdjThread,
        cardCls = kit.cardCls, cheb = kit.cheb, diagonal = kit.diagonal, dmgAdjEnemies = kit.dmgAdjEnemies,
        fwd = kit.fwd, inB = kit.inB, line = kit.line, manh = kit.manh, ortho = kit.ortho,
        square = kit.square, unitKey = kit.unitKey;

  // ---------------- thread instances
  def({ id: 'Fork', cls: 'thread', kind: 'object', atk: 6, hp: 3, text: 'For(2) 「옆칸」 적에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u) { dmgAdjEnemies(G, u, G.effAtk(u)); } }] });
  def({ id: 'Daemon', cls: 'thread', kind: 'object', atk: 5, hp: 4, text: 'Once 선언 시 「옆칸」 내 thread 전부 공격력 +2',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { buffAdjThread(G, u, 2); } }] });
  def({ id: 'Worker', cls: 'thread', kind: 'object', atk: 4, hp: 3, text: 'For(1) 「1칸이내」 적 전부에게 3 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { G.around(u).filter(function (x) { return x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 3, { attacker: u }); }); } }] });
  def({ id: 'Spawn', cls: 'thread', kind: 'object', atk: 4, hp: 2, text: 'Once 파괴 시 「홈칸」에 분신(공2 체2)',
    abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u) { G.summon(u.owner, 'Token2', G.firstEmptyHome(u.owner)); } }] });
  def({ id: 'Interrupt', cls: 'thread', kind: 'object', atk: 6, hp: 3, text: 'If 적이 「옆칸」으로 다가오면 공격력만큼 피해',
    abilities: [{ kw: 'If', trigger: 'onEnterRange', fn: function (G, u, ctx) { if (ctx.mover && ctx.mover.owner !== u.owner) G.deal(ctx.mover, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Overflow', cls: 'thread', kind: 'object', atk: 4, hp: 2, require: { type: 'classOnBoard', cls: 'thread', n: 2 }, text: 'require 내 thread 2개+ 필드에 존재 · While 「옆칸」 thread 1장당 공격력 +2',
    abilities: [] });
  def({ id: 'Race', cls: 'thread', kind: 'object', atk: 5, hp: 3, text: 'While 「옆칸」에 다른 thread 있으면 공격력 +3', abilities: [] });
  def({ id: 'Kernel', cls: 'thread', kind: 'object', atk: 4, hp: 6, require: { type: 'classOnBoard', cls: 'thread', n: 2 }, text: 'require 내 thread 2개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +1',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.allyObjects(u.owner).filter(function (x) { return cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 1); }); } }] });
  def({ id: 'Burst', cls: 'thread', kind: 'object', atk: 6, hp: 2, text: 'For(1) 「2칸이내」 적 1명에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyWithin(G, u, 2); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Recursion', cls: 'thread', kind: 'object', atk: 3, hp: 3, text: 'When 피해받고 생존 시 공격력 +2',
    abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u) { if (G.curHp(u) > 0) G.buffAtk(u, 2); } }] });
  def({ id: 'Signal', cls: 'thread', kind: 'object', atk: 4, hp: 3, text: 'Once 선언 시 「옆칸」 thread 1장 공격력 +4',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var t = G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })[0]; if (t) G.buffAtk(t, 4); } }] });
  def({ id: 'Inline', cls: 'thread', kind: 'object', atk: 5, hp: 2, text: 'When 선언 시(「옆칸」 thread 있으면) 자기 공격력 +3',
    abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { if (G.adj(u).some(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })) G.buffAtk(u, 3); } }] });
  def({ id: 'Panic', cls: 'thread', kind: 'object', atk: 6, hp: 2, text: 'Once 파괴 시 「옆칸」 적 전부 5 피해',
    abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); ortho(p[0], p[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 5, { attacker: u }); }); } }] });
  def({ id: 'Exec', cls: 'thread', kind: 'object', atk: 6, hp: 4, text: 'For(2) 「주위」 적 전부에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u) { G.around(u).filter(function (x) { return x.owner !== u.owner; }).forEach(function (x) { G.deal(x, G.effAtk(u), { attacker: u }); }); } }] });
  def({ id: 'Compile', cls: 'thread', kind: 'object', atk: 2, hp: 4, require: { type: 'classOnBoard', cls: 'thread', n: 3 }, text: 'require 내 thread 3개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +2',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.allyObjects(u.owner).filter(function (x) { return cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 2); }); } }] });

  // ---------------- thread pointers
  def({ id: 'boost()', cls: 'thread', kind: 'pointer', need: 'allyThread', text: '내 thread 1장 공격력 +4', cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.owner === p) G.buffAtk(u, 4); } });
  def({ id: 'overclock()', cls: 'thread', kind: 'pointer', need: 'none', castCondition: { type: 'classOnBoard', cls: 'thread', n: 2 }, text: '내 thread 전부 공격력 +2', cast: function (G, p) { G.allyObjects(p).filter(function (x) { return cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 2); }); } });
  def({ id: 'crash()', cls: 'thread', kind: 'pointer', need: 'enemy', text: '적 1명 4 피해, 파괴 시 「옆칸」 3 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var pk = tk; G.deal(u, 4, { attacker: { owner: p } }); if (!G.board[pk]) { var q = P(pk); ortho(q[0], q[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== p; }).forEach(function (x) { G.deal(x, 3, { attacker: { owner: p } }); }); } } });
  def({ id: 'strike()', cls: 'thread', kind: 'pointer', need: 'none', text: '「앞직선3·첫」 적에게 8 피해', cast: function (G, p, tk, o) { var t = G.firstEnemyInLine(bodyKey(p), p, 3 + (o.rangeBonus || 0), false); if (t) G.deal(t, 8, { attacker: { owner: p } }); else G.deal(G.enemyBody(p), 8, { attacker: { owner: p } }); } });
  def({ id: 'spawn()', cls: 'thread', kind: 'pointer', need: 'none', text: '「홈칸」에 분신(공5 체2)', cast: function (G, p) { G.summon(p, 'Token5', G.firstEmptyHome(p)); } });
  def({ id: 'burst()', cls: 'thread', kind: 'pointer', need: 'enemy', text: '적 1명에게 (「옆칸」 내 thread 수 ×3) 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var n = G.adj(u).filter(function (x) { return x.owner === p && cardCls(x) === 'thread'; }).length; G.deal(u, n * 3, { attacker: { owner: p } }); } });
  def({ id: 'fork()', cls: 'thread', kind: 'pointer', need: 'allyThread', castCondition: { type: 'turnCount', n: 4 }, text: '내 thread 1장 절반능력치 복제', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var nu = G.summon(p, u.cardId, G.firstEmptyHome(p)); if (nu) { nu.baseAtk = Math.ceil(u.baseAtk / 2); nu.baseHp = Math.ceil(u.baseHp / 2); } } });
  def({ id: 'rush()', cls: 'thread', kind: 'pointer', need: 'allyThread', text: '내 thread 1장 앞으로 「1칸이동」',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner !== p) return false; var q = P(tk), nr = q[1] + fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
    cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; var k = unitKey(G, u), q = P(k), dest = K(q[0], q[1] + fwd(p)); if (inB(q[0], q[1] + fwd(p)) && !G.board[dest]) G.move(u, dest, true); } });
  def({ id: 'amplify()', cls: 'thread', kind: 'pointer', need: 'none', castCondition: { type: 'destroyedAlly', n: 2 }, text: '내 thread 전부 공격력 +3', cast: function (G, p) { G.allyObjects(p).filter(function (x) { return cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 3); }); } });

  // ---------------- memory instances
  def({ id: 'Cache', cls: 'memory', kind: 'object', atk: 0, hp: 12, text: 'While 「옆칸」 적 이동 봉쇄', abilities: [] });
  def({ id: 'Mutex', cls: 'memory', kind: 'object', atk: 2, hp: 9, text: 'When 공격받을 때 때린 적 3 피해',
    abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { if (ctx.attacker && ctx.attacker.uid != null) { var a = ctx.attacker; if (G.board[unitKey(G, a)]) G.deal(a, 3, { attacker: u }); } } }] });
  def({ id: 'Heap', cls: 'memory', kind: 'object', atk: 1, hp: 14, text: 'While 「옆칸」 아군 받는 피해 -1', abilities: [] });
  def({ id: 'Stack', cls: 'memory', kind: 'object', atk: 0, hp: 10, text: 'While 「옆칸」 적 공격력 -2', abilities: [] });
  def({ id: 'Lock', cls: 'memory', kind: 'object', atk: 0, hp: 8, text: 'For(2) 적 1명 다음 턴까지 봉쇄',
    abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : bestEnemyObj(G, u.owner); if (t) G.bind(t, 1); } }] });
  def({ id: 'Buffer', cls: 'memory', kind: 'object', atk: 0, hp: 11, text: 'Once 체력5이하 피격 시 체력 +4 회복',
    abilities: [{ kw: 'Once', trigger: 'onDamaged', fn: function (G, u) { if (G.curHp(u) <= 5) G.healInst(u, 4); } }] });
  def({ id: 'Sentinel', cls: 'memory', kind: 'object', atk: 3, hp: 8, text: 'When 적이 「옆칸」으로 다가올 때 3 피해',
    abilities: [{ kw: 'When', trigger: 'onEnterRange', fn: function (G, u, ctx) { if (ctx.mover) G.deal(ctx.mover, 3, { attacker: u }); } }] });
  def({ id: 'Barrier', cls: 'memory', kind: 'object', atk: 0, hp: 13, text: 'While 본체 「옆칸」에 있으면 본체 피해 -2', abilities: [] });
  def({ id: 'Const', cls: 'memory', kind: 'object', atk: 2, hp: 10, text: 'While 이동/변화 불가, 「옆칸」 적 봉쇄', abilities: [] });
  def({ id: 'Page', cls: 'memory', kind: 'object', atk: 1, hp: 9, text: 'Once 파괴 시 「홈칸」에 벽(공0 체8)',
    abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u) { G.summon(u.owner, 'Wall8', G.firstEmptyHome(u.owner)); } }] });
  def({ id: 'Register', cls: 'memory', kind: 'object', atk: 3, hp: 7, text: 'For(1) 적 1명 공격력 0',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : strongestEnemy(G, u.owner); if (t) G.setAtkZeroPerm(t); } }] });
  def({ id: 'Watchdog', cls: 'memory', kind: 'object', atk: 3, hp: 11, text: 'For(1) 「앞직선끝·첫」 적에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, ROWS, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else { var b = G.enemyBody(u.owner); if (inLineToBody(G, u)) G.deal(b, G.effAtk(u), { attacker: u }); } } }] });
  def({ id: 'Sweeper', cls: 'memory', kind: 'object', atk: 2, hp: 12, text: 'For(1) 「2칸이내」 적 1명 3 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyWithin(G, u, 2); if (t) G.deal(t, 3, { attacker: u }); } }] });
  def({ id: 'Pin', cls: 'memory', kind: 'object', atk: 1, hp: 8, require: { type: 'turnCount', n: 3 }, text: 'require 내 턴 3회+ 진행 · When 선언 시 적 1명 영구 봉쇄',
    abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = bestEnemyObj(G, u.owner); if (t) G.bind(t, 'perm'); } }] });
  def({ id: 'Persist', cls: 'memory', kind: 'object', atk: 0, hp: 12, text: 'While 다른 내 memory 전부 체력 +2', abilities: [] });

  // ---------------- memory pointers
  def({ id: 'free()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '본체 「2칸이내」 적 1명 6 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 6, { attacker: { owner: p } }); } });
  def({ id: 'lock()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '적 1명 2턴 봉쇄', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.bind(u, 2); } });
  def({ id: 'restore()', cls: 'memory', kind: 'pointer', need: 'allyOrBody', text: '아군/본체 체력 +6 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : G.body(p); if (u) G.healInst(u, 6); } });
  def({ id: 'barrier()', cls: 'memory', kind: 'pointer', need: 'none', text: '본체 다음 피해 10 막음', cast: function (G, p) { G.players[p].bodyShield += 10; } });
  def({ id: 'purge()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '적 1명 공격력 영구 0', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.setAtkZeroPerm(u); } });
  def({ id: 'reflect()', cls: 'memory', kind: 'pointer', need: 'none', text: '이번 턴 내 memory 피해 절반 반사', cast: function (G, p) { G.players[p].reflectTurn = G.turnNo; } });
  def({ id: 'compact()', cls: 'memory', kind: 'pointer', need: 'none', text: '내 memory 전부 체력 +3', cast: function (G, p) { G.allyObjects(p).filter(function (x) { return cardCls(x) === 'memory'; }).forEach(function (x) { G.buffHp(x, 3); }); } });
  def({ id: 'wall()', cls: 'memory', kind: 'pointer', need: 'none', text: '「통로칸」에 벽(공0 체10)', cast: function (G, p) { var cell = midEmpty(G); G.summon(p, 'Wall10', cell || G.firstEmptyHome(p)); } });
  def({ id: 'freeze()', cls: 'memory', kind: 'pointer', need: 'none', text: '내 인스턴스 「2칸이내」 적 전부 1턴 봉쇄', cast: function (G, p) { var seen = {}; G.allyObjects(p).forEach(function (a) { G.unitsInShape(a, square, 2).forEach(function (x) { if (x.owner !== p && x.type === 'object' && !seen[x.uid]) { seen[x.uid] = 1; G.bind(x, 1); } }); }); } });
  def({ id: 'fortify()', cls: 'memory', kind: 'pointer', need: 'none', castCondition: { type: 'classOnBoard', cls: 'memory', n: 2 }, text: 'memory 전부 체력 +4', cast: function (G, p) { G.allyObjects(p).filter(function (x) { return cardCls(x) === 'memory'; }).forEach(function (x) { G.buffHp(x, 4); }); } });

  // ---------------- process instances
  def({ id: 'Goto', cls: 'process', kind: 'object', atk: 5, hp: 6, text: 'For(1) 「앞직선2·첫」 적(벽 너머) 공격력만큼',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 2)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Hook', cls: 'process', kind: 'object', atk: 3, hp: 6, text: 'When 포인터 시전 시 「1칸이내」 적 1명 2 피해',
    abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u) { var t = nearestEnemyWithin(G, u, 1); if (t) G.deal(t, 2, { attacker: u }); } }] });
  def({ id: 'Pipe', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 포인터 시전 시 맞은 대상 추가 2 피해',
    abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function (G, u, ctx) { if (ctx.target && G.board[unitKey(G, ctx.target)]) G.deal(ctx.target, 2, { attacker: u }); } }] });
  def({ id: 'Proxy', cls: 'process', kind: 'object', atk: 3, hp: 6, text: 'If 포인터 시전 시 사거리 +1', abilities: [] });
  def({ id: 'Snipe', cls: 'process', kind: 'object', atk: 6, hp: 5, text: 'For(1) 「대각2」 적 1명 공격력만큼',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : G.unitsInShape(u, diagonal, 2).filter(function (x) { return x.owner !== u.owner && x.type === 'object'; })[0]; if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Jump', cls: 'process', kind: 'object', atk: 5, hp: 5, text: 'For(2) 「2칸이내」 빈 칸으로 점프 이동(벽·유닛 무시)',
    abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', ready: function (G, u) { return !!jumpTowardEnemy(G, u); }, fn: function (G, u, ch) { var k = unitKey(G, u); var dest = (ch.dest && !G.board[ch.dest] && k && cheb(k, ch.dest) <= 2) ? ch.dest : jumpTowardEnemy(G, u); if (dest) G.move(u, dest, true); } }] });
  def({ id: 'Inject', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 선언 시 적 1명 공격력 -3',
    abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = strongestEnemy(G, u.owner); if (t) G.buffAtk(t, -3); } }] });
  def({ id: 'Reroute', cls: 'process', kind: 'object', atk: 3, hp: 6, require: { type: 'turnCount', n: 4 }, text: 'require 내 턴 4회+ 진행 · For(1) 적 1명 「옆칸」 빈 칸으로 강제 이동',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : bestEnemyObj(G, u.owner); if (t) G.shoveToEmpty(t, u.owner); } }] });
  def({ id: 'Trace', cls: 'process', kind: 'object', atk: 2, hp: 6, text: 'While 「1칸이내」 적 수만큼 공격력 증가', abilities: [] });
  def({ id: 'Probe', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'For(1) 「2칸이내」 가장 먼 적 1명에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var k = unitKey(G, u); var t = (ch.target && G.board[ch.target] && k && cheb(ch.target, k) <= 2) ? G.board[ch.target] : farthestEnemy(G, u, 2); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Async', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'For(1) 턴 중 자기 「1칸이동」',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onActive', ready: function (G, u) { return G.moveCells(u).length > 0; }, fn: function (G, u, ch) { if (ch.dest && G.moveCells(u).indexOf(ch.dest) >= 0) G.move(u, ch.dest, true); } }] });
  def({ id: 'Callback', cls: 'process', kind: 'object', atk: 3, hp: 5, text: 'When 파괴 시 「1칸이내」 적 1명 5 피해',
    abilities: [{ kw: 'When', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); var t = G.objects().filter(function (x) { return x.owner !== u.owner && cheb(unitKey(G, x), ctx.atKey) <= 1; })[0]; if (t) G.deal(t, 5, { attacker: u }); } }] });
  def({ id: 'Patch', cls: 'process', kind: 'object', atk: 3, hp: 7, text: 'For(1) 아군 1장 체력 +3',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : woundedAlly(G, u.owner); if (t) G.buffHp(t, 3); } }] });
  def({ id: 'Vector', cls: 'process', kind: 'object', atk: 6, hp: 5, require: { type: 'classOnBoard', cls: 'process', n: 2 }, text: 'require 내 process 2개+ 필드에 존재 · For(1) 「앞직선3·전부」 공격력만큼',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var k = unitKey(G, u), q = P(k), cells = line(q[0], q[1], 0, fwd(u.owner), 3); cells.map(function (c) { return G.board[c]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, G.effAtk(u), { attacker: u }); }); } }] });
  def({ id: 'Lambda', cls: 'process', kind: 'object', atk: 4, hp: 5, text: 'When 포인터 시전 시 다음 포인터 사거리 +2', abilities: [{ kw: 'When', trigger: 'onPointerCast', fn: function () {} }] });

  // ---------------- process pointers
  def({ id: 'memcpy()', cls: 'process', kind: 'pointer', need: 'enemy', castCondition: { type: 'turnCount', n: 5 }, text: '적 1명을 「옆칸」 빈 칸으로 강제 이동 (뒤쪽 우선, 막히면 옆으로)',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk); return ortho(q[0], q[1]).some(function (x) { return !G.board[x]; }); },
    cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.shoveToEmpty(u, p); } });
  def({ id: 'goto()', cls: 'process', kind: 'pointer', need: 'allyProcess', castCondition: { type: 'turnCount', n: 4 }, text: '내 process 1장 「2칸이내」 빈 칸 순간이동',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner !== p) return false; return !!jumpTowardEnemy(G, u); },
    cast: function (G, p, tk, o) { var u = G.board[tk]; var dest = (o.dest && cheb(tk, o.dest) <= 2) ? o.dest : jumpTowardEnemy(G, u); if (u && dest && !G.board[dest]) G.move(u, dest, true); } });
  def({ id: 'snipe()', cls: 'process', kind: 'pointer', need: 'none', text: '「앞직선3·첫」 적 7 피해', cast: function (G, p, tk, o) { var t = G.firstEnemyInLine(bodyKey(p), p, 3 + (o.rangeBonus || 0), false); if (t) G.deal(t, 7, { attacker: { owner: p } }); } });
  def({ id: 'swap()', cls: 'process', kind: 'pointer', need: 'twoAlly', text: '내 인스턴스 2장 위치 교환', cast: function (G, p, tk, o) { var a = G.board[tk], b = o.second ? G.board[o.second] : null; if (!b) { var allies = G.allyObjects(p); b = allies[0] === a ? allies[1] : allies[0]; } if (a && b) { var ka = unitKey(G, a), kb = unitKey(G, b); G.board[ka] = b; G.board[kb] = a; } } });
  def({ id: 'inject()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 1명 공격력 -4 영구', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.buffAtk(u, -4); } });
  def({ id: 'pull()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 1명을 내 본체 쪽으로 「끌어당기기」 (내 앞칸이 비어야 함)',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk), nr = q[1] - fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
    cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.pullToward(u, p); } });
  def({ id: 'push()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 1명을 적 진영 쪽으로 「밀어내기」 (적 뒤칸이 비어야 함)',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk), nr = q[1] + fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
    cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.pushAway(u, p); } });
  def({ id: 'chain()', cls: 'process', kind: 'pointer', need: 'enemy', text: '지정 적과 뒤 직선 적 각 4 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 4, { attacker: { owner: p } }); var q = P(tk), dr = -fwd(p); for (var k = 1; k <= 3; k++) { var nk = K(q[0], q[1] + dr * k); var v = G.board[nk]; if (v && v.owner !== p && v.type === 'object') G.deal(v, 4, { attacker: { owner: p } }); } } });
  def({ id: 'proxy()', cls: 'process', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 6 }, text: '다음 포인터 한 번 더 발동', cast: function (G, p) { G.turnFlags.proxyRepeat = true; } });
  def({ id: 'trace()', cls: 'process', kind: 'pointer', need: 'allyProcess', text: '내 process 1장 적 근처 점프 + 그 적 2 피해', cast: function (G, p, tk, o) { var u = G.board[tk]; var en = bestEnemyObj(G, p); if (u && en) { var ek = unitKey(G, en), q = P(ek), dest = ortho(q[0], q[1]).filter(function (x) { return !G.board[x]; })[0]; if (dest) G.move(u, dest, true); G.deal(en, 2, { attacker: u }); } } });

  // ---------------- generic instances
  def({ id: 'Null', cls: 'generic', kind: 'object', atk: 0, hp: 5, text: '능력 없음(벽)' });
  def({ id: 'Echo', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'When 선언 시 「옆칸」 적 2 피해', abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { dmgAdjEnemies(G, u, 2); } }] });
  def({ id: 'Noop', cls: 'generic', kind: 'object', atk: 2, hp: 4, text: '능력 없음' });
  def({ id: 'Token', cls: 'generic', kind: 'object', atk: 2, hp: 3, text: 'Once 파괴 시 「옆칸」 적 2 피해', abilities: [{ kw: 'Once', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); ortho(p[0], p[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 2, { attacker: u }); }); } }] });
  def({ id: 'Bit', cls: 'generic', kind: 'object', atk: 1, hp: 2, text: 'For(3) 「옆칸」 적 공격력만큼', abilities: [{ kw: 'For', forCount: 3, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = pickAdjEnemy(G, u, ch); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Byte', cls: 'generic', kind: 'object', atk: 4, hp: 4, text: '능력 없음(표준)' });
  def({ id: 'Flag', cls: 'generic', kind: 'object', atk: 2, hp: 5, text: 'While 「옆칸」 아군 공격력 +1', abilities: [] });
  def({ id: 'Var', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'If 턴 시작 시 자기 공격력 +1', abilities: [{ kw: 'If', trigger: 'onTurnStart', fn: function (G, u) { G.buffAtk(u, 1); } }] });
  def({ id: 'Value', cls: 'generic', kind: 'object', atk: 5, hp: 3, text: '능력 없음(공격형)' });
  def({ id: 'Cast', cls: 'generic', kind: 'object', atk: 3, hp: 3, text: 'When 선언 시 적 1명 공격력 -1', abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { var t = strongestEnemy(G, u.owner); if (t) G.buffAtk(t, -1); } }] });
  def({ id: 'Int', cls: 'generic', kind: 'object', atk: 4, hp: 5, text: '능력 없음(단단)' });
  def({ id: 'Bool', cls: 'generic', kind: 'object', atk: 2, hp: 3, text: 'Once 선언 시 아군 1장 체력 +2', abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { var t = woundedAlly(G, u.owner) || G.adj(u).filter(function (x) { return x.owner === u.owner; })[0]; if (t) G.buffHp(t, 2); } }] });
  def({ id: 'Copy', cls: 'generic', kind: 'object', atk: 3, hp: 3, text: 'Once 선언 시 자기 공격력 +2', abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.buffAtk(u, 2); } }] });
  def({ id: 'Merge', cls: 'generic', kind: 'object', atk: 4, hp: 4, text: 'When 파괴 시 「옆칸」 적 4 피해', abilities: [{ kw: 'When', trigger: 'onDeath', fn: function (G, u, ctx) { var p = P(ctx.atKey); ortho(p[0], p[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== u.owner; }).forEach(function (x) { G.deal(x, 4, { attacker: u }); }); } }] });
  def({ id: 'Delete', cls: 'generic', kind: 'object', atk: 5, hp: 2, text: 'For(1) 「대각2」 적 1명에게 공격력만큼', abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : G.unitsInShape(u, diagonal, 2).filter(function (x) { return x.owner !== u.owner && x.type === 'object'; })[0]; if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Swap', cls: 'generic', kind: 'object', atk: 3, hp: 4, text: 'For(1) 턴 중 자기 「옆칸」 빈 칸 「1칸이동」', abilities: [{ kw: 'For', forCount: 1, trigger: 'onActive', ready: function (G, u) { return G.moveCells(u).length > 0; }, fn: function (G, u, ch) { if (ch.dest && G.moveCells(u).indexOf(ch.dest) >= 0) G.move(u, ch.dest, true); } }] });
  def({ id: 'Ping', cls: 'generic', kind: 'object', atk: 2, hp: 4, text: 'For(2) 「2칸이내」 적 1명 2 피해', abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : nearestEnemyWithin(G, u, 2); if (t) G.deal(t, 2, { attacker: u }); } }] });
  def({ id: 'Loop', cls: 'generic', kind: 'object', atk: 3, hp: 5, text: 'For(2) 「옆칸」 적 공격력만큼', abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = pickAdjEnemy(G, u, ch); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Stub', cls: 'generic', kind: 'object', atk: 1, hp: 6, text: 'While 「옆칸」 적 공격력 -1', abilities: [] });
  def({ id: 'Idle', cls: 'generic', kind: 'object', atk: 0, hp: 7, text: '능력 없음(큰 벽)' });
  // tokens / walls
  def({ id: 'Token2', cls: 'generic', kind: 'object', atk: 2, hp: 2, text: '분신' });
  def({ id: 'Token5', cls: 'generic', kind: 'object', atk: 5, hp: 2, text: '분신' });
  def({ id: 'Wall8', cls: 'memory', kind: 'object', atk: 0, hp: 8, text: '벽' });
  def({ id: 'Wall10', cls: 'memory', kind: 'object', atk: 0, hp: 10, text: '벽' });
  def({ id: 'HalfClone', cls: 'generic', kind: 'object', atk: 2, hp: 2, text: '복제' });

  // ---------------- generic pointers
  def({ id: 'malloc()', cls: 'generic', kind: 'pointer', need: 'none', text: '「홈칸」에 분신(공2 체3)', cast: function (G, p) { G.summon(p, 'Token2b', G.firstEmptyHome(p)); } });
  def({ id: 'Token2b', cls: 'generic', kind: 'object', atk: 2, hp: 3, text: '분신' });
  def({ id: 'kill()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 5 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 5, { attacker: { owner: p } }); } });
  def({ id: 'ping()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 3 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 3, { attacker: { owner: p } }); } });
  def({ id: 'sync()', cls: 'generic', kind: 'pointer', need: 'allyOrBody', text: '아군 1장 체력 +4 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : woundedAlly(G, p); if (u) G.healInst(u, 4); } });
  def({ id: 'flush()', cls: 'generic', kind: 'pointer', need: 'none', text: '내 인스턴스 「옆칸」 적 전부 3 피해', cast: function (G, p) { var seen = {}; G.allyObjects(p).forEach(function (a) { G.adj(a).forEach(function (x) { if (x.owner !== p && x.type === 'object' && !seen[x.uid]) { seen[x.uid] = 1; G.deal(x, 3, { attacker: { owner: p } }); } }); }); } });
  def({ id: 'shift()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 「1칸이동」', cast: function (G, p, tk, o) { var u = G.board[tk]; if (u && o.dest && G.moveCells(u).indexOf(o.dest) >= 0) G.move(u, o.dest, true); else if (u) { var d = G.moveCells(u)[0]; if (d) G.move(u, d, true); } } });
  def({ id: 'drop()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명을 적 진영 쪽으로 「밀어내기」 (적 뒤칸이 비어야 함)',
    castValid: function (G, p, tk) { var u = G.board[tk]; if (!u || u.owner === p) return false; var q = P(tk), nr = q[1] + fwd(p); return inB(q[0], nr) && !G.board[K(q[0], nr)]; },
    cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.pushAway(u, p); } });
  def({ id: 'assert()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 공격력 -2', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.buffAtk(u, -2); } });
  def({ id: 'grep()', cls: 'generic', kind: 'pointer', need: 'none', text: '카드 1장 뽑기', cast: function (G, p) { G.draw(p, 1); } });
  def({ id: 'yield()', cls: 'generic', kind: 'pointer', need: 'none', castCondition: { type: 'turnCount', n: 5 }, text: '이번 턴 행동 +1', cast: function (G, p) { G.actions++; } });
  def({ id: 'wait()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 1턴 봉쇄', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.bind(u, 1); } });
  def({ id: 'cast()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 공격력 +3', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.buffAtk(u, 3); } });
  def({ id: 'throw()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 4, 「옆칸」 2 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 4, { attacker: { owner: p } }); var q = P(tk); ortho(q[0], q[1]).map(function (k) { return G.board[k]; }).filter(function (x) { return x && x.owner !== p; }).forEach(function (x) { G.deal(x, 2, { attacker: { owner: p } }); }); } });
  def({ id: 'catch()', cls: 'generic', kind: 'pointer', need: 'none', text: '본체 다음 피해 6 막음', cast: function (G, p) { G.players[p].bodyShield += 6; } });
  def({ id: 'bind()', cls: 'generic', kind: 'pointer', need: 'enemy', castCondition: { type: 'turnCount', n: 4 }, text: '적 1명 2턴 봉쇄', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.bind(u, 2); } });
  def({ id: 'echo()', cls: 'generic', kind: 'pointer', need: 'cell', text: '떨어진 칸 1개 3 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u && u.owner !== p) G.deal(u, 3, { attacker: { owner: p } }); } });
  def({ id: 'patch()', cls: 'generic', kind: 'pointer', need: 'ally', text: '아군 1장 체력 +3, 공격력 +1', cast: function (G, p, tk) { var u = G.board[tk]; if (u) { G.buffHp(u, 3); G.buffAtk(u, 1); } } });
  def({ id: 'clear()', cls: 'generic', kind: 'pointer', need: 'enemy', text: '적 1명 1턴 공격력 0', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.setAtkZeroTurns(u, 1); } });
  def({ id: 'copy()', cls: 'generic', kind: 'pointer', need: 'none', text: '손의 generic 1장 복사', cast: function (G, p) { var h = G.players[p].hand.filter(function (id) { return CARDS[id].cls === 'generic'; }); if (h.length && G.players[p].hand.length < 10) G.players[p].hand.push(h[0]); } });
  def({ id: 'exit()', cls: 'generic', kind: 'pointer', need: 'none', castCondition: { type: 'selfBodyHP', cmp: '<=', n: 18 }, text: '모든 적 3 피해', cast: function (G, p) { G.enemyObjects(p).forEach(function (x) { G.deal(x, 3, { attacker: { owner: p } }); }); } });

  // ---------------- OP cards
  def({ id: 'Singleton', cls: 'memory', kind: 'object', atk: 6, hp: 20, deckLimit: 1,
    require: { type: 'or', a: { type: 'turnCount', n: 10 }, b: { type: 'classOnBoard', cls: 'memory', n: 4 } },
    text: 'require 내 턴 10회+ 진행 또는 memory 4개+ 필드에 존재 · Once 선언 시 적 전부 6 피해 · While 본체 피해 절반',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.enemyObjects(u.owner).forEach(function (x) { G.deal(x, 6, { attacker: u }); }); } }] });
  def({ id: 'Mainframe', cls: 'thread', kind: 'object', atk: 4, hp: 4, deckLimit: 1, require: { type: 'classOnBoard', cls: 'thread', n: 5 },
    text: 'require 내 thread 5개+ 필드에 존재 · Once 선언 시 내 thread 전부 공격력 +4',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.allyObjects(u.owner).filter(function (x) { return cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, 4); }); } }] });
  def({ id: 'Singularity', cls: 'process', kind: 'object', atk: 5, hp: 6, deckLimit: 1, require: { type: 'pointersCast', n: 6 },
    text: 'require 포인터 6회+ 시전 · Once 선언 시 이번 턴 포인터 1장 무소모 추가 시전 + 사거리 +3',
    abilities: [{ kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.turnFlags.extraPointer = (G.turnFlags.extraPointer || 0) + 1; G.turnFlags.extraPointerRange = 3; } }] });
  def({ id: 'Overlord', cls: 'generic', kind: 'object', atk: 8, hp: 8, deckLimit: 1, require: { type: 'and', a: { type: 'turnCount', n: 8 }, b: { type: 'selfBodyHP', cmp: '>=', n: 35 } },
    text: 'require 내 턴 8회+ 진행 + 본체 HP 35+ · Once 선언 시 적 본체 10 피해 · For(3) 적 1명 공격력만큼',
    abilities: [
      { kw: 'Once', trigger: 'onSummon', fn: function (G, u) { G.deal(G.enemyBody(u.owner), 10, { attacker: u }); } },
      { kw: 'For', forCount: 3, trigger: 'onTurnStart', fn: function (G, u, ch) { var t = ch.target ? G.board[ch.target] : bestEnemyObj(G, u.owner); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }
    ] });
  def({ id: 'Hivemind', cls: 'thread', kind: 'object', atk: 3, hp: 3, deckLimit: 1, deckRule: 'threadSingle',
    text: '덱제한 thread단일 · While 옆아군강화 효과 전체 적용(상한 +6)', abilities: [] });
  def({ id: 'Bedrock', cls: 'memory', kind: 'object', atk: 0, hp: 15, deckLimit: 1, deckRule: 'memorySingle',
    text: '덱제한 memory단일 · While 내 memory 받는 피해 절반', abilities: [] });
  def({ id: 'Conduit', cls: 'process', kind: 'object', atk: 4, hp: 5, deckLimit: 1, deckRule: 'processSingle',
    text: '덱제한 process단일 · While 턴당 첫 포인터 효과 2회', abilities: [] });
  def({ id: 'Polymorph', cls: 'generic', kind: 'object', atk: 4, hp: 4, deckLimit: 1,
    text: '덱당1 · While 단일클래스 덱이면 내 인스턴스 전부 공격력/체력 +1', abilities: [] });

  // ---- effect helper targeters
  function pickAdjEnemy(G, u, ch) { if (ch && ch.target && G.board[ch.target]) return G.board[ch.target]; var e = G.adj(u).filter(function (x) { return x.owner !== u.owner && x.type === 'object'; }); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }
  function strongestEnemy(G, owner) { var e = G.enemyObjects(owner); e.sort(function (a, b) { return G.effAtk(b) - G.effAtk(a); }); return e[0] || null; }
  function nearestEnemyWithin(G, u, n) { var k = unitKey(G, u); if (!k) return null; var e = G.enemyObjects(u.owner).filter(function (x) { var xk = unitKey(G, x); return xk && cheb(xk, k) <= n; }); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }
  function farthestEnemy(G, u, n) { var k = unitKey(G, u); if (!k) return null; var e = G.enemyObjects(u.owner).filter(function (x) { var xk = unitKey(G, x); return xk && (n == null || cheb(xk, k) <= n); }); e.sort(function (a, b) { return manh(unitKey(G, b), k) - manh(unitKey(G, a), k); }); return e[0] || null; }
  function woundedAlly(G, owner) { var a = G.allyObjects(owner).filter(function (x) { return x.dmg > 0; }); a.sort(function (x, y) { return y.dmg - x.dmg; }); return a[0] || null; }
  function inLineToBody(G, u, n) { var k = unitKey(G, u), q = P(k); var bk = bodyKey(1 - u.owner), b = P(bk); if (q[0] !== b[0]) return false; var dist = Math.abs(b[1] - q[1]); if (n && dist > n) return false; return (b[1] - q[1]) * fwd(u.owner) > 0; }
  // §7 지정 원거리 상한: 이동 대상 유닛 기준 「2칸이내」(square(2)) 빈 칸 중 적 본체에 가장 가까운 칸. 후보 0칸이면 불발(null).
  function jumpTowardEnemy(G, u) { var k = unitKey(G, u); if (!k) return null; var q = P(k), bk = bodyKey(1 - u.owner); var cands = square(q[0], q[1], 2).filter(function (x) { return !G.board[x]; }); if (!cands.length) return null; cands.sort(function (a, b) { return manh(a, bk) - manh(b, bk); }); return cands[0]; }
  function midEmpty(G) { for (var r = 2; r <= 3; r++) for (var c = 1; c <= COLS; c++) if (!G.board[K(c, r)]) return K(c, r); return null; }

  // ---------------- content pack v2 (추가 카드) — 검증된 헬퍼 패턴 재사용
  def({ id: 'Spike', cls: 'thread', kind: 'object', atk: 7, hp: 2, text: 'For(2) 「앞직선2·첫」 적에게 공격력만큼 피해',
    abilities: [{ kw: 'For', forCount: 2, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, false); if (t) G.deal(t, G.effAtk(u), { attacker: u }); else if (inLineToBody(G, u, 2)) G.deal(G.enemyBody(u.owner), G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'Surge', cls: 'thread', kind: 'object', atk: 4, hp: 4, text: 'When 소환 시 「옆칸」에 아군 thread 있으면 공격력 +3',
    abilities: [{ kw: 'When', trigger: 'onSummon', fn: function (G, u) { if (G.adj(u).some(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; })) G.buffAtk(u, 3); } }] });
  def({ id: 'Ward', cls: 'memory', kind: 'object', atk: 0, hp: 13, text: 'When 피격 시 가해 인스턴스에 2 반사',
    abilities: [{ kw: 'When', trigger: 'onDamaged', fn: function (G, u, ctx) { var a = ctx.attacker; if (a && a.uid != null && G.board[unitKey(G, a)]) G.deal(a, 2, { attacker: u }); } }] });
  def({ id: 'Trap', cls: 'memory', kind: 'object', atk: 1, hp: 11, text: 'When 「옆칸」에 적 진입 시 4 피해',
    abilities: [{ kw: 'When', trigger: 'onEnterRange', fn: function (G, u, ctx) { if (ctx.mover) G.deal(ctx.mover, 4, { attacker: u }); } }] });
  def({ id: 'Cursor', cls: 'process', kind: 'object', atk: 4, hp: 4, text: 'For(1) 「앞직선2·첫」 적에게 공격력 피해',
    abilities: [{ kw: 'For', forCount: 1, trigger: 'onTurnStart', fn: function (G, u) { var t = G.firstEnemyInLine(unitKey(G, u), u.owner, 2, true); if (t) G.deal(t, G.effAtk(u), { attacker: u }); } }] });
  def({ id: 'volt()', cls: 'thread', kind: 'pointer', need: 'enemy', text: '적 1명 6 피해', cast: function (G, p, tk) { var u = G.board[tk]; if (u) G.deal(u, 6, { attacker: { owner: p } }); } });
  def({ id: 'siphon()', cls: 'memory', kind: 'pointer', need: 'enemy', text: '적 1명 4 피해 + 내 본체 4 회복', cast: function (G, p, tk) { var u = G.board[tk]; if (u) { G.deal(u, 4, { attacker: { owner: p } }); G.healInst(G.body(p), 4); } } });
  def({ id: 'glitch()', cls: 'process', kind: 'pointer', need: 'enemy', text: '적 1명에게 4 피해 후 적 진영 쪽으로 「밀어내기」 (뒤칸이 막혔으면 피해만)', cast: function (G, p, tk) { var u = G.board[tk]; if (!u) return; G.deal(u, 4, { attacker: { owner: p } }); if (G.board[tk]) G.pushAway(u, p); } });
  def({ id: 'mend()', cls: 'generic', kind: 'pointer', need: 'allyOrBody', text: '아군/본체 체력 +5 회복', cast: function (G, p, tk) { var u = tk ? G.board[tk] : (woundedAlly(G, p) || G.body(p)); if (u) G.healInst(u, 5); } });
  };
})();
