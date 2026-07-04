/* RUNTIME TCG — 멀티플레이 백엔드 설정.
 *
 * Supabase 프로젝트의 URL 과 anon(public) 키를 아래에 채우면 로비/인증이 활성화됩니다.
 * anon 키는 공개용이라 클라이언트에 노출돼도 안전합니다(진짜 비밀은 service_role — 절대 넣지 말 것).
 *
 *   Supabase 대시보드 → Project Settings → API 에서 확인:
 *     - Project URL       → url
 *     - anon public key    → anonKey
 *
 * 값이 비어있거나 'YOUR-...' placeholder 이면 net.js 가 오프라인 모드로 우아하게 비활성화됩니다
 * (로비 화면에 설정 안내가 표시됨).
 *
 * ⚠️ 대시보드에서 익명 로그인(게스트)도 켜야 합니다:
 *     Authentication → Providers → Anonymous → Enable
 */
window.RT_SUPABASE = {
  url: "https://ugczgmvtgzxxjclxdeib.supabase.co", // 예: https://abcdefgh.supabase.co
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnY3pnbXZ0Z3p4eGpjbHhkZWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNjQxNTQsImV4cCI6MjA5ODc0MDE1NH0.AN6UrTXj23-nSyusrjw4otjbKej_idFTUPNWrCIoWWc",
};

/* 디스코드 커뮤니티 초대 링크.
 * 디스코드 서버를 만든 뒤 [서버 이름 ▾ → 초대하기 → 초대 링크 편집 → '만료 기한 없음' + '최대 사용 횟수 무제한']
 * 으로 영구 초대 링크를 만들어 아래 invite 값에 붙여넣으세요.
 * 값이 비어있거나 'YOUR-...' placeholder 이면 타이틀 화면의 DISCORD 버튼이 자동으로 숨겨집니다. */
window.RT_DISCORD = {
  invite: "https://discord.gg/bPSVUfeJqe",
};
