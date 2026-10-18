# BizContent AI · PHASE 3

한국 소상공인을 위한 콘텐츠 마케팅 SaaS입니다. Next.js 16, TypeScript, Tailwind CSS, shadcn/ui 방식 컴포넌트, Supabase Auth/PostgreSQL을 사용합니다. 한국어 대시보드·Brand Brain·뉴스/트렌드·AI Studio·콘텐츠 라이브러리 UI를 유지하고, 플랜·구독·Threads 게시·운영 관리 기능을 추가했습니다.

**현재 코드 구현과 자격증명 없는 테스트는 가능하지만, 이 작업 환경에 실서비스 키가 없어 유료 결제·Meta OAuth·실제 게시·호스팅 DB의 성공을 검증하지 못했습니다. Toss는 아직 실결제를 지원하지 않습니다.** staging 검증 전 운영 준비 완료로 간주하지 마세요.

## Windows 초보자 실행법

1. [Node.js 24 LTS](https://nodejs.org/ko), [Git for Windows](https://git-scm.com/download/win)를 설치합니다.
2. 시작 메뉴에서 **명령 프롬프트(cmd)** 를 열고 한 줄씩 실행합니다.

```bat
git clone https://github.com/skylablee/my-first-commit.git
cd my-first-commit
npm install
copy .env.example .env.local
npm run dev
```

3. 브라우저에서 `http://localhost:3000`을 엽니다. 종료는 `Ctrl+C`입니다.
4. 이미 다운로드한 폴더라면 `cd "C:\내프로젝트\my-first-commit"`으로 이동한 후 `npm install`부터 실행하세요.
5. PowerShell 실행 정책 오류가 뜨면 cmd를 사용하거나 `npm.cmd install`을 사용하세요. 포트가 사용 중이면 `npm run dev -- --port 3001`로 실행하고 APP_URL·OAuth Redirect URL도 변경하세요.

환경변수가 없어도 개발 앱·로그인·`/setup`은 실행됩니다. 대시보드는 인증을 요구하며, 미설정 기능은 명확한 오류를 표시합니다. API 키를 입력하는 브라우저 폼이나 인증 우회 경로는 없습니다. `.npmrc`의 `.npm-cache`와 `.env.local`은 Git에서 제외됩니다.

## 빠른 설정

1. **환경별 별도 Supabase 프로젝트**를 만드세요. 새 DB는 `supabase/schema.sql` → `supabase/migrations/002_phase3_operations.sql` 순서로 실행합니다.
2. PHASE 1 DB라면 백업 후 `001_phase1_to_phase2.sql` → `schema.sql` → `002_phase3_operations.sql` 순서입니다. PHASE 2 DB는 `002`만 실행합니다. `002` 이후 `schema.sql`만 다시 실행하면 이전 함수로 덮어쓸 수 있으므로 피하세요.
3. `.env.local`에 Supabase 공개 URL·anon key·서버 service-role key를 입력합니다. Auth 이메일 비밀번호 가입을 켜고 Redirect URLs에 `/auth/callback`을 등록합니다.
4. `TOKEN_ENCRYPTION_KEY`와 `CRON_SECRET`을 서로 다른 난수로 생성합니다. Windows cmd에서 아래 명령을 **각각 두 번** 실행해 서로 다른 값을 복사하세요. 출력값은 환경 설정에만 넣고 Git·채팅에 올리지 마세요.

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. 로컬 mock 구독을 쓰려면 **개발 DB에서만** SQL Editor로 실행하세요.

```sql
update public.operating_settings set allow_mock_billing = true where id = true;
```

운영·staging DB에서는 반드시 `false`여야 합니다. mock 구독은 기본적으로 유료 권한을 부여하지 않으며, 개발 환경과 DB sandbox 설정이 모두 켜져야 사용할 수 있습니다.

6. Supabase 회원가입·메일 인증·로그인 후 브랜드를 만드세요. OpenAI 또는 Gemini 키를 설정하고 AI Studio에서 생성·수정·초안 저장을 확인합니다. PHASE 1 브라우저 mock 데이터는 자동 업로드하지 않습니다.
7. Threads·Stripe·관리자·Cron의 상세 설정은 [배포 안내](docs/DEPLOYMENT.md)를 따르세요.

## 환경변수

전체 이름과 기본값은 [.env.example](.env.example)에 있습니다. **실제 키를 소스에 작성하지 마세요.** 공개 가능한 Supabase anon/publishable key 이외에는 서버 전용입니다.

| 구분 | 환경변수 |
| --- | --- |
| 환경 | `APP_ENV`, `APP_URL` |
| DB·Auth | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| AI | `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| 뉴스 | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` |
| 결제 | `PAYMENT_PROVIDER`, `PAYMENT_SECRET_KEY`, `PAYMENT_CLIENT_KEY`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_PRICE_STARTER`, `PAYMENT_PRICE_PRO`, `PAYMENT_PRICE_AGENCY` |
| 예약 | `CRON_SECRET` |

`APP_ENV`는 development/staging/production입니다. Vercel production/preview는 각각 production/staging으로 강제되어 APP_ENV=development로 검증을 우회할 수 없습니다. production/staging의 필수 값 누락·잘못된 HTTPS URL·mock 결제는 **prebuild에서 실패**합니다. OpenAI/Gemini는 최소 한 제공자가 필요합니다. Stripe Checkout은 서버 URL 이동 방식이므로 PAYMENT_CLIENT_KEY를 브라우저에 전달하지 않으며 현재 사용하지 않습니다. PHASE 1의 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`도 호환됩니다.

처음 Vercel에 로그인·브랜드·AI만 배포할 때는 `DEPLOYMENT_PROFILE=core`로 설정합니다. 이때 Supabase 3개 변수, AI 키 하나 이상, 32자 이상 `CRON_SECRET`, 실제 배포 주소인 HTTPS `APP_URL`이 필요합니다. 네이버·Threads·결제 변수는 미사용 시 추가하지 않습니다. 일부만 설정하면 해당 연동의 나머지 설정도 요구합니다. 기본값 `full`은 기존 전체 운영 검증을 유지하며 core에서도 인증·요청 제한·사용량 한도·운영 mock 결제 금지는 유지됩니다. 실제 결제와 예약 게시 검증이 끝난 유료 서비스라는 의미는 아닙니다.

기본 `vercel.json`에는 자동 Cron을 등록하지 않습니다. Threads와 예약 발행을 연결할 때 요금제에 맞는 scheduler를 별도로 설정해야 예약이 실행됩니다. Vercel Git의 Production Branch는 앱 코드가 있는 `bizcontent-deploy`인지 확인하고, 배포 후 실제 도메인에 맞춰 `APP_URL`과 Supabase Auth의 Site URL 및 `/auth/callback`, `/login` Redirect URL을 수정하세요. 로컬 `http://localhost:3000` Redirect URL은 로컬 테스트를 위해 함께 유지할 수 있습니다. OpenAI 잔액·한도 오류는 배포로 해결되지 않습니다.

```bat
npm run check:env
npm run check:services
```

첫 명령은 형식/존재 여부 검증입니다. 두 번째는 DB·모델 목록·뉴스·Stripe에 실제 읽기 요청을 합니다. 키 누락·네트워크 차단 시 exit code 2로 결과를 보고합니다. 모델 목록 성공은 AI 생성·모델별 권한·결제를 증명하지 않습니다. 생성/결제/게시 기능은 [staging 체크리스트](docs/DEPLOYMENT.md)에서 별도로 검증해야 합니다.

## 플랜

| 플랜 | 월 가격 (KRW) | 월 AI 생성 | 활성 브랜드 | 예약 발행 | 재가공·고급 분석 |
| --- | ---: | ---: | ---: | --- | --- |
| FREE | 0 | 10 | 1 | 불가 | 불가 |
| STARTER | 29,000 | 100 | 1 | 가능 | 불가 |
| PRO | 59,000 | 500 | 3 | 가능 | 가능 |
| AGENCY | 149,000 | 2,000 | 20 | 가능 | 가능 |

월 사용량은 한국시간 달력 월 기준이며 실패·대기 요청도 포함합니다. 요청 전 DB 트랜잭션으로 원자적 차감하고, 다운그레이드·취소·재결제로 같은 달 사용량을 초기화하지 않습니다. 초과 브랜드는 삭제하지 않고 생성일·ID 순서에 따라 보관합니다. 보관 브랜드는 유료 생성·발행·브랜드 수정이 제한됩니다. 기존 콘텐츠는 조회·내보내기할 수 있습니다. AGENCY는 사용자 소유권 기반의 팀 확장 구조이며 **멤버 초대/공유 워크스페이스는 아직 없습니다.**

AI 요청은 10초 간격·출력 토큰 상한·서비스 전체 일일 예상 $25 예산을 추가 적용합니다. 고정 모델과 단가 가정은 `src/lib/ai/provider.ts`에 있습니다. 실제 청구액은 제공자 콘솔을 확인하세요. 실패 시 요금 발생 여부가 불명확하면 $0.10 예약액을 유지합니다. 이 글로벌 안전 한도 때문에 유료 플랜에도 일시적인 호출 제한이 걸릴 수 있습니다.

## 구현 흐름

- **Auth / DB**: 이메일 가입·로그인·PKCE 콜백·세션 갱신·로그아웃. 사용자별 RLS, 복합 소유권 FK, 서버 권한 검사.
- **Brand / Content**: DB CRUD, 뉴스에서 글 작성, 편집·복사·초안 저장·삭제, 100건 커서 페이지네이션. 일부 검색·캘린더·내보내기는 불러온 목록 기준입니다.
- **News / AI**: Naver News·Google News RSS, 비공식 Google Trends(장애 시 안내), OpenAI gpt-4o-mini·Gemini 2.5 Flash, JSON schema·응답 검증. Pro 이상은 7가지 형식 재가공·모두 생성.
- **Threads**: 공식 OAuth 코드 교환·장기 토큰, 계정 username, AES-256-GCM 암호화와 사용자별 AAD, 연결 해제. 토큰 문자열 입력 없음. 갱신 자동화 대신 만료 전 재연결이 필요합니다.
- **게시**: Threads 형식의 저장된 콘텐츠(1~500자) 상세에서 즉시/예약 게시. 게시 결과·permalink·안전한 실패·최대 3회 재시도. DB unique·SKIP LOCKED·lease/checkpoint로 중복 실행을 막고, 성공 여부 불명은 자동 재게시하지 않습니다.
- **Billing**: Stripe Checkout·canonical subscription 조회·가격 검증·서명 웹훅·동기화·플랜 변경·기간 종료 취소, 개발용 mock. **Toss는 인터페이스만 제공하며 실제 인증·청구·웹훅은 미구현, 운영 활성화 불가**입니다.
- **운영**: `/admin`의 DB admin role 검사, DAU/MAU·콘텐츠·생성·게시 성공/실패율·예상 비용·실결제 MRR, 감사 로그·안전한 구조화 오류·request ID.

## 테스트와 프로덕션 실행

```bat
npm run lint
npm run test
npm run typecheck
npm run build
npm run start
```

Vitest는 모사한 외부 API 및 React UI를 검사하고, PGlite는 실제 PostgreSQL 엔진에서 스키마·RLS·구독/한도/게시 RPC를 검사합니다. 호스팅 Supabase·Meta·Stripe 실연결 검증과 구분합니다.

```bat
npx playwright install chromium
npm run build
npm run test:e2e
```

Playwright 공개 경로 테스트는 키 없는 서버에서 실행하세요. Chromium 다운로드가 차단된 클라우드는 `BROWSER_EXECUTABLE_PATH`를 사용할 수 있습니다. 실행 중인 3000 포트 서버를 재사용할 수 있으므로 항상 최신 빌드인지 확인하세요.

## 디렉터리·운영 문서

- `src/app/api/`: Auth, Brand, Content, AI, News, Threads, Publications, Billing, Cron, Admin
- `src/lib/billing/`: 결제 제공자 인터페이스·Stripe·개발 mock·Toss 확장 지점
- `src/lib/threads/`: 공식 API 어댑터·게시 worker
- `src/lib/operations/`: 암호화·플랜/요청 제한·감사·관리자·안전한 로그
- `supabase/migrations/002_phase3_operations.sql`: 데이터 보존형 PHASE 3 마이그레이션
- [배포·환경 분리·운영 테스트](docs/DEPLOYMENT.md)
- [보안 점검·수정·남은 검증](docs/SECURITY_REVIEW.md)
- [마이그레이션 복구·장애 대응](docs/RECOVERY.md)

실제 Vercel 배포·상용 결제 승인·Meta 앱 심사는 이번 작업에서 수행하지 않았습니다. 별도 모니터링 서비스 전송은 없으며 Vercel 구조화 로그·DB 오류 목록을 제공합니다. Threads 외 채널 발행, 팀 멤버 관리, 환불·분쟁 처리 UI, 발행물 노출/클릭 분석은 후속 범위입니다.

## PHASE 3.5 실제 연결 검증

관리자 전용 `/admin/staging-check`에서 실제 API 연결과 전용 테스트 계정·결제·게시의 실행 증거를 확인합니다. 키가 없으면 NOT CONFIGURED이며 mock 성공을 표시하지 않습니다. [Staging 실행 순서·현재 결과·복원 방법](docs/STAGING_VALIDATION.md)을 먼저 읽으세요. 마이그레이션 `003_phase35_staging_validation.sql`이 추가로 필요합니다.

```bat
npm run check:secrets
npm run check:services
```

현재 환경에는 외부 서비스 키가 없으므로 실제 사용자 E2E·결제·Threads 게시 검증은 완료되지 않았습니다. 비밀값은 환경 설정에 입력하고 Git에 추가하지 마세요.

## Supabase URL과 Windows 회원가입 설정

`NEXT_PUBLIC_SUPABASE_URL`에는 `https://프로젝트ID.supabase.co`처럼 프로젝트 주소를 입력하세요. Data API 주소의 `/rest/v1` 경로는 SDK가 자체적으로 붙입니다. 최신 코드는 알려진 Data API 경로를 프로젝트 주소로 정규화합니다.

회원가입·로그인도 서버 요청 제한을 사용하므로 Supabase 환경변수 3개에 더해 32자 이상의 별도 `CRON_SECRET`이 필요합니다. 생성한 값은 `.env.local`에 보관하고 채팅·로그·Git에 공개하지 마세요. 로컬 설정은 `http://localhost:3000/setup`에서 값 없이 설정 여부만 확인할 수 있습니다.
