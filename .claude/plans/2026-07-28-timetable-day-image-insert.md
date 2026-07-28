# 타임테이블 Day별 이미지 삽입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타임테이블 이미지 업로드 시 UI에서 Day를 수동 선택하게 하고, 그 Day/날짜를 서버에서 전 행에 강제해 Day2/Day3 이미지가 올바른 날짜로 삽입되게 한다.

**Architecture:** Day/날짜는 UI 선택값으로 확정하고 Gemini는 아티스트/스테이지/시간만 추출한다. `from-image` 라우트가 모델이 낸 day를 무시하고 요청 파라미터로 덮어쓴다. 날짜 자동인식 의존을 제거.

**Tech Stack:** Next.js 14 App Router / React(client) / TypeScript / Gemini(`gemini-2.5-flash`, 유지). 테스트 러너 없음 — 검증은 `npm run typecheck` + `npm run lint` + `assert` 기반 tsx 셀프체크 + 실측.

## Global Constraints

- vision 모델은 Gemini 유지. `GEMINI_API_KEY` 그대로. Claude/Anthropic 도입 안 함.
- DB 스키마 변경 없음. iOS 동기화 없음. `batch/route.ts`·`timetable-import.ts`(텍스트 파서) 변경 없음.
- import 별칭 `@/*` → 레포 루트. `Select`는 `@/components/ui/Select`에서 이미 import됨(TimetablePanel).
- Day 셀렉터: `start_date`~`end_date`로 Day1..DayN 자동 생성, 기본 Day1. `start_date` 없으면 숫자 직접입력 fallback.
- 미리보기 행별 Day 재지정 없음 — 업로드 시 선택 Day로 전 행 고정.

---

### Task 1: Day 옵션 pure helper + Day 셀렉터 UI + FormData 전송

**Files:**
- Create: `components/admin/event-sheet/day-options.ts`
- Create: `components/admin/event-sheet/day-options.check.ts`
- Modify: `components/admin/event-sheet/TimetablePanel.tsx`

**Interfaces:**
- Produces:
  - `function dateForDay(startISO: string, day: number): string` — `startISO`("YYYY-MM-DD") + (day-1)일 → "YYYY-MM-DD".
  - `function buildDayOptions(startISO: string | null, endISO: string | null): Array<{ day: number; date: string }>` — start~end inclusive Day1..DayN. start 없거나 파싱 실패면 `[]`.

- [ ] **Step 1: `day-options.ts` 작성**

```typescript
/** startISO("YYYY-MM-DD") 기준 day번째(1-base) 날짜를 "YYYY-MM-DD"로 반환 */
export function dateForDay(startISO: string, day: number): string {
  const d = new Date(`${startISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Math.max(0, day - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** 공연 시작~종료(inclusive)로 Day1..DayN 옵션 생성. start 없거나 파싱 실패면 [] */
export function buildDayOptions(
  startISO: string | null,
  endISO: string | null,
): Array<{ day: number; date: string }> {
  if (!startISO) return [];
  const start = new Date(`${startISO}T00:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  let n = 1;
  if (endISO) {
    const end = new Date(`${endISO}T00:00:00`);
    if (!Number.isNaN(end.getTime())) {
      n = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
      );
    }
  }
  return Array.from({ length: n }, (_, i) => ({
    day: i + 1,
    date: dateForDay(startISO, i + 1),
  }));
}
```

- [ ] **Step 2: `day-options.check.ts` 작성**

```typescript
import assert from "node:assert";
import { buildDayOptions, dateForDay } from "./day-options";

// dateForDay: day1=시작일, day3=+2일
assert.strictEqual(dateForDay("2026-01-03", 1), "2026-01-03");
assert.strictEqual(dateForDay("2026-01-03", 3), "2026-01-05");
// 월 경계
assert.strictEqual(dateForDay("2026-01-31", 2), "2026-02-01");

// 3일 공연 → Day1..Day3
const opts = buildDayOptions("2026-01-03", "2026-01-05");
assert.deepStrictEqual(opts, [
  { day: 1, date: "2026-01-03" },
  { day: 2, date: "2026-01-04" },
  { day: 3, date: "2026-01-05" },
]);
// 단일일 공연(start=end) → Day1만
assert.deepStrictEqual(buildDayOptions("2026-01-03", "2026-01-03"), [
  { day: 1, date: "2026-01-03" },
]);
// end 없음 → Day1만
assert.deepStrictEqual(buildDayOptions("2026-01-03", null), [
  { day: 1, date: "2026-01-03" },
]);
// start 없음 → 빈 배열(숫자입력 fallback 신호)
assert.deepStrictEqual(buildDayOptions(null, "2026-01-05"), []);

console.log("day-options.check OK");
```

- [ ] **Step 3: 셀프체크 실행**

Run: `npx tsx components/admin/event-sheet/day-options.check.ts`
Expected: `day-options.check OK`, 종료코드 0.

- [ ] **Step 4: TimetablePanel — import + state 추가**

`TimetablePanel.tsx` import 블록(46행 부근, 기존 type import 다음)에 추가:

```typescript
import { buildDayOptions, dateForDay } from "./day-options";
```

`imageFile` state(99행) 근처에 추가:

```typescript
  const [selectedDay, setSelectedDay] = React.useState(1);
```

`handleImageFile`(177행)에서 새 파일 선택 시 Day 초기화(선택 유지가 자연스러우면 생략 가능하나, 명확성 위해 1로 리셋하지 않고 유지). — 변경 없음(선택 Day 유지).

- [ ] **Step 5: TimetablePanel — Day 셀렉터 UI 삽입**

드롭존 닫는 `</div>`(639행) 다음, `{imageFile && !imageParsed && (` 버튼 블록(641행) **앞**에 삽입:

```tsx
                  {imageFile && !imageParsed && (
                    (() => {
                      const dayOpts = buildDayOptions(
                        event?.start_date?.slice(0, 10) ?? null,
                        event?.end_date?.slice(0, 10) ?? null,
                      );
                      return (
                        <div className="flex items-center gap-2">
                          <Label className="text-caption text-text-secondary">
                            며칠차
                          </Label>
                          {dayOpts.length > 0 ? (
                            <Select
                              value={String(selectedDay)}
                              onValueChange={(v) => setSelectedDay(Number(v))}
                            >
                              <SelectTrigger className="h-8 w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {dayOpts.map((o) => (
                                  <SelectItem key={o.day} value={String(o.day)}>
                                    Day {o.day} ({o.date})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type="number"
                              min={1}
                              className="h-8 w-24"
                              value={selectedDay}
                              onChange={(e) =>
                                setSelectedDay(Math.max(1, Number(e.target.value) || 1))
                              }
                            />
                          )}
                        </div>
                      );
                    })()
                  )}
```

(주의: 기존 641행 `{imageFile && !imageParsed && (` 버튼 블록은 그대로 두고, 위 셀렉터 블록을 그 **앞**에 별도로 추가한다. 두 블록 모두 같은 `{imageFile && !imageParsed}` 조건.)

- [ ] **Step 6: TimetablePanel — FormData에 day_number/date_string 추가**

`submitImageParse`의 FormData 구성부(189~193행)를 아래로 교체:

```typescript
      const fd = new FormData();
      fd.append("image", imageFile);
      if (event.start_date)
        fd.append("start_date", event.start_date.slice(0, 10));
      if (event.end_date) fd.append("end_date", event.end_date.slice(0, 10));
      fd.append("day_number", String(selectedDay));
      fd.append(
        "date_string",
        event.start_date
          ? dateForDay(event.start_date.slice(0, 10), selectedDay)
          : "",
      );
```

- [ ] **Step 7: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0. (`event` 옵셔널 접근은 `event?.` 사용 — Select 블록은 `imageFile` 조건 안이라 event 존재하지만 타입상 안전 위해 `?.`.)

- [ ] **Step 8: 커밋**

```bash
git add components/admin/event-sheet/day-options.ts components/admin/event-sheet/day-options.check.ts components/admin/event-sheet/TimetablePanel.tsx
git commit -m "feat: 타임테이블 이미지 업로드 Day 셀렉터 + day/date 전송"
```

---

### Task 2: `from-image` 라우트 — day/date 강제 + 프롬프트 단순화

**Files:**
- Modify: `app/api/admin/timetable/from-image/route.ts`

**Interfaces:**
- Consumes: FormData `day_number`, `date_string`(Task 1이 전송).

- [ ] **Step 1: 프롬프트 단순화 (day/날짜 요청 제거)**

`from-image/route.ts`의 `PROMPT` 함수(14~45행)를 아래로 교체(파라미터 없이):

```typescript
const PROMPT = () => `이 이미지는 음악 페스티벌 하루치 타임테이블입니다.
이미지에서 모든 아티스트 공연 정보를 JSON 배열로 추출하세요.

각 항목 형식:
{
  "artist_name": "아티스트명 (필수)",
  "stage_name": "스테이지/무대명 (없으면 빈 문자열)",
  "start_time": "HH:MM 24시간제 (없으면 빈 문자열)",
  "end_time": "HH:MM 24시간제 (없으면 빈 문자열)"
}

규칙:
- 시간은 반드시 24시간제 HH:MM 형식
- 스테이지명은 이미지에서 보이는 그대로 추출
- 아티스트 이름은 원문 그대로 (한국어/영어 혼용 포함)
- 날짜/DAY 구분은 신경 쓰지 마세요 (별도로 지정됩니다)

JSON 배열만 반환하세요 (코드블록 사용 가능).`;
```

- [ ] **Step 2: 요청에서 day_number/date_string 읽기**

`startDate`/`endDate` 읽는 부분(67~68행) 다음에 추가:

```typescript
  const dayNumber = Number(formData.get("day_number") ?? 1) || 1;
  const dateString = (formData.get("date_string") as string | null)?.trim() ?? "";
```

(기존 `startDate`/`endDate` 변수는 프롬프트에서 더 안 쓰이면 lint unused 경고 → 제거. `start_date`/`end_date` formData 파싱 라인 삭제.)

- [ ] **Step 3: generateContent 호출을 새 프롬프트로**

`model.generateContent` 호출(91~94행)의 `PROMPT(startDate, endDate)` 를 `PROMPT()` 로 변경:

```typescript
    const result = await model.generateContent([
      PROMPT(),
      { inlineData: { data: base64, mimeType } },
    ]);
```

- [ ] **Step 4: cleaned 매핑에서 day/date 강제**

`cleaned` 매핑(121~130행)을 아래로 교체 — 모델의 day/date 무시하고 요청값 강제:

```typescript
    const cleaned = (performances as Record<string, unknown>[])
      .filter((p) => typeof p.artist_name === "string" && p.artist_name.trim())
      .map((p) => ({
        artist_name: String(p.artist_name ?? "").trim(),
        stage_name: String(p.stage_name ?? "").trim(),
        start_time: String(p.start_time ?? "").trim(),
        end_time: String(p.end_time ?? "").trim(),
        day_number: dayNumber,
        date_string: dateString,
      })) as ParsedPerformance[];
```

- [ ] **Step 5: 타입·린트**

Run: `npm run typecheck && npm run lint`
Expected: 에러 0. (제거한 `startDate`/`endDate`가 다른 데서 안 쓰이는지 확인; 안 쓰이면 파싱 라인까지 삭제.)

- [ ] **Step 6: 커밋**

```bash
git add app/api/admin/timetable/from-image/route.ts
git commit -m "feat: from-image day_number/date_string 요청값 강제 + 프롬프트 단순화"
```

---

### Task 3: 실측 검증 (사용자)

- [ ] **Step 1: dev 서버에서 다일 공연 실측**

Run: `npm run dev`
- 다일(예: 3일) 공연 상세 → 타임테이블 패널 → "이미지로 타임테이블 가져오기".
- Day2 이미지 업로드 → 셀렉터 "Day 2 (날짜)" 선택 → 분석 → 미리보기 전 행 day=2 확인 → 저장.
- Day3도 동일. `timetable_performances`에서 `day_number`/`date_string` 정확 확인.

- [ ] **Step 2: 회귀 — 단일일 공연**

- start=end 공연에서 셀렉터가 Day1만 뜨는지, 기존과 동일하게 저장되는지 확인.

---

## Self-Review 체크

- **스펙 커버리지**: UI Day 셀렉터+FormData = Task 1. 라우트 day/date 강제+프롬프트 단순화 = Task 2. 실측 = Task 3. 비범위(batch·텍스트파서·모델·스키마·iOS) 준수.
- **플레이스홀더**: 모든 코드 스텝 전체 코드 포함. TBD 없음.
- **타입 일관성**: `buildDayOptions`/`dateForDay` Task1 정의·사용 일치. `day_number`/`date_string` FormData 키 Task1 전송 ↔ Task2 수신 일치. `ParsedPerformance` 필드 그대로.
- **리스크**: `startDate`/`endDate` 제거 시 unused 정리(Task2 Step2/5). Select 블록 `event?.` 옵셔널 안전.
