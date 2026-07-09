/*
 * RUNTIME TCG — rule-accurate game engine.
 * Single source of truth: tcg-ruleset-v1.md (rules) + tcg-seed-cards-v4.md (cards)
 * + tcg-test-decks-v1.md (decks). Pure logic, no DOM. Works in node and browser.
 *
 * Board: 5 cols x 4 rows, shared. Bodies: top (3,1), bottom (3,4), HP 100.
 * Players: 0 = bottom (home row 4, forward = up), 1 = top (home row 1, forward = down).
 */
(function (root) {
  'use strict';

  // ----------------------------------------------------------------- RNG (seedable)
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 0xffffffff;
    };
  }

  // ----------------------------------------------------------------- board helpers
  var COLS = 5, ROWS = 4;
  var BODY_HP = 40; // 100 → 50 (basic-attack rule, §5) → 40 (pacing: games felt loose at 50)
  var MAX_ACTION_BUDGET = 9; // 한 턴 총 행동 상한(기본 2 + 추가 액션 카드 스택, Conduit 콤보 등). 구 4 → 9.

  // ----------------------------------------------------------------- RUNTIME ENV (판 전체 환경 효과)
  // 매 게임 1종이 결정적으로 지정된다(온라인은 seed 파생 → 양 클라 동일). clear 는 랜덤 풀에서 제외(무언가는 반드시 일어난다).
  var WEATHERS_ALL = ['overclock', 'throttle', 'memleak', 'ctxswitch', 'deadlock'];
  var WEATHER_HAZARD_START = 8; // memleak 발동 시작 ply(초반 숨통)
  var WALL_OWNER = 2;           // 중립 벽 소유자(플레이어 0/1 아님)
  // FNV-1a — 문자열/숫자 seed 모두 안전한 결정적 해시(rng 스트림을 건드리지 않음).
  function hashStr(s) { s = '' + s; var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function weatherFromSeed(seed) { return WEATHERS_ALL[hashStr(seed + '|w') % WEATHERS_ALL.length]; }
  function inB(c, r) { return c >= 1 && c <= COLS && r >= 1 && r <= ROWS; }
  function K(c, r) { return c + ',' + r; }
  function P(k) { var a = k.split(','); return [+a[0], +a[1]]; }
  function bodyKey(owner) { return owner === 0 ? '3,4' : '3,1'; }
  function homeRow(owner) { return owner === 0 ? 4 : 1; }
  function fwd(owner) { return owner === 0 ? -1 : 1; } // forward dr

  // ----------------------------------------------------------------- range grammar (§9)
  // Each returns array of in-board cell keys, EXCLUDING origin unless noted.
  function ortho(c, r) {
    var out = [], d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) { var nc = c + d[i][0], nr = r + d[i][1]; if (inB(nc, nr)) out.push(K(nc, nr)); }
    return out;
  }
  function around8(c, r) {
    var out = [];
    for (var dc = -1; dc <= 1; dc++) for (var dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue; if (inB(c + dc, r + dr)) out.push(K(c + dc, r + dr));
    }
    return out;
  }
  function cross(c, r, n) {
    var out = [], d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) for (var k = 1; k <= n; k++) { var nc = c + d[i][0] * k, nr = r + d[i][1] * k; if (inB(nc, nr)) out.push(K(nc, nr)); }
    return uniq(out);
  }
  function square(c, r, n) {
    var out = [];
    for (var dc = -n; dc <= n; dc++) for (var dr = -n; dr <= n; dr++) { if (!dc && !dr) continue; if (inB(c + dc, r + dr)) out.push(K(c + dc, r + dr)); }
    return out;
  }
  function ring(c, r, n) {
    var out = [];
    for (var dc = -n; dc <= n; dc++) for (var dr = -n; dr <= n; dr++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) === n && inB(c + dc, r + dr)) out.push(K(c + dc, r + dr));
    }
    return out;
  }
  function diagonal(c, r, n) {
    var out = [], d = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (var i = 0; i < 4; i++) for (var k = 1; k <= n; k++) { var nc = c + d[i][0] * k, nr = r + d[i][1] * k; if (inB(nc, nr)) out.push(K(nc, nr)); }
    return out;
  }
  function line(c, r, dc, dr, n) {
    var out = [];
    for (var k = 1; k <= n; k++) { var nc = c + dc * k, nr = r + dr * k; if (!inB(nc, nr)) break; out.push(K(nc, nr)); }
    return out;
  }
  function knight(c, r) {
    var out = [], d = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
    for (var i = 0; i < 8; i++) if (inB(c + d[i][0], r + d[i][1])) out.push(K(c + d[i][0], r + d[i][1]));
    return out;
  }
  function uniq(a) { var s = {}, o = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } return o; }
  function cheb(k1, k2) { var a = P(k1), b = P(k2); return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
  function manh(k1, k2) { var a = P(k1), b = P(k2); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

  // ============================================================== GAME
  var DEFAULT_TURN_CAP = 80; // rules v12: 80턴 상한 — 50은 각자 25드로우 만에 종료돼 피로(덱 소진) 발동 전 HP판정이 되던 문제. 80이면 덱 소진→피로 누적으로 정상 결착.
  function Game(opts) {
    opts = opts || {};
    this.rng = makeRng(opts.seed || 12345);
    this.board = {};           // key -> unit
    this.players = [newPlayer(0), newPlayer(1)];
    this.players[WALL_OWNER] = newPlayer(WALL_OWNER); // 중립 슬롯: destroy/deal/polymorphActive 의 players[owner] 인덱싱이 owner=2 에도 안전(빈 덱·deckMeta null → 오라 자동 무효). players 를 길이로 순회하는 코드 없음.
    this.weather = null;       // RUNTIME WEATHER — newGame 에서 지정
    this.turnNo = 0;           // ply counter
    this.active = (opts.first != null ? opts.first : 0);
    this.firstPlayer = this.active;
    this.actions = 0;
    this.uidSeq = 1;
    this.log = [];
    this.winner = undefined;   // 0 | 1 | 'draw' | undefined
    this.TURN_CAP = opts.turnCap || DEFAULT_TURN_CAP;
    // 스톨 방지: 덱을 소진한 플레이어는 드로우 대신 본체 3 피해(피로) — draw() 참조. (구 '런타임 과열' 대체)
    this.listeners = [];
    this.pending = null;       // ui hint
    this.turnFlags = {};       // per-turn transient flags for active player
    this._resolveSeen = null;  // §5 clamp guard
    this.forUsesThisTurn = {}; // uid -> bool (For used this player-turn)
    // 선후공 보정 config(rules v12): 선공 5·후공 5, 선공 1턴차 드로우 스킵 없음.
    // 80턴 결착(피로) 메타에선 "적게 뽑는 쪽이 늦게 소진→피로 늦음"이라 선공 드로우 스킵이 선공 이점을
    // 오히려 키웠음(64%). 스킵 제거로 덱중립하게 ~57%로 완화(본체HP 보정은 요새덱 펌핑 부작용이라 미채택).
    this._cfg = Object.assign({ openFirst: 5, openSecond: 5, firstSkipDraw: false, secondBodyBonus: 0, secondComp: true }, opts);
  }
  function newPlayer(i) {
    return { idx: i, deck: [], hand: [], graveyard: [], destroyedAlly: 0, pointersCast: 0, turnsTaken: 0,
      deckMeta: null, bodyShield: 0, fatigueNext: 3, deferredActions: 0, pointerFree: false };
  }

  Game.prototype.emit = function () { for (var i = 0; i < this.listeners.length; i++) try { this.listeners[i](this); } catch (e) {} };
  // lightweight animation event hook: UI sets G.onfx to receive {type,...} effects
  Game.prototype.fx = function (ev) { if (typeof this.onfx === 'function') { try { this.onfx(ev); } catch (e) {} } };
  Game.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Game.prototype.note = function (m) { this.log.unshift('[' + this.turnNo + '] ' + m); if (this.log.length > 80) this.log.pop(); };

  // ---- unit creation
  Game.prototype.makeUnit = function (owner, cardId) {
    var card = CARDS[cardId];
    return { uid: this.uidSeq++, owner: owner, cardId: cardId, type: card.kind === 'pointer' ? 'pointer' : 'object',
      baseAtk: card.atk || 0, baseHp: card.hp || 0, atkMod: 0, hpMod: 0, dmg: 0,
      atkZero: false, atkZeroUntil: 0, boundUntil: 0, boundPerm: false, blockFull: false, tempAtk: [],
      onceUsed: {}, summonedTurn: this.turnNo, attackedTurn: -1, bonusAtkTurn: -1, bonusAtk: 0, flags: {} };
  };
  Game.prototype.body = function (owner) { return this.board[bodyKey(owner)]; };

  // ---- effective stats (dynamic auras)
  Game.prototype.effMaxHp = function (u) {
    var hp = u.baseHp + u.hpMod;
    if (u.type !== 'object') return hp;
    // Persist aura: each friendly Persist (other) grants +2 to my memory units
    if (cardCls(u) === 'memory') hp += 2 * this.countBoard(function (x) { return x.owner === u.owner && x.uid !== u.uid && x.cardId === 'Persist'; });
    // Polymorph: 내 필드 클래스 3종+ 이면 +1
    if (this.polymorphActive(u.owner)) hp += 1;
    return Math.max(1, hp);
  };
  Game.prototype.curHp = function (u) { return this.effMaxHp(u) - u.dmg; };
  Game.prototype.effAtk = function (u) {
    if (u.type !== 'object') return 0;
    if (u.atkZero || u.atkZeroUntil > this.turnNo) return 0;
    var a = u.baseAtk + u.atkMod;
    // self While auras
    if (u.cardId === 'Race') { if (this.adj(u).some(function (x) { return x.owner === u.owner && x.uid !== u.uid && cardCls(x) === 'thread'; })) a += 3; }
    if (u.cardId === 'Overflow') { a += 2 * this.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).length; }
    if (u.cardId === 'Cannon') { a += 2 * this.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'memory'; }).length; }
    if (u.cardId === 'Profiler') { a += this.unitsInShape(u, square, 1).filter(function (x) { return x.owner !== u.owner && x.type === 'object'; }).length; }
    if (u.cardId === 'Cluster') { a += 2 * this.countBoard(function (x) { return x.owner === u.owner && x.token; }); }
    // neighbor-granted auras
    var hive = this.hivemindActive(u.owner) && cardCls(u) === 'thread';
    var grant = 0;
    var allies = hive ? this.boardUnits().filter(function (x) { return x.owner === u.owner; }) : this.adj(u);
    allies.forEach(function (x) {
      if (x.uid === u.uid) return;
      if (x.owner === u.owner) {
        if (x.cardId === 'Flag' && (hive ? cardCls(u) === 'thread' : true)) grant += 1;            // +1 ally
        if (x.cardId === 'Race' && hive && cardCls(u) === 'thread') grant += 0; // Race buffs only itself
      }
    });
    if (hive) grant = Math.min(grant, 6);
    a += grant;
    // enemy debuff auras (adjacent)
    this.adj(u).forEach(function (x) {
      if (x.owner !== u.owner) {
        if (x.cardId === 'Stack') a -= 2;
        if (x.cardId === 'Stub') a -= 1;
      }
    });
    if (this.polymorphActive(u.owner)) a += 1;
    // 임시 공격력 디버프(inject 등 「-N (N턴)」)
    if (u.tempAtk && u.tempAtk.length) { var self2 = this; u.tempAtk.forEach(function (t) { if (t.until > self2.turnNo) a -= t.amt; }); }
    // RUNTIME WEATHER — 전역 공격력 보정(중립 벽 제외)
    if (!(u.flags && u.flags.wall)) { if (this.weather === 'overclock') a += 1; else if (this.weather === 'throttle') a -= 1; }
    return Math.max(0, a);
  };
  Game.prototype.debuffAtkTurns = function (u, amt, turns) { if (u.type !== 'object') return; u.tempAtk = u.tempAtk || []; u.tempAtk.push({ amt: amt, until: this.turnNo + turns * 2 }); this._statFx(u, 'atk', -amt); };

  // ---- board scans
  Game.prototype.boardUnits = function () { var o = [], b = this.board; for (var k in b) if (b.hasOwnProperty(k)) o.push(b[k]); return o; };
  Game.prototype.objects = function () { return this.boardUnits().filter(function (u) { return u.type === 'object'; }); };
  Game.prototype.countBoard = function (pred) { return this.boardUnits().filter(pred).length; };
  Game.prototype.adj = function (u) { var k = unitKey(this, u); if (!k) return []; var p = P(k), self = this; return ortho(p[0], p[1]).map(function (kk) { return self.board[kk]; }).filter(Boolean); };
  Game.prototype.around = function (u) { var k = unitKey(this, u); if (!k) return []; var p = P(k), self = this; return around8(p[0], p[1]).map(function (kk) { return self.board[kk]; }).filter(Boolean); };
  Game.prototype.unitsInShape = function (u, fn, n) {
    var k = unitKey(this, u); if (!k) return []; var p = P(k), cells = fn(p[0], p[1], n), self = this;
    return cells.map(function (kk) { return self.board[kk]; }).filter(Boolean);
  };
  function unitKey(G, u) { var b = G.board; for (var k in b) if (b.hasOwnProperty(k) && b[k] === u) return k; return null; }
  // 분신은 생성한 카드의 클래스를 상속(clsOverride). tokenRules D1=A안.
  function cardCls(u) { return u ? (u.clsOverride || (CARDS[u.cardId] ? CARDS[u.cardId].cls : undefined)) : undefined; }

  // ---- aura/deck flags
  Game.prototype.hivemindActive = function (owner) { return this.boardUnits().some(function (x) { return x.owner === owner && x.cardId === 'Hivemind'; }); };
  Game.prototype.bedrockActive = function (owner) { return this.boardUnits().some(function (x) { return x.owner === owner && x.cardId === 'Bedrock'; }); };
  Game.prototype.singletonActive = function (owner) { return this.boardUnits().some(function (x) { return x.owner === owner && x.cardId === 'Singleton'; }); };
  Game.prototype.polymorphActive = function (owner) {
    // While effect of a Polymorph INSTANCE — must be alive on board (aura source).
    var mine = this.boardUnits().filter(function (x) { return x.owner === owner && x.type === 'object'; });
    if (!mine.some(function (x) { return x.cardId === 'Polymorph'; })) return false;
    // Card text: 내 필드에 클래스 3종 이상이면 발동 — count distinct classes among my board objects.
    var seen = {};
    for (var i = 0; i < mine.length; i++) { var c = cardCls(mine[i]); if (c) seen[c] = 1; }
    return Object.keys(seen).length >= 3;
  };

  // ---- binding (movement lock)
  // 봉쇄(full): 이동·기본 공격·For 전부 불가. boundUntil/perm + 「옆칸」 적 Const 오라.
  Game.prototype.isBound = function (u) {
    if (u.boundPerm) return true;
    if (u.boundUntil > this.turnNo) return true;
    return this.adj(u).some(function (x) { return x.owner !== u.owner && x.cardId === 'Const'; });
  };
  // 이동 잠금(부분): 봉쇄 + 자기 이동 불가(Const·ROM) + 「옆칸」 적 Cache 오라(이동만 막음).
  Game.prototype.isMoveLocked = function (u) {
    if (this.isBound(u)) return true;
    if (u.cardId === 'Const' || u.cardId === 'ROM') return true;
    return this.adj(u).some(function (x) { return x.owner !== u.owner && x.cardId === 'Cache'; });
  };

  // ---- damage / heal / stat
  Game.prototype.beginResolve = function () { this._resolveSeen = {}; };
  Game.prototype.endResolve = function () { this._resolveSeen = null; };
  Game.prototype._clampOnce = function (u, stat) {
    if (!this._resolveSeen) return true;
    var key = u.uid + ':' + stat;
    if (this._resolveSeen[key]) return false;
    this._resolveSeen[key] = true; return true;
  };

  // 데미지 파이프라인(rules v10): 기본치 → 증폭(+N) → 감소(-N·절반·상한·최소치) → 차단(막음) → 반사
  // 「직격」은 감소 단계만 스킵한다. 증폭·차단·반사는 직격에도 정상 작동.
  Game.prototype.damageAmplify = function (target, amount) {
    // Debug: 대상의 「옆칸」에 있는 적(Debug) 1장당 받는 피해 +1
    return amount + this.adj(target).filter(function (x) { return x.owner !== target.owner && x.cardId === 'Debug'; }).length;
  };
  Game.prototype.damageReduction = function (target, amount, direct) {
    var amt = amount;
    if (direct) return amt < 0 ? 0 : amt;   // 직격: 감소 단계 스킵
    if (target.type === 'body') {
      // Firewall adjacent to this body: -2 each
      amt -= 2 * this.adj(target).filter(function (x) { return x.owner === target.owner && x.cardId === 'Firewall'; }).length;
      if (amt < 0) amt = 0;
      if (this.singletonActive(target.owner) && amt > 0) amt = Math.max(0, amt - 2); // Singleton: 본체 받는 피해 -2
      return amt < 0 ? 0 : amt;
    }
    // object: Heap adjacency -1 each (ally Heaps)
    amt -= this.adj(target).filter(function (x) { return x.owner === target.owner && x.cardId === 'Heap'; }).length;
    if (amt < 0) amt = 0;
    // Bedrock: 내 memory 받는 피해 -1 (최소 1)
    if (amt > 0 && cardCls(target) === 'memory' && this.bedrockActive(target.owner)) amt = Math.max(1, amt - 1);
    // ROM: 받는 피해 상한 2 (감소 계열 — 직격이 무시)
    if (target.cardId === 'ROM') amt = Math.min(amt, 2);
    return amt < 0 ? 0 : amt;
  };
  // 차단(막음): barrier()=본체 흡수풀(bodyShield), mprotect()=인스턴스 다음 피해 1회 전량 차단
  Game.prototype.damageBlock = function (target, amount) {
    var amt = amount;
    if (target.blockFull) { target.blockFull = false; this.note(CARDS[target.cardId].name + ' 차단(전량 ' + amt + ')'); return 0; }
    if (target.type === 'body') {
      var pl = this.players[target.owner];
      // barrier(): 다음 피해 1회를 최대 N 흡수, 초과분 적용 — 1회성(흡수 후 소멸)
      if (pl.bodyShield > 0) { var ab = Math.min(pl.bodyShield, amt); pl.bodyShield = 0; amt -= ab; }
    }
    return amt < 0 ? 0 : amt;
  };

  Game.prototype.deal = function (target, amount, source) {
    if (!target || this.winner !== undefined) return 0;
    var direct = !!(source && source.direct);
    // Sandbox: 내 본체가 받는 피해를 대신 Sandbox 인스턴스가 받는다(선택 — 엔진은 존재 시 자동 흡수)
    if (target.type === 'body') {
      var sb = this.boardUnits().filter(function (x) { return x.owner === target.owner && x.cardId === 'Sandbox'; })[0];
      if (sb) { target = sb; }
    }
    var amt = this.damageAmplify(target, amount);
    amt = this.damageReduction(target, amt, direct);
    amt = this.damageBlock(target, amt);
    target.dmg += amt;
    var tkey = target.type === 'body' ? bodyKey(target.owner) : unitKey(this, target);
    if (amt > 0) {
      var at = source && source.attacker;
      // 시전 데미지는 attacker 를 { owner } 합성 객체로만 넘기는 카드가 많다(cardId 없음).
      // → 연출 클래스는 실제 공격 인스턴스가 있으면 그 클래스, 없으면 시전 카드(_castCard)의 클래스로 폴백(무방비 cardCls 접근 금지).
      var srcCardId = at && at.cardId ? at.cardId : (at ? this._castCard : undefined);
      var atkCls = (at && at.cardId) ? cardCls(at) : (CARDS[srcCardId] ? CARDS[srcCardId].cls : undefined);
      this.fx({ type: 'damage', key: tkey, amount: amt, srcOwner: at ? at.owner : undefined, srcCard: srcCardId, atkCls: atkCls, via: (source && source.via) ? source.via : (at ? 'ability' : 'system') });
    }
    if (target.type === 'body') {
      this.note('본체 피해 ' + amt + ' → P' + target.owner + ' (HP ' + this.curHp(target) + ')');
      this.checkWin();
      return amt;
    }
    this.note(CARDS[target.cardId].name + ' 피해 ' + amt + ' (HP ' + this.curHp(target) + ')');
    // reflect(): 이번 턴 내 memory 피격 시 피해 절반(올림)을 가해 인스턴스에 반사(받는 피해 유지)
    if (amt > 0 && cardCls(target) === 'memory' && this.players[target.owner].memReflectTurn === this.turnNo) {
      var ra = source && source.attacker;
      if (ra && ra.uid != null && this.board[unitKey(this, ra)]) this.deal(ra, Math.ceil(amt / 2), { attacker: target });
    }
    // onDamaged triggers (only if it was an attack and survived/while)
    if (source && source.attacker && this.curHp(target) > 0) {
      this.fireDamaged(target, source.attacker);
    }
    if (this.curHp(target) <= 0) this.destroy(target, source);
    return amt;
  };

  Game.prototype.fireDamaged = function (target, attacker) {
    // Mutex: reflect 3 to attacker; Recursion: +2 atk on survive; Buffer: heal if hp<=5; Sentinel handled on enter
    var card = CARDS[target.cardId];
    var self = this;
    (card.abilities || []).forEach(function (ab) {
      if (ab.trigger === 'onDamaged') { self.beginResolve(); ab.fn(self, target, { attacker: attacker }); self.endResolve(); }
    });
  };

  Game.prototype.destroy = function (u, source) {
    var k = unitKey(this, u); if (!k) return;
    this.note(CARDS[u.cardId].name + ' 파괴');
    var dat = source && source.attacker;
    this.fx({ type: 'death', key: k, cls: cardCls(u), victim: u.cardId, owner: u.owner, byOwner: dat ? dat.owner : undefined, byCard: dat && dat.cardId ? dat.cardId : (dat ? this._castCard : undefined) });
    // onDeath triggers BEFORE removal (need position)
    var card = CARDS[u.cardId], self = this;
    delete this.board[k];
    this.players[u.owner].destroyedAlly++;
    this.players[u.owner].graveyard.push(u.cardId);
    (card.abilities || []).forEach(function (ab) {
      if (ab.trigger === 'onDeath') { self.beginResolve(); ab.fn(self, u, { atKey: k }); self.endResolve(); }
    });
    // onUnitDeath watchers (Atomic·Journal 등 — 다른 인스턴스의 파괴를 감시)
    this.boardUnits().forEach(function (w) {
      (CARDS[w.cardId].abilities || []).forEach(function (ab) {
        if (ab.trigger === 'onUnitDeath') { self.beginResolve(); ab.fn(self, w, { dead: u, atKey: k }); self.endResolve(); }
      });
    });
    // 오라 소멸 연쇄 사망 처리: 이 파괴로 오라(Persist 최대체력+2·Polymorph +1)가 사라지면
    // 인접/전역 인스턴스의 effMaxHp 가 줄어 curHp 가 0 이하가 될 수 있다. deal 은 피격 순간에만
    // 사망을 검사하므로, 여기서 보드를 훑어 음수 체력 잔존 인스턴스를 마저 파괴한다(버그: 포인터로
    // Persist 처치 시 오라 버프받던 적이 체력 마이너스로 살아남던 문제).
    this.reap();
  };

  // 최대체력 하락(오라 소멸 등)으로 curHp<=0 이 된 인스턴스를 일괄 파괴. 재진입 방지 가드로
  // destroy→reap→destroy 연쇄가 무한재귀 없이 하나의 스윕에서 안정될 때까지 반복한다.
  Game.prototype.reap = function () {
    if (this._reaping) return;
    this._reaping = true;
    var changed = true;
    while (changed) {
      changed = false;
      var objs = this.objects();
      for (var i = 0; i < objs.length; i++) {
        var u = objs[i];
        if (this.board[unitKey(this, u)] === u && this.curHp(u) <= 0) { this.destroy(u, null); changed = true; break; }
      }
    }
    this._reaping = false;
  };

  Game.prototype.healInst = function (u, amount) {
    var before = u.dmg; u.dmg = Math.max(0, u.dmg - amount);
    var healed = before - u.dmg;
    if (healed > 0) this.fx({ type: 'heal', key: u.type === 'body' ? bodyKey(u.owner) : unitKey(this, u), amount: healed });
  };
  // stat fx (buff/debuff/bind) so the UI can show WHICH instance an auto/random-targeted effect hit.
  Game.prototype._statFx = function (u, kind, delta) { if (u && u.type === 'object') this.fx({ type: 'stat', key: unitKey(this, u), kind: kind, delta: delta, srcOwner: this.active, srcCard: this._castCard }); };
  Game.prototype.buffAtk = function (u, delta) { if (u.type !== 'object') return; if (!this._clampOnce(u, 'atk')) return; u.atkMod += delta; if (delta) this._statFx(u, 'atk', delta); };
  Game.prototype.buffHp = function (u, delta) { if (u.type !== 'object') return; if (!this._clampOnce(u, 'hp')) return; u.hpMod += delta; if (delta) this._statFx(u, 'hp', delta); if (delta < 0 && this.curHp(u) <= 0) this.destroy(u, null); };
  Game.prototype.setAtkZeroPerm = function (u) { if (u.atkZero) return; u.atkZero = true; this._statFx(u, 'zero', 0); };
  Game.prototype.setAtkZeroTurns = function (u, turns) { u.atkZeroUntil = this.turnNo + turns * 2; this._statFx(u, 'zero', 0); };
  Game.prototype.bind = function (u, turns) {
    if (turns === 'perm') u.boundPerm = true; else u.boundUntil = this.turnNo + turns * 2;
    this._statFx(u, 'bind', turns === 'perm' ? 0 : turns);
    // Fault: 적이 봉쇄될 때마다 그 적에게 1 피해 (능동 bind 한정)
    var self = this;
    this.boardUnits().filter(function (f) { return f.cardId === 'Fault' && f.owner !== u.owner; }).forEach(function (f) { if (self.board[unitKey(self, u)]) self.deal(u, 1, { attacker: f }); });
  };
  // 수리(받은 피해 전부 회복) · 차단 부여
  Game.prototype.repair = function (u) { if (u) this.healInst(u, u.dmg); };
  // 보호막(mprotect): 다음 피해 1회 전량 차단 + 인스턴스에 시각 표시(shield stat fx → 상태칩 유지)
  Game.prototype.protect = function (u) { if (!u) return; u.blockFull = true; this._statFx(u, 'shield', 0); };

  // ---- queries for targeting
  Game.prototype.enemyObjects = function (owner) { return this.objects().filter(function (u) { return u.owner !== owner; }); };
  Game.prototype.allyObjects = function (owner) { return this.objects().filter(function (u) { return u.owner === owner; }); };
  Game.prototype.enemyBody = function (owner) { return this.body(1 - owner); };

  // ---- movement primitives (rules v10 moveVerbs)
  //  relocate  = 재배치: 위치 제거 후 새 칸에 재설정. 트리거 전부 비발동 (Wormhole·Dispatch).
  //  teleport  = 이동(자발, 경로 무시): 진입/이동 트리거 발동 (goto·trace·swap·Jump·Symlink).
  //  forceMove = 강제 이동: 강제이동 트리거(Thrash) + 진입 트리거 발동 (pull·push·glitch·memcpy·jitter·rotate·splice적).
  Game.prototype.relocate = function (u, toKey) {
    if (u && u.flags && u.flags.wall) return false;   // 중립 벽 = 이동 불가(모든 강제이동의 단일 진입점)
    var from = unitKey(this, u); if (!from || this.board[toKey]) return false;
    delete this.board[from]; this.board[toKey] = u;
    // 강제이동·재배치·teleport(for 함수) 공통 이동 연출 진입점 — from+to 로 인스턴스 슬라이드.
    this.fx({ type: 'move', from: from, to: toKey });
    return true;
  };
  // 진입 트리거(Sentinel/Interrupt/Trap = 옆칸). ability.enterRange==='s1' 이면 1칸이내(대각 포함), 그 외 옆칸(직교 인접).
  Game.prototype.fireEnterTriggers = function (u) {
    var self = this, k = unitKey(this, u); if (!k) return;
    this.enemyObjects(u.owner).forEach(function (x) {
      var xk = unitKey(self, x); if (!xk) return;
      (CARDS[x.cardId].abilities || []).forEach(function (ab) {
        if (ab.trigger !== 'onEnterRange') return;
        var inRange = (ab.enterRange === 's1') ? cheb(xk, k) <= 1 : (manh(xk, k) === 1);
        if (inRange) { self.beginResolve(); ab.fn(self, x, { mover: u }); self.endResolve(); }
      });
    });
  };
  // 강제 이동 후처리: Thrash(2 피해) + 진입 트리거
  Game.prototype.afterForcedMove = function (u) {
    if (!u) return; var self = this, k = unitKey(this, u); if (!k) return;
    this.boardUnits().filter(function (t) { return t.cardId === 'Thrash' && t.owner !== u.owner; })
      .forEach(function (t) { if (self.board[unitKey(self, u)]) self.deal(u, 2, { attacker: t }); });
    if (this.board[unitKey(this, u)]) this.fireEnterTriggers(u);
  };
  Game.prototype.forceMove = function (u, toKey) { if (!this.relocate(u, toKey)) return false; this.afterForcedMove(u); return true; };
  Game.prototype.teleport = function (u, toKey) { if (!this.relocate(u, toKey)) return false; if (this.board[unitKey(this, u)]) this.fireEnterTriggers(u); return true; };
  // knockback: move the target one cell AWAY from the caster (toward the caster's enemy edge).
  Game.prototype.pushAway = function (target, fromOwner) {
    var k = unitKey(this, target); if (!k) return false; var p = P(k);
    var dr = fwd(fromOwner); var dest = K(p[0], p[1] + dr);
    return (inB(p[0], p[1] + dr) && !this.board[dest]) ? this.forceMove(target, dest) : false;
  };
  // pull: move the target one cell TOWARD the caster (toward the caster's own home edge = opposite of forward).
  Game.prototype.pullToward = function (target, owner) {
    var k = unitKey(this, target); if (!k) return false; var p = P(k);
    var dr = -fwd(owner); var dest = K(p[0], p[1] + dr);
    return (inB(p[0], p[1] + dr) && !this.board[dest]) ? this.forceMove(target, dest) : false;
  };
  // relocate the target to ANY adjacent empty cell — prefer the knockback direction, else any ortho.
  Game.prototype.shoveToEmpty = function (target, fromOwner) {
    var k = unitKey(this, target); if (!k) return false; var p = P(k);
    var dr = fwd(fromOwner), dest = K(p[0], p[1] + dr);
    if (inB(p[0], p[1] + dr) && !this.board[dest]) return this.forceMove(target, dest);
    var self = this, opts = ortho(p[0], p[1]).filter(function (x) { return !self.board[x]; });
    return opts.length ? this.forceMove(target, opts[0]) : false;
  };
  // 전개칸: 기준 인스턴스 「1칸이내」(8칸) 빈 칸 목록. chain() 후방: 대상 뒤(적 진영 방향) 같은 열 첫 적.
  Game.prototype.deployCells = function (u) { var k = unitKey(this, u); if (!k) return []; var p = P(k), self = this; return around8(p[0], p[1]).filter(function (x) { return !self.board[x]; }); };
  Game.prototype.chainBackEnemy = function (fromKey, casterOwner) {
    var p = P(fromKey), dr = fwd(casterOwner);
    for (var r = p[1] + dr; inB(p[0], r); r += dr) { var t = this.board[K(p[0], r)]; if (t && t.owner !== casterOwner && t.type === 'object') return t; }
    return null;
  };
  // 행동 추가(yield/overtime/Sudo): 이번 턴 총 행동은 기본 2 + 추가로 최대 9까지(콤보 스택 허용, Conduit 등).
  Game.prototype.grantActions = function (n) {
    var room = MAX_ACTION_BUDGET - (this.actionBudget || 2); var give = Math.max(0, Math.min(n, room));
    this.actionBudget = (this.actionBudget || 2) + give; this.actions += give; return give;
  };
  Game.prototype.firstEmptyHome = function (owner) {
    var r = homeRow(owner);
    for (var c = 1; c <= COLS; c++) { if (!this.board[K(c, r)]) return K(c, r); }
    // any empty
    for (var rr = 1; rr <= ROWS; rr++) for (var cc = 1; cc <= COLS; cc++) if (!this.board[K(cc, rr)]) return K(cc, rr);
    return null;
  };
  // opts.cls = 분신이 상속할 클래스(생성 카드 클래스). 지정 시 token 플래그가 붙는다.
  Game.prototype.summon = function (owner, cardId, cell, opts) {
    if (!cell || this.board[cell]) { cell = this.firstEmptyHome(owner); }
    if (!cell) return null;
    var u = this.makeUnit(owner, cardId); this.board[cell] = u;
    if (opts && opts.cls) { u.clsOverride = opts.cls; u.token = true; }
    this.note(CARDS[cardId].name + ' 생성 → ' + cell);
    this.fx({ type: 'spawn', key: cell, card: cardId, owner: owner });
    return u;
  };

  // ---- Switch(변신): 살아있는 인스턴스를 다른 카드(폼)로 영구 변신.
  // cardId·baseAtk/baseHp를 새 폼으로 교체하고 능력치 보정/능력 회계를 초기화한다.
  // 누적 피해(dmg)는 새 최대 HP-1로 클램프 → 변신으로 완치되거나 즉사하지 않게.
  // onSummon은 재발동하지 않는다(변신은 소환이 아님).
  Game.prototype.transformUnit = function (u, newId) {
    var nc = CARDS[newId]; if (!nc || !u) return false;
    var k = unitKey(this, u); if (!k || this.board[k] !== u) return false;
    u.cardId = newId;
    u.baseAtk = nc.atk || 0;
    u.baseHp = nc.hp || 0;
    u.atkMod = 0; u.hpMod = 0;                       // 폼이 새 기준치를 정의 — 누적 강화 제거
    u.tempAtk = []; u.atkZero = false; u.atkZeroUntil = 0;
    u.onceUsed = {};                                  // 능력 배열이 바뀌므로 For/If/Switch 회계 초기화
    var newMax = this.effMaxHp(u);
    if (u.dmg > newMax - 1) u.dmg = Math.max(0, newMax - 1);
    this.note(nc.name + '(으)로 전환');
    this.fx({ type: 'spawn', key: k, card: newId, owner: u.owner }); // 변신 연출 = spawn 플래시 재사용
    this.checkWin(); this.emit();
    return true;
  };

  // forward-line first enemy (벽 너머 가능 = ignore blockers for "first enemy in line")
  Game.prototype.firstEnemyInLine = function (originKey, owner, n, throughWalls) {
    var p = P(originKey), dr = fwd(owner);
    for (var k = 1; k <= n; k++) {
      var nc = p[0], nr = p[1] + dr * k; if (!inB(nc, nr)) break;
      var u = this.board[K(nc, nr)];
      if (u) { if (u.owner !== owner && u.type === 'object') return u; if (!throughWalls) return null; }
    }
    return null;
  };

  // ============================================================== TURN LOOP
  Game.prototype.startMatch = function () {
    // 선후공 보정(rules v12) — config 기반(_cfg). 기본 선공 5·후공 5.
    this.draw(this.firstPlayer, this._cfg.openFirst);
    this.draw(1 - this.firstPlayer, this._cfg.openSecond);
    // (튜닝 knob, 기본 off) 후공 본체 HP 가산 — 선후공 미세 보정용. ⚠ 요새/방어덱을 비대칭 강화하므로 기본 미사용.
    if (this._cfg.secondBodyBonus) { var sb = this.board[bodyKey(1 - this.firstPlayer)]; if (sb) sb.baseHp += this._cfg.secondBodyBonus; }
    this.note('대국 시작 — 선공 P' + this.firstPlayer + ' (선공 ' + this._cfg.openFirst + ' / 후공 ' + this._cfg.openSecond + ')');
  };
  Game.prototype.draw = function (player, n) {
    n = n || 1; var pl = this.players[player];
    for (var i = 0; i < n; i++) {
      if (pl.deck.length === 0) {
        // 덱 소진(피로): 드로우할 카드가 없으면 그 대신 본체가 피로 피해. rules v10: 첫 3, 이후 장당 +1 누적(3,4,5,…).
        var fb = this.body(player);
        if (fb) { var fd = pl.fatigueNext; pl.fatigueNext = fd + 1; fb.dmg += fd; this.note('⚠ 덱 소진(피로) — P' + player + ' 본체 ' + fd + ' 피해'); this.fx({ type: 'damage', key: bodyKey(player), amount: fd, fatigue: true }); this.checkWin(); }
        continue;
      }
      var id = pl.deck.shift();
      if (pl.hand.length >= 10) { pl.graveyard.push(id); this.note('오버드로우 — ' + CARDS[id].name + ' 버림'); }
      else { pl.hand.push(id); this.fx({ type: 'draw', player: player, cardId: id }); }
    }
  };
  Game.prototype.mulligan = function (player, indices) {
    var pl = this.players[player];
    var keep = [], toss = [];
    pl.hand.forEach(function (id, i) { if (indices.indexOf(i) >= 0) toss.push(id); else keep.push(id); });
    // shuffle tossed back, draw replacements
    pl.hand = keep;
    this.draw(player, toss.length);
    for (var i = 0; i < toss.length; i++) pl.deck.push(toss[i]);
    this.shuffle(pl.deck);
  };
  Game.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(this.rng() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  };

  Game.prototype.beginTurn = function () {
    var p = this.active, pl = this.players[p];
    this.turnNo++; pl.turnsTaken++;
    // 행동: 기본 2 + 이월(defer) + 컨텍스트 스위치 환경(+1) — 총 상한 MAX_ACTION_BUDGET. actionBudget = 이번 턴 배정된 총 행동 수(추가 액션 카드로 증가).
    this.actionBudget = Math.min(MAX_ACTION_BUDGET, 2 + (pl.deferredActions || 0) + (this.weather === 'ctxswitch' ? 1 : 0));
    this.actions = this.actionBudget; pl.deferredActions = 0;
    this.turnFlags = { pointerCastThisTurn: 0, lambdaBonus: 0, proxyBonus: 0, conduitUsed: false, extraPointer: 0, extraPointerRange: 0, extraActions: 0 };
    this.forUsesThisTurn = {};
    // draw: (config) 선공 1턴차 드로우 스킵 여부. everyone else draws.
    if (!(this._cfg.firstSkipDraw && p === this.firstPlayer && pl.turnsTaken === 1)) this.draw(p, 1);
    // 후공 보정: 후공 첫 턴 시작 시 '동전'(overtime, 이번 턴 액션 +3) 1장 덱 외 지급(멀리건 후라 덱 미오염).
    if (this._cfg.secondComp && p !== this.firstPlayer && pl.turnsTaken === 1 && pl.hand.length < 10) { pl.hand.push('overtime()'); this.fx({ type: 'draw', player: p, cardId: 'overtime()', overtime: true }); }
    this.note('— P' + p + ' 턴 시작 (turn ' + this.turnNo + ') —');
    // onTurnStart triggers (auto for When; For are user/AI-activated)
    this.fireTurnStart(p);
    // RUNTIME ENV — 피해형 환경(메모리 누수)은 매 턴 시작 시 효과 적용. (컨텍스트 스위치는 위 행동 예산에서 +1 처리)
    this.applyWeatherTick();
    // (구 '런타임 과열' 제거 — 스톨 방지는 이제 덱 소진 피로(draw)로 대체)
    this.checkTurnCap();
    this.emit();
  };
  // 런타임 환경 틱 — memleak: 8ply부터 매 ply 전 인스턴스 HP−1. (컨텍스트 스위치 등 비피해형 환경은 틱 없음)
  Game.prototype.applyWeatherTick = function () {
    var w = this.weather; if (!w || this.turnNo < WEATHER_HAZARD_START) return;
    if (w === 'memleak') {
      var objs = this.objects(); if (!objs.length) return;
      this.fx({ type: 'weather', weather: w });
      for (var i = 0; i < objs.length; i++) { if (this.winner !== undefined) break; if (this.board[unitKey(this, objs[i])]) this.deal(objs[i], 1, { direct: true, weather: true }); }
    }
  };
  Game.prototype.fireTurnStart = function (owner) {
    var self = this;
    this.allyObjects(owner).forEach(function (u) {
      (CARDS[u.cardId].abilities || []).forEach(function (ab) {
        if (ab.trigger === 'onTurnStart' && ab.kw === 'When') { self.beginResolve(); ab.fn(self, u, {}); self.endResolve(); }
      });
    });
  };

  // 활성형 능력(선택 발동): For(무료·턴당 forCount회) + If(선택 발동·조건부 분기) + Switch(변신 폼 선택). 모두 동일 회계 사용.
  Game.prototype.forAbilities = function (u) {
    return (CARDS[u.cardId].abilities || []).filter(function (ab) { return ab.kw === 'For' || ab.kw === 'If' || ab.kw === 'Switch'; });
  };
  Game.prototype.canFireFor = function (u, abIndex) {
    if (u.owner !== this.active || this.winner !== undefined) return false;
    if (this.isBound(u)) return false;                // rules v10: 봉쇄 = For 능동도 불가
    var ab = CARDS[u.cardId].abilities[abIndex];
    if (!ab || (ab.kw !== 'For' && ab.kw !== 'If' && ab.kw !== 'Switch')) return false;
    if (this.forUsesThisTurn[u.uid + ':' + abIndex]) return false;
    u.onceUsed['for' + abIndex] = u.onceUsed['for' + abIndex] || 0;
    if (u.onceUsed['for' + abIndex] >= (ab.forCount || 1)) return false;
    return true;
  };
  // readiness: does firing this For ability actually accomplish anything right now?
  // (e.g. a self-move ability whose every legal destination is blocked → not ready)
  Game.prototype.forReady = function (u, abIndex) {
    var ab = CARDS[u.cardId] && CARDS[u.cardId].abilities[abIndex];
    return !!ab && (!ab.ready || ab.ready(this, u));
  };
  Game.prototype.fireFor = function (u, abIndex, choice) {
    if (!this.canFireFor(u, abIndex)) return false;
    var ab = CARDS[u.cardId].abilities[abIndex];
    // fizzle guard: never spend a For charge when the ability can't do anything (e.g. move fully blocked)
    if (ab.ready && !ab.ready(this, u)) return false;
    this.beginResolve();
    ab.fn(this, u, choice || {});
    this.endResolve();
    this.forUsesThisTurn[u.uid + ':' + abIndex] = true;
    u.onceUsed['for' + abIndex] = (u.onceUsed['for' + abIndex] || 0) + 1;
    this.emit();
    return true;
  };

  // ---- actions: declare / move / cast
  Game.prototype.canDeclare = function (player, cardId) {
    if (player !== this.active || this.actions < 1) return false;
    var card = CARDS[cardId]; if (!card || card.kind === 'pointer') return false;
    if (this.declareCells(player, cardId).length === 0) return false;
    return this.requireMet(player, card.require);
  };
  // 기본 선언 위치 = 홈칸. Affinity: 내 필드에 process 있으면 「통로칸」(행2·3)에도 선언 가능.
  Game.prototype.declareCells = function (player, cardId) {
    var r = homeRow(player), out = [];
    for (var c = 1; c <= COLS; c++) if (!this.board[K(c, r)]) out.push(K(c, r));
    if (cardId === 'Affinity' && this.allyObjects(player).some(function (x) { return cardCls(x) === 'process'; })) {
      for (var rr = 2; rr <= 3; rr++) for (var cc = 1; cc <= COLS; cc++) if (!this.board[K(cc, rr)]) out.push(K(cc, rr));
    }
    return out;
  };
  Game.prototype.declare = function (player, handIndex, cell) {
    var pl = this.players[player]; var cardId = pl.hand[handIndex];
    if (!this.canDeclare(player, cardId)) return false;
    if (this.declareCells(player, cardId).indexOf(cell) < 0) return false;
    pl.hand.splice(handIndex, 1);
    var u = this.makeUnit(player, cardId); this.board[cell] = u;
    this.actions--;
    this.note(CARDS[cardId].name + ' 선언 → ' + cell);
    this.fx({ type: 'spawn', key: cell, card: cardId, owner: player });
    // onSummon
    var self = this;
    (CARDS[cardId].abilities || []).forEach(function (ab) {
      if (ab.trigger === 'onSummon' && ab.kw !== 'For') { self.beginResolve(); ab.fn(self, u, {}); self.endResolve(); }
    });
    this.checkWin(); this.emit();
    return true;
  };
  Game.prototype.canMove = function (u, toKey) {
    if (u.owner !== this.active || this.actions < 1) return false;
    if (u.type !== 'object') return false;
    if (this.isMoveLocked(u)) return false; // 봉쇄 · Const/ROM 자기 이동 불가 · Cache 오라
    return this.moveCells(u).indexOf(toKey) >= 0;
  };
  Game.prototype.moveCells = function (u) {
    var k = unitKey(this, u); if (!k) return []; var p = P(k), self = this;
    return ortho(p[0], p[1]).filter(function (x) { return !self.board[x]; });
  };
  Game.prototype.move = function (u, toKey, free) {
    if (!free && !this.canMove(u, toKey)) return false;
    var from = unitKey(this, u); delete this.board[from]; this.board[toKey] = u;
    if (!free) this.actions--;
    this.note(CARDS[u.cardId].name + ' 이동 ' + from + '→' + toKey);
    this.fx({ type: 'move', from: from, to: toKey });
    // onMove
    var self = this;
    (CARDS[u.cardId].abilities || []).forEach(function (ab) { if (ab.trigger === 'onMove') { self.beginResolve(); ab.fn(self, u, {}); self.endResolve(); } });
    // onEnterRange: 자발 이동도 진입 트리거 발동 (옆칸 Sentinel/Interrupt/Trap)
    this.fireEnterTriggers(u);
    this.emit();
    return true;
  };

  // ---- basic attack (§5 amendment): every Object may, once per its owner's turn,
  // FREELY deal its effective ATK to one orthogonally-adjacent enemy object OR the
  // enemy body. Adjacency-only keeps the corridor/positioning identity. No automatic
  // retaliation — counterplay is reflect functions (Mutex/Recursion) + atk-down auras
  // (Stack/Stub) + damage reduction (Heap/Bedrock/Barrier). Bind blocks movement, not
  // attacking. No summoning sickness: a unit may attack the same turn it is declared.
  Game.prototype.basicAttackTargets = function (u) {
    if (!u || u.type !== 'object') return [];
    var k = unitKey(this, u); if (!k) return [];
    var p = P(k), self = this, out = [];
    // 기본 공격 = 옆칸(상하좌우·직교)만. (구 '본체 수호' 대각선 예외 제거)
    ortho(p[0], p[1]).forEach(function (nk) { var t = self.board[nk]; if (t && t.owner !== u.owner) out.push(nk); });
    return out;
  };
  // 이번 턴 남은 기본 공격 보너스(Preempt·retry()·Broadcast). 인스턴스당 턴 1회 + 보너스만큼 추가.
  Game.prototype.grantBonusAttack = function (u, n) { if (!u || u.type !== 'object') return; if (u.bonusAtkTurn !== this.turnNo) { u.bonusAtkTurn = this.turnNo; u.bonusAtk = 0; } u.bonusAtk += (n || 1); };
  Game.prototype.hasBonusAttack = function (u) { return u.bonusAtkTurn === this.turnNo && u.bonusAtk > 0; };
  Game.prototype.canBasicAttack = function (u) {
    if (!u || u.owner !== this.active || this.winner !== undefined) return false;
    if (u.type !== 'object') return false;
    if (this.isBound(u)) return false;                // rules v10: 봉쇄 = 기본 공격도 불가
    if (this.effAtk(u) <= 0) return false;            // ATK 0 / atk-zero'd / walls can't attack
    // rules v11: 선언 즉시 전투 가능(소환멀미 없음). 인스턴스당 턴 1회 + 보너스 공격만 예외.
    if (u.attackedTurn === this.turnNo && !this.hasBonusAttack(u)) return false;
    return this.basicAttackTargets(u).length > 0;
  };
  Game.prototype.basicAttack = function (u, targetKey) {
    if (!this.canBasicAttack(u)) return false;
    if (this.basicAttackTargets(u).indexOf(targetKey) < 0) return false;
    var t = this.board[targetKey], dmg = this.effAtk(u);
    this.note(CARDS[u.cardId].name + ' 공격 → ' + (t.type === 'body' ? '본체' : CARDS[t.cardId].name) + ' (' + dmg + ')');
    // 첫 공격이면 attackedTurn 소비, 이미 공격했으면 보너스 1 소비
    if (u.attackedTurn === this.turnNo && this.hasBonusAttack(u)) u.bonusAtk--; else u.attackedTurn = this.turnNo;
    this.fx({ type: 'attack', from: unitKey(this, u), to: targetKey, cls: cardCls(u), dmg: dmg, via: 'basic' });
    this.beginResolve();
    this.deal(t, dmg, { attacker: u, via: 'basic' });
    this.endResolve();
    this.emit();
    return true;
  };

  // Actual board cells a field object's primary function range covers, at its real
  // position with owner-forward direction (for the on-board range visualization).
  Game.prototype.rangeCellsFor = function (u) {
    if (!u || u.type !== 'object') return [];
    var info = cardRange(u.cardId); if (info.kind !== 'grid') return [];
    var k = unitKey(this, u); if (!k) return [];
    var p = P(k), c = p[0], r = p[1], dr = fwd(u.owner), code = info.code, out = [], i;
    function add(cc, rr) { if (inB(cc, rr)) out.push(K(cc, rr)); }
    if (code === 'x1' || code === 'ax1') out = ortho(c, r);
    else if (code === 's1') out = around8(c, r);
    else if (code === 's2' || code === 'bs2') out = square(c, r, 2);
    else if (code === 'r2') out = ring(c, r, 2);
    else if (code === 'd3') out = diagonal(c, r, 3);
    else if (code === 'd2') out = diagonal(c, r, 2);
    else if (code === 's3') out = square(c, r, 3);
    else if (code === 'lf3') { for (i = 1; i <= 3; i++) add(c, r + dr * i); }
    else if (code === 'lf4') { for (i = 1; i <= 4; i++) add(c, r + dr * i); }
    else if (code === 'lf2') { for (i = 1; i <= 2; i++) add(c, r + dr * i); }
    else if (code === 'lfEnd') { for (i = 1; i < ROWS; i++) add(c, r + dr * i); }  // 「앞직선끝」 보드 끝까지
    else if (code === 'kn') out = knight(c, r);
    return out;
  };

  // ---- pointers
  // rules v10: 포인터는 기본 사거리 무제한(보드 전역 지정). 텍스트에 사거리·기준점이 명시된
  // 포인터(free()=내 본체 「2칸이내」)만 기준점 square(n) 로 제한한다. 「포인터 사거리 +N」은
  // 사거리가 명시된 포인터에만 적용되며 무제한 지정에는 효과가 없다.
  var CASTRANGE = {
    // 포병(본체 기준): 적 앞줄까지 · 적 뒷줄·본체는 안전
    'free()':   { from: 'body', n: 2 },
    // 기본 데미지/디버프(내 인스턴스·본체 기준 2칸): 인스턴스를 전진시키면 적 뒷줄까지 도달
    'kill()':   { from: 'allyOrBody', n: 2 },
    'ping()':   { from: 'allyOrBody', n: 2 },
    'drop()':   { from: 'allyOrBody', n: 2 },
    'assert()': { from: 'allyOrBody', n: 2 },
    'throw()':  { from: 'allyOrBody', n: 2 },
    'catch()':  { from: 'allyOrBody', n: 2 },
    'clear()':  { from: 'allyOrBody', n: 2 },
    'halt()':   { from: 'allyOrBody', n: 2 },
    'burst()':  { from: 'allyOrBody', n: 2 },
    'jolt()':   { from: 'allyOrBody', n: 2 },
    'lock()':   { from: 'allyOrBody', n: 2 },
    'purge()':  { from: 'allyOrBody', n: 2 },
    'siphon()': { from: 'allyOrBody', n: 2 },
    'inject()': { from: 'allyOrBody', n: 2 },
    'chain()':  { from: 'allyOrBody', n: 2 },
    'glitch()': { from: 'allyOrBody', n: 2 }
    // 무제한 유지(정밀/변위 셋업): strike() suspend() pull() push() memcpy() splice() — CASTRANGE 미등재 = unlimited
  };
  function castSpec(id) { return CASTRANGE[id] || { unlimited: true }; }
  // 적 = 적 인스턴스 + 적 본체(v13 개정): 「적」을 대상으로 하는 데미지 포인터는 적 본체도 지정 가능(사거리 준수).
  // 봉쇄·강제이동·약화·버프제거·바운스(lock/halt/purge/inject/pull/push/memcpy/splice/clear/suspend)와
  // 본체에 무의미한 것(drop=대상 공격력만큼 → 본체 0 / glitch=이동 주체)은 인스턴스 전용 유지.
  var BODY_DMG_PTR = { 'strike()': 1, 'burst()': 1, 'jolt()': 1, 'free()': 1, 'siphon()': 1, 'chain()': 1, 'kill()': 1, 'ping()': 1, 'assert()': 1, 'throw()': 1, 'catch()': 1 };
  // human-readable cast-range info for the UI (null = 무제한, 오버레이 없음)
  function pointerRangeInfo(id) {
    var c = CARDS[id]; if (!c || c.kind !== 'pointer' || (c.need !== 'enemy' && c.need !== 'cell')) return null;
    var s = castSpec(id); if (s.unlimited) return null;
    var fromTxt = s.from === 'body' ? '본체' : (s.from === 'ally' ? '내 인스턴스' : '내 인스턴스·본체');
    return { from: s.from, n: s.n, text: fromTxt + ' 기준 ' + s.n + '칸 이내' };
  }
  Game.prototype.castOrigins = function (player, spec) {
    var origins = [], self = this;
    if (spec.from === 'body' || spec.from === 'allyOrBody') origins.push(bodyKey(player));
    if (spec.from === 'ally' || spec.from === 'allyOrBody') this.allyObjects(player).forEach(function (u) { var k = unitKey(self, u); if (k) origins.push(k); });
    return origins;
  };
  // 포인터 사거리 보너스: Relay(While +1, 지속) + Lambda(다음 포인터 +2) + Singularity(+3) 합산.
  // castTargets·castZone(타겟 선정)와 cast()의 rangeBonus(snipe 등 효과 사거리)가 함께 읽는다.
  Game.prototype.pointerRangeBonus = function (player) {
    var t = this.turnFlags || {};
    var b = (t.extraPointerRange || 0) + (t.lambdaBonus || 0);
    this.allyObjects(player).forEach(function (u) { if (u.cardId === 'Relay') b += 1; });
    return b;
  };
  Game.prototype.castTargets = function (player, cardId) {
    var card = CARDS[cardId];
    if (!card || card.kind !== 'pointer' || (card.need !== 'enemy' && card.need !== 'cell')) return [];
    var self = this, spec = castSpec(cardId), out = [];
    var bodyHit = BODY_DMG_PTR[cardId] && this.enemyBody(player), ebk = bodyHit ? bodyKey(1 - player) : null;
    if (spec.unlimited) {
      this.enemyObjects(player).forEach(function (u) { var k = unitKey(self, u); if (k) out.push(k); });
      if (bodyHit) out.push(ebk);   // 무제한 데미지 포인터: 적 본체도 대상
      return out;
    }
    var n = spec.n + this.pointerRangeBonus(player), set = {};
    this.castOrigins(player, spec).forEach(function (ok) { var p = P(ok); set[ok] = 1; square(p[0], p[1], n).forEach(function (ck) { set[ck] = 1; }); });
    this.enemyObjects(player).forEach(function (u) { var k = unitKey(self, u); if (k && set[k]) out.push(k); });
    if (bodyHit && set[ebk]) out.push(ebk);   // 사거리 내면 적 본체도 데미지 포인터 대상
    return out;
  };
  // every cell within cast range (the reachable zone, occupied or not) — for the UI overlay.
  // 무제한 포인터는 빈 배열 반환 → UI는 전역 지정으로 처리(제한 오버레이 없음).
  Game.prototype.castZone = function (player, cardId) {
    var card = CARDS[cardId];
    if (!card || card.kind !== 'pointer' || (card.need !== 'enemy' && card.need !== 'cell')) return [];
    var spec = castSpec(cardId); if (spec.unlimited) return [];
    var n = spec.n + this.pointerRangeBonus(player), set = {};
    this.castOrigins(player, spec).forEach(function (ok) { var p = P(ok); set[ok] = 1; square(p[0], p[1], n).forEach(function (ck) { set[ck] = 1; }); });
    return Object.keys(set);
  };
  // all legal target keys for a pointer's need, honoring per-card castValid (fizzle-proofing).
  // castValid(G, player, targetKey, extra) → false means "casting on this target does nothing",
  // so it must not be selectable and must not consume the card (§ rush/pull-into-blocked bug).
  Game.prototype.pointerLegalTargets = function (player, cardId) {
    var card = CARDS[cardId]; if (!card || card.kind !== 'pointer') return [];
    var need = card.need, me = player, self = this, out = [];
    function ek(list) { return list.map(function (u) { return unitKey(self, u); }).filter(Boolean); }
    if (need === 'enemy' || need === 'cell') out = this.castTargets(player, cardId);
    else if (need === 'ally') out = ek(this.allyObjects(me));
    else if (need === 'allyThread') out = ek(this.allyObjects(me).filter(function (x) { return cardCls(x) === 'thread'; }));
    else if (need === 'allyProcess') out = ek(this.allyObjects(me).filter(function (x) { return cardCls(x) === 'process'; }));
    else if (need === 'allyMemory') out = ek(this.allyObjects(me).filter(function (x) { return cardCls(x) === 'memory'; }));
    else if (need === 'allyOrBody') { out = ek(this.allyObjects(me)); out.push(bodyKey(me)); }
    else if (need === 'twoAlly') out = ek(this.allyObjects(me));
    else return out; // 'none' — no target
    if (card.castValid) out = out.filter(function (k) { return card.castValid(self, player, k, {}); });
    return out;
  };
  Game.prototype.canCast = function (player, cardId) {
    var card0 = CARDS[cardId];
    // Singularity 버프: pointerFree 이면 포인터는 액션 없이도 시전 가능(액션 게이트 면제).
    var free0 = card0 && card0.kind === 'pointer' && this.players[player] && this.players[player].pointerFree;
    if (player !== this.active || (this.actions < 1 && !free0)) return false;
    var card = CARDS[cardId]; if (!card || card.kind !== 'pointer') return false;
    if (!this.castConditionMet(player, card)) return false;
    var need = card.need;
    if (need && need !== 'none') {
      // a targeted pointer with no target that would actually do something is not castable
      if (this.pointerLegalTargets(player, cardId).length < (need === 'twoAlly' ? 2 : 1)) return false;
    }
    return true;
  };
  Game.prototype.castConditionMet = function (player, card) {
    if (!card.castCondition) return true;
    return this.requireMet(player, card.castCondition);
  };
  Game.prototype.cast = function (player, handIndex, targetKey, free, extra) {
    var pl = this.players[player]; var cardId = pl.hand[handIndex]; var card = CARDS[cardId];
    if (!free && !this.canCast(player, cardId)) return false;
    if (!free && (card.need === 'enemy' || card.need === 'cell') && targetKey != null && this.castTargets(player, cardId).indexOf(targetKey) < 0) return false;
    // fizzle guard: never consume a move-pointer whose chosen target can't actually move (rush/pull into a blocked cell)
    if (!free && card.castValid && targetKey != null && !card.castValid(this, player, targetKey, extra || {})) return false;
    pl.hand.splice(handIndex, 1);
    // Singularity 버프: pointerFree 이면 포인터는 액션 소비 없음.
    if (!free && !(card.kind === 'pointer' && pl.pointerFree)) this.actions--;
    pl.pointersCast++;
    this.turnFlags.pointerCastThisTurn++;
    this.note(card.name + ' 시전' + (targetKey ? ' → ' + targetKey : ''));
    this.fx({ type: 'cast', player: player, cardId: cardId, targetKey: targetKey });

    // process synergy: extra range from Lambda/Proxy/Singularity
    var rangeBonus = this.pointerRangeBonus(player); // Relay(지속) + Lambda(직전 시전분) + Singularity
    this.turnFlags.lambdaBonus = 0; this.turnFlags.proxyBonus = 0; // Lambda 보너스는 1회성

    // Conduit: first pointer this turn resolves twice · proxy(): 다음 시전 포인터 효과 2회
    var times = 1;
    if (!this.turnFlags.conduitUsed && this.boardUnits().some(function (x) { return x.owner === player && x.cardId === 'Conduit'; })) {
      times = 2; this.turnFlags.conduitUsed = true;
    }
    if (this.turnFlags.proxyRepeat) { times = Math.max(times, 2); this.turnFlags.proxyRepeat = false; }
    var self = this, target = targetKey ? this.board[targetKey] : null;
    this._castCard = cardId; // so damage/kills this pointer causes are attributed to it
    for (var t = 0; t < times; t++) {
      this.beginResolve();
      card.cast(this, player, targetKey, Object.assign({ rangeBonus: rangeBonus }, extra || {}));
      this.endResolve();
    }
    this._castCard = null;
    // onPointerCast triggers for my objects (Hook/Pipe/Proxy/Lambda/Singularity already partly handled)
    this.firePointerCast(player, target);
    // Lambda: 다음 시전 포인터 사거리 +2 (1회성). Relay는 지속형이라 pointerRangeBonus에서 처리.
    this.allyObjects(player).forEach(function (u) {
      if (u.cardId === 'Lambda') self.turnFlags.lambdaBonus = 2;
    });
    // 포인터가 오라 소스를 파괴 없이 제거(예: 손으로 되돌리기)해 최대체력이 하락한 경우도 스윕.
    this.reap();
    this.checkWin(); this.emit();
    return true;
  };
  Game.prototype.firePointerCast = function (player, target) {
    var self = this;
    this.allyObjects(player).forEach(function (u) {
      (CARDS[u.cardId].abilities || []).forEach(function (ab) {
        if (ab.trigger === 'onPointerCast') { self.beginResolve(); ab.fn(self, u, { target: target }); self.endResolve(); }
      });
    });
  };

  // ---- end turn
  Game.prototype.endTurn = function () {
    if (this.winner !== undefined) return;
    var p = this.active, self = this;
    // onTurnEnd triggers
    this.allyObjects(p).forEach(function (u) {
      (CARDS[u.cardId].abilities || []).forEach(function (ab) { if (ab.trigger === 'onTurnEnd') { self.beginResolve(); ab.fn(self, u, {}); self.endResolve(); } });
    });
    this.active = 1 - p;
    this.checkTurnCap();
    if (this.winner === undefined) this.beginTurn();
    else this.emit();
  };

  // ---- win / require
  Game.prototype.checkWin = function () {
    if (this.winner !== undefined) return;
    var b0 = this.body(0), b1 = this.body(1);
    if (b1 && this.curHp(b1) <= 0) { this.winner = 0; this.note('★ P0 승리 — 상대 본체 격파'); }
    else if (b0 && this.curHp(b0) <= 0) { this.winner = 1; this.note('★ P1 승리 — 상대 본체 격파'); }
  };
  Game.prototype.checkTurnCap = function () {
    if (this.winner !== undefined) return;
    if (this.turnNo >= this.TURN_CAP) {
      var h0 = this.curHp(this.body(0)), h1 = this.curHp(this.body(1));
      this.winner = h0 === h1 ? 'draw' : (h0 > h1 ? 0 : 1);
      this.note('★ 턴 상한(' + this.TURN_CAP + ') — 본체 HP 판정: ' + (this.winner === 'draw' ? '무승부' : 'P' + this.winner));
    }
  };
  Game.prototype.requireMet = function (player, req) {
    if (!req) return true;
    var pl = this.players[player], self = this;
    switch (req.type) {
      case 'turnCount': return pl.turnsTaken >= req.n;
      case 'destroyedAlly': return pl.destroyedAlly >= req.n;
      case 'pointersCast': return pl.pointersCast >= req.n;
      case 'classOnBoard': return this.countBoard(function (x) { return x.owner === player && x.type === 'object' && cardCls(x) === req.cls; }) >= req.n;
      case 'boardCount': return this.countBoard(function (x) { return x.owner === player && x.type === 'object' && (!req.cls || cardCls(x) === req.cls); }) >= req.n;
      case 'selfBodyHP': { var hp = this.curHp(this.body(player)); return req.cmp === '<=' ? hp <= req.n : req.cmp === '>=' ? hp >= req.n : hp === req.n; }
      case 'or': return this.requireMet(player, req.a) || this.requireMet(player, req.b);
      case 'and': return this.requireMet(player, req.a) && this.requireMet(player, req.b);
      default: return true;
    }
  };
  // human-readable cast condition (§ pointer 시전조건 표시). null = no condition.
  function castCondText(cond) {
    if (!cond) return null;
    switch (cond.type) {
      case 'turnCount': return '내 턴 ' + cond.n + '회+ 진행';
      case 'destroyedAlly': return '내 인스턴스 ' + cond.n + '개+ 파괴됨';
      case 'pointersCast': return '포인터 ' + cond.n + '회+ 시전';
      case 'classOnBoard': return '내 ' + cond.cls + ' ' + cond.n + '개+ 필드에 존재';
      case 'boardCount': return '내 인스턴스 ' + cond.n + '개+' + (cond.cls ? '(' + cond.cls + ')' : '');
      case 'selfBodyHP': return '본체 HP ' + (cond.cmp || '=') + ' ' + cond.n;
      case 'or': return castCondText(cond.a) + ' 또는 ' + castCondText(cond.b);
      case 'and': return castCondText(cond.a) + ' + ' + castCondText(cond.b);
      default: return '특수 조건';
    }
  }

  // ============================================================== CARD CATALOG (seed v4)
  // helper builders used inside effects
  function dmgAdjEnemies(G, u, amount) { G.adj(u).filter(function (x) { return x.owner !== u.owner; }).forEach(function (x) { G.deal(x, amount, { attacker: u }); }); }
  function buffAdjThread(G, u, delta) { G.adj(u).filter(function (x) { return x.owner === u.owner && cardCls(x) === 'thread'; }).forEach(function (x) { G.buffAtk(x, delta); }); }
  function bestEnemyObj(G, owner) { var e = G.enemyObjects(owner); e.sort(function (a, b) { return G.curHp(a) - G.curHp(b); }); return e[0] || null; }

  var CARDS = {};
  function def(c) { CARDS[c.id] = c; if (!c.name) c.name = c.id; if (!c.abilities) c.abilities = []; }

  // ── 카드 풀은 cards.js 에서 kit(엔진 헬퍼) 주입으로 정의 (본문 무변경 분리) ──
  var __cardKit = {
    def: def, CARDS: CARDS, COLS: COLS, ROWS: ROWS, K: K, P: P, bestEnemyObj: bestEnemyObj, bodyKey: bodyKey,
    buffAdjThread: buffAdjThread, cardCls: cardCls, cheb: cheb, diagonal: diagonal, dmgAdjEnemies: dmgAdjEnemies,
    fwd: fwd, inB: inB, line: line, manh: manh, ortho: ortho, square: square, unitKey: unitKey,
    knight: knight, ring: ring, around8: around8, homeRow: homeRow
  };
  (typeof window !== 'undefined' && window.RT_DEFINE_CARDS ? window.RT_DEFINE_CARDS
    : (typeof RT_DEFINE_CARDS !== 'undefined' ? RT_DEFINE_CARDS : function () {}))(__cardKit);

  // ── 견본 덱은 decks.js 에서 순수 데이터로 정의 ──
  var DECKS = (typeof window !== 'undefined' && window.RT_DECKS) ? window.RT_DECKS
    : (typeof RT_DECKS !== 'undefined' ? RT_DECKS : {});

  // ---- deck legality (§11 + single-class for B-type/Polymorph)
  function deckClasses(list) { var s = {}; list.forEach(function (id) { var card = CARDS[id]; if (!card) return; var c = card.cls; if (c !== 'generic') s[c] = 1; }); return Object.keys(s); }
  function analyzeDeck(list) {
    var classes = deckClasses(list);
    var singleClass = classes.length <= 1; // generic-only or one class + generic
    return {
      size: list.length, classes: classes, singleClass: singleClass,
      hasPolymorph: list.indexOf('Polymorph') >= 0,
      hasHivemind: list.indexOf('Hivemind') >= 0,
      hasBedrock: list.indexOf('Bedrock') >= 0,
      hasConduit: list.indexOf('Conduit') >= 0
    };
  }
  function validateDeck(list) {
    var errs = [];
    if (list.length !== 30) errs.push('덱은 30장이어야 함 (현재 ' + list.length + ')');
    var counts = {};
    list.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    for (var id in counts) {
      var card = CARDS[id]; if (!card) { errs.push('알 수 없는 카드: ' + id); continue; }
      var lim = card.deckLimit || 2;
      if (counts[id] > lim) errs.push(card.name + ' ' + counts[id] + '장 (제한 ' + lim + ')');
    }
    var a = analyzeDeck(list);
    // 클래스 단일(◈) 규칙 — deckRule='{cls}Single' 카드는 해당 클래스 단일 덱에서만 가능(generic 혼합 허용).
    // 구: Hivemind/Bedrock/Conduit 3장 하드코딩 → 스택 시 위험한 교차-클래스 splash 방지 위해 일반화.
    for (var rid in counts) {
      var rc = CARDS[rid]; if (!rc || !rc.deckRule) continue;
      var rm = /^(thread|memory|process)Single$/.exec(rc.deckRule); if (!rm) continue;
      var need = rm[1];
      var onlyClass = a.classes.length === 0 || (a.classes.length === 1 && a.classes[0] === need);
      if (!onlyClass) errs.push(rc.name + '은(는) ' + need + ' 단일 클래스 덱에서만 가능');
    }
    return { ok: errs.length === 0, errors: errs, meta: a };
  }

  // ============================================================== AI (heuristic)
  function fireAllFor(g, me) {
    var units = g.allyObjects(me).slice();
    units.forEach(function (u) {
      var abs = g.forAbilities(u);
      for (var i = 0; i < CARDS[u.cardId].abilities.length; i++) {
        var _ab = CARDS[u.cardId].abilities[i];
        if (_ab.kw !== 'For' && _ab.kw !== 'If' && _ab.kw !== 'Switch') continue;
        // If/Switch(선택형): AI는 조건이 맞고 이득일 때만 발동 — aiWant 훅이 있으면 그 판단을 따른다.
        if ((_ab.kw === 'If' || _ab.kw === 'Switch') && _ab.aiWant && !_ab.aiWant(g, u)) continue;
        var guard = 0;
        while (g.canFireFor(u, i) && g.forReady(u, i) && guard++ < 5 && g.winner === undefined) {
          var _ch = {};
          if ((_ab.kw === 'If' || _ab.kw === 'Switch') && _ab.aiOpt) _ch.opt = _ab.aiOpt(g, u);
          g.fireFor(u, i, _ch);
          if (_ab.kw === 'Switch') break;   // 변신은 cardId가 바뀌므로 같은 인덱스 재발동 금지
        }
      }
    });
  }
  function lowestEnemy(g, me) { var e = g.enemyObjects(me); e.sort(function (a, b) { return g.curHp(a) - g.curHp(b); }); return e[0] || null; }
  function strongEnemy(g, me) { var e = g.enemyObjects(me); e.sort(function (a, b) { return g.effAtk(b) - g.effAtk(a); }); return e[0] || null; }
  // total basic-attack damage my ready units could land on the enemy body this turn
  function aiBodyReachDmg(g, me) {
    var bk = bodyKey(1 - me), sum = 0;
    g.allyObjects(me).forEach(function (u) { if (g.canBasicAttack(u) && g.basicAttackTargets(u).indexOf(bk) >= 0) sum += g.effAtk(u); });
    return sum;
  }
  // 방어 휴리스틱: 적 인스턴스 t 가 내(me) 본체를 기본공격 사거리에 두는가(= 내 본체를 때리는/때릴 놈).
  function aiThreatensBody(g, t, myBK) {
    if (!t || t.type !== 'object' || g.effAtk(t) <= 0) return false;
    var tt = g.basicAttackTargets(t); return tt && tt.indexOf(myBK) >= 0;
  }
  // pick the best basic-attack target for u: finish body > commit lethal > kill a base-threat/threat > defend body > pressure body > chip
  function aiAttackTarget(g, me, u, lethalBody) {
    var tg = g.basicAttackTargets(u); if (!tg.length) return null;
    var atk = g.effAtk(u), myBK = bodyKey(me);
    var bodyK = tg.filter(function (k) { return g.board[k].type === 'body'; })[0];
    if (bodyK && (lethalBody || g.curHp(g.board[bodyK]) <= atk)) return bodyK;             // finishing / committed lethal
    var kills = tg.filter(function (k) { var t = g.board[k]; return t.type === 'object' && g.curHp(t) <= atk && g.effAtk(t) > 0; });
    if (kills.length) {
      // 원샷 가능한 대상 중 '내 본체를 노리는 인스턴스'을 최우선(다운사이드 없음 — 어차피 잡을 인스턴스면 본체 때리는 놈부터), 그다음 공격력 큰 순.
      kills.sort(function (a, b) {
        var da = aiThreatensBody(g, g.board[a], myBK) ? 1 : 0, db = aiThreatensBody(g, g.board[b], myBK) ? 1 : 0;
        if (da !== db) return db - da;
        return g.effAtk(g.board[b]) - g.effAtk(g.board[a]);
      });
      return kills[0];
    }
    // 원샷 불가 — 내 본체가 위험(≤24, 즉 16+ 피해)하고 리썰 임박이 아니면, 본체를 노리는 적을 깎아 압박을 줄인다(레이스보다 우선).
    if (!lethalBody && g.curHp(g.body(me)) <= 24) {
      var bthreats = tg.filter(function (k) { return aiThreatensBody(g, g.board[k], myBK); });
      if (bthreats.length) { bthreats.sort(function (a, b) { return g.effAtk(g.board[b]) - g.effAtk(g.board[a]); }); return bthreats[0]; }
    }
    if (bodyK) return bodyK;                                                               // otherwise race the body
    tg.sort(function (a, b) { return g.curHp(g.board[a]) - g.curHp(g.board[b]); }); return tg[0];
  }
  // 변위 전용 포인터(피해·디버프 없이 적 위치만 1칸 바꿈) — 아무 적이나 밀면 액션 낭비라, AI는 가치 있을 때만 시전.
  var DISP_PTR = { 'push()': 'away', 'memcpy()': 'away', 'pull()': 'toward' };
  // cellKey 로 끌려온 적(hp)을 즉시 옆칸 기본공격으로 처치할 내 인스턴스가 있는가(pull 킬셋업 판정).
  function aiAdjAllyKills(g, me, cellKey, hp) {
    var p = P(cellKey), adj = ortho(p[0], p[1]);
    for (var i = 0; i < adj.length; i++) { var u = g.board[adj[i]]; if (u && u.type === 'object' && u.owner === me && g.canBasicAttack(u) && g.effAtk(u) >= hp) return true; }
    return false;
  }
  // 변위 포인터의 유용 타깃 — push/memcpy(밀어내기)=내 본체를 노리는 적을 사거리 밖으로, pull(끌어오기)=저체력 적을 처치셋업 칸으로. 없으면 null(시전 보류).
  function aiDisplaceTarget(g, me, card, id, ts) {
    var dir = DISP_PTR[id], myBK = bodyKey(me);
    var cand = ts.filter(function (k) { var u = g.board[k]; return u && u.type === 'object' && (!card.castValid || card.castValid(g, me, k)); });
    for (var a = 0; a < cand.length; a++) {
      var u = g.board[cand[a]];
      if (dir === 'away') { if (aiThreatensBody(g, u, myBK)) return cand[a]; }
      else if (g.curHp(u) <= 6) { var q = P(cand[a]), dest = K(q[0], q[1] - fwd(me)); if (inB(q[0], q[1] - fwd(me)) && aiAdjAllyKills(g, me, dest, g.curHp(u))) return cand[a]; }
    }
    return null;
  }
  function aiCast(g, me) {
    var pl = g.players[me];
    for (var i = 0; i < pl.hand.length; i++) {
      var id = pl.hand[i], card = CARDS[id];
      if (card.kind !== 'pointer' || !g.canCast(me, id)) continue;
      var need = card.need, tk = null;
      if (need === 'enemy' || need === 'cell') {
        var ts = g.castTargets(me, id); if (!ts.length) continue;
        if (DISP_PTR[id]) { var dtk = aiDisplaceTarget(g, me, card, id, ts); if (!dtk) continue; return g.cast(me, i, dtk, false); }
        var ebody = ts.filter(function (k) { return g.board[k].type === 'body'; })[0];
        var units = ts.filter(function (k) { return g.board[k].type === 'object'; });
        units.sort(function (a, b) { return g.curHp(g.board[a]) - g.curHp(g.board[b]); });
        var myBK3 = bodyKey(me);
        // 제거 우선순위: ① 내 본체를 노리는 위협(baseThreat) ② 그 외 공격력 있는 위협 — 둘 다 저체력(제거 쉬운) 순.
        var baseThreat = null; for (var y = 0; y < units.length; y++) { if (aiThreatensBody(g, g.board[units[y]], myBK3)) { baseThreat = units[y]; break; } }
        var threat = null; for (var z = 0; z < units.length; z++) { if (g.effAtk(g.board[units[z]]) > 0) { threat = units[z]; break; } }
        threat = baseThreat || threat;                                         // 본체를 때리는 놈을 최우선 스나이프
        if (ebody && (g.curHp(g.board[ebody]) <= 14 || !threat)) tk = ebody;   // close out a low body, or nothing worth removing
        else tk = threat || units[0] || ebody;                                 // else snipe a threatening unit
      }
      else if (need === 'ally' || need === 'allyOrBody' || need === 'allyThread' || need === 'allyProcess' || need === 'twoAlly') {
        var allies = g.allyObjects(me); if (need === 'allyThread') allies = allies.filter(function (x) { return cardCls(x) === 'thread'; });
        if (need === 'allyProcess') allies = allies.filter(function (x) { return cardCls(x) === 'process'; });
        if (!allies.length) { if (need === 'allyOrBody') tk = null; else continue; } else tk = unitKey(g, allies[0]);
      }
      // utility buffs: only if we have a board presence
      if (need === 'none' && /overclock|amplify|compact|fortify|boost|spawn|malloc|copy|grep|reflect|barrier|catch/.test(id) && g.allyObjects(me).length < 1 && !/grep|spawn|malloc/.test(id)) continue;
      return g.cast(me, i, tk, false);
    }
    return false;
  }
  function aiDeclare(g, me) {
    var pl = g.players[me];
    var cells = g.declareCells(me); if (!cells.length) return false;
    // prefer center column for pressure
    cells.sort(function (a, b) { return Math.abs(P(a)[0] - 3) - Math.abs(P(b)[0] - 3); });
    var bestIdx = -1, bestScore = -1;
    for (var i = 0; i < pl.hand.length; i++) {
      var id = pl.hand[i], card = CARDS[id];
      if (card.kind === 'pointer' || !g.canDeclare(me, id)) continue;
      var score = (card.atk || 0) + (card.hp || 0) / 2 + (card.abilities && card.abilities.length ? 3 : 0);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0) return false;
    return g.declare(me, bestIdx, cells[0]);
  }
  function aiMove(g, me) {
    // advance an object toward enemy body (forward) if it frees an attack lane
    var objs = g.allyObjects(me).filter(function (u) { return !g.isMoveLocked(u); });
    for (var i = 0; i < objs.length; i++) {
      var u = objs[i], k = unitKey(g, u), p = P(k), dest = K(p[0], p[1] + fwd(me));
      if (inB(p[0], p[1] + fwd(me)) && !g.board[dest] && g.actions > 0) {
        // only advance attackers (atk>0) and not past mid into danger blindly: advance toward rows 2-3
        if ((u.baseAtk || 0) > 0) return g.move(u, dest, false);
      }
    }
    return false;
  }
  function aiBasicAttacks(g, me) {
    var did = false, lethal = aiBodyReachDmg(g, me) >= g.curHp(g.body(1 - me));
    g.allyObjects(me).slice().forEach(function (u) {
      if (!g.canBasicAttack(u)) return;
      var pick = aiAttackTarget(g, me, u, lethal);
      if (pick && g.basicAttack(u, pick)) did = true;
    });
    return did;
  }
  function aiTakeTurn(g) {
    if (g.winner !== undefined) return;
    var me = g.active;
    fireAllFor(g, me);
    aiBasicAttacks(g, me);
    var guard = 0;
    while (g.actions > 0 && g.winner === undefined && guard++ < 12) {
      if (aiCast(g, me)) continue;
      if (aiDeclare(g, me)) continue;
      if (aiMove(g, me)) continue;
      break;
    }
    fireAllFor(g, me);      // fire any For unlocked by new declares/casts
    aiBasicAttacks(g, me);  // attack with anything that moved into range
    if (g.winner === undefined) g.endTurn();
  }
  // one unit of AI work; returns false when the turn's work is exhausted (caller ends turn)
  function aiStep(g) {
    if (g.winner !== undefined) return false;
    var me = g.active;
    var objs = g.allyObjects(me);
    for (var i = 0; i < objs.length; i++) {
      var u = objs[i], abs = CARDS[u.cardId].abilities;
      for (var j = 0; j < abs.length; j++) { if (abs[j].kw === 'For' && g.canFireFor(u, j) && g.forReady(u, j)) { g.fireFor(u, j, {}); return true; } }
    }
    // basic-attack one ready unit (free) — smart target + lethal awareness
    var lethalB = aiBodyReachDmg(g, me) >= g.curHp(g.body(1 - me));
    for (var b = 0; b < objs.length; b++) {
      if (g.canBasicAttack(objs[b])) {
        var pk = aiAttackTarget(g, me, objs[b], lethalB);
        if (pk && g.basicAttack(objs[b], pk)) return true;
      }
    }
    if (g.actions > 0) { if (aiCast(g, me)) return true; if (aiDeclare(g, me)) return true; if (aiMove(g, me)) return true; }
    return false;
  }

  // ============================================================== convenience
  function newGame(deck0, deck1, opts) {
    opts = opts || {};
    var g = new Game(opts);
    var d0 = (DECKS[deck0] ? DECKS[deck0].list : deck0).slice();
    var d1 = (DECKS[deck1] ? DECKS[deck1].list : deck1).slice();
    g.players[0].deck = d0; g.players[0].deckMeta = analyzeDeck(d0);
    g.players[1].deck = d1; g.players[1].deckMeta = analyzeDeck(d1);
    g.shuffle(g.players[0].deck); g.shuffle(g.players[1].deck);
    // bodies
    g.board[bodyKey(0)] = { uid: g.uidSeq++, owner: 0, cardId: '__body0', type: 'body', baseAtk: 0, baseHp: BODY_HP, atkMod: 0, hpMod: 0, dmg: 0, onceUsed: {}, flags: {} };
    g.board[bodyKey(1)] = { uid: g.uidSeq++, owner: 1, cardId: '__body1', type: 'body', baseAtk: 0, baseHp: BODY_HP, atkMod: 0, hpMod: 0, dmg: 0, onceUsed: {}, flags: {} };
    // RUNTIME WEATHER 지정 — 명시(opts.weather: 튜토리얼 clear·챌린지 스테이지) 우선, 없으면 seed 파생(단일/온라인 랜덤·양 클라 동일).
    g.weather = (opts.weather !== undefined) ? opts.weather : weatherFromSeed(opts.seed != null ? opts.seed : 12345);
    if (g.weather === 'deadlock') placeDeadlockWalls(g);
    g.startMatch();
    return g;
  }
  // 교착(DEADLOCK) 날씨 — 통로(row 2·3)에서 결정적으로 3칸을 골라 중립 벽(공0/체12·이동불가) 배치.
  function placeDeadlockWalls(g) {
    var cells = [], c;
    for (c = 1; c <= COLS; c++) { cells.push(K(c, 2)); cells.push(K(c, 3)); }
    // seed rng 로 셔플(양 클라 동일) 후 앞 3칸 — 본체/인스턴스 없는 통로라 항상 빈 칸.
    for (var i = cells.length - 1; i > 0; i--) { var j = Math.floor(g.rng() * (i + 1)); var t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
    var n = Math.min(3, cells.length);
    for (var w = 0; w < n; w++) {
      var cell = cells[w]; if (g.board[cell]) continue;
      var u = g.makeUnit(WALL_OWNER, '__wall'); u.flags.wall = true; u.boundPerm = true;
      g.board[cell] = u;
    }
  }
  CARDS.__body0 = { id: '__body0', name: '본체', cls: 'none', kind: 'body', atk: 0, hp: BODY_HP, abilities: [] };
  CARDS.__body1 = { id: '__body1', name: '본체', cls: 'none', kind: 'body', atk: 0, hp: BODY_HP, abilities: [] };
  CARDS.__wall = { id: '__wall', name: '교착 노드', cls: 'none', kind: 'object', atk: 0, hp: 12, text: '교착 노드 — 공격 가능·이동 불가', abilities: [] }; // DEADLOCK 날씨 중립 벽

  // ============================================================== range display metadata
  // Origin-relative shape of each card's PRIMARY range, for the card-UI mini-grid.
  // dr negative = "forward" (toward enemy). Codes: x=cross s=square r=ring d=diagonal
  // lf=line-forward(from self) bf=line-forward(from body) bs=square(from body) prefix b=body-origin.
  var RANGE = {
    Fork: 'x1', Daemon: 'x1', Worker: 's1', Interrupt: 'x1', Overflow: 'x1', Race: 'x1', Burst: 's2', Signal: 'x1', Panic: 'x1', Exec: 's1',
    Spike: 'lf2', Trap: 'x1', Cursor: 'lf3', Surge: 's1', Longjmp: 'lf2',
    Atomic: 'x1', Join: 'x1', Scheduler: 'move', Pool: 'self', Preempt: 'self', Cluster: 'self', Forkbomb: 's1', Livelock: 'x1', TLS: 'self', Affinity: 'self',
    Latch: 'x1', Checksum: 'self', Collector: 'enemy1', Canary: 'self', Journal: 'self', Sandbox: 'self', ROM: 'self', Snapshot: 'self',
    Cron: 'lf2', Honeypot: 's3', Marshal: 'move', Spooler: 'self', Thrash: 'self', Offset: 'kn', Dispatch: 'kn', JIT: 'self', Fault: 'self', Wormhole: 'global',
    Debug: 'x1', Symlink: 'move', Sudo: 'self', Broadcast: 'allyAll',
    Kernel: 'allyAll', Compile: 'allyAll', Mainframe: 'allyAll', Hivemind: 'allyAll',
    Cache: 'x1', Heap: 'x1', Stack: 'x1', Sentinel: 'x1', Const: 'x1', Watchdog: 'lfEnd', Sweeper: 's2', Persist: 'allyAll', Cannon: 'lfEnd', Overrun: 'self',
    Mutex: 'self', Buffer: 'self', Barrier: 'self', Page: 'self', Lock: 'enemy1', Register: 'enemy1', Pin: 'enemy1', Singleton: 'global', Bedrock: 'self',
    Goto: 'lf2', Hook: 's1', Snipe: 'd2', Trace: 's1', Callback: 's1', Vector: 'lf3', Probe: 's3', Jump: 'move', Async: 'move',
    Pipe: 'self', Proxy: 'self', Lambda: 's2', Singularity: 'self', Conduit: 'self', Inject: 'enemy1', Reroute: 'enemy1', Patch: 'ally1',
    Echo: 'x1', Token: 'x1', Bit: 'x1', Flag: 'x1', Merge: 'x1', Delete: 's2', Loop: 'x1', Stub: 'x1', Ping: 's2', Sonar: 's2', Debug: 'x1',
    Cast: 'enemy1', Bool: 'ally1', Overlord: 'enemy1', Polymorph: 'self', Swap: 'move',
    'boost()': 'ally1', 'overclock()': 'allyAll', 'crash()': 's2', 'strike()': 'bf3', 'spawn()': 'self', 'burst()': 's2', 'fork()': 'ally1', 'rush()': 'move', 'amplify()': 'allyAll',
    'free()': 'bs2', 'lock()': 's2', 'restore()': 'ally1', 'barrier()': 'self', 'purge()': 's2', 'reflect()': 'self', 'compact()': 'allyAll', 'wall()': 'self', 'freeze()': 's2', 'fortify()': 'allyAll', 'segfault()': 'self',
    'memcpy()': 'enemy1', 'goto()': 'move', 'snipe()': 'bf3', 'swap()': 'move', 'inject()': 's2', 'pull()': 'enemy1', 'push()': 'enemy1', 'chain()': 's2', 'proxy()': 'self', 'trace()': 'move',
    'kill()': 's2', 'ping()': 's2', 'sync()': 'ally1', 'flush()': 'ax1', 'shift()': 'move', 'drop()': 's2', 'assert()': 's2', 'throw()': 's2', 'wait()': 's2', 'cast()': 'ally1', 'catch()': 'self', 'bind()': 's2', 'echo()': 'far', 'patch()': 'ally1', 'clear()': 's2', 'exit()': 'global', 'malloc()': 'self', 'grep()': 'self', 'yield()': 'self', 'copy()': 'self',
    // 함수 능력 사거리 일관 표기 보강 — 기본 공격 외 함수(능력) 발동 카드 전수 등록(rename 시 표 미갱신분).
    Fiber: 'x1', Salvo: 's2', Inline: 'x1', Firewall: 'x1', Ripple: 'x1', Relay: 's1', Raycast: 'd2', Profiler: 's1', Predicate: 's2', Cond: 'lf3', Branch: 'x1', Guard: 'x1',
    Semaphore: 'enemy1', Exploit: 'enemy1', Coerce: 'enemy1', Switch: 'self', Pivot: 'move'
  };
  function relCells(code) {
    var out = [], i, dc, dr, n;
    if (code === 'x1' || code === 'ax1') { out = [[1, 0], [-1, 0], [0, 1], [0, -1]]; }
    else if (code === 's1' || code === 's2' || code === 'bs2') { n = code === 's1' ? 1 : 2; for (dc = -n; dc <= n; dc++) for (dr = -n; dr <= n; dr++) if (dc || dr) out.push([dc, dr]); }
    else if (code === 'r2') { n = 2; for (dc = -n; dc <= n; dc++) for (dr = -n; dr <= n; dr++) if (Math.max(Math.abs(dc), Math.abs(dr)) === n) out.push([dc, dr]); }
    else if (code === 's3') { n = 3; for (dc = -n; dc <= n; dc++) for (dr = -n; dr <= n; dr++) if (dc || dr) out.push([dc, dr]); }
    else if (code === 'd3') { for (i = 1; i <= 3; i++) { out.push([i, i]); out.push([i, -i]); out.push([-i, i]); out.push([-i, -i]); } }
    else if (code === 'd2') { for (i = 1; i <= 2; i++) { out.push([i, i]); out.push([i, -i]); out.push([-i, i]); out.push([-i, -i]); } }
    else if (code === 'lf3' || code === 'bf3') { for (i = 1; i <= 3; i++) out.push([0, -i]); }
    else if (code === 'lf4' || code === 'bf4') { for (i = 1; i <= 4; i++) out.push([0, -i]); }
    else if (code === 'lf2' || code === 'bf2') { for (i = 1; i <= 2; i++) out.push([0, -i]); }
    else if (code === 'lfEnd') { for (i = 1; i < ROWS; i++) out.push([0, -i]); }
    else if (code === 'kn') { out = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]; }
    return out;
  }
  function squareRel(n) { var o = [], dc, dr; for (dc = -n; dc <= n; dc++) for (dr = -n; dr <= n; dr++) if (dc || dr) o.push([dc, dr]); return o; }
  function cardRange(id) {
    // range-gated pointers: draw the cast zone from the BODY (bottom of grid) projecting
    // forward, so a "body ±N" range reads as "~N rows ahead", not the whole board.
    var pr = pointerRangeInfo(id);
    if (pr) return { kind: 'grid', cells: squareRel(pr.n), originBottom: true, code: 'cast', castText: pr.text };
    var code = RANGE[id];
    if (!code) { var c = CARDS[id]; if (c && c.kind === 'pointer') code = (c.need === 'enemy' || c.need === 'cell') ? 'enemy1' : (/^ally|twoAlly/.test(c.need || '') ? 'ally1' : 'self'); else code = 'self'; }
    var labels = { ally1: '아군 1', enemy1: '적 1', allyAll: '필드 전체', global: '적 전체', far: '원거리 1칸', move: '이동·위치' };
    if (labels[code]) return { kind: 'label', text: labels[code], code: code };
    // forward-line shapes read clearest projecting up from the bottom of the mini-grid
    return { kind: 'grid', cells: relCells(code), originBottom: code.charAt(0) === 'b' || code.indexOf('lf') === 0, code: code };
  }

  var API = {
    Game: Game, CARDS: CARDS, DECKS: DECKS, DEFAULT_TURN_CAP: DEFAULT_TURN_CAP, newGame: newGame, cardRange: cardRange, pointerRangeInfo: pointerRangeInfo, castCondText: castCondText,
    validateDeck: validateDeck, analyzeDeck: analyzeDeck,
    ai: { takeTurn: aiTakeTurn, step: aiStep, fireAllFor: fireAllFor },
    K: K, P: P, inB: inB, bodyKey: bodyKey, homeRow: homeRow, fwd: fwd,
    cardCls: cardCls, unitKey: unitKey,
    shapes: { ortho: ortho, around8: around8, cross: cross, square: square, ring: ring, diagonal: diagonal, line: line, knight: knight, cheb: cheb, manh: manh }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RT = API;
})(typeof window !== 'undefined' ? window : globalThis);
