/* RUNTIME TCG — EN 번역 데이터. window.RT_I18N.dict(KO→EN 문자열) + .card(id→효과문 EN) 채움.
 * i18n.js 다음에 로드. 미기재 항목은 자동으로 한국어 폴백된다. */
(function () {
  var I = window.RT_I18N; if (!I) return;
  // (데이터는 아래 assign 으로 채워짐 — 번역 진행 중 항목은 KO 폴백)
  I.dict = Object.assign(I.dict || {}, {
    /* __DICT__ */
  });
  I.card = Object.assign(I.card || {}, {
    /* __CARD__ */
  });
})();
