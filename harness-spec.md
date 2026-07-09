# RUNTIME TCG — 개선 작업 사양서 (Harness)

> 10개 투두를 의존성·리스크 기준으로 재배치한 실행 사양서.
> 조사 근거: `art-map.js`, `cards.js`, `engine.js`, `core.js`, `cards.html`, `deckbuilder.js`, `i18n.js`, `i18n-en.js` 전수 조사 완료.

---

## 실행 순서 (Phase)

| # | Phase | 투두(원번호) | 핵심 파일 | 리스크 |
|---|-------|------------|----------|--------|
| P1 | **보호 키워드 통일·밸런스** | 3, 3-1 | cards.js, engine.js, core.js, i18n-en.js | 중(데이터·엔진) |
| P2 | **인게임 키워드/환경 UI** | 8(C3), 4(B1) | core.js | 저 |
| P3 | **도감 Switch 확대 버그** | 2 | cards.html | 저 |
| P4 | **덱빌더 Switch 폼 확대** | 7(C2) | deckbuilder.js | 저 |
| P5 | **덱빌더 검색·키워드 필터** | 6(C1) | deckbuilder.js | 중(UI 신규) |
| P6 | **번역 — require 분리 + 미번역 일괄** | 5(B2), 5-1 | engine.js, i18n.js, i18n-en.js | 중(범위 큼) |
| P7 | **일러스트 중복 제거** | 1 | art-map.js | 저(단, 자산 판단) |

순서 근거: P1이 카드 텍스트를 바꾸므로 번역(P6)보다 **먼저** 와야 재번역 낭비가 없다. P2는 P1의 GLOSS 편집과 같은 파일이라 묶는다. P3~P5는 독립 UI. P6은 가장 범위가 크고 다른 작업 결과 텍스트까지 번역해야 하므로 뒤. P7은 자산 의존이라 마지막.

---

## P1 — 보호(protection) 키워드 승격 · 용어 통일 · 밸런스 (투두 3, 3-1)

### 현황 (조사 결과)
피해 방지 계열이 **3종 메커니즘**으로 흩어져 있고 용어가 제각각(보호막/차단/흡수/막음).

- **메커니즘 A `blockFull`** — 다음 피해 1회 **전량** 차단 후 소멸(턴 무관 1회성).
  - 세터 `Game.prototype.protect` (engine.js:392) → `u.blockFull=true`
  - 소비 `damageBlock` (engine.js:270)
  - 상태칩 `🛡보호` (core.js:2162), 플로트 `🛡 보호막` (core.js:1131)
  - 부여 카드: `mprotect()`(cards.js:202), `Aegis`(500), `Sentry`(504), `Quarantine`(506), `shield()`(510), `harden()`(515), `Failover_STBY`(485), `Fallback`(433)
- **메커니즘 B `bodyShield`** — 본체 전용 흡수풀(N까지 흡수, 초과 적용). `barrier()`(184, 10), `bastion()`(513, 12). → **별개 개념, 이번 통일 대상 아님.**
- **메커니즘 C `damageReduction`** — 피해 감소(면역 아님). → **별개, 대상 아님.**

### 결정 (사양)
"보호"를 **정식 키워드**로 승격하고, 의미를 **"이번 턴 동안 받는 모든 피해 무시(1턴 무피해)"** 로 재정의한다. 기존 `blockFull`(1회 전량 차단)을 **`protUntil`(1턴 무피해)** 로 교체한다.

> ⚠ 밸런스 주의: 기존 blockFull = "1회" 차단 → 신규 = "1턴 내 모든 피해" 차단은 **강화**다. 다타겟 상황에서 과해지므로 아래처럼 부여 카드 스탯/조건을 하향 조정한다.

#### 1. 엔진 (engine.js)
- unit init(engine.js:135)에 `protUntil: 0` 추가, `blockFull` 제거(또는 하위호환 유지).
- 세터 교체:
  ```js
  // 보호: 이번 턴부터 내 다음 턴 시작 전까지 받는 모든 피해 무시
  Game.prototype.protect = function (u) { if (!u) return; u.protUntil = this.turnNo + 2; this._statFx(u, 'shield', 0); };
  ```
  (turnNo는 half-turn 카운터 → `+2` = 상대 공격 포함 1바퀴 보호. Bind와 동일 관례.)
- `damageBlock`(engine.js:268) 소비부 교체:
  ```js
  if (target.protUntil && target.protUntil > this.turnNo) { this.note(CARDS[target.cardId].name + ' 보호(무피해)'); return 0; }
  ```
  body 타입도 동일 처리(기존 blockFull이 body에도 동작했음).
- `transformUnit`(engine.js:493)에서 `atkZeroUntil` 리셋 옆에 `protUntil=0` 추가.
- `protect`를 참조하던 `!x.blockFull` 필터(Aegis/Sentry/shield 후보 선정)는 `!(x.protUntil>G.turnNo)`로 교체.

#### 2. GLOSS 키워드 등록 (core.js:592)
```js
'보호': { t: '보호 · 1턴 무피해', d: '이번 턴 동안 이 인스턴스가 받는 모든 피해를 무시한다(내 다음 턴 시작 시 해제).' },
```
> 정렬은 `KW_PHRASES` longest-first(core.js:680)라 `보호막`(bodyShield 계열 텍스트)이 있으면 먼저 매칭됨. 아래 카드 텍스트에서 "보호막"을 전부 "보호"로 바꾸므로 충돌 없음. (bodyShield 카드 barrier/bastion은 "흡수"로 표현해 분리.)

상태칩/플로트도 라벨 통일: core.js:2162 `🛡보호`(유지), core.js:1131 `🛡 보호막`→`🛡 보호`.

#### 3. 카드 텍스트 간략화 (cards.js) — 키워드 "보호" 사용
| 카드 | 기존 | 신규 |
|------|------|------|
| mprotect() | 아군 1장이 받는 다음 피해 1회를 전부 막음(🛡 보호막 표시) | 아군 1장에게 **보호** |
| Aegis | When 피격 시 「옆칸」 아군 하나에게 보호막(턴당 1회) | When 피격 시 「옆칸」 아군 하나에게 **보호**(턴당 1회) |
| Sentry | For(1) 「옆칸」 아군 하나에게 보호막 | For(1) 「옆칸」 아군 하나에게 **보호** |
| Quarantine | Once 선언 시 적 인스턴스 하나 1턴 봉쇄 + 자기 보호막 | Once 선언 시 적 하나 1턴 봉쇄 + 자기 **보호** |
| shield() | 내 아군 최대 2장(공격력 높은 순)에게 보호막 부여 | 내 아군 최대 2장(공격력 높은 순)에게 **보호** |
| harden() | 아군 1장 보호막 + 체력 +2 | 아군 1장 **보호** + 체력 +2 |
| Failover_STBY | 변신폼(대기형) · When 피격 시 자기 보호막(턴당 1회) | 변신폼(대기형) · When 피격 시 자기 **보호**(턴당 1회) |
| Fallback | …자기 보호막… | …자기 **보호**… |
| Failover(parent) | …(피격 시 보호막)… | …(피격 시 **보호**)… |

#### 4. 밸런스 재튜닝 (강화 상쇄)
"1턴 전체 무피해"는 1회 차단보다 강하므로:
- **shield()**: 2장 → **1장** (또는 유지하되 대상 무피해 1턴은 광역 과함 → 1장 권장). 최종: "가장 공격력 높은 아군 1장에게 보호".
- **Sentry**: For(1) 유지. hp 6 유지.
- **Aegis / Failover_STBY**: 턴당 1회 가드 유지(이미 flags로 제한) → OK.
- **harden()**: 체력 +2 → **+1** (보호가 강해진 만큼).
- 나머지는 단일 대상·조건부라 유지.
> 튜닝 값은 구현 중 실제 카드 스탯 확인 후 미세조정. 목표: 보호 부여의 광역성 축소, 단일·조건부는 유지.

#### 5. i18n (i18n-en.js)
- GLOSS `보호` 항목 EN: `'보호 · 1턴 무피해' → 'Protect · No damage this turn'`, desc 번역.
- 위 카드들의 `I.card[id]` 영문 텍스트를 "protect" 키워드로 재작성(P6에서 함께).

---

## P2 — 인게임 키워드 패널 · 환경 설명 (투두 8/C3, 4/B1)

### 8/C3 — Switch 키워드 좌측 패널 누락
- `glossaryBox()` render 목록(core.js:2580)에 **`line('Switch')` 추가**. `KWSHORT['Switch']`(core.js:2565)·`GLOSS['Switch']`(594)는 이미 존재.
- 룰 화면은 `RULE_ABILITY`(core.js:2903)에 이미 `'Switch'` 포함 → **수정 불필요**(조사로 확인).
- P1에서 추가한 `보호`도 KWSHORT + line + RULE에 넣을지 결정: **넣는다**(신규 키워드이므로). `KWSHORT['보호']` 추가, `line('보호')` 추가, `RULE_*` 목록에 포함.

### 4/B1 — 모바일 상단 환경 설명 줄바꿈
`WEATHER_INFO.desc`(core.js:30-35)를 짧게. 최장은 `deadlock`.
| id | 기존 desc | 신규(짧게) |
|----|----------|-----------|
| clear | 특이 효과 없음 — 표준 런타임. | 효과 없음 |
| overclock | 모든 인스턴스 공격력 +1 (양측). | 전체 공격력 +1 |
| throttle | 모든 인스턴스 공격력 −1 (최소 0). | 전체 공격력 −1 |
| memleak | 8턴부터 매 턴 모든 인스턴스 HP −1. | 8턴+ 매 턴 전체 HP −1 |
| ctxswitch | 양측 매 턴 추가 행동 +1. | 매 턴 행동 +1 |
| deadlock | 교착 노드가 필드를 가로막는다 — 공격 가능·이동 불가. | 교착 노드: 이동 불가 |
- 상세 설명(`WEATHER_DETAIL`, core.js:2594)은 툴팁/데스크톱용이라 유지.
- 추가 안전장치: 모바일 top-bar 텍스트(core.js:1042-1044) `whiteSpace:'normal'` 유지하되 desc 단축으로 1줄화. 필요 시 `nowrap+ellipsis`는 데스크톱 회귀 위험 있어 미적용.
- EN 번역: 신규 짧은 desc를 i18n-en.js에 갱신.

---

## P3 — 도감 Switch 카드 확대 버그 (투두 2)

### 원인
`cards.html showBig()`의 확대 카드 `wrap`(cards.html:283-285)는 `transform:scale(sc)`만 적용하고, `scaledFace`처럼 **스케일된 크기의 외곽 박스로 감싸지 않음**. transform은 레이아웃 박스를 안 바꾸므로 카드의 예약 높이는 220px 그대로 → Switch 카드는 아래 `formsRow`(변신폼)와 겹치고 `col`의 `overflow:auto`가 클리핑 → 깨진 확대.

### 수정
`showBig`에서 확대 카드도 `scaledFace` 패턴(외곽 박스 `FACE_W*sc × FACE_H*sc`)으로 감싼 뒤 `col`에 넣는다. 그러면 폼 행이 카드 실제 높이 아래에 정상 배치.
- 일반 카드 회귀 없음(중앙 정렬 컨테이너라 무해).

---

## P4 — 덱빌더 Switch 폼 프리뷰 확대 (투두 7/C2)

`formsRow(id, sc)`(deckbuilder.js:239) 프리뷰가 너무 작음.
- 호버 프리뷰 호출(deckbuilder.js:331) `formsRow(id, 0.5)` → **`0.72`** 로 상향.
- 기본값(deckbuilder.js:241) `0.6` → **`0.72`**.
- `showCardFace` 높이 보정(deckbuilder.js:332) `FACE_H*0.5` → 새 스케일에 맞게 갱신.
- `faceFor(fid, true)`(compact) 유지(가독성 충분). 모바일 fullscreen(354)은 `Math.min(0.72, scl*0.6)` 정도로 상향.
> 값은 실제 렌더 확인 후 미세조정.

---

## P5 — 덱빌더 카드 검색 · 키워드 분류 필터 (투두 6/C1)

### 현황
`builderPool`(deckbuilder.js:153)에 이미 **클래스 탭**(all/thread/memory/process/generic, 156-160)이 있고 `bFilter`(15)로 필터(166: `c.cls!==bFilter` skip). 카드 필드: `id/name/cls/kind/text/abilities[].kw/switchForms`.

### 추가 사양
1. **검색 입력창**: 모듈 state `bSearch=''` 추가. `builderPool` 상단(클래스 탭 옆/위)에 `<input>`(nameIn 패턴, deckbuilder.js:117 참고). oninput → `bSearch` 갱신 + `UI.render()`. 매칭: `c.id`·`c.name`·`c.text` 소문자 포함.
2. **키워드 분류 필터**: 클래스 탭과 별개 두 번째 버튼 행. 후보 키워드(카드 실제 사용): `For / Once / When / If / While / Switch / require / 보호 / 봉쇄 / 이동`(범위는 실사용 스캔으로 확정). state `bKw='all'`. 매칭: `abilities[].kw === bKw` 또는 `text` 내 키워드 문자열 포함(While/require/보호는 text 스캔 필요).
3. 필터 가드(deckbuilder.js:166) 확장: `bFilter`·`bSearch`·`bKw` AND 결합. 구분자 헤더 로직(168, `lastCls`)은 필터 후에도 동작하도록 유지(빈 클래스 헤더 미출력 처리).
4. i18n: 검색 placeholder·키워드 버튼 라벨 dict 추가.
> UI 톤은 기존 `crt-opt` 버튼·CRT 스타일 재사용.

---

## P6 — 번역: require 분리 + 미번역 일괄 (투두 5/B2, 5-1)

### 5/B2 — require를 별도 텍스트 공간에 번역
#### 현황(버그)
`require`는 카드의 **구조화 필드**(`require:{type,...}` / 포인터는 `castCondition:{...}`)로 존재하고, 화면에선 `condLine(condSpec(card))`(core.js:454)가 **본문과 별도 줄**로 렌더. 그런데 조건 텍스트 생성기 `castCondText`(engine.js:957-970)가 **한국어 하드코딩·i18n 미연동**. 결과:
- EN 모드에서 별도 조건 줄이 항상 한국어(`내 thread 2개+ 필드에 존재`).
- `선언 조건` 라벨도 미번역(dict에 `시전 조건`만 존재, i18n-en.js:194).
- 게다가 일부 OP 카드(`1 per deck · …`)는 `_META_LEAD`(core.js:432)가 영어 접두사를 못 벗겨 `I.card` 블롭이 통째로 본문에 박혀 **길어짐** — 이게 사용자가 본 증상.

#### 수정 사양
1. `castCondText`를 **i18n-aware** 로: 각 `type`(turnCount/classOnBoard/and/or/특수)별로 `RT_I18N` 조회 후 EN/KO 분기. 예:
   ```js
   // EN: 'turnCount' → 'your turn '+n+'+', 'classOnBoard' → n+'+ of your '+cls+' on field', ...
   ```
2. `선언 조건` 라벨(core.js:451,457)·`시전 조건`을 i18n dict 키로 처리(EN: `Requirement` / `Cast condition`).
3. `I.card` 영문 텍스트에서 **중복된 require 영문 접두사 제거**(구조 필드가 담당하므로 본문에 넣지 않음). 특히 OP 카드(Mainframe i18n-en.js:578, Singleton 581, ROM 583)의 `1 per deck · require …` 접두 제거 → 본문 짧아짐.
4. `_META_LEAD`(core.js:432)에 영어 리드(`1 per deck`, `require`, `single-deck`)도 스트립되도록 정규식 보강(또는 effectOnly가 EN 텍스트도 처리).
5. `deckRuleLine` 배지(`클래스 단일`, core.js:485/2433) i18n.

### 5-1 — 미번역 일괄 스윕
조사로 확인된 **미번역 영역**(우선순위순):
- **A. require/조건 텍스트** — 위 5/B2에서 처리.
- **B. WEATHER_DETAIL 상세 6종**(core.js:2594-2601) — dict 추가.
- **C. 멀티플레이/계정 4파일 전면 미번역** — lobby.js, leaderboard.js, auth.js, online.js. 정적 문자열 dict 대량 추가(섹션 헤더·버튼·검증 메시지). MutationObserver 방식이라 **정적 whole-string**만 매칭됨에 유의 — 동적 조합 문자열은 소스에서 `I.t()` 감싸기 필요.
- **D. 덱빌더 검증/동적 문자열**(덱 규칙 위반, `… 최대 …`, `✓ 유효한 덱` 등) — 일부 소스 수정 필요.
- **E. 동적 조합 인게임 문자열**(`2/2 액션`, `◆ … 시전` 등) — 소스에서 숫자/이름 분리 후 `I.t()`.
> 범위가 크므로 C(멀티/계정)는 **정적 문자열 우선**으로 dict 추가하고, 동적 조합은 눈에 띄는 것부터. 완주 목표지만 커밋은 파일 그룹별로 분할.

---

## P7 — 일러스트 중복 제거 (투두 1) — ✅ 해결(2026-07, `all/` 라이브러리로 교체)

> 후속: `F:/projects/card/all`(game-icons 4133개)에서 미사용 아이콘을 골라 10쌍 교체 완료.
> 카드←아이콘: Polymorph←transform, Match←choice, kill()←death-skull, grep()←magnifying-glass,
> yield()←wheat, fortify()←guarded-tower, Failover_ACT←power-generator, Failover_STBY←sleepy,
> Duplex_TX←cloud-upload, Duplex_RX←cloud-download, Fused←convergence-target.
> 남은 중복은 내부 본체 아트(__body/cpu)뿐. 토큰은 사용자 선택으로 현행 유지.


### 조사 결론(정정)
art-map은 서로 다른 **파일명**을 매핑하지만, `art/`에 **바이트 동일한 파일 쌍이 다수** 존재한다(md5 기준). 총 235파일 / **고유 내용 223개**. 여분(미참조) 파일은 배경용 `cpu.png`·`deadlock.png` 2개뿐.

**동일 내용 art 쌍(서로 다른 카드가 같은 그림):**
- 플레이 풀 카드끼리 겹침(핵심 대상 5쌍):
  1. `Adaptive` = `Polymorph`
  2. `kill()` = `strike()`
  3. `Match` = `grep()`
  4. `defer()` = `yield()`
  5. `Aegis` = `fortify()`
- 폼/생성물과 겹침(가시성 낮음): `Failover_ACT`=`Vector`, `Failover_STBY`=`Noop`, `Duplex_TX`=`Relay`, `Duplex_RX`=`Overrun`, `Atomic`=`Fused`
- 내부(의도됨): `__body0`=`__body1`=`cpu`

### 사용자 결정
- **토큰(Token2=Token21)**: **현행 유지**(사용자 선택). 토큰은 도감·풀에서 제외되어 브라우징 시 안 보임. 코드 변경 없음.
- **플레이 카드 5쌍**: 완전 분리하려면 **각 쌍당 새 이미지 1개(총 5개)** 필요 → 여분 자산 없음, 이 세션에서 PNG 생성 불가.

### 남은 조치(자산 대기)
위 5쌍 중복 카드에 넣을 **새 PNG를 제공**해 주시면 `art/`에 추가하고 art-map을 연결하겠습니다(밸런스 무관, 순수 표시). 어느 카드를 새 그림으로 바꿀지도 지정 가능. 대안(승인 시): 임시로 배경 아트를 전용하거나 크롭 차등을 적용 — 다만 아이콘형이라 품질 저하가 있어 비권장.

---

## 검증 계획
- P1/P2/P3/P4: `index.html`/`cards.html`/덱빌더를 로컬 서버로 띄워 실제 렌더 확인(도감 Switch 확대, 덱빌더 폼 크기, 좌측 키워드 패널, 모바일 폭 환경바).
- P5: 검색/필터 동작(입력·키워드 버튼 조합) 수동 확인.
- P6: 언어 토글(KO↔EN)로 require 줄·멀티/계정 화면 번역 확인.
- 각 Phase 커밋 분리. 캐시버스트(index.html 등 `?v=`) 필요 시 상향.
