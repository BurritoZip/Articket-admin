# 공연장 주소 오염·이름 중복 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공연장 `address==이름` 오염을 Claude+웹검색으로 실주소로 고치고, 이름 변형 대형 공연장 중복을 병합하며, 파이프라인 auto-merge를 주소-인지로 만들어 재발을 막는다.

**Architecture:** (1) `auto-merge.ts`를 주소-인지로 수정(주소 다르면 병합 보류) — LLM 없음. (2) dedup 후보 탐지 순수 로직을 `lib/venues/dedup-detect.ts`로 추출해 route와 일회성 스크립트가 공유. (3) 일회성 `scripts/pipeline/venue-cleanup-claude.ts`(dry-run 기본, `--apply`)가 Claude로 Phase1 주소수정 + Phase2 변형중복 병합.

**Tech Stack:** Next.js 14 / TypeScript / Supabase(service-role) / `@anthropic-ai/sdk`(신규) / `npx tsx` 실행. 테스트 러너 없음 — 검증은 `npm run typecheck` + `npm run lint` + `assert` 기반 tsx 셀프체크 + 스크립트 dry-run 실측.

## Global Constraints

- 뮤테이션은 `createServiceRoleClient()`(`lib/supabase/service-role`), 읽기는 서버 클라이언트. RLS 우회는 서비스롤만.
- import 별칭 `@/*` → 레포 루트(tsconfig paths).
- Claude 모델 `claude-opus-4-8`, `thinking: {type:"adaptive"}`, `output_config: {effort:"low"}`, `web_search_20260209` 툴. `ANTHROPIC_API_KEY`는 서버 전용 — 클라이언트 노출 금지.
- DB 스키마 변경 없음(`address_attempted_at` 기존 컬럼). 마이그레이션·iOS 동기화 없음.
- `mergeVenues`(`lib/venues/merge.ts`)와 `enrich.ts`는 변경하지 않고 재사용.
- 파괴적 병합: 스크립트는 인자 없으면 반드시 dry-run, `--apply` 명시해야 쓰기.

---

### Task 1: dedup 후보 탐지 로직 추출 → `lib/venues/dedup-detect.ts`

현재 `app/api/admin/venues/dedup/route.ts`에 인라인된 순수 탐지 함수를 새 모듈로 옮기고 route가 import하게 한다. AI 검증 이전의 후보쌍만 반환.

**Files:**
- Create: `lib/venues/dedup-detect.ts`
- Create: `lib/venues/dedup-detect.check.ts` (assert 셀프체크)
- Modify: `app/api/admin/venues/dedup/route.ts` (탐지 로직 제거 후 import)

**Interfaces:**
- Produces:
  - `interface VenueBasic { id: string; name: string; address: string | null; normalized_name: string | null }`
  - `interface VenueDedupCandidate { reason: "exact_normalized"|"name_contains"|"token_overlap"; similarity: number; suggestedKeepId: string; members: Array<{ id: string; name: string; address: string | null; linked_event_count: number }> }`
  - `function detectDuplicateCandidates(venues: VenueBasic[], linkedCountMap: Record<string, number>): VenueDedupCandidate[]` — reason 우선순위·similarity 내림차순 정렬된 후보. AI 검증 없음.

- [ ] **Step 1: `lib/venues/dedup-detect.ts` 작성**

```typescript
export interface VenueBasic {
  id: string;
  name: string;
  address: string | null;
  normalized_name: string | null;
}

export interface VenueDedupCandidate {
  reason: "exact_normalized" | "name_contains" | "token_overlap";
  similarity: number;
  suggestedKeepId: string;
  members: Array<{
    id: string;
    name: string;
    address: string | null;
    linked_event_count: number;
  }>;
}

function normalizeVenueKey(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^가-힣ㄱ-㆏a-z0-9]/g, "")
    .trim();
}

function tokenizeVenue(s: string): string[] {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[()[\]{}（）]/g, " ")
    .split(/[\s\-·._/]+/)
    .map((t) => t.replace(/[^가-힣ㄱ-㆏a-z0-9]/g, ""))
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of Array.from(setA)) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** AI 검증 이전의 중복 후보쌍 생성 (Stage A: 정규화 완전일치, B: 이름 포함, C: 토큰 자카드 ≥ 0.7) */
export function detectDuplicateCandidates(
  venues: VenueBasic[],
  linkedCountMap: Record<string, number>,
): VenueDedupCandidate[] {
  const toMember = (v: VenueBasic) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    linked_event_count: linkedCountMap[v.id] ?? 0,
  });

  const groups = new Map<string, VenueDedupCandidate>();

  const addGroup = (
    a: VenueBasic,
    b: VenueBasic,
    reason: VenueDedupCandidate["reason"],
    similarity: number,
  ) => {
    const key = [a.id, b.id].sort().join("|");
    if (groups.has(key)) return;
    const members = [toMember(a), toMember(b)].sort(
      (x, y) => y.linked_event_count - x.linked_event_count,
    );
    groups.set(key, {
      reason,
      similarity,
      suggestedKeepId: members[0].id,
      members,
    });
  };

  // ── Stage A: normalized_name 완전 일치 ──
  const normGroups = new Map<string, VenueBasic[]>();
  for (const v of venues) {
    const key = v.normalized_name
      ? normalizeVenueKey(v.normalized_name)
      : normalizeVenueKey(v.name);
    if (!key) continue;
    const g = normGroups.get(key) ?? [];
    g.push(v);
    normGroups.set(key, g);
  }
  for (const group of Array.from(normGroups.values())) {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        addGroup(group[0], group[i], "exact_normalized", 1.0);
      }
    }
  }

  // ── Stage B: 이름 포함 관계 ──
  for (let i = 0; i < venues.length - 1; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const a = venues[i];
      const b = venues[j];
      const keyA = normalizeVenueKey(a.name);
      const keyB = normalizeVenueKey(b.name);
      if (keyA.length < 2 || keyB.length < 2) continue;
      const [shorter, longer] =
        keyA.length <= keyB.length ? [keyA, keyB] : [keyB, keyA];
      const [shortV, longV] = keyA.length <= keyB.length ? [a, b] : [b, a];
      if (longer.includes(shorter) && shorter.length / longer.length >= 0.5) {
        addGroup(longV, shortV, "name_contains", shorter.length / longer.length);
      }
    }
  }

  // ── Stage C: 토큰 자카드 유사도 ≥ 0.7 ──
  const byLen = new Map<number, VenueBasic[]>();
  for (const v of venues) {
    const l = v.name.length;
    for (const d of [-1, 0, 1]) {
      const g = byLen.get(l + d) ?? [];
      if (!g.includes(v)) g.push(v);
      byLen.set(l + d, g);
    }
  }
  for (const [, group] of Array.from(byLen)) {
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const key = [a.id, b.id].sort().join("|");
        if (groups.has(key)) continue;
        const sim = jaccard(tokenizeVenue(a.name), tokenizeVenue(b.name));
        if (sim >= 0.7) addGroup(a, b, "token_overlap", sim);
      }
    }
  }

  const reasonOrder = { exact_normalized: 0, name_contains: 1, token_overlap: 2 };
  return Array.from(groups.values()).sort((a, b) => {
    if (reasonOrder[a.reason] !== reasonOrder[b.reason])
      return reasonOrder[a.reason] - reasonOrder[b.reason];
    return b.similarity - a.similarity;
  });
}
```

- [ ] **Step 2: `route.ts`를 추출 함수 사용하도록 수정**

`app/api/admin/venues/dedup/route.ts`에서 인라인 `VenueBasic`/`normalizeVenueKey`/`tokenizeVenue`/`jaccard`/`VenueDedupCandidate`/`groups`/`addGroup`/Stage A~C/정렬(`allCandidates`)을 삭제하고, 상단 import에 추가:

```typescript
import {
  detectDuplicateCandidates,
  type VenueBasic,
  type VenueDedupCandidate,
} from "@/lib/venues/dedup-detect";
```

`linkedCountMap` 계산까지는 그대로 두고, 그 다음을 아래로 교체:

```typescript
  const venues = rawVenues as unknown as VenueBasic[];

  // 이벤트 연결 수 조회 (기존 그대로)
  const { data: eventLinks } = await supabase
    .from("events")
    .select("venue_id")
    .not("venue_id", "is", null);

  const linkedCountMap: Record<string, number> = {};
  for (const { venue_id } of eventLinks ?? []) {
    if (venue_id)
      linkedCountMap[venue_id] = (linkedCountMap[venue_id] ?? 0) + 1;
  }

  const allCandidates = detectDuplicateCandidates(venues, linkedCountMap);

  // Gemini 검증 이하 기존 로직 그대로 (useAI, verified, result, byReason, return)
```

`VenueDedupCandidate` 를 다른 곳에서 export하던 코드가 있으면 그 export는 남겨두되 정의는 dedup-detect에서 re-export한다. route에 남아있던 `export interface VenueDedupCandidate` 는 삭제(위 import로 대체).

- [ ] **Step 3: `lib/venues/dedup-detect.check.ts` 작성 (assert 셀프체크)**

```typescript
import assert from "node:assert";
import { detectDuplicateCandidates, type VenueBasic } from "./dedup-detect";

const venues: VenueBasic[] = [
  { id: "1", name: "올림픽공원 체조경기장", address: null, normalized_name: "올림픽공원체조경기장" },
  { id: "2", name: "올림픽공원 체조경기장", address: null, normalized_name: "올림픽공원체조경기장" },
  { id: "3", name: "KSPO DOME", address: null, normalized_name: null },
  { id: "4", name: "KSPO DOME (올림픽체조경기장)", address: null, normalized_name: null },
  { id: "5", name: "전혀다른곳", address: null, normalized_name: null },
];
const counts = { "1": 5, "2": 1, "3": 3, "4": 0 };
const c = detectDuplicateCandidates(venues, counts);

// 1↔2 완전일치
assert.ok(
  c.some((x) => x.reason === "exact_normalized" && x.members.map((m) => m.id).sort().join() === "1,2"),
  "1↔2 exact_normalized 후보 있어야",
);
// 3↔4 이름 포함
assert.ok(
  c.some((x) => x.members.map((m) => m.id).sort().join() === "3,4"),
  "3↔4 후보(name_contains/token) 있어야",
);
// keep은 event_count 최다(1번, 3번)
const g12 = c.find((x) => x.members.map((m) => m.id).sort().join() === "1,2")!;
assert.strictEqual(g12.suggestedKeepId, "1", "1↔2 keep은 event_count 많은 1");
// 5번은 어떤 후보에도 없음
assert.ok(!c.some((x) => x.members.some((m) => m.id === "5")), "무관한 5번은 후보 없음");

console.log("dedup-detect.check OK");
```

- [ ] **Step 4: 셀프체크 실행 (통과 확인)**

Run: `npx tsx lib/venues/dedup-detect.check.ts`
Expected: `dedup-detect.check OK` 출력, 종료코드 0.

- [ ] **Step 5: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add lib/venues/dedup-detect.ts lib/venues/dedup-detect.check.ts app/api/admin/venues/dedup/route.ts
git commit -m "refactor: 공연장 dedup 후보 탐지 로직 lib/venues/dedup-detect 로 추출"
```

---

### Task 2: `auto-merge.ts` 주소-인지 병합

같은 `normalized_name` 그룹이라도 주소가 명확히 다르면 병합을 보류한다.

**Files:**
- Modify: `lib/venues/auto-merge.ts`
- Create: `lib/venues/auto-merge.check.ts` (assert 셀프체크)

**Interfaces:**
- Produces:
  - `function normalizeAddress(a: string | null): string`
  - `function shouldMergeByAddress(keepAddr: string | null, memberAddr: string | null): boolean` — 한쪽이 비면 `true`, 정규화 주소 같으면 `true`, 둘 다 있고 다르면 `false`.
  - `VenueAutoMergeResult`에 필드 추가: `heldBack: Array<{ name: string; reason: string }>`

- [ ] **Step 1: `auto-merge.ts` 수정 — 헬퍼 추가 + 주소 반영**

`lib/venues/auto-merge.ts` 전체를 아래로 교체:

```typescript
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeVenues } from "./merge";

export interface VenueAutoMergeResult {
  merged: number;
  pairs: Array<{ keepId: string; mergeId: string; name: string }>;
  heldBack: Array<{ name: string; reason: string }>;
  errors: string[];
}

function normalizeKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^가-힣A-Za-z0-9]/g, "");
}

/** 주소 비교용 정규화 — 층/호/지하 등 세부 제거 후 비교 */
export function normalizeAddress(a: string | null): string {
  if (!a) return "";
  return a
    .normalize("NFKC")
    .toLowerCase()
    .replace(/지하\s*\d*/g, "")
    .replace(/\d+\s*층/g, "")
    .replace(/\d+\s*호/g, "")
    .replace(/\s+/g, "")
    .replace(/[^가-힣a-z0-9]/g, "");
}

/** 한쪽 주소가 비었거나 정규화 주소가 같으면 병합 가능. 둘 다 있고 다르면 보류. */
export function shouldMergeByAddress(
  keepAddr: string | null,
  memberAddr: string | null,
): boolean {
  const k = normalizeAddress(keepAddr);
  const m = normalizeAddress(memberAddr);
  if (!k || !m) return true;
  return k === m;
}

export async function autoMergeExactVenues(): Promise<VenueAutoMergeResult> {
  const db = createServiceRoleClient();

  const { data: venues } = await db
    .from("venues")
    .select("id,name,normalized_name,address")
    .limit(5000);

  if (!venues || venues.length === 0)
    return { merged: 0, pairs: [], heldBack: [], errors: [] };

  // normalized_name 기준 그룹화
  const groups = new Map<
    string,
    Array<{ id: string; name: string; address: string | null }>
  >();
  for (const v of venues as Array<{
    id: string;
    name: string;
    normalized_name: string | null;
    address: string | null;
  }>) {
    const key = normalizeKey(v.normalized_name ?? v.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: v.id, name: v.name, address: v.address });
  }

  const pairs: Array<{ keepId: string; mergeId: string; name: string }> = [];
  const heldBack: Array<{ name: string; reason: string }> = [];
  const errors: string[] = [];

  for (const group of Array.from(groups.values())) {
    if (group.length < 2) continue;

    // event_count 많은 쪽 keep
    const counts = await Promise.all(
      group.map(async (v) => {
        const { count } = await db
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", v.id);
        return { ...v, count: count ?? 0 };
      }),
    );
    counts.sort((a, b) => b.count - a.count);
    const keep = counts[0];

    for (let i = 1; i < counts.length; i++) {
      const merge = counts[i];
      if (!shouldMergeByAddress(keep.address, merge.address)) {
        heldBack.push({
          name: keep.name,
          reason: `주소 상이: "${keep.address}" vs "${merge.address}"`,
        });
        continue;
      }
      const result = await mergeVenues(keep.id, merge.id);
      if (result.ok) {
        pairs.push({ keepId: keep.id, mergeId: merge.id, name: keep.name });
      } else {
        errors.push(...result.errors);
      }
    }
  }

  return { merged: pairs.length, pairs, heldBack, errors };
}
```

- [ ] **Step 2: `autoMergeExactVenues` 결과 소비처 확인**

Run: `grep -rn "autoMergeExactVenues\|\.heldBack\|VenueAutoMergeResult" lib/ app/ scripts/`
`heldBack` 은 신규 필드라 기존 소비처는 무시해도 안전(옵셔널 아님이지만 결과 객체 새로 생성). 소비처가 결과를 spread/전달만 하면 수정 불필요. 만약 결과 shape를 명시 타이핑해 재구성하는 곳이 있으면 `heldBack: []` 를 더한다. (없으면 이 스텝은 확인만.)

- [ ] **Step 3: `lib/venues/auto-merge.check.ts` 작성**

```typescript
import assert from "node:assert";
import { normalizeAddress, shouldMergeByAddress } from "./auto-merge";

// 정규화: 층/호/공백/특수문자 제거
assert.strictEqual(
  normalizeAddress("서울 송파구 올림픽로 424 5층"),
  normalizeAddress("서울 송파구 올림픽로424"),
  "층/공백 무시하고 같아야",
);
assert.strictEqual(normalizeAddress(null), "");
assert.strictEqual(normalizeAddress(""), "");

// 한쪽 비면 병합 가능
assert.strictEqual(shouldMergeByAddress(null, "서울 송파구 올림픽로 424"), true);
assert.strictEqual(shouldMergeByAddress("서울 송파구 올림픽로 424", ""), true);
// 같은 주소 병합 가능
assert.strictEqual(
  shouldMergeByAddress("서울 송파구 올림픽로 424", "서울 송파구 올림픽로424 5층"),
  true,
);
// 명확히 다른 주소 보류
assert.strictEqual(
  shouldMergeByAddress("서울 송파구 올림픽로 424", "부산 해운대구 센텀로 55"),
  false,
);

console.log("auto-merge.check OK");
```

- [ ] **Step 4: 셀프체크 실행**

Run: `npx tsx lib/venues/auto-merge.check.ts`
Expected: `auto-merge.check OK`, 종료코드 0.

- [ ] **Step 5: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add lib/venues/auto-merge.ts lib/venues/auto-merge.check.ts
git commit -m "feat: 공연장 auto-merge 주소-인지 — 주소 다르면 병합 보류(heldBack)"
```

---

### Task 3: `@anthropic-ai/sdk` 의존성 + 환경변수

**Files:**
- Modify: `package.json` (의존성 추가 — npm이 처리)
- Modify: `.env.example`

- [ ] **Step 1: SDK 설치**

Run: `npm install @anthropic-ai/sdk`
Expected: `package.json` dependencies에 `@anthropic-ai/sdk` 추가, 종료코드 0.

- [ ] **Step 2: `.env.example`에 키 추가**

`.env.example` 하단에 append:

```
# 일회성 공연장 정리 스크립트(scripts/pipeline/venue-cleanup-claude.ts) 전용. 파이프라인은 사용 안 함.
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: 로컬 `.env.local`에 실제 키 넣기 (사용자 수동)**

`.env.local`에 `ANTHROPIC_API_KEY=sk-ant-...` 추가. (커밋 대상 아님.)
확인: `grep -c ANTHROPIC_API_KEY .env.local` → 1.

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: @anthropic-ai/sdk 추가 + ANTHROPIC_API_KEY(.env.example)"
```

---

### Task 4: 일회성 정리 스크립트 `venue-cleanup-claude.ts`

dry-run 기본, `--apply` 시 실제 쓰기. Phase1 주소오염 수정 → Phase2 변형중복 병합.

**Files:**
- Create: `scripts/pipeline/venue-cleanup-claude.ts`

**Interfaces:**
- Consumes: `detectDuplicateCandidates`, `VenueBasic` (`@/lib/venues/dedup-detect`); `mergeVenues` (`@/lib/venues/merge`); `createServiceRoleClient` (`@/lib/supabase/service-role`).

- [ ] **Step 1: 스크립트 작성**

```typescript
/**
 * 일회성 공연장 정리 (Gemini 다운 대응 — Claude 사용):
 *  Phase 1. address==이름 등 오염 주소 → Claude+웹검색으로 실주소 채움(실패 시 null)
 *  Phase 2. 이름 변형 중복(대형 공연장 별칭) → Claude 판정 후 mergeVenues 병합
 *
 * 실행: npx tsx scripts/pipeline/venue-cleanup-claude.ts [--apply]
 *   인자 없으면 dry-run(쓰기 없음). --apply 명시해야 실제 UPDATE/merge.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeVenues } from "@/lib/venues/merge";
import {
  detectDuplicateCandidates,
  type VenueBasic,
} from "@/lib/venues/dedup-detect";

const APPLY = process.argv.includes("--apply");
const db = createServiceRoleClient();
const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

const MODEL = "claude-opus-4-8";
const ADDRESS_KW = /시|구|동|로|길|번지|특별시|광역시|도\s|읍|면/;

/** address가 실제 주소가 아니라 이름/쓰레기인지 판정 (null·빈값은 제외 — Gemini 담당) */
function isGarbageAddress(name: string, address: string | null): boolean {
  if (!address || address.trim() === "") return false;
  const a = address.trim();
  const norm = (s: string) =>
    s.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[^가-힣a-z0-9]/g, "");
  if (norm(a) === norm(name)) return true;
  if (a.length < 5) return true;
  if (!ADDRESS_KW.test(a)) return true;
  return false;
}

/** Claude 호출(web_search 그라운딩). 최종 text 블록 이어붙여 반환. pause_turn 재개. */
async function askClaude(prompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  for (let i = 0; i < 6; i++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return "";
}

/** 실주소 예측 — 유효하면 주소 문자열, 아니면 null */
async function predictAddress(name: string): Promise<string | null> {
  const out = await askClaude(
    `다음 공연장의 실제 도로명 주소를 웹에서 확인해 알려주세요. 확실하지 않으면 "모름"이라고만 답하세요.\n` +
      `공연장: "${name}"\n` +
      `마지막 줄에 주소만 한 줄로(도로명 주소 형식, 확실치 않으면 "모름"):`,
  );
  const line = out.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  if (!line || line === "모름" || line.length < 5 || line.length > 150) return null;
  if (!ADDRESS_KW.test(line)) return null;
  return line;
}

/** 두 공연장이 같은 물리적 공간인지 판정 */
async function isSameVenue(
  a: { name: string; address: string | null },
  b: { name: string; address: string | null },
): Promise<boolean> {
  const out = await askClaude(
    `아래 두 공연장이 같은 물리적 공연장(같은 건물/장소, 이름만 다른 경우 포함)인지 판정하세요.\n` +
      `필요하면 웹검색으로 별칭·주소를 확인하세요. 주소가 명확히 다른 별개 장소면 다른 곳입니다.\n` +
      `A: 이름="${a.name}" 주소="${a.address ?? ""}"\n` +
      `B: 이름="${b.name}" 주소="${b.address ?? ""}"\n` +
      `마지막 줄에 SAME 또는 DIFFERENT 만:`,
  );
  return /\bSAME\b/i.test(out.split("\n").pop() ?? "");
}

async function phase1(): Promise<void> {
  console.log(`\n=== Phase 1: 주소 오염 수정 ${APPLY ? "(apply)" : "(dry-run)"} ===`);
  const { data: rows } = await db
    .from("venues")
    .select("id,name,address")
    .not("address", "is", null)
    .neq("address", "")
    .is("address_attempted_at", null)
    .limit(2000);

  const garbage = (rows ?? []).filter((v) => isGarbageAddress(v.name, v.address));
  console.log(`오염 후보: ${garbage.length}개`);

  let fixed = 0;
  let nulled = 0;
  for (const v of garbage) {
    const addr = await predictAddress(v.name);
    if (addr) {
      console.log(`  [FIX] "${v.name}": "${v.address}" → "${addr}"`);
      fixed++;
    } else {
      console.log(`  [NULL] "${v.name}": "${v.address}" → (null)`);
      nulled++;
    }
    if (APPLY) {
      const now = new Date().toISOString();
      await db
        .from("venues")
        .update(
          addr
            ? { address: addr, address_attempted_at: now }
            : { address: null, address_attempted_at: now },
        )
        .eq("id", v.id);
    }
  }
  console.log(`Phase 1 결과: fix ${fixed}, null ${nulled}`);
}

async function phase2(): Promise<void> {
  console.log(`\n=== Phase 2: 이름 변형 중복 병합 ${APPLY ? "(apply)" : "(dry-run)"} ===`);
  const { data: rawVenues } = await db
    .from("venues")
    .select("id,name,address,normalized_name")
    .limit(3000);
  const venues = (rawVenues ?? []) as VenueBasic[];

  const { data: eventLinks } = await db
    .from("events")
    .select("venue_id")
    .not("venue_id", "is", null);
  const linkedCountMap: Record<string, number> = {};
  for (const { venue_id } of eventLinks ?? []) {
    if (venue_id) linkedCountMap[venue_id] = (linkedCountMap[venue_id] ?? 0) + 1;
  }

  const candidates = detectDuplicateCandidates(venues, linkedCountMap);
  console.log(`병합 후보쌍: ${candidates.length}개`);

  let merged = 0;
  let kept = 0;
  for (const c of candidates) {
    const [keep, other] = c.members; // members[0]=keep(event 많은쪽)
    const same = await isSameVenue(
      { name: keep.name, address: keep.address },
      { name: other.name, address: other.address },
    );
    if (same) {
      console.log(`  [MERGE] keep "${keep.name}" ← "${other.name}"`);
      merged++;
      if (APPLY) {
        const r = await mergeVenues(keep.id, other.id);
        if (!r.ok) console.log(`    실패: ${r.errors.join("; ")}`);
      }
    } else {
      console.log(`  [KEEP] "${keep.name}" ≠ "${other.name}" (별개)`);
      kept++;
    }
  }
  console.log(`Phase 2 결과: merge ${merged}, keep ${kept}`);
}

async function main(): Promise<void> {
  console.log(`공연장 정리 시작 — ${APPLY ? "실제 실행(--apply)" : "DRY-RUN"}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY 환경변수가 없습니다. .env.local 확인.");
    process.exit(1);
  }
  await phase1();
  await phase2();
  console.log("\n완료.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0. (SDK 필드명 오류 시 컴파일러 메시지 따라 수정 — 특히 `output_config`/`web_search_20260209`/`TextBlock` 타입.)

- [ ] **Step 3: dry-run 실측 (사용자, `.env.local` 로드)**

Run: `npx tsx -r dotenv/config scripts/pipeline/venue-cleanup-claude.ts` (dotenv 미설치면 `.env.local` 로드 방식은 프로젝트 관례 따름; 다른 스크립트가 env 로드하는 방식 확인)
Expected: Phase1/Phase2 dry-run 로그 출력, 아무 쓰기 없음. 오염 후보 수·병합 후보 수가 `scripts/pipeline/venue-audit.ts` 감과 대략 일치하는지 대조.

- [ ] **Step 4: 커밋**

```bash
git add scripts/pipeline/venue-cleanup-claude.ts
git commit -m "feat: 일회성 공연장 정리 스크립트(Claude+웹검색) — 주소오염 수정 + 변형중복 병합"
```

- [ ] **Step 5: `--apply` 실행 (사용자, dry-run 검토 후)**

dry-run 출력을 사람이 검토해 오판 병합이 없는지 확인 후:
Run: `npx tsx -r dotenv/config scripts/pipeline/venue-cleanup-claude.ts --apply`
Expected: 실제 UPDATE/merge 반영. 표본 공연장 주소·중복 상태 확인.

---

## 문서 갱신 (마지막)

- [ ] `lib/venues/CLAUDE.md`에 `dedup-detect.ts`(후보 탐지 공유 모듈), auto-merge 주소-인지, 일회성 `venue-cleanup-claude.ts` 항목 추가. 커밋 `docs: lib/venues 모듈 지도 갱신`.

---

## Self-Review 체크

- **스펙 커버리지**: ① auto-merge 주소-인지 = Task 2. ② dedup-detect 추출 = Task 1. ③ 일회성 Phase1/Phase2 = Task 4. ④ SDK+env = Task 3. 비범위(스키마·iOS·enrich·merge 무변경) 준수.
- **플레이스홀더**: 모든 코드 스텝에 전체 코드 포함. TBD 없음.
- **타입 일관성**: `VenueBasic`/`VenueDedupCandidate`/`detectDuplicateCandidates` 시그니처 Task1↔Task4 일치. `shouldMergeByAddress`/`normalizeAddress` Task2 정의·사용 일치.
- **리스크**: `output_config`/`web_search_20260209`/`TextBlock` SDK 실제 타입은 설치 후 컴파일러로 검증(Task4 Step2). env 로드 방식은 기존 스크립트 관례 확인 후 맞춤(Task4 Step3).
