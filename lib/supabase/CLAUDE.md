# lib/supabase/ — Supabase 클라이언트

## 클라이언트 종류

| 파일 | 용도 | 언제 사용 |
|---|---|---|
| `server.ts` | 서버 컴포넌트/라우트 읽기 | GET 요청, 서버 사이드 렌더링 |
| `service-role.ts` | RLS 우회 뮤테이션 | INSERT/UPDATE/DELETE, AI 큐 처리 |
| `client.ts` | 클라이언트 컴포넌트 | 브라우저 실시간 구독 |
| `require-admin.ts` | 관리자 인증 — `requireAdmin()` | 모든 admin API 라우트 최상단 |
| `middleware.ts` | 세션 갱신 미들웨어 | `middleware.ts` 루트에서 사용 |

## 규칙

뮤테이션 = 항상 `createServiceRoleClient()`.
관리자 확인 = 모든 API 라우트에서 `const guard = await requireAdmin(); if (!guard.ok) return guard.response;`.
