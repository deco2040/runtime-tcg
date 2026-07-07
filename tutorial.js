/* RUNTIME TCG — tutorial guide screen(읽기형 가이드 + 페이지). 실습(practice) 모드 로직은 core 에 있음. */
(function () {
  'use strict';
  var UI = window.RTUI = window.RTUI || {};
  var el = UI.el, SKIN = UI.SKIN, titlebar = UI.titlebar, clear = UI.clear, app = UI.app;
  var hexa = UI.hexa, richText = UI.richText, RT = UI.RT, CLS = UI.CLS;
  // =================================================================== 튜토리얼 (읽기형 가이드 + 실습)
  // 미니 보드 다이어그램 — 5×4 그리드(보드 스킨 재사용). cells: {"c,r":{label,bg,border,fg,fs}}.
  function tutMini(cells, opts) {
    opts = opts || {};
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gridTemplateRows: 'repeat(4,1fr)', gap: '4px', aspectRatio: '5/4', width: '100%', maxWidth: (opts.max || 340) + 'px', margin: '4px auto', background: SKIN.boardFace, border: '1px solid ' + SKIN.ink, padding: '6px', boxShadow: 'inset 2px 2px 0 ' + SKIN.bevelLo } });
    for (var r = 1; r <= 4; r++) for (var c = 1; c <= 5; c++) {
      var cell = cells && cells[c + ',' + r];
      var cs = { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid ' + SKIN.line, background: SKIN.cellFace, minHeight: 0, minWidth: 0, textAlign: 'center', lineHeight: 1.05 };
      if (!cell && opts.home !== false) {
        if (r === 4) { cs.background = hexa(SKIN.own, .14); cs.borderColor = hexa(SKIN.own, .5); }
        else if (r === 1) { cs.background = hexa(SKIN.enemy, .14); cs.borderColor = hexa(SKIN.enemy, .5); }
      }
      var kids = [];
      if (cell) {
        if (cell.bg) cs.background = cell.bg;
        if (cell.border) cs.borderColor = cell.border;
        if (cell.label) kids.push(el('span', { class: cell.mono ? 'mono' : 'grot', style: { color: cell.fg || SKIN.txt, fontSize: (cell.fs || 12) + 'px', fontWeight: 700 } }, [cell.label]));
      }
      grid.appendChild(el('div', { style: cs }, kids));
    }
    return grid;
  }
  function tutTile(label, fg, bg) { return { label: label, fg: fg || '#fff', bg: bg || '#1d1d24', border: bg || '#1d1d24' }; }
  // **볼드** 는 강조 스팬으로, 나머지 텍스트는 richText(키워드 툴팁 유지)로 렌더.
  function tutRich(text) {
    if (!text) return [];
    var out = [], re = /\*\*([^*]+)\*\*/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out = out.concat(richText(text.slice(last, m.index)));
      out.push(el('b', { style: { fontWeight: 700, color: SKIN.txt } }, [m[1]]));
      last = re.lastIndex;
    }
    if (last < text.length) out = out.concat(richText(text.slice(last)));
    return out;
  }
  function tutP(txt) { return el('div', { style: { fontSize: '13px', lineHeight: 1.65, color: SKIN.txt, marginBottom: '9px' } }, tutRich(txt)); }
  function tutLi(txt) { return el('div', { style: { fontSize: '12.5px', lineHeight: 1.55, color: SKIN.panelText, margin: '0 0 5px 4px', paddingLeft: '14px', position: 'relative' } }, [el('span', { style: { position: 'absolute', left: 0, color: SKIN.own, fontWeight: 700 } }, ['▸']), el('span', {}, tutRich(txt))]);
  }
  // 심화용 정의 리스트 — 왼쪽 키워드 칩 + 오른쪽 설명. left 가 문자열이면 다크 칩으로 감싼다.
  function tutChip(label, bg) { return el('span', { class: 'mono', style: { fontSize: '9.5px', fontWeight: 700, color: '#fff', background: bg || '#1d1d24', padding: '1px 6px', borderRadius: '2px', whiteSpace: 'nowrap' } }, [label]); }
  function tutDefList(rows) {
    var box = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', margin: '4px 0 8px' } });
    rows.forEach(function (r) {
      var left = typeof r[0] === 'string' ? tutChip(r[0], r[2]) : r[0];
      box.appendChild(el('div', { style: { display: 'flex', gap: '9px', alignItems: 'flex-start' } }, [
        el('div', { style: { flex: 'none', width: '84px', display: 'flex', justifyContent: 'flex-start', paddingTop: '1px' } }, [left]),
        el('div', { style: { flex: 1, fontSize: '12px', lineHeight: 1.5, color: SKIN.panelText } }, tutRich(r[1]))
      ]));
    });
    return box;
  }
  // 각 페이지 = { t: 제목, build: ()=>node }
  function tutPages() {
    return [
      { t: '게임의 목표', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('**RUNTIME**은 2인 턴제 카드 대전입니다. 두 플레이어가 하나의 **5열 × 4행 보드**를 위·아래로 나눠 씁니다.'));
        box.appendChild(tutP('각자 **본체(HP 40)** 가 있고, **상대 본체의 HP를 0으로 만들면 승리**합니다. 유닛을 필드에 깔고, 앞으로 밀고 나가 상대 본체를 두들기는 것이 큰 그림입니다.'));
        box.appendChild(tutMini({ '3,1': tutTile('적 본체', '#e6a3bd', '#3a2630'), '3,4': tutTile('내 본체', '#9db8e6', '#1d1d24') }));
        box.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, textAlign: 'center' } }, ['위=상대 진영(마젠타) · 아래=내 진영(틸) · 본체는 3열에서 마주본다']));
        return box;
      } },
      { t: '보드와 진영', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('맨 아랫줄(4행)이 **내 홈**, 맨 윗줄(1행)이 **상대 홈**입니다. 가운데 두 줄(2·3행)은 **중립 통로** — 여기서 전투가 벌어집니다.'));
        box.appendChild(tutLi('새 유닛은 항상 **내 홈칸(빈 칸)** 에만 놓을 수 있어요.'));
        box.appendChild(tutLi('유닛은 **상하좌우로 1칸씩** 움직여 앞으로 전진합니다(대각선 X).'));
        box.appendChild(tutLi('**본체도 보드의 한 칸** — 옆에 붙으면 기본 공격으로 때릴 수 있습니다.'));
        box.appendChild(tutMini({ '1,4': tutTile('홈', '#fff', hexa(SKIN.own, .8)), '2,4': tutTile('홈', '#fff', hexa(SKIN.own, .8)), '4,4': tutTile('홈', '#fff', hexa(SKIN.own, .8)), '5,4': tutTile('홈', '#fff', hexa(SKIN.own, .8)), '3,4': tutTile('내 본체', '#9db8e6', '#1d1d24'), '3,1': tutTile('적 본체', '#e6a3bd', '#3a2630'), '2,2': tutTile('통로', SKIN.muted, SKIN.cellFace), '3,3': tutTile('통로', SKIN.muted, SKIN.cellFace), '4,2': tutTile('통로', SKIN.muted, SKIN.cellFace) }));
        return box;
      } },
      { t: '한 턴에 할 수 있는 것', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('마나·코스트가 없습니다. 대신 **매 턴 액션 2개**를 씁니다. 아래 셋 중 아무거나 조합하세요.'));
        box.appendChild(tutLi('**① 선언** — 손패의 유닛 카드를 홈칸에 놓기 (액션 1)'));
        box.appendChild(tutLi('**② 이동** — 내 유닛을 옆 빈 칸으로 1칸 옮기기 (액션 1)'));
        box.appendChild(tutLi('**③ 포인터 시전** — 1회성 주문 카드 사용 (액션 1)'));
        box.appendChild(el('div', { style: { height: '6px' } }));
        box.appendChild(tutP('그리고 **액션을 쓰지 않는 무료 행동**도 있습니다:'));
        box.appendChild(tutLi('**기본 공격** — 유닛마다 턴에 1번, 공짜 (다음 장에서 자세히)'));
        box.appendChild(tutLi('**함수(능력) 발동** — 카드에 적힌 특수 능력'));
        box.appendChild(tutP('턴이 시작되면 카드를 **1장 뽑습니다**(선공·후공 모두 매 턴). 손패는 최대 10장.'));
        return box;
      } },
      { t: '전투 — 기본 공격', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('모든 유닛은 자기 턴에 **「옆칸」(상하좌우 4칸)의 적** 하나를 **무료로, 턴당 1회** 때립니다. 대각선은 닿지 않아요.'));
        box.appendChild(tutMini({ '3,2': tutTile('내 유닛', '#fff', SKIN.own), '2,2': tutTile('⚔', '#fff', hexa(SKIN.enemy, .85)), '4,2': tutTile('⚔', '#fff', hexa(SKIN.enemy, .85)), '3,1': tutTile('⚔ 적본체', '#fff', hexa(SKIN.enemy, .85)), '3,3': tutTile('⚔', '#fff', hexa(SKIN.enemy, .85)) }, { home: false }));
        box.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, textAlign: 'center', marginBottom: '8px' } }, ['빨강 ⚔ = 내 유닛이 때릴 수 있는 옆칸 4개']));
        box.appendChild(tutLi('피해는 **공격력(ATK)** 만큼. 대상 **체력(HP)** 이 0이 되면 파괴됩니다.'));
        box.appendChild(tutLi('받은 피해는 **턴을 넘겨도 누적**됩니다(자동 회복 없음).'));
        box.appendChild(tutLi('**반격은 없습니다** — 때린 쪽만 피해를 줍니다. 방어는 memory 유닛의 벽·피해감소로.'));
        box.appendChild(tutLi('카드가 말하는 **「적」 = 적 유닛 + 적 본체**. 그래서 **피해를 주는 능력·포인터**도 범위·직선이 닿으면 **본체를 직접** 노릴 수 있어요. (봉쇄·강제 이동·약화 같은 조작은 유닛에만 적용 — 「적 인스턴스」/「적 본체」로 콕 집어 적힌 경우는 그 대상만.)'));
        return box;
      } },
      { t: '클래스 상성', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('유닛은 세 클래스로 나뉘고 **가위바위보** 관계입니다:'));
        box.appendChild(el('div', { class: 'grot', style: { textAlign: 'center', fontWeight: 700, fontSize: '13px', margin: '4px 0 10px', color: SKIN.txt } }, [
          el('span', { style: { color: CLS.thread } }, ['thread']), ' → ',
          el('span', { style: { color: CLS.process } }, ['process']), ' → ',
          el('span', { style: { color: CLS.memory } }, ['memory']), ' → ',
          el('span', { style: { color: CLS.thread } }, ['thread'])
        ]));
        box.appendChild(tutLi('**thread(공격형)** — 공격 높고 체력 낮은 유리대포. 뭉쳐서 근접 압박.'));
        box.appendChild(tutLi('**memory(방어형)** — 체력 높고 벽·봉쇄·반사로 통제. 느림.'));
        box.appendChild(tutLi('**process(유틸형)** — 변칙 함수 범위·강제 이동·주문 콤보로 진형을 흔든다.'));
        box.appendChild(tutLi('**generic(무클래스)** — 어느 덱에나 들어가는 독립형.'));
        box.appendChild(tutP('카드의 능력 키워드: **When**(자동) · **If**(원하면 발동) · **While**(상시) · **For**(내 턴마다 수동, 무료).'));
        return box;
      } },
      { t: '승리 · 무승부 · 팁', build: function () {
        var box = el('div', {});
        box.appendChild(tutLi('**승리** — 상대 본체 HP 0 이하로.'));
        box.appendChild(tutLi('**턴 상한 ' + RT.DEFAULT_TURN_CAP + '** — 그때까지 안 끝나면 남은 본체 HP가 높은 쪽 승리(동률이면 무승부).'));
        box.appendChild(tutLi('덱을 다 뽑아도 지지 않아요(대신 드로우 못 함).'));
        box.appendChild(el('div', { style: { height: '6px' } }));
        box.appendChild(tutP('**요령:** 홈에 유닛을 깔고 → 통로로 전진시켜 → 옆칸에서 기본 공격. 방어 유닛을 앞세워 상대 진격을 막으면서 본체를 노리세요.'));
        box.appendChild(tutP('여기까지가 **기초**! 아래 버튼으로 바로 실습하거나, **다음 ▶** 으로 심화 내용(피로 · 능력 키워드 · 특수 상태)을 볼 수 있어요.'));
        box.appendChild(el('div', { style: { textAlign: 'center', marginTop: '10px' } }, [
          el('button', { class: 'btn', style: { fontSize: '15px', padding: '12px 26px', background: SKIN.own, color: '#fff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.35), inset -2px -2px 0 rgba(0,0,0,.35), 2px 2px 0 rgba(0,0,0,.25)' }, onclick: UI.startTutorialPractice }, ['▶ 직접 해보기 (실습)'])
        ]));
        return box;
      } },
      // ===== 심화 과정 =====
      { t: '피로 · 자원 관리', tier: '심화', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('마나·코스트가 없는 대신 **손패와 덱이 곧 자원**입니다. 관리 포인트를 정리해요.'));
        box.appendChild(tutDefList([
          ['드로우', '내 턴 시작마다 카드 **1장**을 뽑습니다(선공·후공 모두 매 턴). 능력·포인터로 더 뽑을 수도 있어요.'],
          ['손패 상한', '손패는 **최대 10장**. 넘치게 뽑으면 초과분은 그대로 버려집니다(오버드로우).'],
          ['피로', '덱이 비어 **뽑을 카드가 없으면**, 뽑는 대신 **내 본체가 피로 피해**를 받습니다. 피해량은 뽑지 못할 때마다 **누적(3 → 4 → 5 …)** 되어 갈수록 커집니다.', '#b23a72']
        ]));
        box.appendChild(tutP('덱 소진 자체는 패배가 아니지만 **피로 피해는 매 턴 쌓입니다.** 장기전에서 덱이 먼저 마르는 쪽이 스스로 무너질 수 있으니 카드를 너무 헤프게 쓰지 마세요.'));
        box.appendChild(tutP('반대로, 오래 버텨 상대를 먼저 피로로 몰아가는 것도 하나의 승리 플랜입니다.'));
        return box;
      } },
      { t: '능력 키워드 (함수)', tier: '심화', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('카드의 능력은 **발동 방식**을 나타내는 키워드로 시작합니다. 대부분 **무료**(액션 소비 없음)예요.'));
        box.appendChild(tutDefList([
          ['When', '조건이 충족되면 **자동으로 강제 발동**. 예) 소환될 때, 피해를 받고 살아남을 때.'],
          ['If', '조건이 충족되면 **원할 때 골라서 발동**(하스스톤의 선택 효과처럼).'],
          ['Once', '게임 중 **딱 한 번**만 터지는 일회성. 주로 선언·파괴 순간에.'],
          ['While', '조건이 유지되는 **동안 상시** 적용되는 지속 효과(=오라). 다음 장 참고.'],
          ['For(N)', '**내 턴마다 직접** 발동하는 능동 능력. 턴당 1회, 게임 전체에서 총 **N번**. 무료.']
        ]));
        box.appendChild(tutP('능력이 **언제** 터지는지(트리거)도 다양합니다:'));
        box.appendChild(tutLi('**선언 시** · **파괴 시** · **피해받고 생존 시**'));
        box.appendChild(tutLi('**턴 시작·종료** · **이동 후** · **적이 옆칸으로 들어올 때** · **포인터 시전 시**'));
        box.appendChild(tutP('필드 유닛에 커서를 올리면 **함수 범위**(🟡)가 보드에 표시됩니다. For 능력은 유닛을 클릭하면 나오는 **⚡ 발동** 버튼으로 씁니다.'));
        return box;
      } },
      { t: '특수 상태 · 오라', tier: '심화', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('전투 중 유닛·본체에 붙는 **주요 상태**입니다.'));
        box.appendChild(tutDefList([
          ['🔒 봉쇄', '**이동·기본 공격·For 능동 전부 불가**. While 오라와 When/If/Once 트리거는 유지됩니다. (memory의 Cache/Const 등이 옆칸 적을 묶어요.) ※「이동 불가」는 이동만 막는 별개 상태.'],
          ['ATK0', '**공격력 0** — 기본 공격 불가. 영구이거나 몇 턴 한시입니다.'],
          ['본체 보호막', '본체가 받을 다음 피해를 **먼저 흡수**. barrier() +10, catch() +6. 단 **피로 피해는 못 막습니다.**'],
          ['피해 누적', 'HP는 **회복 전까지 깎인 채 유지**(자동 회복 없음). 회복은 누적된 피해를 되돌립니다.']
        ]));
        box.appendChild(tutP('**지속 오라(While)** 는 조건이 유지되는 동안 주변에 상시 영향을 줍니다. 대표 예:'));
        box.appendChild(tutDefList([
          ['강화', '옆칸 아군 공격력 **+1~**(Flag·Race·Overflow). thread는 뭉칠수록 세집니다.', '#3c8a66'],
          ['약화', '옆칸 적 공격력 **−1~−2**(Stub·Stack). memory의 통제 수단.', '#2456a6'],
          ['피해감소', '옆칸 아군이 받는 피해 **−1**(Heap), 본체 옆이면 본체 피해 **−2**(Barrier).', '#2456a6']
        ]));
        box.appendChild(tutP('적 유닛에 커서를 올려 어떤 오라·상태를 가졌는지 확인하고, **오라 유닛부터 걷어내는 것**이 공략의 기본입니다.'));
        box.appendChild(el('div', { style: { textAlign: 'center', marginTop: '12px' } }, [
          el('button', { class: 'btn', style: { fontSize: '15px', padding: '12px 26px', background: SKIN.own, color: '#fff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.35), inset -2px -2px 0 rgba(0,0,0,.35), 2px 2px 0 rgba(0,0,0,.25)' }, onclick: UI.startTutorialPractice }, ['▶ 직접 해보기 (실습)'])
        ]));
        return box;
      } },
      { t: '날씨 (RUNTIME WEATHER)', tier: '심화', build: function () {
        var box = el('div', {});
        box.appendChild(tutP('**게임을 시작할 때마다 「날씨」 1종이 무작위로 지정**되어, 그 판 내내 필드 전체에 영향을 줍니다. 시작 시 어떤 날씨인지 **연출로 공개**되고, 대국 화면 상단(타이틀바)과 컨트롤 바의 **배지**로 언제든 확인할 수 있어요. (멀티플레이 대전은 양쪽에 **같은 날씨**가 적용됩니다.)'));
        var rows = [
          ['🟢', '평온', '#3c8a66', '특이 효과 없음 — 표준 런타임.'],
          ['⚡', '오버클럭', '#c8951b', '모든 유닛 공격력 **+1** (양측·즉시).'],
          ['🧊', '스로틀링', '#3f7bd6', '모든 유닛 공격력 **−1** (최소 0·즉시).'],
          ['🩸', '메모리 누수', '#c23c70', '**8턴부터** 매 턴 모든 유닛 HP **−1** — 장기전일수록 압박이 커집니다.'],
          ['🧹', '가비지 컬렉션', '#8a6fb0', '**8턴부터 4턴마다** 체력이 가장 낮은 유닛 1기를 **회수(파괴)**.'],
          ['🧱', '방화벽', '#8a8a94', '**중립 벽**이 통로를 가로막습니다 — **양쪽 다 공격 가능·이동 불가**.']
        ];
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', margin: '6px 0 10px' } });
        rows.forEach(function (r) {
          list.appendChild(el('div', { style: { display: 'flex', gap: '9px', alignItems: 'flex-start' } }, [
            el('span', { style: { flex: 'none', width: '20px', fontSize: '16px', textAlign: 'center', lineHeight: 1.3 } }, [r[0]]),
            el('div', { style: { flex: 'none', width: '84px' } }, [el('b', { style: { color: r[2], fontSize: '12.5px', fontWeight: 700 } }, [r[1]])]),
            el('div', { style: { flex: 1, fontSize: '12px', lineHeight: 1.5, color: SKIN.panelText } }, tutRich(r[3]))
          ]));
        });
        box.appendChild(list);
        box.appendChild(tutP('**방화벽**의 중립 벽은 어느 편도 아니라서 **양쪽 모두 때려서** 부술 수 있지만, 스스로는 **움직이지 않고 공격도 하지 않습니다.** 진격로를 막거나 우회를 강요하죠.'));
        box.appendChild(tutMini({ '1,2': tutTile('🧱 벽', '#fff', '#484850'), '2,2': tutTile('🧱 벽', '#fff', '#484850'), '3,2': tutTile('🧱 벽', '#fff', '#484850'), '3,4': tutTile('내 본체', '#9db8e6', '#1d1d24'), '3,1': tutTile('적 본체', '#e6a3bd', '#3a2630') }));
        box.appendChild(el('div', { class: 'mono', style: { fontSize: '10px', color: SKIN.muted, textAlign: 'center', marginBottom: '8px' } }, ['방화벽 예시 — 통로(2·3행)에 중립 벽이 배치된다']));
        box.appendChild(tutP('**CHALLENGE 모드**에선 스테이지가 오를수록 날씨가 더 가혹해지고, **5·10…단계 보스전**에선 피해·차폐형 날씨가 강제됩니다. 날씨를 읽고 **덱과 전개 속도**를 맞추는 것이 새로운 공략 포인트예요.'));
        box.appendChild(el('div', { style: { textAlign: 'center', marginTop: '12px' } }, [
          el('button', { class: 'btn', style: { fontSize: '15px', padding: '12px 26px', background: SKIN.own, color: '#fff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.35), inset -2px -2px 0 rgba(0,0,0,.35), 2px 2px 0 rgba(0,0,0,.25)' }, onclick: UI.startTutorialPractice }, ['▶ 직접 해보기 (실습)'])
        ]));
        return box;
      } }
    ];
  }
  function renderTutorial(page) {
    UI.exitToGuide();   // 가이드 진입 시 게임/실습 상태 초기화 (core 소유 G·tutorial)
    clear();
    var pages = tutPages();
    page = Math.max(0, Math.min(page, pages.length - 1));
    var pg = pages[page];
    var wrap = el('div', { class: 'bevel', style: { background: SKIN.chassis, color: SKIN.txt, maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column' } });
    wrap.appendChild(titlebar('RUNTIME — 게임 방법   ·   ' + (page + 1) + ' / ' + pages.length));
    var body = el('div', { style: { padding: 'clamp(14px,2.4vw,26px)' } });
    var tier = pg.tier || '기초';
    body.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '4px', flexWrap: 'wrap' } }, [
      el('span', { class: 'grot', style: { fontWeight: 700, fontSize: '22px', letterSpacing: '.02em' } }, ['📖 ' + pg.t]),
      el('span', { class: 'mono', style: { fontSize: '10px', fontWeight: 700, letterSpacing: '.08em', padding: '2px 8px', color: '#fff', background: tier === '심화' ? SKIN.rangeGold : SKIN.own, border: '1px solid ' + SKIN.ink } }, [tier === '심화' ? '심화 과정' : '기초'])
    ]));
    body.appendChild(el('div', { style: { height: '1px', background: SKIN.line, margin: '8px 0 14px' } }));
    body.appendChild(pg.build());
    // 페이지 점(진행 표시)
    var dots = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center', margin: '16px 0 12px' } });
    pages.forEach(function (_, i) { dots.appendChild(el('span', { style: { width: i === page ? '20px' : '8px', height: '8px', borderRadius: '4px', background: i === page ? SKIN.own : SKIN.chassisSunk, border: '1px solid ' + SKIN.ink, transition: 'width .15s', cursor: 'pointer' }, onclick: (function (n) { return function () { renderTutorial(n); }; })(i) })); });
    body.appendChild(dots);
    var nav = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
      el('button', { class: 'btn ghost', disabled: page === 0 ? 'disabled' : null, onclick: page === 0 ? null : function () { renderTutorial(page - 1); } }, ['◀ 이전']),
      el('button', { class: 'btn ghost', style: { fontSize: '12px' }, onclick: function () { UI.renderTitle(); } }, ['✕ 닫기']),
      el('span', { style: { flex: 1 } }),
      page < pages.length - 1
        ? el('button', { class: 'btn', onclick: function () { renderTutorial(page + 1); } }, ['다음 ▶'])
        : el('button', { class: 'btn', style: { background: SKIN.own, color: '#fff' }, onclick: UI.startTutorialPractice }, ['▶ 직접 해보기'])
    ]);
    body.appendChild(nav);
    wrap.appendChild(body);
    app.appendChild(wrap);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  UI.renderTutorial = renderTutorial;
  UI.tutRich = tutRich;
})();
