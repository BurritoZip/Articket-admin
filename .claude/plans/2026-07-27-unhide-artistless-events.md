# 아티스트 미연결 공연 노출 (숨김 정책 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 포스터가 있는 아티스트-미연결 콘서트를 앱 피드에 노출한다 (현재 `unlinked_no_artist`로 숨겨진 ~381개).

**Architecture:** `lib/data-quality/purge-unlinked.ts`의 숨김 규칙에 `poster_url IS NULL` 가드레일을 추가하고, 포스터 보유 숨김 건을 해제하는 self-heal을 추가한다. 파이프라인 `merge` 단계가 이 함수를 호출하므로 다음 실행 시 자동 반영. 즉시 반영은 함수 1회 수동 실행.

**Tech Stack:** TypeScript, Supabase(service-role client), Next.js. 테스트 프레임워크 없음 — 검증 = `npm run typecheck` + `npm run lint` + 감사 스크립트 실측(레포 관례).

## Global Constraints

- 뮤테이션은 `createServiceRoleClient()` 사용 (이미 파일이 사용 중).
- `hidden_reason='unlinked_no_artist'`로 숨긴 건만 건드린다. 180일 purge(`ended_180d`)·병합 숨김은 절대 건드리지 않는다.
- 마이그레이션·iOS 변경 없음 (컬럼 `is_hidden`/`hidden_reason`/`poster_url` 모두 존재).
- 스펙: `docs/decisions/2026-07-27-unhide-artistless-events.md`.

---

### Task 1: 숨김 규칙 가드레일 + 포스터 기반 해제

**Files:**
- Modify: `lib/data-quality/purge-unlinked.ts`

**Interfaces:**
- Produces: `purgeUnlinkedEvents(): Promise<{ hidden: number; unhidden: number }>` (시그니처 불변).

- [ ] **Step 1: 세 숨김 쿼리에 포스터 가드레일 추가**

각 숨김 쿼리(d1/d2/d3)에 `.is("poster_url", null)`를 추가한다. 즉 아티스트 미연결이라도 **포스터가 없을 때만** 숨긴다.

d1 (`.eq("artist_link_status", "no_artist")` 블록):
```ts
  const { data: d1 } = await db
    .from("events")
    .update(patch)
    .eq("artist_link_status", "no_artist")
    .is("artist_id", null)
    .is("poster_url", null)
    .eq("is_hidden", false)
    .select("id");
```

d2 (`enrich 시도 후도 artist_id 없음` 블록):
```ts
  const { data: d2 } = await db
    .from("events")
    .update(patch)
    .is("artist_id", null)
    .not("enrich_attempted_at", "is", null)
    .or("artist_link_status.is.null,artist_link_status.eq.no_artist")
    .is("poster_url", null)
    .eq("is_hidden", false)
    .select("id");
```

d3 (`3일 이상 방치 null` 블록):
```ts
  const { data: d3 } = await db
    .from("events")
    .update(patch)
    .is("artist_id", null)
    .is("artist_link_status", null)
    .lt("crawled_at", threeDaysAgo)
    .is("poster_url", null)
    .eq("is_hidden", false)
    .select("id");
```

- [ ] **Step 2: 포스터 보유 숨김 건 해제(self-heal 확장)**

기존 `back`(artist_id 기반 unhide) 블록 **뒤에** 포스터 기반 unhide를 추가한다. 순차 실행이라 이미 해제된 건은 `hidden_reason`이 null이 되어 두 번째 쿼리에 안 걸림 → 중복 카운트 없음.

```ts
  // 자가치유 2: 포스터가 있으면 아티스트 미연결이어도 노출한다(정책 완화).
  const { data: backPoster } = await db
    .from("events")
    .update({ is_hidden: false, hidden_at: null, hidden_reason: null })
    .eq("hidden_reason", REASON)
    .not("poster_url", "is", null)
    .select("id");
```

반환값의 `unhidden` 합산에 `backPoster`를 포함:
```ts
  return {
    hidden: (d1?.length ?? 0) + (d2?.length ?? 0) + (d3?.length ?? 0),
    unhidden: (back?.length ?? 0) + (backPoster?.length ?? 0),
  };
```

- [ ] **Step 3: 상단 doc 주석 갱신**

파일 상단 주석의 "숨김 조건" 섹션에 포스터 가드레일을, "보존" 섹션에 "포스터 보유 시 아티스트 미연결이어도 노출"을 반영한다. 예:
```ts
 * 숨김 조건 (아래 + 공통: poster_url IS NULL — 포스터 없는 것만 숨긴다):
 *   1. artist_link_status='no_artist'
 *   2. artist_id IS NULL AND enrich_attempted_at IS NOT NULL
 *   3. artist_id IS NULL AND artist_link_status IS NULL AND crawled_at < 3일 전
 *
 * 보존/해제:
 *   - multi_artist, artist_id 있는 것: 유지
 *   - 포스터가 있으면 아티스트 미연결이어도 노출(정책 완화) — Gemini 다운 시 대량 숨김 방지
```

- [ ] **Step 4: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과(에러 0).

- [ ] **Step 5: 커밋**

```bash
git add lib/data-quality/purge-unlinked.ts docs/decisions/2026-07-27-unhide-artistless-events.md
git commit -m "fix: 포스터 있는 아티스트-미연결 공연 노출 — 숨김 정책 완화"
```

---

### Task 2: 즉시 반영 + 실측 검증

**Files:**
- (임시) 스크래치 스크립트 — 커밋하지 않음.

**Interfaces:**
- Consumes: `purgeUnlinkedEvents` (Task 1).

- [ ] **Step 1: 변경 전 기준값 기록**

레포 루트에 임시 스크립트 `verify.tmp.ts` 작성:
```ts
import { createServiceRoleClient } from "@/lib/supabase/service-role";
const db = createServiceRoleClient();
const head = (q: any) => q.select("id", { count: "exact", head: true });
const now = new Date().toISOString();
async function main() {
  const { count: active } = await head(db.from("events")).gte("end_date", now);
  const { count: hiddenFuture } = await head(db.from("events"))
    .eq("is_hidden", true).eq("hidden_reason", "unlinked_no_artist").gte("end_date", now);
  console.log("active(end>=now):", active, "| hidden-future unlinked:", hiddenFuture);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local verify.tmp.ts`
Expected: 변경 전 대략 `active: ~626 | hidden-future unlinked: ~381`.

- [ ] **Step 2: purge-unlinked 1회 실행(즉시 해제)**

레포 루트에 임시 스크립트 `run-unhide.tmp.ts`:
```ts
import { purgeUnlinkedEvents } from "@/lib/data-quality/purge-unlinked";
purgeUnlinkedEvents()
  .then((r) => console.log("hidden:", r.hidden, "unhidden:", r.unhidden))
  .catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local run-unhide.tmp.ts`
Expected: `unhidden:` 수백(≈ 포스터 보유 숨김 건).

- [ ] **Step 3: 변경 후 실측 재확인**

Run: `npx tsx --env-file=.env.local verify.tmp.ts`
Expected: `active`가 ~1000 수준으로 급증, `hidden-future unlinked`가 포스터 없는 소수만 남음.

- [ ] **Step 4: 스팟 체크 — 포스터 없는 미래 콘서트는 여전히 숨김**

임시 스크립트로 `hidden_reason='unlinked_no_artist' AND poster_url IS NULL AND end_date>=now` 카운트가 남아있는지 확인(0이 아니어도 정상 — 포스터 없는 건은 계속 숨김).

- [ ] **Step 5: 임시 스크립트 삭제**

```bash
rm -f verify.tmp.ts run-unhide.tmp.ts
```
(커밋 없음 — 코드 변경은 Task 1에서 완료.)
