# 미매칭 타임테이블 아티스트 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미매칭 타임테이블 아티스트 페이지에서 행 클릭 → 시트로 (a) 기존 아티스트 추천·연결, (b) 이름 수정 재매칭, (c) 신규 아티스트 추가·연결, (d) 삭제(로그+타임테이블 행)를 할 수 있게 한다.

**Architecture:** 미매칭 로그(`timetable_unmatched_artists`)와 짝인 `timetable_performances` 행(event_id+artist_name, artist_id null)을 서버에서 원자 처리하는 `POST` 액션(link/create/rename/delete)을 unmatched 라우트에 추가. 추천 검색은 기존 `GET /api/admin/artists?q=` 재사용. UI는 신규 `UnmatchedResolveSheet` + 행 클릭.

**Tech Stack:** Next.js 14 App Router / TypeScript / Supabase(service-role) / TanStack Query / shadcn Sheet. 테스트 러너 없음 — 검증은 typecheck+lint+build+실측.

## Global Constraints

- 뮤테이션 라우트: `createServiceRoleClient()` + `withErrorHandler()`. 최상단 `requireAdmin()`.
- import 별칭 `@/*`.
- 대상 performance 행 특정 = `event_id`(로그.event_id) AND `artist_name`(로그.artist_name) AND `artist_id is null`.
- 기존 아티스트 연결 = `artist_id` 설정 + `artist_name`을 아티스트 정식명(`artists.name`)으로 교체.
- 신규 아티스트 = 이름만(`name` + `normalized_name`).
- DB 스키마 변경 없음. iOS 없음. `batch/route.ts`·`matchExistingArtist` 로직 무변경(matcher는 export 1개만 추가).
- 기존 GET(목록)/PATCH(is_resolved 토글)·해결토글 버튼 보존.

---

### Task 1: unmatched 라우트 POST(resolve) + normalizeArtistName export

**Files:**
- Modify: `lib/ingestion/artist-matcher.ts` (normalizeArtistName export)
- Modify: `app/api/admin/timetable/unmatched/route.ts` (POST 추가)

**Interfaces:**
- Produces: `POST /api/admin/timetable/unmatched` — body `{ action: "link"|"create"|"rename"|"delete", logId, artistId?, name?, newName? }`. 응답 `{ ok: true, matched?: boolean }`.
- Consumes: `matchExistingArtist`, `normalizeArtistName` (`@/lib/ingestion/artist-matcher`).

- [ ] **Step 1: normalizeArtistName export**

`lib/ingestion/artist-matcher.ts`에서 `function normalizeArtistName(name: string): string {` 를 `export function normalizeArtistName(name: string): string {` 로 변경(그 외 변경 없음).

- [ ] **Step 2: unmatched 라우트에 POST 추가**

`app/api/admin/timetable/unmatched/route.ts` 상단 import에 추가:
```typescript
import {
  matchExistingArtist,
  normalizeArtistName,
} from "@/lib/ingestion/artist-matcher";
```
파일 맨 끝(기존 PATCH 다음)에 추가:
```typescript

// 미매칭 처리: 기존 연결 / 신규 생성 후 연결 / 이름 수정 재매칭 / 삭제
export const POST = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    action?: "link" | "create" | "rename" | "delete";
    logId?: string;
    artistId?: string;
    name?: string;
    newName?: string;
  };
  const { action, logId } = body;
  if (!logId || !action) {
    return NextResponse.json(
      { error: "action 과 logId 필요" },
      { status: 400 },
    );
  }

  const db = createServiceRoleClient();

  const { data: log, error: logErr } = await db
    .from("timetable_unmatched_artists")
    .select("id, event_id, artist_name")
    .eq("id", logId)
    .maybeSingle();
  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }
  if (!log) {
    return NextResponse.json(
      { error: "로그를 찾을 수 없습니다." },
      { status: 404 },
    );
  }
  const eventId = (log as { event_id: string | null }).event_id;
  const currentName = (log as { artist_name: string }).artist_name;

  // 대상 performance 행 갱신 헬퍼 (event_id + 원문명 + artist_id null)
  const updatePerformances = async (patch: Record<string, unknown>) => {
    if (!eventId) return;
    await db
      .from("timetable_performances")
      .update(patch)
      .eq("event_id", eventId)
      .eq("artist_name", currentName)
      .is("artist_id", null);
  };

  if (action === "delete") {
    if (eventId) {
      await db
        .from("timetable_performances")
        .delete()
        .eq("event_id", eventId)
        .eq("artist_name", currentName)
        .is("artist_id", null);
    }
    await db.from("timetable_unmatched_artists").delete().eq("id", logId);
    return NextResponse.json({ ok: true });
  }

  if (action === "rename") {
    const newName = body.newName?.trim();
    if (!newName) {
      return NextResponse.json({ error: "newName 필요" }, { status: 400 });
    }
    const artistId = await matchExistingArtist(newName);
    if (artistId) {
      const { data: art } = await db
        .from("artists")
        .select("name")
        .eq("id", artistId)
        .maybeSingle();
      const canonical = (art as { name: string } | null)?.name ?? newName;
      await updatePerformances({ artist_id: artistId, artist_name: canonical });
      await db
        .from("timetable_unmatched_artists")
        .update({ artist_name: canonical, is_resolved: true })
        .eq("id", logId);
      return NextResponse.json({ ok: true, matched: true });
    }
    // 매칭 실패 → 이름만 갱신, 미해결 유지
    await updatePerformances({ artist_name: newName });
    await db
      .from("timetable_unmatched_artists")
      .update({ artist_name: newName })
      .eq("id", logId);
    return NextResponse.json({ ok: true, matched: false });
  }

  // link / create → artistId + 정식명 결정
  let artistId: string | undefined = body.artistId;
  let canonical: string;
  if (action === "create") {
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name 필요" }, { status: 400 });
    }
    const { data: created, error: cErr } = await db
      .from("artists")
      .insert({ name, normalized_name: normalizeArtistName(name) })
      .select("id, name")
      .single();
    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 });
    }
    artistId = (created as { id: string }).id;
    canonical = (created as { name: string }).name;
  } else if (action === "link") {
    if (!artistId) {
      return NextResponse.json({ error: "artistId 필요" }, { status: 400 });
    }
    const { data: art } = await db
      .from("artists")
      .select("name")
      .eq("id", artistId)
      .maybeSingle();
    if (!art) {
      return NextResponse.json(
        { error: "아티스트를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    canonical = (art as { name: string }).name;
  } else {
    return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
  }

  await updatePerformances({ artist_id: artistId, artist_name: canonical });
  await db
    .from("timetable_unmatched_artists")
    .update({ is_resolved: true })
    .eq("id", logId);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 3: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0. (`withErrorHandler`, `createServiceRoleClient`, `NextResponse`, `requireAdmin`는 이미 이 파일에 import돼 있음 — 확인만.)

- [ ] **Step 4: 커밋**

```bash
git add lib/ingestion/artist-matcher.ts app/api/admin/timetable/unmatched/route.ts
git commit -m "feat: 미매칭 타임테이블 처리 API — link/create/rename/delete"
```

---

### Task 2: 처리 시트 UI + 행 클릭 연결

**Files:**
- Create: `components/admin/UnmatchedResolveSheet.tsx`
- Modify: `components/admin/TimetableUnmatchedPageClient.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/timetable/unmatched`(Task 1), `GET /api/admin/artists?q=`(기존).

- [ ] **Step 1: UnmatchedResolveSheet.tsx 작성**

```tsx
"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";

export interface UnmatchedResolveRow {
  id: string;
  artist_name: string;
  event_title: string | null;
  events: { id: string; title: string } | null;
  stage_name: string | null;
  day_number: number | null;
}

interface ArtistSuggestion {
  id: string;
  name: string;
}

export function UnmatchedResolveSheet({
  row,
  onClose,
  onResolved,
}: {
  row: UnmatchedResolveRow;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [name, setName] = React.useState(row.artist_name);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const { data: suggestData } = useQuery({
    queryKey: ["unmatched-suggest", row.artist_name],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: row.artist_name,
        pageSize: "8",
      });
      const res = await fetch(`/api/admin/artists?${params}`);
      if (!res.ok) return { rows: [] as ArtistSuggestion[] };
      return res.json() as Promise<{ rows: ArtistSuggestion[] }>;
    },
  });
  const suggestions = suggestData?.rows ?? [];

  const resolve = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/admin/timetable/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: row.id, ...payload }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        matched?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "처리 실패");
      return json;
    },
    onSuccess: (json, payload) => {
      if (payload.action === "rename" && json.matched === false) {
        toast.success("이름을 수정했지만 매칭되는 아티스트가 없어 미해결로 남았습니다.");
      } else if (payload.action === "delete") {
        toast.success("삭제했습니다.");
      } else {
        toast.success("아티스트를 연결했습니다.");
      }
      onResolved();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "처리 실패 — 다시 시도하세요."),
  });

  const eventTitle = row.events?.title ?? row.event_title ?? "-";

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle>미매칭 아티스트 처리</SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-surface-muted/40 p-3 text-body-sm">
            <p className="font-semibold text-text-primary">{row.artist_name}</p>
            <p className="text-text-secondary">
              {eventTitle}
              {row.stage_name ? ` · ${row.stage_name}` : ""}
              {row.day_number ? ` · DAY ${row.day_number}` : ""}
            </p>
          </div>

          {/* 이름 수정 재매칭 */}
          <div className="space-y-1.5">
            <Label className="text-caption text-text-secondary">이름 수정</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={resolve.isPending || !name.trim()}
                onClick={() =>
                  resolve.mutate({ action: "rename", newName: name.trim() })
                }
              >
                재매칭
              </Button>
            </div>
          </div>

          {/* 추천 아티스트 연결 */}
          <div className="space-y-1.5">
            <Label className="text-caption text-text-secondary">
              추천 아티스트
            </Label>
            {suggestions.length === 0 ? (
              <p className="text-caption text-text-tertiary">
                일치하는 기존 아티스트가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {suggestions.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded border border-border px-2 py-1.5"
                  >
                    <span className="text-body-sm">{a.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ action: "link", artistId: a.id })
                      }
                    >
                      연결
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 신규 아티스트 추가 */}
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={resolve.isPending || !name.trim()}
              onClick={() =>
                resolve.mutate({ action: "create", name: name.trim() })
              }
            >
              &quot;{name.trim() || row.artist_name}&quot; 신규 아티스트로 추가
            </Button>
          </div>

          {/* 삭제 */}
          <div className="border-t border-border pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-body-sm text-danger">
                  타임테이블 행까지 삭제됩니다. 확실합니까?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ action: "delete" })}
                >
                  삭제
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                이 항목 삭제
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Button variant 확인**

Run: `grep -n "destructive\|secondary\|ghost\|outline" components/ui/Button.tsx | head`
Expected: 위 variant들이 존재. 없는 variant가 있으면 존재하는 것으로 교체(예: `destructive` 없으면 `outline` + `className="text-danger border-danger"`). typecheck가 잡아준다.

- [ ] **Step 3: TimetableUnmatchedPageClient에 시트 연결**

`components/admin/TimetableUnmatchedPageClient.tsx`:

(a) import 추가(상단, 기존 import 다음):
```typescript
import { UnmatchedResolveSheet } from "@/components/admin/UnmatchedResolveSheet";
```

(b) state 추가(`queryClient` 선언 다음):
```typescript
  const [resolveRow, setResolveRow] = React.useState<UnmatchedRow | null>(null);
```

(c) 해결/미해결 토글 버튼 onClick에 stopPropagation 추가(행 클릭과 분리). 기존:
```typescript
                      onClick={() =>
                        resolveMutation.mutate({
                          id: row.id,
                          is_resolved: !row.is_resolved,
                        })
                      }
```
를:
```typescript
                      onClick={(e) => {
                        e.stopPropagation();
                        resolveMutation.mutate({
                          id: row.id,
                          is_resolved: !row.is_resolved,
                        });
                      }}
```

(d) 행에 클릭 핸들러. 기존 `<TableRow key={row.id}>`를:
```typescript
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setResolveRow(row)}
                >
```

(e) 시트 렌더. 컴포넌트 최상위 반환 `<div className="space-y-4">` 안 맨 끝(닫는 `</div>` 직전)에 추가:
```tsx
      {resolveRow && (
        <UnmatchedResolveSheet
          row={resolveRow}
          onClose={() => setResolveRow(null)}
          onResolved={() => {
            queryClient.invalidateQueries({
              queryKey: ["admin-timetable-unmatched"],
            });
            queryClient.invalidateQueries({
              queryKey: ["admin-attention-counts"],
            });
            setResolveRow(null);
          }}
        />
      )}
```

(`UnmatchedRow`는 이 파일에 이미 정의돼 있고 `UnmatchedResolveSheet`의 `UnmatchedResolveRow` 필드(id, artist_name, event_title, events, stage_name, day_number)를 모두 포함 → 그대로 전달 가능.)

- [ ] **Step 4: 타입·린트·빌드**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 에러 0, 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
git add components/admin/UnmatchedResolveSheet.tsx components/admin/TimetableUnmatchedPageClient.tsx
git commit -m "feat: 미매칭 타임테이블 처리 시트 — 추천연결/이름수정/신규추가/삭제"
```

---

### Task 3: 실측 (사용자)

- [ ] **Step 1: dev 실측**

`/admin/timetable-unmatched` 접속:
- 미매칭 행 클릭 → 시트 열림.
- (a) 추천 아티스트 "연결" → 목록에서 사라짐(resolved), 해당 공연 타임테이블에 artist_id/정식명 반영.
- (b) 이름 수정 → "재매칭": 존재하는 이름이면 연결·resolved, 없는 이름이면 "미해결로 남음" 토스트 + 이름만 변경.
- (c) "신규 아티스트로 추가" → artists 목록에 생성, 연결·resolved.
- (d) "이 항목 삭제" → 확인 → 타임테이블 행+로그 제거.
- 해결/미해결 토글 버튼은 여전히 동작(행 클릭과 분리).

---

## Self-Review 체크

- **스펙 커버리지**: link/create/rename/delete API = Task 1. 시트+행클릭 = Task 2. 추천=artists?q= 재사용. normalizeArtistName export = Task1 Step1. 실측 = Task 3.
- **플레이스홀더**: 모든 코드 스텝 전체 코드. TBD 없음.
- **타입 일관성**: POST body `{action, logId, artistId, name, newName}` Task1 정의 ↔ Task2 mutate payload 일치. `UnmatchedResolveRow` 필드 ⊆ `UnmatchedRow`.
- **리스크**: Button variant 존재 여부 Task2 Step2에서 확인. rename 실패 분기 토스트 명시.
