# RUNTIME TCG (card/deploy) — 프로젝트 지침

## 카드를 만들거나 효과문을 수정할 때 (필수)

**새 카드 추가·효과문 변경 전에 반드시 [텍스트 길이 가이드라인]을 참조할 것.**
가이드라인 원문: `i18n-en.js` 상단 `I.card` 정의 바로 앞 주석 블록. (KO 요약: `cards.js` 헤더)

- 효과문은 카드 페이스 고정높이 패널에 렌더되고, 넘치면 `fitHand()`가 폰트를 자동 축소한다(하한 **5.5px**, `core.js`). 하한에서도 안 들어가면 **잘린다**.
- 길이 예산은 **effectOnly 후**(= `require …/조건 …` 접두사와 `덱당 1`·`XX 단일 덱` 뗀 '효과 본문') 글자수 기준. 시전조건/단일룰 라인은 패널 위에 별도로 그려져 예산을 줄인다.

| 효과 본문 조건 | EN(라틴) | KO(CJK) |
|---|---|---|
| 시전조건·단일룰 둘 다 없음 | ≤130 | ≤78 |
| 시전조건 또는 단일룰 택1 | ≤98 | ≤62 |
| 둘 다 있음 | ≤82 | ≤52 |

- 초과 시 **문구를 줄여** 맞출 것. 줄일 수 없으면 예외로 판단하기 전에 근거를 남길 것(현재 예외: Branch·Cond·Cannon).
- **일관성**: 같은 개념은 같은 표현으로. 예) `deal ATK damage`(공격력만큼 피해), `ignoring walls/instances`, `enemy`(적=인스턴스+본체) ≠ `enemy instance`(인스턴스만).
- **점검**: 아래 감사 스크립트로 예산 초과 카드를 확인하고, 문서화된 예외 외에 새 초과가 없어야 한다.

```bash
# 효과 본문 길이 감사 — 예산 초과 카드 나열 (문서화 예외: Cannon/Cond/Branch)
node -e 'global.document={documentElement:{getAttribute:()=>"ko",setAttribute:()=>{}},addEventListener:()=>{},readyState:"complete",body:null};global.window={};global.navigator={language:"ko"};global.localStorage={getItem:()=>null,setItem:()=>{}};global.setTimeout=f=>0;global.requestAnimationFrame=f=>0;require("./cards.js");require("./engine.js");var C=window.RT.CARDS;require("./i18n.js");require("./i18n-en.js");var EN=window.RT_I18N.card;var _M=/^\s*(덱당|require|조건|1 per deck|single[- ]class deck|single[- ]deck)|단일\s*덱/i,_K=/^\s*(Once|While|When|If|For|Switch)\b/;function eo(t){if(!t)return t||"";var p=t.split(" · "),mi=-1;for(var k=0;k<p.length;k++){if(_K.test(p[k])){mi=k;break;}}if(mi>0&&_M.test(p[0]))return p.slice(mi).join(" · ");if(mi===-1){var i=0;while(i<p.length&&_M.test(p[i]))i++;if(i>0)return p.slice(i).join(" · ");}return t;}function b(c,r,en){var k=(c?1:0)+(r?1:0);return en?(k===0?130:k===1?98:82):(k===0?78:k===1?62:52);}Object.keys(C).forEach(id=>{var c=C[id];if(!c||c.kind==="body"||/^__/.test(id)||/^(Token|Wall)/.test(id)||c.form)return;var cd=!!(c.require||c.castCondition),ru=!!c.deckRule,en=EN[id]?eo(EN[id]).length:0,ko=eo(c.text||"").length;if(en>b(cd,ru,1)||ko>b(cd,ru,0))console.log(id+"  EN="+en+"/"+b(cd,ru,1)+"  KO="+ko+"/"+b(cd,ru,0));});'
```

## 로드 순서 / 구조 (참고)
- `cards.js`(KO 원문·효과 정의) → `engine.js`(kit 주입) 순으로 로드. 시전 조건문은 `castCondText`(engine.js)가 언어분기로 생성 — 사전에 넣지 말 것.
- EN 번역: `i18n-en.js`의 `I.dict`(정적 전체일치, DOM 번역기) + `I.card`(카드 효과문 id→EN). 숫자 포함 동적·placeholder/title 속성은 DOM 번역기가 못 잡으므로 소스레벨 `tL()`/`pick()` 로 처리.
- 구조·i18n 한계는 프로젝트 메모리(`memory/`) 참조.
