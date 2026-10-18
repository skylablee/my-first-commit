# Supabase 실제 연결 검증 — 2026-10-18 (한국 시간)

Supabase만 검사했습니다. OpenAI·Gemini·Naver·Threads·결제 API는 호출하지 않았습니다.

## PASS: 실제 Supabase에서 확인

- 프로젝트 URL·공개 키·서버 키를 현재 실행 환경에서 인식했습니다. 값은 출력하거나 파일에 기록하지 않았습니다.
- Auth 설정 및 관리자 권한 확인 API가 HTTP 200을 반환했습니다.
- schema.sql → 002_phase3_operations.sql → 003_phase35_staging_validation.sql을 사용자가 SQL Editor에서 순서대로 적용했습니다. 적용 후 실제 API에서 버전 002/003과 테이블을 확인했습니다.
- profiles, brands, contents, subscriptions, social_connections, publications, usage_counters 7개 테이블의 존재·RLS 활성화·정책을 확인했습니다.
- 일반 사용자의 암호화 토큰 컬럼 SELECT 및 사용량 카운터 UPDATE 권한이 차단돼 있습니다. 비로그인 사용자의 관리자 검사 RPC 호출도 401로 거부됐습니다.
- 임시 계정 두 개로 실제 비밀번호 로그인, 프로필 자동 생성, 브랜드 생성·수정·삭제, 콘텐츠 저장을 확인했습니다.
- 다른 사용자 계정에서 브랜드 읽기·수정과 콘텐츠 읽기가 차단되는 실제 RLS 동작을 확인했습니다.
- 로그아웃 후 재로그인해도 저장한 콘텐츠가 유지됐습니다.
- 사용한 임시 계정 두 개와 테스트 데이터를 정리했습니다.

기능 검사 16건과 테스트 계정 정리 2건이 통과했습니다. 계정은 관리자 API에서 이메일 인증 완료 상태로 생성한 전용 fixture입니다. 이 결과는 공개 회원가입이나 이메일 수신·인증 성공의 증거가 아닙니다.

## 미실행

- 본인 이메일을 이용한 앱의 공개 회원가입·이메일 인증.
- 실제 브라우저 앱 화면의 로그인 및 Brand Brain 저장.

따라서 DB/API 연결과 서버 권한 검증은 PASS이며 Supabase 전체 사용자 시나리오는 아직 완료되지 않았습니다. 다른 서비스로 넘어가기 전에 위 항목을 확인합니다.

## 환경 주의

이 클라우드에서는 기본 Node fetch가 직접 DNS를 사용할 때 EAI_AGAIN이 발생했습니다. 제공된 HTTPS 프록시를 이용하도록 Node 24 실행 시 `NODE_USE_ENV_PROXY=1`을 지정한 뒤 실제 연결이 성공했습니다. TLS 검증은 유지했습니다. Windows 로컬에서 이 설정이 항상 필요한 것은 아닙니다.

allow_mock_billing=false, staging_validation_enabled=false 상태입니다. 관리자 테스트 도구를 실행하려면 별도 DB opt-in이 필요합니다. 현재 검사는 전용 fixture를 사용해 직접 Supabase API로 수행했으며, 임시 사용량 제한 도구는 활성화하지 않았습니다.

## Windows 회원가입 중 PGRST125 확인 및 보완

프로젝트 URL 뒤에 `/rest/v1`을 포함하면 SDK가 해당 경로를 다시 붙여 `404 / PGRST125`가 발생하는 것을 실제 Supabase에서 재현했습니다. 프로젝트 origin으로 호출하면 동일 함수가 HTTP 200으로 응답했습니다. Windows의 직접 HTTP 검사도 성공했으나 SDK 함수 호출은 PGRST125로 실패했습니다.

`getSupabaseConfig`는 Data API URL의 `/rest/v1` 및 `/rest/v1/`을 프로젝트 origin으로 정규화합니다. 사용자정보·쿼리·fragment·다른 API 경로를 포함한 주소는 거부합니다. SDK RPC 경로가 한 번만 붙는 회귀 테스트를 추가했습니다. 기존 Windows 복사본은 `.env.local`의 NEXT_PUBLIC_SUPABASE_URL을 프로젝트 origin으로 수정해 재시작하면 동일하게 해결할 수 있습니다.

회원가입을 위한 최소 서버 설정은 Supabase URL·공개 키·서버 키와 내부 요청 제한용 CRON_SECRET입니다. CRON_SECRET 설정은 외부 Cron 서비스를 호출하지 않습니다. 실제 브라우저 회원가입은 URL 수정 후 재검증이 필요합니다.

## 브랜드 선택 항목 저장 보완

브랜드 이름만 필수로 유지하고 업종·주요 고객·말투·소개·주소·키워드·금칙어는 빈 값 또는 생략을 허용합니다. 도메인 형태의 주소는 HTTPS 주소로 정규화하며 숫자·잘못된 주소·HTTP(S) 외 프로토콜은 거부합니다. 브라우저 기본 URL 검사 대신 공통 입력 계약으로 검증하여 오류가 난 주소 항목을 안내합니다. 기존 DB는 빈 값과 기본값을 지원하므로 migration 변경이 필요하지 않습니다.

실제 Supabase에서 별도의 관리자 생성·사전 인증 임시 계정으로 비밀번호 로그인, 이름만 있는 브랜드 저장, 선택 문자열·배열 기본값, DB 재조회와 임시 계정 정리를 확인했습니다. 모두 PASS입니다. 사용자 본인의 브라우저에서 수정 후 저장·새로고침 결과는 아직 확인하지 않았습니다.
