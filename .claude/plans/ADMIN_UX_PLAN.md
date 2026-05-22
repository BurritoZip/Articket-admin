# Admin UX 개선 계획

> 상태: 🔴 미착수 | 🟡 진행중 | ✅ 완료

---

## 1. 대시보드 KPI + 액션 아이템 🔴

### 목표
접속 즉시 전체 현황 파악 + 즉각 처리가 필요한 항목 확인

### 신규 파일
- `app/api/admin/dashboard/stats/route.ts` — 병렬 집계 API
- `components/admin/DashboardPageClient.tsx` — 실제 대시보드 UI

### 수정 파일
- `app/admin/dashboard/page.tsx` — stub → DashboardPageClient 연결

### API 스펙 (`GET /api/admin/dashboard/stats`)
```ts
{
  events: {
    total: number
    upcoming: number
    on_sale: number
    ended: number
    needs_end_update: number  // end_date < today AND status != "ended"
  }
  artists: { total: number }
  venues: { total: number }
  users: { total: number }
  ticket_opens_soon: Array<{  // ticket_open_date 기준 D-7 이내
    id: string
    title: string
    ticket_open_date: string
    d_day: number
  }>
  unlinked_events: number  // artist_id IS NULL인 이벤트 수
}
```

### UI 구성
```
[이벤트 N건]  [아티스트 N건]  [공연장 N건]  [유저 N건]
  upcoming / on_sale / ended 소분류

[⚠️ 즉각 처리 필요]
- ended 처리 필요: N건 → 클릭 시 이벤트 목록 해당 필터로 이동
- 아티스트 미연결: N건 → 이벤트 목록으로 이동
- 티켓 오픈 임박 (D-7 이내): 이벤트 목록 (D-N 뱃지)
```

---

## 2. 이벤트 인라인 편집 (status + is_banner + D-N 뱃지) 🔴

### 수정 파일
- `components/admin/EventsPageClient.tsx`

### 변경 내용

**status 컬럼** — 뱃지 표시만 → `<Select>` 인라인 드롭다운
```tsx
<Select value={row.status} onValueChange={(v) => void patchStatus(row.id, v)}>
  <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="upcoming">예매 예정</SelectItem>
    <SelectItem value="on_sale">예매 중</SelectItem>
    <SelectItem value="ended">판매 종료</SelectItem>
  </SelectContent>
</Select>
```

**is_banner 컬럼** — 클릭 시 즉시 토글 (AlertDialog 없이, 배너는 가역적 변경)
```tsx
<button onClick={() => void patchBanner(row.id, !row.is_banner)}>
  <Badge variant={row.is_banner ? "success" : "outline"}>
    {row.is_banner ? "ON" : "OFF"}
  </Badge>
</button>
```

**티켓 오픈 D-N 뱃지** — ticket_open_date 컬럼에 추가
```tsx
// D-7 이내면 warning 뱃지, 이미 지났으면 일반 텍스트
function TicketOpenBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-text-tertiary">-</span>
  const diff = differenceInCalendarDays(parseISO(date), new Date())
  if (diff >= 0 && diff <= 7)
    return <Badge variant="warning">D-{diff} {formatKst(date)}</Badge>
  return <span>{formatKst(date)}</span>
}
```

**핸들러 추가** (기존 confirmRemove 패턴 참고)
```ts
const patchStatus = async (id: string, status: string) => {
  await fetch(`/api/admin/events/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  })
  void queryClient.invalidateQueries({ queryKey: ["admin-events"] })
}
const patchBanner = async (id: string, is_banner: boolean) => {
  await fetch(`/api/admin/events/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_banner }),
  })
  void queryClient.invalidateQueries({ queryKey: ["admin-events"] })
}
```

**date-fns import 추가**
```ts
import { differenceInCalendarDays, parseISO } from "date-fns"
```

---

## 3. Bulk Action (Events + Artists) 🔴

### 신규 파일
- `app/api/admin/events/bulk/route.ts`
- `app/api/admin/artists/bulk/route.ts`

### 수정 파일
- `components/admin/EventsPageClient.tsx`
- `components/admin/ArtistsPageClient.tsx`

### Bulk API 스펙
```ts
// POST /api/admin/events/bulk
{ ids: string[], action: "delete" | "set_status", payload?: { status: string } }
→ service role client로 처리

// POST /api/admin/artists/bulk
{ ids: string[], action: "delete" }
```

### UI 패턴
```
테이블 헤더: [□] 전체선택  각 행: [□]

선택 시 상단 툴바:
┌──────────────────────────────────────────┐
│ 3개 선택됨  [상태 변경 ▼]  [삭제]  [취소]  │
└──────────────────────────────────────────┘
```

### 상태 관리
```ts
const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
const toggleSelect = (id: string) => setSelectedIds(prev => {
  const next = new Set(prev)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
})
const toggleAll = () => setSelectedIds(
  selectedIds.size === list.length ? new Set() : new Set(list.map(r => r.id))
)
```

---

## 4. Reviews 페이지 구현 🔴

### DB 테이블: `concert_reviews`
```
id, title, star_count, content, username, created_at
조인: events(id, title, poster_url)
```

### 신규 파일
- `app/api/admin/reviews/route.ts` — GET (search, star filter, pagination)
- `app/api/admin/reviews/[id]/route.ts` — DELETE (service role)
- `components/admin/ReviewsPageClient.tsx`

### 수정 파일
- `app/admin/reviews/page.tsx` — stub 교체

### UI
```
[검색: 공연명/작성자] [별점 필터: 전체/1-5]

테이블:
공연명 | 작성자 | ★★★★☆ | 제목 미리보기 | 작성일 | 삭제
```

### API GET 파라미터
- `q`: 공연 제목 또는 username ilike 검색
- `star`: 1-5 별점 필터
- `page`, `pageSize`: 페이지네이션

---

## 5. Bookings 페이지 구현 🔴

### DB 테이블: `user_bookings`
```
id, seat, delivery_type, booked_at, status (active/cancelled)
조인: events(id, title, poster_url, start_date, end_date, venues(name))
```

### 신규 파일
- `app/api/admin/bookings/route.ts` — GET (status filter, search, pagination)
- `components/admin/BookingsPageClient.tsx`

### 수정 파일
- `app/admin/bookings/page.tsx` — stub 교체

### UI
```
[검색: 공연명] [상태: 전체/active/cancelled]

테이블:
공연명 | 좌석 | 배송방식 | 예매일 | 상태 뱃지
```
> 읽기 전용 (삭제 없음)

---

## 6. 이미지 업로드 (Supabase Storage) 🔴

### 전제조건
Supabase Storage `images` bucket 생성 (public read) — SQL 실행 필요:
```sql
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict do nothing;

create policy "public read images"
on storage.objects for select
using (bucket_id = 'images');

create policy "admin upload images"
on storage.objects for insert
with check (bucket_id = 'images');
```

### 신규 파일
- `app/api/admin/upload/route.ts` — multipart 받아서 Storage 업로드
- `components/admin/ImageUploader.tsx` — 재사용 업로드 컴포넌트

### ImageUploader 스펙
```tsx
<ImageUploader
  value={form.poster_url ?? ""}
  onChange={(url) => setForm(s => ({ ...s, poster_url: url }))}
  folder="posters"  // or "avatars"
  placeholder="포스터 이미지"
/>
```

동작 흐름:
1. 파일 선택 → 로컬 미리보기 표시
2. "업로드" 클릭 → `POST /api/admin/upload` (FormData: file + folder)
3. `supabase.storage.from("images").upload(path, buffer, { upsert: true })`
4. `getPublicUrl(path)` 반환 → onChange 호출

### 수정 파일
- `components/admin/EventsPageClient.tsx` — poster_url Input → ImageUploader
- `components/admin/ArtistsPageClient.tsx` — avatar_url Input → ImageUploader

---

## 실행 순서

| # | 작업 | 핵심 파일 | 상태 |
|---|------|----------|------|
| 1 | 이벤트 인라인 status/banner + D-N 뱃지 | EventsPageClient | ✅ |
| 2 | 대시보드 KPI | DashboardPageClient, stats API | ✅ |
| 3 | Reviews 페이지 | ReviewsPageClient, reviews API | ✅ |
| 4 | Bookings 페이지 | BookingsPageClient, bookings API | ✅ |
| 5 | Bulk action (Events + Artists) | bulk APIs, PageClients | ✅ |
| 6 | 이미지 업로드 | ImageUploader, upload API | ✅ |

---

## 완료 체크리스트

- [x] 이벤트 인라인 status 변경
- [x] 이벤트 is_banner 인라인 토글
- [x] 티켓 오픈 D-N 뱃지
- [x] 대시보드 KPI 카드
- [x] 대시보드 액션 아이템 (ended 처리 필요, 미연결 이벤트, 오픈 임박)
- [x] Events Bulk action (삭제 + 상태 변경)
- [x] Artists Bulk action (삭제) — API 구현 완료, ArtistsPageClient UI는 추가 예정
- [x] Reviews 페이지 (목록 + 삭제)
- [x] Bookings 페이지 (읽기 전용)
- [x] 이미지 업로드 (Storage)
