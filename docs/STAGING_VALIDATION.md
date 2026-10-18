# PHASE 3.5 Staging validation

실제 운영 승인 전용 절차입니다. 로컬 자동 테스트는 외부 API 성공 증거가 아닙니다.

## 시작

1. 운영 DB와 분리한 Supabase 프로젝트에 `supabase/schema.sql`(신규 프로젝트만), `002_phase3_operations.sql`, `003_phase35_staging_validation.sql`을 순서대로 적용합니다. Phase 1 DB라면 먼저 `001_phase1_to_phase2.sql` → `schema.sql` → `002` → `003`을 적용합니다. Phase 2/3 데이터베이스에 schema.sql을 재실행하지 마세요.
2. `.env.example`의 값을 환경 설정에 안전하게 입력합니다. `APP_ENV=staging`, 실제 HTTPS `APP_URL`, `PAYMENT_PROVIDER=stripe`, Stripe **테스트** 키와 테스트 Price ID만 사용합니다. 비밀값은 채팅·Git에 입력하지 않습니다.
3. `user_roles`에 실제 관리자 계정의 admin 역할을 부여합니다. 사용자 metadata의 역할은 인정하지 않습니다.
4. SQL Editor에서 `update public.operating_settings set staging_validation_enabled=true where id=true;`를 실행합니다. 로컬 development/test에서는 추가로 `STAGING_VALIDATION_ENABLED=true`가 필요합니다. production에서는 활성화할 수 없습니다.
5. `npm ci`, `npm run build`, `npm run start` 후 관리자 로그인하여 `/admin/staging-check`를 엽니다.

정확한 operating_settings PK는 마이그레이션의 `id boolean` 정의를 확인합니다. 별도 Vercel staging 배포와 Cron 지원 플랜이 필요합니다. 저장소 환경 설정만으로 배포나 외부 콘솔 설정이 완료되지는 않습니다.

## 실제 실행 순서

- 7개 서비스 연결 검사를 각각 실행합니다. 키 존재는 Configured일 뿐 Connection success가 아닙니다. 결과의 시각과 검증 범위를 확인합니다. AI 검사는 최소 토큰을 사용하지만 실제 비용과 사용량이 발생합니다.
- 새 이메일 두 개로 Auth/CRUD/RLS 검사를 실행합니다. 기존 일반 계정 이메일은 거부합니다. 이메일 인증이 켜져 있으면 수신 메일을 직접 확인한 후 동일 계정으로 다시 실행합니다. SMTP/CAPTCHA 설정에 따라 최초 실행이 중단될 수 있습니다. 비밀번호는 저장하거나 로그에 남기지 않습니다.
- 별도로 실제 브라우저에서 새 사용자 가입 → 로그인 → Brand Brain 저장 → AI Studio 생성 → Content Library 저장 → 로그아웃/재로그인 후 보존을 확인합니다. 관리자 fixture 테스트는 이 전체 UI 시나리오의 대체 증거가 아닙니다.
- Threads 실제 OAuth로 연결합니다. 게시 버튼의 공개 게시 확인란과 확인 대화상자에 동의한 경우에만 `BizContent AI staging connection test`를 게시합니다. 즉시 게시와 5분 뒤 예약을 각각 검사하고, 예약 시간 이후 상태 확인 버튼을 누릅니다. post ID·게시 시각·username과 상태 전이 및 Cron 실행 출처가 일치해야 PASS입니다. 접속 검사만으로 OAuth/게시/Cron PASS를 부여하지 않습니다. 게시물은 자동 삭제하지 않습니다.
- Stripe Checkout에서 테스트 카드로 FREE → STARTER를 결제한 뒤 웹훅을 수신하고 동기화합니다. 테스트 실패 카드, 기간 말 취소, PRO 업그레이드 후 STARTER 다운그레이드, Stripe 콘솔의 동일 이벤트 재전송을 각각 확인합니다. 중복 검사는 실제 서명 검증된 수신 기록 2건 이상이 필요합니다. 취소 예약 PASS는 기간 말 실제 FREE 전환의 증거가 아닙니다.
- 신규 전용 FREE fixture의 사용량 0에서만 임시 한도 3을 켭니다. AI 호출은 11초 이상 간격으로 3번 실행하고, 네 번째 호출의 `api_called=false`와 quota 차단을 확인합니다. 실제 Starter 테스트 결제 후 생성 재개를 확인합니다. 완료 후 복원 버튼을 누릅니다. 임시 override는 20분 후 만료되며 사용량 카운터를 초기화하지 않습니다.
- 최근 오류 50건의 service/request_id/user_id/error_category/safe_message를 확인합니다. 제공자 원문·토큰·비밀번호는 출력하지 않습니다.

## 중단·복원

`update public.operating_settings set staging_validation_enabled=false where id=true;`로 도구를 끄고, staging_usage_overrides의 본인 테스트 행을 삭제합니다. 테스트 계정/태그된 콘텐츠만 확인 후 정리합니다. 운영 구독·콘텐츠·사용량을 일괄 초기화하지 마세요. 외부 Stripe 구독 취소와 공개 Threads 게시물 정리는 외부 콘솔에서 별도로 확인합니다.

운영 전 `STAGING_VALIDATION_ENABLED=false`, DB staging_validation_enabled=false, allow_mock_billing=false로 설정합니다. production 환경 검증과 마이그레이션 003은 필수입니다. `/api/billing/webhook`은 003의 수신 증거 테이블을 사용합니다.

## 현재 실행 보고 (2026-10-17)

| 검증 대상 | 결과 | 근거 |
| --- | --- | --- |
| Supabase 실제 DB/Auth/RLS | NOT CONFIGURED | URL·공개 키·service role 미설정, 원격 마이그레이션 미실행 |
| OpenAI | NOT CONFIGURED | 키 미설정, 실제 생성 미실행 |
| Gemini | NOT CONFIGURED | 키 미설정, 실제 생성 미실행 |
| Naver | NOT CONFIGURED | ID/secret 미설정 |
| Threads OAuth/즉시 게시/예약 게시 | NOT CONFIGURED | 앱 설정·토큰·배포 미설정, 공개 게시 없음 |
| Stripe 테스트 결제/웹훅/플랜/취소 | NOT CONFIGURED | 테스트 키·Price·웹훅 미설정, 결제 없음 |
| 실제 Cron 5분 예약 실행 | NOT CONFIGURED | 배포 URL·CRON_SECRET 미설정 |
| 실제 가입부터 재로그인까지 UI E2E | NOT CONFIGURED | Supabase 및 제공자 연결 필요 |

외부 서비스 성공으로 보고할 수 있는 항목은 없습니다. 보조 Google News/Trends 연결 검사도 현재 네트워크 접근 실패입니다. 로컬 테스트 수·빌드·브라우저 결과는 최종 실행 보고를 참조하세요. 실제 계정/결제/게시가 검증되기 전에는 유료 출시를 보류합니다.

## 이번 실행의 로컬 검증 증거

- PASS: `npm ci --no-audit --no-fund`, `npm run lint`, `npm run typecheck`, `npm run build`.
- PASS: Vitest 19개 파일, 87개 테스트. PostgreSQL 엔진(PGlite)의 migration/RLS/임시 한도/상태 전이 검사와 모사 HTTP 제공자 검사입니다.
- PASS: Playwright 3개 테스트. 키 없는 로그인/설정, 모바일 가로 넘침, 비인가 관리자·staging API, 위조 웹훅 및 Cron 차단을 검사했습니다. 인증된 SaaS 전체 E2E는 아닙니다.
- PASS: 비밀값 패턴 검사에서 현재 파일 및 Git 이력에 실제 credential 탐지 없음. 이 검사는 등록되지 않은 임의 형식 비밀의 완전 검출을 보장하지 않습니다.
- PASS(차단 검증): production + mock 결제 설정의 환경 검사가 종료 코드 1로 거부되었습니다. 정상 운영 환경 준비 완료를 뜻하지 않습니다.
- NOT CONFIGURED: 외부 서비스 7종 및 실제 결제·Threads·전체 사용자 시나리오.
- FAIL: Google News/Trends 보조 연결 요청의 네트워크/TLS/timeout 오류. 현재 클라우드 네트워크 규칙에서 대상 API 도메인이 허용되어 있지 않았으며, 허용 도메인 추가는 설정 초안에만 저장되었습니다. 런타임 반영 후 재검사가 필요합니다.

환경 설정 초안에 install_script/start_skill, 필요한 환경변수 이름, 외부 API 허용 도메인을 저장했습니다. 비밀값은 저장하지 않았습니다. 설정에서 검토·저장 후 환경 Publish가 필요하며, 새 환경 복원과 외부 연결은 아직 검증하지 않았습니다.

## 2026-10-18 Supabase 후속 검증

클라우드 게시 후 Supabase 환경변수 3개가 반영됐습니다. SQL Editor에서 3단계 마이그레이션을 적용한 뒤 실제 DB/API·RLS·로그인·브랜드 CRUD·콘텐츠 보존 검사를 통과했습니다. 공개 회원가입·이메일 인증·브라우저 UI 검사는 남아 있습니다. 이전 표는 2026-10-17 실행 당시 기록이며, 최신 Supabase 상태는 [SUPABASE_VALIDATION.md](SUPABASE_VALIDATION.md)를 참조하세요. 다른 서비스는 이번 후속 작업에서 호출하지 않았습니다.
