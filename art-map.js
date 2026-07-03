/* RUNTIME TCG — 카드 일러스트 매핑(매니페스트).
 * 카드 ID → 일러스트. dev.html(개발자 페이지)이 자동으로 채워넣고 관리한다.
 * 손으로 편집해도 되며, engine.js/ui.js 보다 먼저(또는 ui.js 직전) 로드할 것.
 *
 * 값 형식:
 *   "카드ID": "art/파일명.webp"                        // 간단형(경로만)
 *   "카드ID": { src:"art/파일명.webp", pos:"50% 40%", fit:"cover" }  // 프레이밍 지정형
 *     - pos : object-position(초점). 기본 "50% 50%"
 *     - fit : "cover"(꽉 채움·기본) | "contain"(여백 두고 전체 표시)
 *
 * 파일명 규칙(dev.html slug): 포인터의 "()" 는 "_fn" 으로, 그 외 안전문자만 유지.
 *   예) Fiber → art/Fiber.webp,  boost() → art/boost_fn.webp
 */
window.RT_ART = {
};
