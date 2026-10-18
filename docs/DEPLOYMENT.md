# 환경 분리와 Vercel 배포

PHASE 3.5 검증 절차와 실제 실행 상태는 [STAGING_VALIDATION.md](STAGING_VALIDATION.md)를 따릅니다.

## 1. Supabase와 데이터 마이그레이션

development/staging/production에 각각 다른 Supabase 프로젝트, 암호화 키, 결제 계정/모드, Meta 앱 또는 테스트 계정을 사용합니다. 운영 DB를 로컬 mock 결제에 공유하지 마세요.

- 신규: `schema.sql` → `migrations/002_phase3_operations.sql` → `migrations/003_phase35_staging_validation.sql`
- PHASE 1 DB: 백업 → `001_phase1_to_phase2.sql` → `schema.sql` → `002_phase3_operations.sql` → `003_phase35_staging_validation.sql`
- PHASE 2 DB: 백업 → `002_phase3_operations.sql` → `003_phase35_staging_validation.sql`
- 트랜잭션 단위로 적용되며 기존 브랜드·콘텐츠는 삭제하지 않습니다. 기존 AI 사용량은 월 카운터에 이관하고 감소시키지 않습니다. `002` 재실행도 데이터를 초기화하지 않습니다.
- `002` 적용 후 구버전 `schema.sql`만 실행하지 마세요. 운영 기능이 사용하는 함수를 과거 버전으로 바꿀 수 있습니다.

운영·staging DB에서 다음 결과가 `false`인지 확인합니다.

```sql
select allow_mock_billing from public.operating_settings where id=true;
```

Supabase Auth에서 이메일/비밀번호 가입, 이메일 확인, SMTP, CAPTCHA, 비밀번호·로그인 요청 제한을 설정합니다. 공개 anon 키와 서버 service-role 키를 분리합니다. 사용자 metadata에 admin이라고 적어도 권한이 생기지 않습니다. SQL Editor에서 확인된 운영자 UUID에만 역할을 부여합니다.

```sql
insert into public.user_roles(user_id,role) values('검증한-관리자-UUID','admin');
```

## 2. 환경변수와 검증

Vercel Project Settings → Environment Variables에서 `.env.example`의 변수를 등록합니다. Preview에는 staging 값, Production에는 운영 값을 사용합니다. 비밀 키에는 NEXT_PUBLIC_ 접두사를 쓰지 않습니다. APP_URL은 `https://app.example.com`처럼 끝에 경로·쿼리 없는 공개 origin으로 입력하세요.

- Supabase URL·anon key·service-role key
- OpenAI/Gemini 최소 1개, Naver ID/Secret
- Threads 앱 ID/Secret/Redirect URI
- TOKEN_ENCRYPTION_KEY: 32바이트 hex(64자), CRON_SECRET: 별도 32자 이상 난수
- PAYMENT_PROVIDER=stripe, PAYMENT_SECRET_KEY, PAYMENT_WEBHOOK_SECRET, 3가지 PAYMENT_PRICE_* ID. production은 sk_live_ 키, staging은 sk_test_ 키를 강제하고 웹훅 livemode도 검사합니다
- PAYMENT_CLIENT_KEY는 현재 Stripe 서버 Checkout에 사용하지 않습니다.

`npm run check:env`와 빌드의 prebuild가 누락/형식 오류를 차단합니다. Vercel Production/Preview 환경 이름은 APP_ENV 값보다 우선하므로 development 값을 복사해도 mock 배포로 우회되지 않습니다. `npm run check:services`는 읽기 요청으로 접속을 검사하며, 유효한 서비스 연결이나 모델 목록이 실제 결제·게시 성공을 증명하지는 않습니다.

필요한 네트워크 호스트:

- 자신의 `<project>.supabase.co`
- `api.openai.com`, `generativelanguage.googleapis.com`, `openapi.naver.com`
- `news.google.com`, `trends.google.com`
- `graph.threads.net`, 브라우저 OAuth용 `www.threads.net`/`www.threads.com`
- `api.stripe.com`, 브라우저 결제용 `checkout.stripe.com`

운영자가 기존 허용 목록에 추가하세요. 이 클라우드에서는 Google 피드와 Meta/Toss 문서가 프록시 CONNECT 403으로 차단되었습니다. TLS·서명 검증은 끄지 않았습니다.

## 3. Meta Threads 앱

1. Meta 개발자 포털에서 Threads use case의 앱을 만들고 앱 ID/Secret을 서버에 등록합니다.
2. Threads API 설정의 OAuth Redirect URI를 `https://app.example.com/api/threads/callback`으로 정확히 등록합니다. 개발은 `http://localhost:3000/api/threads/callback`입니다. APP_URL과 origin이 같아야 합니다.
3. `threads_basic`, `threads_content_publish` 권한을 구성합니다. 개발 모드에서는 앱 역할/테스터와 수락한 테스트 계정으로 확인합니다.
4. 일반 고객 운영 전에 Meta의 앱 심사·권한 승인·사업자/개인정보·데이터 삭제 정책 요구를 완료합니다. 코드는 앱 심사를 대신하지 않습니다.
5. 로그인 → 연동 관리 → Threads 연결 → Meta 동의 → callback → username·만료일 표시를 확인합니다.
6. short-lived 토큰은 서버에서 long-lived로 교환하고 AES-GCM 암호화 후 저장합니다. refresh token은 Meta가 제공하지 않아 null입니다. 만료 전 재연결 안내를 사용합니다. 자동 장기 토큰 refresh는 후속 작업입니다.
7. 연결 해제는 서버 토큰을 삭제합니다. Meta 앱의 원격 권한 철회는 사용자가 Threads 설정에서도 수행할 수 있습니다.

본문은 저장된 Threads 형식, 1~500자여야 합니다. container 생성 → 상태 확인 → publish → post ID/링크 저장 순서입니다. 준비 중이면 최대 3회 backoff, 게시 성공 여부가 불명확하면 자동 재시도하지 않습니다.

## 4. 결제 제공자

실제 구현은 Stripe이며 사업자의 계약/지원 국가·통화·정기결제 사용 가능 여부를 먼저 확인해야 합니다. **Toss 어댑터는 활성화되지 않았습니다.** Toss를 쓰려면 merchant 계약, 빌링키 발급·청구 주기·취소 및 공식 웹훅 검증을 별도로 구현해야 하며 Stripe HMAC 검증을 재사용하면 안 됩니다.

Stripe 테스트 모드부터 다음을 설정합니다.

1. 월간 KRW 가격 29,000 / 59,000 / 149,000, 수량 1, 월 주기 1로 Price를 만듭니다. ID를 PAYMENT_PRICE_STARTER/PRO/AGENCY에 넣습니다.
2. 서버 secret key를 PAYMENT_SECRET_KEY에 등록합니다. 사용자 입력 가격·plan metadata만으로 유료 권한을 부여하지 않습니다.
3. 웹훅 URL: `https://app.example.com/api/billing/webhook`
4. 이벤트: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
5. 웹훅 signing secret을 PAYMENT_WEBHOOK_SECRET에 등록합니다. 원문 body HMAC·5분 timestamp·이벤트 ID DB dedup을 검사합니다. 실패 이벤트는 다음 재전송에서 다시 처리할 수 있습니다.
6. Billing에서 플랜 선택 → Stripe Checkout → 테스트 결제 → 제공자 canonical 구독/가격/납부 invoice 확인 → 권한 반영을 검증합니다. 성공 redirect는 권한을 변경하지 않습니다.
7. 웹훅이 누락되면 기존 구독 ID를 Billing에 입력해 내 구독만 동기화할 수 있습니다. 저장한 Stripe customer 매핑과 활성 구독 조회로 새 중복 구독 생성을 방지합니다. Checkout 재시도에는 DB attempt ID와 Stripe idempotency key를 재사용합니다.
8. 업그레이드는 차액 청구·pending payment를 사용하며 결제가 미완료되면 새 권한을 주지 않습니다. 다운그레이드는 즉시 적용하고 환불/크레딧을 만들지 않습니다. UI가 이를 확인받습니다. 취소는 현재 이용 기간 종료 후 Free로 전환합니다.

mock은 development/test와 개발 DB `allow_mock_billing=true`에서만 허용됩니다. 실제 매출·유료 사용자/MRR 집계에서 제외합니다. mock에서는 실카드 청구가 없습니다. production/staging의 sandbox DB는 요청 단계에서도 거부됩니다.

## 5. Vercel와 Cron

1. 저장소를 GitHub에 올리고 Vercel에서 Next.js / 저장소 루트 / npm run build로 Import합니다.
2. 환경변수와 Supabase Auth Redirect URLs (`/auth/callback`) 및 Threads Redirect URI를 등록합니다.
3. DB 마이그레이션과 역할·RLS를 검증한 뒤 배포합니다. 환경변수 변경 후 재배포합니다.
4. 기본 `vercel.json`에는 자동 Cron이 없습니다. Threads 연결과 예약 발행을 검증할 단계에서 지원 요금제에 맞게 `/api/cron/publish` 호출 주기를 등록합니다. 매분 호출은 해당 주기를 지원하는 Vercel 플랜이 필요합니다. 호환 scheduler라면 `Authorization: Bearer <CRON_SECRET>`로 같은 GET endpoint를 호출합니다. scheduler 미설정 상태에서는 예약 작업이 자동 실행되지 않습니다.
5. Cron 호출은 비밀 키 검증 후 persistent rate limit을 적용합니다. DB가 due job 한 건을 `FOR UPDATE SKIP LOCKED`로 claim하고 5분 lease를 잡습니다. 함수 실행 제한은 90초, Threads 요청은 15초 timeout입니다.
6. 중복 호출은 동일 작업을 다시 claim하지 못합니다. 프로세스 중단 후 만료된 lease는 결과 불명으로 분리합니다. 초기 처리량은 cron당 1건/분이며 대량 운영에는 큐/worker를 확장해야 합니다.

## 6. Staging/Production acceptance test

별도 테스트 사용자 A/B, 테스트 Meta 계정, Stripe 테스트 모드로 검증하세요.

- 회원가입·인증 메일·로그인·로그아웃·세션 갱신
- A의 브랜드/콘텐츠/연결/청구가 B에게 보이지 않음
- OpenAI/Gemini 각각 실제 생성·JSON·토큰 사용량 기록·한도 초과 시 외부 호출 없음
- Naver/Google News, Google Trends 정상/차단 fallback
- OAuth state 위조·만료·재사용 실패, username·암호화 저장, token 미노출
- 테스트 Threads 계정에 즉시 게시, 예약·중복 Cron·실패 재시도·성공 불명 확인 대기
- Free 예약/재가공 차단, 플랜별 브랜드 한도·월 한도, 동시 예약 경쟁
- Stripe 테스트 결제 성공/실패·가격 불일치·중복/순서 역전 웹훅·서명 위조·취소·다운그레이드
- 결제 실패 시 유료 권한 없음, 성공 redirect URL 조작으로 업그레이드 불가
- 관리자 role 없는 사용자 `/admin`·`/api/admin` 차단
- 운영 로그·오류 응답·브라우저 bundle에 API key/token/stack trace 없음
- 모바일 Billing/연동/콘텐츠 상세 확인

마지막으로 라이브 결제·실게시의 소액/내부 계정 검증을 별도로 승인된 운영 절차에 따라 수행합니다. 이 저장소의 자동 테스트는 실제 계약·앱 심사·외부 제공자의 가용성을 증명하지 않습니다.

## 7. 운영 모니터링

Vercel 로그의 category/request_id로 API 오류를 찾고 `/admin`에서 DB 오류·결제 실패·감사 로그·DAU/MAU·예상 비용·게시 성공/실패율을 확인하세요. secret/토큰/프롬프트/원문 응답은 로그 필드로 허용하지 않습니다. MRR은 현재 활성·기간 미종료·취소 예약 없는 실구독의 월 가격 합계입니다. 실패/대기 AI 예약액도 예상 비용에 포함됩니다.

요청 제한은 사용자와 해시 IP 버킷을 DB에서 원자적으로 처리합니다. Vercel이 정규화하는 IP만 신뢰하며, 다른 서버에서는 임의 forwarded header를 신뢰하지 않고 shared IP 버킷을 사용합니다. 자체 프록시 배포에는 검증된 IP 전달 정책을 추가해야 합니다. 모든 신규 요청 제한 버킷에는 하루 총 20,000 차감(인증 요청은 user/IP 2개, 익명은 IP 1개)의 전역 안전 한도를 추가 적용합니다. 이 보수적 한도는 운영 트래픽과 DB 비용을 관찰한 뒤 조정하세요. 외부 모니터링/Sentry 전송, 로그 보관/삭제 Cron, 환불·분쟁 자동화는 아직 포함하지 않습니다.
