# 이벤트 화면 4→1 통합 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이벤트 상세 시트 + 생성/편집 다이얼로그 + TimetableSheet 를 탭 하나의 `EventSheet`([상세][편집][타임테이블])로 통합하고, 생성도 편집 탭(빈 폼)으로 흡수한다.

**Architecture:** 신규 `components/admin/event-sheet/` 아래 EventSheet(탭 컨테이너) + EventDetailTab + EventEditTab + TimetablePanel. EventsPageClient 는 목록 + 인라인 액션 + 진입점만 남기고 오버레이 3개 제거, 상태를 sheet 3개로 수렴.

**Tech Stack:** Next.js 14 App Router, TanStack Query, 기존 UI 프리미티브(Sheet/Dialog/Tabs/Input/Select/Textarea), TypeScript. 테스트 러너 없음.

## Global Constraints

- 테스트 프레임워크 없음. 각 태스크 검증 = `npm run typecheck` + `npx next lint` + `npm run build` 그린 + 수기 상태전이 확인.
- 기존 API 무변경: 생성 `POST /api/admin/events`, 수정 `PATCH /api/admin/events/[id]`, 상세 `GET /api/admin/events/[id]`, 타임테이블 `/api/admin/timetable*`.
- 편집 폼 필드 컴포넌트 `EventFormFields`(EventsPageClient.tsx L1591-1799)는 이미 생성/편집 공유 — 재사용, 재작성 금지.
- 증분: 각 태스크 끝에 앱이 동작(빌드 그린)해야 함.
- 탭 식별자는 영문 키 `"detail" | "edit" | "timetable"`, 라벨만 한글.
- import alias `@/*`.

---

### Task 1: EventEditTab — 생성/편집 폼+제출 통일 컴포넌트

**Files:**
- Create: `components/admin/event-sheet/EventEditTab.tsx`
- Modify: `components/admin/EventsPageClient.tsx` (생성 다이얼로그 L1099-1126, 편집 다이얼로그 L1129-1162 가 EventEditTab 사용)

**Interfaces:**
- Produces: `EventEditTab` — props `{ event: EventRow | null; artists: OptionItem[]; venues: OptionItem[]; onSaved: (saved: EventRow) => void; onDirtyChange?: (dirty: boolean) => void }`. 내부에 form/artistIds/venueIds 상태 + `EventFormFields` 렌더 + 저장 버튼. `event=null`→POST, 있으면 PATCH.
- Consumes: `EventFormFields`, `MultiSelect`(현재 EventsPageClient 로컬 — Step 1 에서 export 하거나 event-sheet 로 이동)

- [ ] **Step 1: EventFormFields·MultiSelect 를 재사용 가능하게 export**

`EventsPageClient.tsx` 의 `function EventFormFields(...)`(L1591)와 `function MultiSelect(...)`(L1523)를 `components/admin/event-sheet/EventFormFields.tsx` 로 옮기고 `export`. EventsPageClient 는 거기서 import. (이동만 — 로직 무변경.) `EventFormFields` 가 쓰는 `ImageUploader`, `OptionItem` 타입 import 경로도 함께.

- [ ] **Step 2: EventEditTab 작성**

```tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EventFormFields } from "./EventFormFields";
import type { EventRow, OptionItem } from "@/types/event";

const emptyForm: Partial<EventRow> = {
  title: "", artist_id: "", venue_id: "", start_date: "", end_date: "",
  status: "upcoming", genre: "", duration: "", age_restriction: "",
  ticket_open_date: "", ticket_provider: "", notice_text: "", is_banner: false,
};

function toPayload(form: Partial<EventRow>, artistIds: string[], venueIds: string[]) {
  const n = (v?: string | null) => (v && String(v).trim() ? v : null);
  return {
    ...form,
    title: form.title?.trim(),
    artist_ids: artistIds,
    venue_ids: venueIds,
    end_date: n(form.end_date), ticket_open_date: n(form.ticket_open_date),
    duration: n(form.duration), age_restriction: n(form.age_restriction),
    ticket_provider: n(form.ticket_provider), notice_text: n(form.notice_text),
    booking_url: n(form.booking_url),
  };
}

export function EventEditTab({
  event, artists, venues, onSaved, onDirtyChange,
}: {
  event: EventRow | null; artists: OptionItem[]; venues: OptionItem[];
  onSaved: (saved: EventRow) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const isCreate = event === null;
  const [form, setForm] = React.useState<Partial<EventRow>>(
    isCreate ? { ...emptyForm } : { ...event },
  );
  const [artistIds, setArtistIds] = React.useState<string[]>([]);
  const [venueIds, setVenueIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const markDirty = () => { if (!dirty) { setDirty(true); onDirtyChange?.(true); } };

  // event 로 초기화 (편집 진입 시 join 된 artist/venue id 는 상위에서 seed 하거나 상세 GET 응답으로 채운다 — 아래 주석)
  React.useEffect(() => {
    setForm(isCreate ? { ...emptyForm } : { ...event });
    setDirty(false); onDirtyChange?.(false);
  }, [event, isCreate, onDirtyChange]);

  const save = async () => {
    if (!form.title?.trim() || !form.start_date) {
      toast.error("공연명과 시작일은 필수입니다."); return;
    }
    if (isCreate && (artistIds.length === 0 || venueIds.length === 0)) {
      toast.error("아티스트와 공연장을 선택하세요."); return;
    }
    setSubmitting(true);
    try {
      const url = isCreate ? "/api/admin/events" : `/api/admin/events/${event!.id}`;
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form, artistIds, venueIds)),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.detail ?? "저장 실패");
      toast.success(isCreate ? "공연이 추가되었습니다." : "공연이 수정되었습니다.");
      setDirty(false); onDirtyChange?.(false);
      // 생성: 반환 id 로 최소 EventRow 구성해 onSaved (상위가 상세 GET 로 보강)
      const saved: EventRow = isCreate ? ({ ...(form as EventRow), id: json.id }) : ({ ...(event as EventRow), ...(form as EventRow) });
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4" onInput={markDirty}>
      <EventFormFields
        form={form} setForm={setForm} artists={artists} venues={venues}
        artistIds={artistIds} setArtistIds={setArtistIds}
        venueIds={venueIds} setVenueIds={setVenueIds}
      />
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={submitting}>
          {submitting ? "저장 중..." : isCreate ? "생성" : "저장"}
        </Button>
      </div>
    </div>
  );
}
```
주의: 편집 모드에서 기존 아티스트/공연장 다중선택 초기값(`artistIds`/`venueIds`)은 상세 응답의 event_artists/event_venues 로 seed 해야 한다 — Task 3 에서 EventSheet 가 상세 GET 응답(join 포함)을 EventEditTab 에 initial prop 으로 전달하도록 배선한다. 이 태스크에선 생성 경로(빈 초기값)만 완전 동작하면 된다.

- [ ] **Step 3: 생성/편집 다이얼로그가 EventEditTab 사용 (임시)**

EventsPageClient 의 생성 다이얼로그(L1099-1126) 본문 `<EventFormFields.../>` + 푸터를 `<EventEditTab event={null} artists={artists} venues={venues} onSaved={(s)=>{setCreateOpen(false); void refetch();}} />` 로 교체. 편집 다이얼로그(L1129-1162)도 `<EventEditTab event={editingEvent} ... onSaved={()=>{setEditOpen(false); setEditingEvent(null); void refetch();}} />`. 기존 `submitCreate`/`submitEdit`/`form`/`artistIds`/`venueIds` state 는 이 시점엔 남겨둔다(다음 태스크에서 정리).

- [ ] **Step 4: 검증**

Run: `npm run typecheck && npx next lint --file components/admin/event-sheet/EventEditTab.tsx --file components/admin/event-sheet/EventFormFields.tsx --file components/admin/EventsPageClient.tsx && npm run build`
Expected: 그린. 수기 확인: 공연 추가(생성) 저장 동작, 편집 다이얼로그 저장 동작(단 편집 다중선택 초기값은 Task3 이후 완성).

- [ ] **Step 5: 커밋**

```bash
git add components/admin/event-sheet components/admin/EventsPageClient.tsx
git commit -m "refactor: 이벤트 생성/편집 폼을 EventEditTab 로 통일"
```

---

### Task 2: EventDetailTab — 상세 읽기 뷰 + 패널 추출

**Files:**
- Create: `components/admin/event-sheet/EventDetailTab.tsx`
- Modify: `components/admin/EventsPageClient.tsx` (상세 시트 본문 L1188-1386 이동)

**Interfaces:**
- Produces: `EventDetailTab` — props `{ event: EventRow; artistNames: string; venueNames: string; timetable: TimetablePerformanceRow[] | undefined }`. 읽기 전용 뷰(정보 그리드·포스터·인라인 타임테이블·공지·점수/출처/잠금 패널).
- Consumes: `InfoItem`, `Badge`, `formatKst`, score/field/locked 패널 JSX (현 L1281-1386)

- [ ] **Step 1: EventDetailTab 작성**

현 상세 시트 본문(EventsPageClient L1188-1386: 정보 그리드 → 포스터 → 인라인 타임테이블 → 공지 → 점수/출처/잠금 패널)을 그대로 `EventDetailTab` 로 옮긴다. `detailEvent` → `event` prop, `detailTimetable` → `timetable` prop, artist/venue 이름은 상위에서 계산해 `artistNames`/`venueNames` prop 으로. `InfoItem` 컴포넌트가 EventsPageClient 로컬이면 함께 export 하거나 event-sheet 로 이동.

- [ ] **Step 2: 상세 시트가 EventDetailTab 사용 (임시)**

상세 Sheet(L1165-1404) 본문을 `<EventDetailTab event={detailEvent} artistNames={...} venueNames={...} timetable={detailTimetable} />` 로 교체. SheetFooter(닫기/편집하기)는 유지.

- [ ] **Step 3: 검증**

Run: `npm run typecheck && npx next lint --file components/admin/event-sheet/EventDetailTab.tsx --file components/admin/EventsPageClient.tsx && npm run build`
Expected: 그린. 수기: 상세 보기 → 정보·포스터·패널 정상 표시.

- [ ] **Step 4: 커밋**

```bash
git add components/admin/event-sheet/EventDetailTab.tsx components/admin/EventsPageClient.tsx
git commit -m "refactor: 이벤트 상세 뷰를 EventDetailTab 로 추출"
```

---

### Task 3: EventSheet 셸 — 상세·편집 탭 + 진입점 배선

**Files:**
- Create: `components/admin/event-sheet/EventSheet.tsx`
- Modify: `components/admin/EventsPageClient.tsx` (진입점·상태 배선, 옛 생성/편집 다이얼로그·상세 시트 제거)

**Interfaces:**
- Produces: `EventSheet` — props `{ open: boolean; onOpenChange: (o: boolean) => void; event: EventRow | null; defaultTab: "detail"|"edit"|"timetable"; artists: OptionItem[]; venues: OptionItem[]; onChanged: () => void; prefill?: Partial<EventRow> }`.
- Consumes: `EventDetailTab`, `EventEditTab`, `Sheet`, `Tabs`(UI 프리미티브 — 없으면 버튼 토글로 대체)

- [ ] **Step 1: Tabs 프리미티브 확인**

`components/ui/` 에 Tabs 컴포넌트가 있는지 확인(`ls components/ui | grep -i tab`). 있으면 사용, 없으면 EventSheet 내부에 간단한 버튼 3개 + 조건부 렌더로 탭 구현(신규 의존성 금지).

- [ ] **Step 2: EventSheet 작성**

```tsx
"use client";
import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/Sheet";
import { EventDetailTab } from "./EventDetailTab";
import { EventEditTab } from "./EventEditTab";
import type { EventRow, OptionItem } from "@/types/event";

type Tab = "detail" | "edit" | "timetable";

export function EventSheet({
  open, onOpenChange, event, defaultTab, artists, venues, onChanged,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  event: EventRow | null; defaultTab: Tab;
  artists: OptionItem[]; venues: OptionItem[]; onChanged: () => void;
}) {
  // 생성 후 수정 모드 전환용 로컬 event (prop 을 seed)
  const [current, setCurrent] = React.useState<EventRow | null>(event);
  const [tab, setTab] = React.useState<Tab>(defaultTab);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { setCurrent(event); setTab(defaultTab); setDirty(false); }, [event, defaultTab, open]);

  const isCreate = current === null;

  const guardedSet = (next: Tab) => {
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
    setTab(next);
  };
  const requestClose = (o: boolean) => {
    if (!o && dirty && !confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-3">
          <SheetTitle>{isCreate ? "공연 추가" : current!.title}</SheetTitle>
        </SheetHeader>
        {/* 탭 바 */}
        <div className="mb-4 flex gap-1 border-b">
          <TabBtn active={tab === "detail"} disabled={isCreate} onClick={() => guardedSet("detail")}>상세</TabBtn>
          <TabBtn active={tab === "edit"} onClick={() => guardedSet("edit")}>편집</TabBtn>
          <TabBtn active={tab === "timetable"} disabled={isCreate} onClick={() => guardedSet("timetable")}>타임테이블</TabBtn>
        </div>
        {tab === "detail" && current && (
          <EventDetailTab event={current} artistNames={""} venueNames={""} timetable={undefined} />
          /* artistNames/venueNames/timetable 은 EventSheet 가 상세 GET 로 로드해 전달 — Step 3 */
        )}
        {tab === "edit" && (
          <EventEditTab
            event={current} artists={artists} venues={venues}
            onDirtyChange={setDirty}
            onSaved={(saved) => {
              setDirty(false);
              setCurrent(saved);   // 생성 → 이제 수정 모드
              setTab("detail");
              onChanged();         // 목록 refetch
            }}
          />
        )}
        {tab === "timetable" && current && (
          <div className="text-sm text-muted-foreground">타임테이블 탭 — Task 4 에서 TimetablePanel 마운트</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TabBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${active ? "border-primary font-semibold" : "border-transparent text-muted-foreground"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >{children}</button>
  );
}
```

- [ ] **Step 3: 상세 GET 로드 + 편집 초기 join id seed**

EventSheet 가 `open && current?.id` 일 때 `GET /api/admin/events/{id}` 로 전체 행 + (가능하면 join 된 event_artists/event_venues)를 로드해 `current` 를 보강하고, EventDetailTab 의 artistNames/venueNames/timetable 및 EventEditTab 의 초기 artistIds/venueIds 를 채운다. 기존 `openDetail`(L451)·`detailTimetable`(L264) 로직을 EventSheet 내부로 이관. (EventEditTab 에 `initialArtistIds`/`initialVenueIds` prop 추가해 seed.)

- [ ] **Step 4: EventsPageClient 진입점 배선 + 옛 오버레이 제거**

- 신규 state: `sheetOpen`, `sheetEvent: EventRow|null`, `sheetTab`.
- `openDetail(row)` → `setSheetEvent(row); setSheetTab("detail"); setSheetOpen(true)`.
- `openCreate` → `setSheetEvent(null); setSheetTab("edit"); setSheetOpen(true)`.
- `openEdit(row)` → `setSheetEvent(row); setSheetTab("edit"); setSheetOpen(true)`.
- `openTimetable(row)` → `setSheetEvent(row); setSheetTab("timetable"); setSheetOpen(true)`.
- 목록 하단에 `<EventSheet open={sheetOpen} onOpenChange={setSheetOpen} event={sheetEvent} defaultTab={sheetTab} artists={artists} venues={venues} onChanged={() => void refetch()} />` 마운트.
- **제거**: 생성 다이얼로그(L1099-1126), 편집 다이얼로그(L1129-1162), 상세 Sheet(L1165-1404). URL로 추가는 스크랩 후 `setSheetEvent(null); setSheetTab("edit"); setSheetOpen(true)` + prefill 전달(EventSheet/ EventEditTab 에 prefill prop 추가).

- [ ] **Step 5: 검증**

Run: `npm run typecheck && npx next lint --file components/admin/event-sheet/EventSheet.tsx --file components/admin/EventsPageClient.tsx && npm run build`
Expected: 그린. 수기: 목록클릭→상세탭, 공연추가→편집탭 저장→상세탭 전환, 편집→저장, URL추가→편집탭 prefill, dirty 가드.

- [ ] **Step 6: 커밋**

```bash
git add components/admin/event-sheet components/admin/EventsPageClient.tsx
git commit -m "feat: EventSheet 통합 시트(상세+편집 탭) + 진입점 배선, 옛 오버레이 제거"
```

---

### Task 4: TimetablePanel — 타임테이블 탭

**Files:**
- Create: `components/admin/event-sheet/TimetablePanel.tsx`
- Modify: `components/admin/TimetableSheet.tsx` (본문을 TimetablePanel 로 추출, Sheet 는 얇은 래퍼로), `components/admin/event-sheet/EventSheet.tsx` (타임테이블 탭에 TimetablePanel 마운트)

**Interfaces:**
- Produces: `TimetablePanel` — props `{ event: EventRow; onHasTimetableChange: () => void }`. TimetableSheet 의 리스트 본문(L516-602) + Add/Edit/Import 다이얼로그(L606-978) + 로컬 상태/핸들러 전부 포함. Sheet 래퍼만 벗긴 형태.

- [ ] **Step 1: TimetableSheet 본문을 TimetablePanel 로 이동**

`TimetableSheet.tsx` 의 컴포넌트 본문(상태·쿼리·핸들러 L135-510 + JSX 프래그먼트 L512-980)을 `TimetablePanel({ event, onHasTimetableChange })` 로 옮긴다. 단 최상위 `<Sheet>...<SheetContent>` 래퍼(L514-515, L603-604)는 벗기고, 그 안의 헤더/액션바/리스트 본문(L516-602)을 패널 루트로 올린다. Add/Edit/Import 다이얼로그(L606-978)는 그대로 패널 안에 둔다(다이얼로그는 Sheet 와 독립). `SearchDropdown`·`TimetableForm`·`STAGE_OPTIONS`·`GENRE_OPTIONS` 도 이 파일로 이동.

- [ ] **Step 2: TimetableSheet 를 얇은 래퍼로 (기존 호출부 호환)**

`TimetableSheet` 는 `<Sheet open onOpenChange><SheetContent><TimetablePanel event={event} onHasTimetableChange={...}/></SheetContent></Sheet>` 만 렌더. (다른 호출부가 없으면 — grep 확인 — TimetableSheet 를 삭제하고 EventSheet 만 TimetablePanel 을 쓰게 해도 됨. 호출부 있으면 래퍼 유지.)

- [ ] **Step 3: EventSheet 타임테이블 탭에 마운트**

Task 3 의 타임테이블 탭 placeholder 를 `<TimetablePanel event={current} onHasTimetableChange={onChanged} />` 로 교체. `current` 가 있을 때만(생성모드 비활성은 Task3 탭바가 처리).

- [ ] **Step 4: 검증**

Run: `npm run typecheck && npx next lint --file components/admin/event-sheet/TimetablePanel.tsx --file components/admin/TimetableSheet.tsx --file components/admin/event-sheet/EventSheet.tsx && npm run build`
Expected: 그린. 수기: 타임테이블 탭 → 리스트 표시, 공연추가/자동입력 다이얼로그 동작, 추가/삭제 후 has_timetable 반영.

- [ ] **Step 5: 커밋**

```bash
git add components/admin/event-sheet/TimetablePanel.tsx components/admin/TimetableSheet.tsx components/admin/event-sheet/EventSheet.tsx
git commit -m "refactor: TimetablePanel 추출 + EventSheet 타임테이블 탭 마운트"
```

---

### Task 5: EventsPageClient 상태·죽은코드 정리

**Files:**
- Modify: `components/admin/EventsPageClient.tsx`

- [ ] **Step 1: 죽은 state/핸들러 제거**

이제 EventSheet 로 이관돼 안 쓰이는 것 제거: `createOpen`, `editOpen`, `detailOpen`, `timetableOpen`, `submitting`, `editingEvent`, `detailEvent`, `timetableEvent`, `form`, `artistIds`, `venueIds`, `emptyForm`, `submitCreate`, `submitEdit`, `handleTimetableAdded`(→ EventSheet onChanged 로 대체), `detailTimetable` 쿼리, 옛 `openDetail` 본문 fetch(→ EventSheet 로 이관). grep 으로 각 심볼 참조 0 확인 후 삭제.

- [ ] **Step 2: 검증**

Run: `npm run typecheck && npx next lint --file components/admin/EventsPageClient.tsx && npm run build`
Expected: 그린 + unused 경고 0. 수기: 전체 이벤트 플로우(목록·필터·인라인 상태변경·상세·편집·생성·타임테이블·삭제·벌크·중복검토·URL추가) 회귀 없음.

- [ ] **Step 3: 커밋**

```bash
git add components/admin/EventsPageClient.tsx
git commit -m "refactor: EventsPageClient 죽은 상태·핸들러 정리(EventSheet 이관 후)"
```

---

## 검증 요약

- 각 태스크: `typecheck` + `lint` + `build` 그린.
- 수기 회귀: 생성→저장→상세전환, 편집 저장, 편집 다중선택 초기값, dirty 가드, URL prefill, 타임테이블 CRUD, 목록 인라인 액션 무영향.
- (선택) Playwright e2e 1개: 목록→상세→편집저장→타임테이블.

## 스코프 밖

- 목록 테이블 재설계, ticket_open_date 시각 보존.
