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
