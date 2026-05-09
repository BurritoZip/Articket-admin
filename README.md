# Articket Admin

Next.js 14(App Router) 기반 **Articket** 운영자 웹 콘솔입니다.  
한국어 UI, Pretendard, 라이트/고대비 다크 모드 토큰, `/admin/users` 고충실도 **사용자 관리** 화면이 포함되어 있습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

- 앱: [http://localhost:3000](http://localhost:3000) → `/admin/dashboard`로 리다이렉트
- **사용자 관리(디자인 데모)**: [http://localhost:3000/admin/users](http://localhost:3000/admin/users)
- **로그인(데모)**: [http://localhost:3000/login](http://localhost:3000/login)

## Vercel 배포

프로젝트 루트에 `vercel.json`이 있으며, 빌드는 **`npm run build`** (`next build`)로 고정되어 있습니다. Node는 **20.x LTS**를 권장합니다(`.nvmrc`, `package.json`의 `engines` 참고).

### 1) GitHub에 푸시 후 Vercel 연결

1. [Vercel](https://vercel.com)에서 **New Project** → 저장소 선택  
2. **Framework Preset**: Next.js (자동 인식)  
3. **Root Directory**: 저장소 루트 그대로  
4. **Build Command**: `npm run build` (기본값과 동일, `vercel.json`에 명시됨)  
5. **Install Command**: `npm install`  
6. **Deploy**

### 2) 환경 변수 (Production / Preview)

Vercel 프로젝트 **Settings → Environment Variables**에 다음을 등록합니다.

| 이름 | 환경 | 비고 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | 공개 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | 서버·API 전용, **절대 클라이언트에 노출 금지** |

배포 후 **Supabase** → Authentication → URL Configuration:

- **Site URL**: `https://<프로젝트>.vercel.app` (또는 커스텀 도메인)  
- **Redirect URLs**에 동일 도메인 패턴 추가 (비밀번호 재설정 등에 사용)

### 3) 로컬에서 Vercel CLI로 미리 빌드 (선택)

```bash
npm i -g vercel
vercel build
```

또는 PR마다 미리보기는 Vercel이 자동 생성합니다.

## 환경 변수

값은 저장소에 넣지 말고, 루트의 **`.env.example`** 을 복사해 `.env.local`로 만든 뒤 채웁니다.

`.env.local` 예시:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

- **브라우저:** `lib/supabase/client.ts`
- **서버(RSC/액션):** `lib/supabase/server.ts`
- **서비스 롤(API 등):** `lib/supabase/service-role.ts`  
미들웨어(`middleware.ts`)가 세션 쿠키를 갱신하고, `/admin`은 로그인·`user_profiles.role = admin` 검사 후에만 열립니다.

스키마 타입은 다음으로 생성합니다.

```bash
npx supabase gen types typescript --linked > types/database.ts
```

## 보안·의존성

- **비밀값:** `.env`·`.env.*`는 Git에 올리지 않고, **`.env.example`** 만 저장소에 둡니다. `SUPABASE_SERVICE_ROLE_KEY`는 서버(API·RSC)에서만 참조합니다.
- **`npm audit`:** ESLint가 끌고 오던 **`glob` CLI 취약점**은 `package.json`의 **`overrides`** 로 `glob@^10.4.6` 이상을 강제해 완화했습니다.
- **잔여 항목:** `next`가 번들하는 **`postcss@8.4.x`** 등은 npm이 “수정”으로 **Next 16** 설치만 제안하는 경우가 있습니다. 14.x를 유지할 때는 [공지된 CVE](https://github.com/advisories?query=next.js)별 **자체 호스팅·Image Optimizer·rewrites** 해당 여부를 보고 리스크를 판단하면 됩니다(Vercel 등 관리형 호스팅과 로컬 dev는 영향이 다를 수 있음).

## Supabase RLS

### 본인 프로필 읽기 (로그인 후 역할 확인에 필요)

앱은 로그인 직후 `user_profiles`에서 `role`을 읽습니다. 아래 정책이 없으면 조회가 막혀 관리자도 입장하지 못할 수 있습니다.

```sql
CREATE POLICY "Users can read own profile"
ON public.user_profiles
FOR SELECT
USING (auth.uid() = id);
```

### 관리자 전체 접근 예시

JWT에 `role: 'admin'` 클레임이 포함된다고 가정할 때, 각 테이블에 동일 패턴의 정책을 둘 수 있습니다.  
실제 프로젝트에서는 `user_profiles.role = 'admin'`과 Auth 훅/커스텀 클레임을 일치시키세요.

```sql
-- 예: events 테이블
CREATE POLICY "admin full access" ON public.events
  FOR ALL
  USING (coalesce((auth.jwt() ->> 'role'), '') = 'admin')
  WITH CHECK (coalesce((auth.jwt() ->> 'role'), '') = 'admin');

-- artists, venues, user_profiles, user_bookings, user_artist_followings,
-- concert_reviews, albums, music_videos 등 동일 패턴으로 적용
```

**Storage**(예: `posters`, `avatars` 버킷)도 업로드/읽기 정책에서 동일하게 `auth.jwt() ->> 'role' = 'admin'` 조건을 사용할 수 있습니다.

## 구현 상태

| 영역 | 상태 |
|------|------|
| 디자인 토큰·레이아웃·Auth 가드 | 구현됨 |
| 사용자·공연장·공연·아티스트 등 | API + 화면 연동 |
| 대시보드·예매·리뷰 등 | 일부 플레이스홀더 |
| Supabase RLS·Storage | 프로젝트별 SQL/버킷 설정 필요 |

## 진행 이력·GitHub 이슈 후보 (2026-05-09)

로컬에서 이슈를 만들 때 아래 제목·요약을 그대로 복사해 등록하면 됩니다. (`gh issue create` 사용 시 `gh auth login` 필요)

### 이번 마일스톤까지 완료

- Next.js 14 App Router·Supabase 연동, 미들웨어 세션·`/admin` 관리자 가드(`user_profiles.role`)
- 로그인 페이지·클라이언트/서버 모듈 경계 정리(`searchParams` 등)
- Admin API: `users`, `venues`, `events`, `artists` (목록·단건 PATCH 등)
- 관리 화면: 사용자·공연장·공연·아티스트(목록·Sheet 상세·편집 연동)
- Vercel 배포용 `vercel.json`, `.nvmrc`, `engines`, README 배포·환경변수 절
- 운영 중 발견 이슈 대응: 미들웨어 매처 축소, service role 키 검증, 무한 업데이트 루프 패턴 제거 등

### 백로그 → GitHub Issue 제안

| # | 제목 (복사용) | 요약 |
|---|----------------|------|
| 1 | `[Feature] 예약(bookings) 관리 API 및 /admin/bookings 고도화` | 실데이터·필터·API 패턴 통일 |
| 2 | `[Feature] 리뷰(concert_reviews) 관리 API 및 /admin/reviews 고도화` | 목록·상태 변경·RLS 정합 |
| 3 | `[Feature] /admin/dashboard 실제 지표·차트 연동` | KPI 집계는 서버(API)에서 |
| 4 | `[Docs] RLS·Storage SQL 패키지(supabase/migrations 또는 docs/sql)` | 재현 가능한 정책 스크립트 |
| 5 | `[Chore] 로깅·에러 트래킹(Sentry 등)·PII 검토` | Vercel 시크릿 주입 |
| 6 | `[Test] admin API·권한 단위/통합 테스트` | Vitest/Jest + 라우트 핸들러 |
| 7 | `[Chore] next·의존성 보안/마이너 업데이트` | Node 20–22 유지 |

## 디자인 토큰 요약

| 구분 | 토큰/값 |
|------|---------|
| 타이포 | `text-display`(40px/700), `text-h1`(32px), `text-h2`(24px), `text-h3`(19px), `text-body`(17px), `text-body-sm`(15px), `text-caption`(13px), 줄간격 150% |
| 색(라이트) | `--background`, `--surface`, `--border`, `--text-primary/secondary/tertiary`, `--primary`, `--danger`, `--success`, `--warning` (`app/globals.css`) |
| 간격 | 8px 스케일, 데스크톱 거터 24px·모바일 16px, 콘텐츠 최대 너비 `max-w-content`(1200px) |
| 반경 | `rounded-xs`~`xl` (2~12px) |
| 아이콘 | Lucide 24px 기준, stroke ~1.6 |
| 그림자 | `shadow-elevation1`~`4` (단계별 위계) |

## 반응형 메모

- **모바일**: 좌측 고정 사이드바 숨김, 헤더 **메뉴**로 **하단 시트** 내비게이션.
- **태블릿(md~lg)**: **72px 아이콘 레일** 고정.
- **데스크톱(lg+)**: **264px** 전체 사이드바.

## 접근성 메모

- 포커스 링: `focus-visible:ring-2 ring-ring` 일괄 적용.
- 테이블 행 전체 클릭 숨기기 없음 — **상세**·**더보기** 버튼으로 명시적 동작.
- 체크박스·정렬 컨트롤에 `aria-label` 부여.
- 토스트: Sonner `richColors` + 한국어 메시지(스크린리더는 브라우저/OS에 따라 live region 동작).

## 프로젝트 구조 (요약)

- `app/(auth)/login` — 로그인
- `app/admin/*` — 대시보드·사용자·공연장·공연·아티스트·예약·리뷰
- `app/api/admin/*` — 관리자 REST API
- `middleware.ts` — 세션 갱신·`/admin`·`/login` 보호
- `lib/supabase/*` — 클라이언트·서버·미들웨어·service role
- `components/layout/*` — 사이드바·헤더·쉘
- `components/ui/*` — shadcn 스타일 프리미티브
- `components/admin/*PageClient.tsx` — 각 관리 화면 클라이언트

---

Toss·KRDS 등 제3자 브랜드 자산은 사용하지 않았으며, **차분한 중립 톤 + 블루 포인트**의 독자적 B2B 관리 UI로 재해석했습니다.
