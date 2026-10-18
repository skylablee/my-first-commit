# PHASE 3 보안 점검

코드·로컬 PostgreSQL·모사 API로 확인한 범위입니다. 실제 Supabase/Meta/Stripe 자격증명이 없어 실서비스 침투/계약/권한 검증은 수행하지 않았습니다.

| 분류 | 문제/위협 | 조치·검증 |
| --- | --- | --- |
| Critical | 클라이언트가 유료 권한·카운터·admin을 변경 | 해당 테이블 DML/RPC 권한을 서버 전용으로 제한, 사용자 metadata 미신뢰, RLS/role 테스트 |
| Critical | 위조 결제 성공·저가 Price로 상위 플랜 부여 | 성공 redirect 무권한, 원문 HMAC+timestamp, canonical 구독·paid invoice·가격/통화/주기 검사 |
| High | 같은 webhook으로 중복 반영/오래된 이벤트 역전 | unique provider/event ID와 트랜잭션 반영, stale event 무시, 실패 후 재전송 허용 |
| High | 동시 AI 요청·브랜드 생성의 한도 우회 | advisory lock·월 카운터·brand DB trigger, 서비스 예산 제한 |
| High | 다운그레이드로 사용량 초기화·초과 브랜드 계속 사용 | 카운터 유지, 기존 데이터 보존+초과 브랜드 보관, 생성/발행/수정 서버·DB 제한 |
| High | 중복 Cron·실패 재시도로 이중 게시 | unique content/provider, SKIP LOCKED, lease token, 비멱등 요청 전 checkpoint, uncertain 재시도 금지 |
| High | OAuth CSRF/재사용·토큰 노출 | HttpOnly SameSite cookie+사용자/10분 state hash+원자적 consume, AES-GCM+AAD, encrypted column client SELECT 금지 |
| High | mock 결제가 production 권한으로 연결 | Vercel stage 우선·prebuild fail, mock 생성자 제한, sandbox DB 명시 활성화 및 운영 차단 |
| High | 헤더 IP 변경으로 rate limit 우회 | Vercel 정규화 IP만 신뢰, 나머지 shared bucket, DB 원자적 user/IP 제한 |
| High | 중복 Checkout·웹훅 누락 후 재결제 | 영구 Stripe customer 매핑, 제공자 활성 구독 확인, checkout attempt·idempotency 재사용 |
| Medium | XSS | React 텍스트/textarea, RSS HTML 제거, javascript 링크 거부, 공개 API 응답 스키마 검증 |
| Medium | CSRF | 인증 mutation의 same-origin 검사, OAuth state, Cron bearer, webhook 서명 |
| Medium | SSRF | 외부 호출 host 고정, 사용자 원문 URL 미수집, 리다이렉트 오류 처리 |
| Medium | SQL injection/IDOR | Supabase 파라미터 API·UUID 검증·세션 user ID, 복합 FK·RLS·server guards |
| Medium | secret logging/오류 본문 | 허용된 category/code/request ID만 구조화 로그, key/token/raw payload/stack 제외 |
| Medium | 장기 토큰·로그 보관 | 토큰 재연결/키 백업·재암호화 전략 문서화. 자동 refresh·보관 정리 작업은 후속 |

표의 Critical/High 방어는 구현했으나 외부 제공자 자격증명·앱 심사·운영 네트워크가 없는 상태에서 완전한 상용 보안을 보증하지 않습니다. 알려진 운영 제한은 README와 DEPLOYMENT에 기록했습니다.

스테이징에 배포하기 전 가격 ID·실결제 계정·Meta 권한·공개 bundle·RLS를 다시 검사해야 합니다. Toss 실결제는 미구현이며, 임의의 webhook HMAC 호환을 가정하지 않고 운영 활성화를 거부합니다.

## PHASE 3.5 안정성 보강

- High: 운영 환경에서 staging mutation/무료 한도 override 사용을 차단하고 별도 DB opt-in·관리자 역할·동일 출처·요청 제한을 적용했습니다. 한도 override는 전용 FREE fixture에만 20분 동안 적용하며 카운터를 초기화하지 않습니다.
- High: 연결 테스트의 AI 호출에도 기존 사용량 예약과 비용 fuse를 적용했습니다. 네 번째 호출은 제공자 호출 전에 차단하는 경로를 검사합니다.
- High: 공개 테스트 게시문을 고정하고 명시적 확인 없이는 게시하지 않습니다. sandbox 검증은 Stripe test key만 허용합니다.
- High: 신규 fixture 생성 전에 기존 사용자 이메일을 검사하여 미인증 일반 계정이 public signup으로 변경되는 경로를 방지했습니다.
- Medium: 실제 서명 검증된 webhook 수신 증거와 게시 상태 전이 기록을 추가해 mock 결과·미실행·중복 기록을 실제 성공으로 잘못 표시하지 않도록 했습니다.
- Medium: provider timeout/invalid-model 오류 분류, 관리자 최근 오류 50건, request ID 및 비밀값 없는 결과 기록을 보강했습니다.

위 등급은 막은 위험의 등급이며 외부 서비스 실연결 완료를 의미하지 않습니다. 실제 유료 출시 판정은 [staging 보고](STAGING_VALIDATION.md)를 따릅니다.
