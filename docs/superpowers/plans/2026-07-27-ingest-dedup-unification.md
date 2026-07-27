# Ingest 중복 방지 — 정규화 통일 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 크롤 표기 변형(한/영·티켓팅 분할·도시마커)으로 중복 이벤트가 생기는 걸 marker-aware 강한 정규화 키로 ingest 시점에 차단하고, 기존 중복은 재계산 마이그레이션으로 정리한다.

**Architecture:** auto-merge 에 갇혀 있던 정규화(normTitle/coreKey/festPrefix)를 공용 모듈 `lib/ingestion/match-key.ts` 로 승격해 ingest 와 auto-merge 가 공유한다. 이벤트 `dedup_key` 를 강한 키로 교체하고, 기존 데이터는 `absorbEvents()`(기존 헬퍼) 재사용 스크립트로 collapse 한다.

**Tech Stack:** TypeScript, Next.js App Router, Supabase(service-role), `npx tsx` 스크립트. 테스트 러너 없음 → 검증은 모듈 내 `demo()` assert 자기검증 + `npm run typecheck` + `npm run lint` + 스크립트 `--dry` 실측.

## Global Constraints

- 테스트 프레임워크 없음. 각 로직 검증 = `demo()` assert self-check(`npx tsx`) + `npm run typecheck` + `npm run lint`.
- 뮤테이션은 `createServiceRoleClient()`; 읽기는 `createClient()`.
- 임포트 alias `@/*` → 레포 루트.
- `events.dedup_key` 는 **UNIQUE** 제약. 재계산 시 흡수(삭제) 먼저 → 생존 행에만 키 세팅.
- 이벤트 병합은 하드삭제 + `event_merge_logs` 스냅샷(복구 가능). 유일 병합 경로 = `absorbEvents()`.
- 보존 마커(합치면 안 됨): `1부/2부`, `낮공/밤공`, `1일권/2일권`, 서로 다른 공연장(전국투어).
- 스크립트 env 로드: 파일 상단에서 `.env.local` 직접 파싱(dotenv 미설치). 기존 `scripts/pipeline/backfill-canonical-names.ts` 패턴 따름.

---

### Task 1: 공용 정규화 모듈 `match-key.ts`

auto-merge 의 정규화를 레이어별로 승격한다. **레이어를 나누는 이유**: auto-merge 는 3단계를 다르게 쓴다 — `normTitleKey`(패스1~6), `coreTitleKey`(도시마커, 패스7), `festivalKey`(페스티벌 토큰셋, 패스8). ingest dedup_key 는 이 셋을 조합한 `strongTitleKey` 를 쓴다.

**Files:**
- Create: `lib/ingestion/match-key.ts`

**Interfaces:**
- Produces:
  - `normTitleKey(raw: string): string` — NFKC + lowercase + 영숫자/한글만
  - `coreTitleKey(raw: string): string` — normTitleKey + 앞[도시]·뒤"- 도시" 제거(티켓마커 보존)
  - `festivalKey(raw: string): string | null` — 페스티벌/listing 신호 있을 때만 토큰셋 키, 아니면 null
  - `strongTitleKey(raw: string): string` — `festivalKey(raw) ?? coreTitleKey(raw)`
  - `eventDedupKey(rawTitle: string, normalizedVenueName: string | null, startDate: string | null): string`
  - `demo(): void`

- [ ] **Step 1: demo() 자기검증을 먼저 작성 (실패 상태)**

`lib/ingestion/match-key.ts` 를 아래 `demo()` 만 먼저 만들고 함수 본문은 비운(throw) 상태로 시작하지 말고, Step 2 에서 전체를 한 번에 작성한다. (이 프로젝트는 테스트 러너가 없어 red-green 대신 demo assert 로 검증한다.)

- [ ] **Step 2: 모듈 전체 작성**

```ts
import { createHash } from "crypto";
import { strict as assert } from "node:assert";

// 티켓 종류 마커 — coreTitleKey 에서 이건 안 뗀다(스탠딩/지정석은 auto-merge 다른 패스가 처리).
const TICKET =
  /스탠딩|지정석|얼리버드|예매|선예매|티켓|블라인드|vip|premium|pass|[rsa]석/i;
const FEST = /페스티벌|페스타|페스트|festival|fes\b|fest\b/i;
const LISTING =
  /라인업|얼리버드|티켓|발표|개최|크루|예매|오픈|lineup|[0-9]\s*차|최종/i;

/** NFKC + lowercase + 영숫자·한글만(기호·공백 제거). auto-merge normTitle 과 동일. */
export function normTitleKey(raw: string): string {
  return (raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

/** normTitleKey + 앞 [도시]·뒤 "- 도시"(1~6자) 제거. 티켓 마커는 보존. auto-merge coreKey 와 동일. */
export function coreTitleKey(raw: string): string {
  let t = (raw ?? "").normalize("NFKC");
  const lead = t.match(/^\s*[[(［（]([^\])］）]{1,10})[\])］）]\s*/);
  if (lead && !TICKET.test(lead[1])) t = t.slice(lead[0].length);
  t = t.replace(/[ \t]*[-－‐‑–—―_⎽~∼][ \t]*[가-힣A-Za-z]{1,6}[ \t]*$/, "");
  return t.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

/** 페스티벌/서브listing 신호가 있을 때만 정렬 토큰셋 키. auto-merge festPrefix 와 동일. */
export function festivalKey(raw: string): string | null {
  const s = (raw ?? "").normalize("NFKC");
  const idx = s.search(/\s[-–—]\s/);
  const head = idx >= 0 ? s.slice(0, idx) : s;
  const tail = idx >= 0 ? s.slice(idx) : "";
  if (!FEST.test(head) && !(tail && LISTING.test(tail))) return null;
  const toks = head
    .toLowerCase()
    .split(/[\s·,]+/)
    .map((t) => t.replace(/[^a-z0-9가-힣]/g, ""))
    .filter(
      (t) =>
        t.length >= 2 &&
        !/^20\d\d$/.test(t) &&
        !LISTING.test(t) &&
        !/^[a-z]{1,5}$/.test(t),
    )
    .sort();
  const k = toks.join("");
  return k.length >= 6 ? k : null;
}

/** 이벤트 제목 매칭 키 — 페스티벌이면 토큰셋, 아니면 도시마커 제거 core. */
export function strongTitleKey(raw: string): string {
  return festivalKey(raw) ?? coreTitleKey(raw);
}

/** 이벤트 dedup 키 = strongTitleKey | 공연장 | 날짜. 기존 generateDedupKey 대체. */
export function eventDedupKey(
  rawTitle: string,
  normalizedVenueName: string | null,
  startDate: string | null,
): string {
  const title = strongTitleKey(rawTitle) || (rawTitle ?? "").toLowerCase().trim();
  const parts = [
    title,
    (normalizedVenueName ?? "unknown").toLowerCase().trim(),
    startDate ?? "unknown",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function demo(): void {
  // 도시 마커 흡수(비페스티벌 → coreTitleKey)
  assert.equal(
    strongTitleKey("[부산] 유승우 콘서트"),
    strongTitleKey("유승우 콘서트 - 부산"),
    "city marker collapse",
  );
  // 전각/반각
  assert.equal(strongTitleKey("［서울］ 아이유"), strongTitleKey("[서울] 아이유"), "fullwidth");
  // 회차 보존(합치면 안 됨)
  assert.notEqual(
    strongTitleKey("굴다리 콘서트 1부"),
    strongTitleKey("굴다리 콘서트 2부"),
    "session preserved",
  );
  // 티켓 종류는 core 에서 보존(스탠딩≠지정석) — auto-merge 다른 패스가 판단
  assert.notEqual(
    coreTitleKey("[스탠딩] 어떤공연"),
    coreTitleKey("[지정석] 어떤공연"),
    "ticket grade kept",
  );
  // 페스티벌 티켓팅 분할 → 같은 토큰셋 키
  assert.equal(
    strongTitleKey("2026 서울숲재즈페스티벌 - 얼리버드"),
    strongTitleKey("2026 서울숲재즈페스티벌 - 1차 라인업"),
    "festival ticketing split collapse",
  );
  // 서로 다른 페스티벌은 안 합침
  assert.notEqual(
    strongTitleKey("서울숲재즈페스티벌 - 티켓"),
    strongTitleKey("부산국제록페스티벌 - 티켓"),
    "different festivals kept",
  );
  console.log("match-key demo OK");
}

if (require.main === module) demo();
```

- [ ] **Step 3: demo 실행 → 통과 확인**

Run: `npx tsx lib/ingestion/match-key.ts`
Expected: `match-key demo OK` (assert 통과). 실패하면 정규식/로직 수정.

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npx next lint --file lib/ingestion/match-key.ts`
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add lib/ingestion/match-key.ts
git commit -m "feat: 공용 marker-aware 정규화 모듈 match-key (normTitle/core/festival/strong)"
```

---

### Task 2: auto-merge 가 match-key import (DRY, 무회귀)

`event-auto-merge.ts` 의 로컬 `normTitle`/`coreKey`(pass7)/`festPrefix`(pass8) 를 공용 모듈로 대체한다. **동작 동일해야 한다.** Task 1 의 함수는 auto-merge 원본을 그대로 포팅했으므로 결과가 같아야 한다.

**Files:**
- Modify: `lib/ingestion/event-auto-merge.ts`

**Interfaces:**
- Consumes: `normTitleKey`, `coreTitleKey`(→기존 `coreKey`), `festivalKey`(→기존 `festPrefix`) from `@/lib/ingestion/match-key`

- [ ] **Step 1: import 추가**

`event-auto-merge.ts` 상단(다른 import 아래)에:
```ts
import { normTitleKey, coreTitleKey, festivalKey } from "@/lib/ingestion/match-key";
```

- [ ] **Step 2: 로컬 normTitle 대체**

`event-auto-merge.ts` 의 로컬 `function normTitle(e: Ev): string { ... }` 정의를 삭제하고, 호출부 `normTitle(x)` 를 `normTitleKey(x.normalized_title ?? x.title ?? "")` 로 바꾼다. (기존 normTitle 은 `e.normalized_title ?? e.title` 를 정규화했으므로 인자를 그 문자열로 넘긴다.)

`normTitle` 은 여러 패스에서 쓰이므로 전 호출부를 일괄 치환한다. 예:
```ts
// before: if (normTitle(e).length < 3 ...)
// after:  if (normTitleKey(e.normalized_title ?? e.title ?? "").length < 3 ...)
```
반복을 줄이려면 파일 상단에 얇은 로컬 헬퍼를 남겨도 된다:
```ts
const nt = (e: Ev) => normTitleKey(e.normalized_title ?? e.title ?? "");
```
그리고 기존 `normTitle(e)` → `nt(e)` 로 치환.

- [ ] **Step 3: pass7 coreKey, pass8 festPrefix 대체**

로컬 `const coreKey = (e: Ev) => {...}` 삭제 → 호출부 `coreKey(e)` 를 `coreTitleKey(e.normalized_title ?? e.title ?? "")` 로.
로컬 `const festPrefix = (e: Ev) => {...}` 삭제 → 호출부 `festPrefix(e)` 를 `festivalKey(e.title ?? "")` 로. (festPrefix 는 원본 title 기반이었음)

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npx next lint --file lib/ingestion/event-auto-merge.ts`
Expected: 에러 없음. (사용 안 하게 된 지역 헬퍼/정규식 잔재 정리 — TICKET/FEST/LISTING/lcsLen 중 여전히 쓰는 건 남기고 죽은 것만 제거.)

- [ ] **Step 5: 무회귀 스팟체크**

`npx tsx` 인라인으로 샘플 제목 몇 개를 넣어 예전 값(알고 있는 결과)과 일치하는지 눈으로 확인:
```bash
npx tsx -e 'import {strongTitleKey} from "./lib/ingestion/match-key"; console.log(strongTitleKey("[부산] 2026 김경호 전국투어 콘서트"))'
```
Expected: 도시마커 제거된 core 키. auto-merge 가 여전히 typecheck/lint 통과 + demo OK.

- [ ] **Step 6: 커밋**

```bash
git add lib/ingestion/event-auto-merge.ts
git commit -m "refactor: auto-merge 정규화를 공용 match-key 로 이관(무회귀)"
```

---

### Task 3: 이벤트 dedup_key 강한 키 적용 + upsert 23505 방어

**Files:**
- Modify: `lib/ingestion/dedup.ts`
- Modify: `lib/ingestion/normalize.ts` (dedupKey 호출부)
- Modify: `lib/ingestion/upsert.ts` (INSERT 23505 폴백)

**Interfaces:**
- Consumes: `eventDedupKey` from `@/lib/ingestion/match-key`

- [ ] **Step 1: dedup.ts generateDedupKey 를 강한 키에 위임**

`lib/ingestion/dedup.ts` 를 아래로 교체(시그니처 유지, 호출부 무변경):
```ts
import { eventDedupKey } from "./match-key";

/** @deprecated 강한 키 위임. rawTitle 을 넘기면 marker-aware 로 계산된다. */
export function generateDedupKey(
  titleOrRaw: string,
  normalizedVenueName: string | null,
  startDate: string | null,
): string {
  return eventDedupKey(titleOrRaw, normalizedVenueName, startDate);
}

export function isDuplicate(keyA: string, keyB: string): boolean {
  return keyA === keyB;
}
```

- [ ] **Step 2: normalize.ts 가 원본 제목을 넘기게 변경**

`lib/ingestion/normalize.ts` 의 `normalizeEvent` 반환부:
```ts
// before: dedupKey: generateDedupKey(normalizedTitle, normalizedVenueName, startDate),
// after:
dedupKey: generateDedupKey(displayTitle, normalizedVenueName, startDate),
```
(strongTitleKey 가 원본 displayTitle 에서 마커를 처리하도록 normalizedTitle 대신 displayTitle 을 넘긴다.)

- [ ] **Step 3: upsert.ts INSERT 23505 방어 추가**

`lib/ingestion/upsert.ts` 의 INSERT 결과 처리부:
```ts
// before:
//   if (error) throw new Error(`Upsert insert failed: ${error.message}`);
// after:
if (error) {
  // 강한 dedup_key 가 UNIQUE 충돌(23505) → 사실상 같은 공연이 방금 들어옴/경합.
  // throw 대신 그 키로 기존 행을 다시 찾아 UPDATE 경로로 폴백.
  if ((error as { code?: string }).code === "23505") {
    const { data: dupe } = await db
      .from("events")
      .select(EXISTING_COLS)
      .eq("dedup_key", event.dedupKey)
      .maybeSingle();
    if (dupe) {
      existing = dupe;
    } else {
      throw new Error(`Upsert insert failed(23505, no row): ${error.message}`);
    }
  } else {
    throw new Error(`Upsert insert failed: ${error.message}`);
  }
}
```
**주의**: 이 폴백이 성립하려면 INSERT 블록이 `existing` 을 재설정한 뒤 아래 UPDATE 경로로 흐를 수 있어야 한다. 현재 INSERT 블록은 `if (!existing) { ...insert...; return ... }` 안에서 즉시 return 한다. 구조를 바꿔 23505 시 return 하지 말고 UPDATE 경로로 이어지게 한다 — 가장 작은 변경: INSERT 시도를 헬퍼로 감싸 성공하면 return, 23505 면 `existing = dupe` 후 아래로 fall through. 구현자는 `if (!existing)` 블록 끝의 `return` 을 조건부로 만들어 23505 폴백일 때만 계속 진행하도록 재배치한다.

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npx next lint --file lib/ingestion/dedup.ts --file lib/ingestion/normalize.ts --file lib/ingestion/upsert.ts`
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add lib/ingestion/dedup.ts lib/ingestion/normalize.ts lib/ingestion/upsert.ts
git commit -m "feat: 이벤트 dedup_key 를 강한 marker-aware 키로 + upsert 23505 폴백"
```

---

### Task 4: 재계산 마이그레이션 스크립트 (이벤트 collapse)

**Files:**
- Create: `scripts/pipeline/recompute-match-keys.ts`
- Modify: `lib/ingestion/event-auto-merge.ts` (기존 `absorbEvents` 를 export — 현재 파일 내 private)

**Interfaces:**
- Consumes: `eventDedupKey` from match-key; `absorbEvents(db, canonId, otherIds, passName)` from event-auto-merge; `pickCanonical` 논리(스크립트 내 간이 재현 또는 export)

- [ ] **Step 1: absorbEvents export**

`lib/ingestion/event-auto-merge.ts` 의 `async function absorbEvents(...)` 앞에 `export` 추가. (지금은 private; recompute 스크립트가 재사용.)

- [ ] **Step 2: 스크립트 작성**

`scripts/pipeline/recompute-match-keys.ts`:
```ts
/**
 * dedup_key 재계산 + 기존 중복 collapse. dedup_key 가 UNIQUE 라 "흡수(삭제) → 생존 행 키 세팅" 순서.
 * 실행: npx tsx scripts/pipeline/recompute-match-keys.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

type Ev = { id: string; title: string; normalized_title: string | null; start_date: string | null; venue_id: string | null; created_at: string; dedup_key: string | null };

async function main() {
  const dry = process.argv.includes("--dry");
  const { createServiceRoleClient } = await import("../../lib/supabase/service-role");
  const { eventDedupKey } = await import("../../lib/ingestion/match-key");
  const { absorbEvents } = await import("../../lib/ingestion/event-auto-merge");
  const db = createServiceRoleClient();

  // 활성 이벤트 fetch
  const all: Ev[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select("id,title,normalized_title,start_date,venue_id,created_at,dedup_key")
      .is("merged_into_event_id", null)
      .eq("is_hidden", false)
      .range(f, f + 999);
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < 1000) break;
  }

  // 공연장 정규화명 조회(키 계산용)
  const venueIds = Array.from(new Set(all.map((e) => e.venue_id).filter(Boolean))) as string[];
  const vname = new Map<string, string>();
  for (let i = 0; i < venueIds.length; i += 500) {
    const { data } = await db.from("venues").select("id,normalized_name").in("id", venueIds.slice(i, i + 500));
    for (const v of (data as { id: string; normalized_name: string | null }[]) ?? [])
      vname.set(v.id, v.normalized_name ?? "");
  }

  // 새 키로 그룹핑
  const groups = new Map<string, Ev[]>();
  for (const e of all) {
    const key = eventDedupKey(e.title, e.venue_id ? (vname.get(e.venue_id) ?? null) : null, e.start_date);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const dupGroups = Array.from(groups.entries()).filter(([, g]) => g.length > 1);
  console.log(`이벤트 ${all.length}, 새 키 그룹 ${groups.size}, 중복 그룹 ${dupGroups.length}, 흡수 예정 ${dupGroups.reduce((n, [, g]) => n + g.length - 1, 0)}`);

  if (dry) {
    for (const [key, g] of dupGroups.slice(0, 40)) {
      console.log(`\n[${key.slice(0, 10)}]`);
      for (const e of g) console.log(`  "${e.title.slice(0, 45)}" ${e.start_date?.slice(0, 10)} v=${e.venue_id?.slice(0, 8)}`);
    }
    console.log("\n(--dry. 적용하려면 --dry 없이)");
    return;
  }

  // canonical = 정보량/최초등록 우선(간이): 아티스트 있으면… 여기선 created_at 최소 + 제목 김을 canonical.
  let collapsed = 0, keyed = 0;
  for (const [key, g] of dupGroups) {
    const canon = [...g].sort((a, b) => (b.title?.length ?? 0) - (a.title?.length ?? 0) || (a.created_at < b.created_at ? -1 : 1))[0];
    const others = g.filter((e) => e.id !== canon.id).map((e) => e.id);
    const n = await absorbEvents(db, canon.id, others, "recompute_collapse");
    collapsed += n;
    // 생존 행 키 세팅(흡수로 충돌 행 삭제됨 → UNIQUE 안전)
    const { error } = await db.from("events").update({ dedup_key: key }).eq("id", canon.id);
    if (!error) keyed++;
  }
  // 단일 그룹(중복 아님)도 키 갱신
  for (const [key, g] of groups) {
    if (g.length !== 1) continue;
    if (g[0].dedup_key === key) continue;
    await db.from("events").update({ dedup_key: key }).eq("id", g[0].id);
    keyed++;
  }
  console.log(`\n흡수 ${collapsed}, 키 갱신 ${keyed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: --dry 실측**

Run: `npx tsx scripts/pipeline/recompute-match-keys.ts --dry`
Expected: 중복 그룹 목록 출력. **사람 확인**: 명백한 오병합(다른 공연장/회차/1부2부)이 같은 그룹에 없나 샘플 검토. 이상하면 Task 1 정규화 수정 후 재확인.

- [ ] **Step 5: 실제 적용**

Run: `npx tsx scripts/pipeline/recompute-match-keys.ts`
Expected: `흡수 N, 키 갱신 M`. `event_merge_logs` 스냅샷으로 복구 가능.

- [ ] **Step 6: 커밋**

```bash
git add scripts/pipeline/recompute-match-keys.ts lib/ingestion/event-auto-merge.ts
git commit -m "feat: dedup_key 재계산+collapse 마이그레이션 스크립트 (absorbEvents 재사용)"
```

---

### Task 5: 파이프라인 상시 collapse (강한 키 pass0)

매 파이프라인 run 에 강한-키 collapse 를 넣어 새로 샌 중복을 자동 정리한다.

**Files:**
- Modify: `lib/ingestion/event-auto-merge.ts` (`collapseByStrongKey()` 추가 + `autoMergeDuplicateEvents` 시작에서 호출)

**Interfaces:**
- Produces: `collapseByStrongKey(): Promise<{ collapsed: number }>` — recompute 스크립트의 collapse 로직을 라이브러리 함수로.

- [ ] **Step 1: collapseByStrongKey 추가**

`event-auto-merge.ts` 에 Task 4 스크립트의 그룹핑+absorb 로직을 함수로 추가(스크립트는 이 함수를 호출하도록 나중에 리팩터 가능하나 지금은 중복 최소화를 위해 공통 로직을 이 함수에 두고 스크립트가 import). 시그니처:
```ts
export async function collapseByStrongKey(): Promise<{ collapsed: number }> {
  // Task4 의 fetch → venue name → eventDedupKey 그룹핑 → dupGroups → absorbEvents → 생존행 키 세팅
  // (dry/로그 없이 실행만)
}
```
그리고 recompute 스크립트(Task4)는 이 함수를 재사용하도록 정리하되, `--dry` 미리보기는 스크립트에 남긴다.

- [ ] **Step 2: autoMergeDuplicateEvents 시작에서 호출**

`autoMergeDuplicateEvents()` 본문 맨 앞(패스1 전)에:
```ts
const strong = await collapseByStrongKey();
merged += strong.collapsed;
```
(강한-키로 먼저 확실한 중복을 합친 뒤, 기존 8패스가 fuzzy 잔여 처리.)

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npx next lint --file lib/ingestion/event-auto-merge.ts`
Expected: 에러 없음.

- [ ] **Step 4: 로컬 파이프라인 merge 단계만 실측(선택)**

`npx tsx -e 'import {collapseByStrongKey} from "./lib/ingestion/event-auto-merge"; collapseByStrongKey().then(r=>console.log(r))'` (env 로드 필요 — set -a; . ./.env.local; set +a 선행)
Expected: `{ collapsed: 0 }` (Task4 로 이미 정리됐으면 0). 오류 없이 완료.

- [ ] **Step 5: 커밋**

```bash
git add lib/ingestion/event-auto-merge.ts scripts/pipeline/recompute-match-keys.ts
git commit -m "feat: 파이프라인 상시 강한키 collapse (autoMerge pass0)"
```

---

### Task 6: 아티스트/공연장 NFKC + normalized_name 재계산

**Files:**
- Modify: `lib/artists/normalize.ts` (`normalizeKey` NFC→NFKC)
- Modify: `lib/ingestion/normalize.ts` (`normalizeVenueName` NFKC)
- Modify: `scripts/pipeline/recompute-match-keys.ts` (아티스트/공연장 normalized_name 재계산 추가)

- [ ] **Step 1: normalizeKey NFKC**

`lib/artists/normalize.ts` 의 `normalizeKey`:
```ts
// before: .normalize("NFC")
// after:  .normalize("NFKC")
```

- [ ] **Step 2: normalizeVenueName NFKC**

`lib/ingestion/normalize.ts` 의 `normalizeVenueName` 시작에 NFKC 정규화 추가(기존 로직 앞):
```ts
// 입력을 NFKC 로 먼저 정규화(전각/반각·호환문자 흡수)
const src = (rawInput ?? "").normalize("NFKC");
// ...이후 기존 로직에서 src 사용
```
(구체 변수명은 기존 함수 시그니처에 맞춰 조정.)

- [ ] **Step 3: 재계산 스크립트에 아티스트/공연장 추가**

`recompute-match-keys.ts` 에 `--entities=artists,venues` 처리 또는 항상 이어서 실행:
```ts
// 아티스트 normalized_name 재계산
const { normalizeKey } = await import("../../lib/artists/normalize");
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("artists").select("id,name,normalized_name").range(f, f + 999);
  if (!data?.length) break;
  for (const a of data as { id: string; name: string; normalized_name: string | null }[]) {
    const nk = normalizeKey(a.name);
    if (nk && nk !== a.normalized_name)
      await db.from("artists").update({ normalized_name: nk }).eq("id", a.id);
  }
  if (data.length < 1000) break;
}
// 공연장도 동일 패턴(normalizeVenueName 사용)
```
재계산으로 같은 normalized_name 이 된 아티스트 중복은 기존 `autoMergeExactArtists`(파이프라인 merge) / 수동 시트가 정리 — 이 스크립트는 키만 갱신.

- [ ] **Step 4: typecheck + lint + demo 재확인**

Run: `npm run typecheck && npx tsx lib/ingestion/match-key.ts`
Expected: 에러 없음, demo OK.

- [ ] **Step 5: 재계산 실행**

Run: `npx tsx scripts/pipeline/recompute-match-keys.ts` (아티스트/공연장 갱신 포함)
Expected: 갱신 건수 출력, 오류 없음.

- [ ] **Step 6: 커밋 + PR**

```bash
git add lib/artists/normalize.ts lib/ingestion/normalize.ts scripts/pipeline/recompute-match-keys.ts
git commit -m "feat: 아티스트/공연장 NFKC 정규화 + normalized_name 재계산"
git push -u origin feat/ingest-dedup-unification
```
그 후 `gh pr create` 로 PR 생성(설명에 스펙 링크).

---

## 검증 요약 (전체)

- Task1 `match-key.demo()` assert 통과 — 티켓팅분할/도시마커/회차보존/전각반각.
- Task2 auto-merge 무회귀 — typecheck+lint, 샘플 키 스팟체크.
- Task4/5 `--dry` 로 오병합 없음 확인 후 적용, `event_merge_logs` 복구 가능.
- 각 Task typecheck + lint 통과.

## 스코프 밖 (별도 플랜)

- 관리자 버튼 전수 검증(보강/dedup/merge/이름제안/이벤트 dedup → API → DB 효과 실측).
