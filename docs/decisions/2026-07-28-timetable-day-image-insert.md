# 타임테이블 Day별 이미지 삽입 설계

**날짜**: 2026-07-28
**상태**: 승인 대기

## 문제

Day2/Day3 타임테이블을 이미지로 넣으려는데, 이미지에 날짜가 있어도 인식·구분을 못 해 전부 Day1로 들어간다.

## 근본 원인 (코드 확인됨)

`app/api/admin/timetable/from-image/route.ts`:
- 프롬프트 `dateContext`가 **Day1(start_date)/Day2(end_date)만** 매핑한다. 3일+ 공연의 Day3 이상은 날짜→day 매핑이 없다.
- 3일 공연이어도 `end_date`를 무조건 "공연 둘째 날(DAY 2)"로 라벨 → 오라벨.
- UI(`TimetablePanel.tsx`)는 `start_date`/`end_date`만 넘기고 **"이 이미지가 몇째날"이라는 신호가 없다.** 모델이 이미지 날짜로 추측해야 하는데 실패하면 `day_number = Number(...) || 1` 로 전부 Day1로 떨어진다(route.ts:128).

## 결정 (합의됨)

- 이미지 형태: **날짜별로 이미지 따로** 업로드(Day2 이미지, Day3 이미지 각각).
- Day 지정: **업로드 시 UI에서 Day 수동 선택**(모델 추측 제거).
- vision 모델: **Gemini 유지**(`gemini-2.5-flash`). Day가 수동으로 확정되므로 모델은 날짜를 볼 필요가 없다.
- Day 셀렉터: `start_date`~`end_date`로 Day1..DayN 자동 생성, 각 날짜 표시, 기본 Day1. 날짜 없으면 숫자 직접입력 fallback.
- 미리보기: 업로드 시 선택한 Day로 **모든 행 고정**(행별 재지정 없음).

## 아키텍처

핵심 아이디어: **Day/날짜는 UI 선택값으로 확정하고, Gemini는 아티스트/스테이지/시간만 추출.** 날짜 인식 의존을 완전히 제거한다.

### ① UI — `components/admin/event-sheet/TimetablePanel.tsx`

- `selectedDay` state 추가(기본 1).
- 이미지 업로드 영역에 **Day 셀렉터**(shadcn `Select`) 추가. 옵션 = Day1..DayN.
  - N = `event.start_date`~`event.end_date` 일수(inclusive). 계산: `floor((end - start)/86400000) + 1`, 최소 1.
  - 각 옵션 라벨: `Day K (YYYY-MM-DD)` — 날짜 = `start_date + (K-1)일`.
  - `start_date`/`end_date` 없으면 셀렉터 대신 Day 숫자 입력(기본 1).
- `submitImageParse`의 FormData에 추가:
  - `day_number` = `selectedDay`
  - `date_string` = `start_date + (selectedDay-1)일` 을 `YYYY-MM-DD`로.

### ② 라우트 — `app/api/admin/timetable/from-image/route.ts`

- formData에서 `day_number`, `date_string`를 읽는다.
- 프롬프트 단순화: Day1/Day2 `dateContext` 로직 제거. 모델에 **day/날짜를 요청하지 않고** 아티스트/스테이지/시간만 추출하도록 지시. 반환 JSON에서 `day_number`/`date_string` 필드 요구를 뺀다.
- `cleaned` 매핑에서 각 행의 `day_number`/`date_string`을 **요청 파라미터 값으로 강제**한다(모델 출력 무시).
  - `day_number` = `Number(reqDayNumber) || 1`.
  - `date_string` = `reqDateString`(빈값이면 "").
- Gemini(`gemini-2.5-flash`) 그대로. `GEMINI_API_KEY` 그대로.

## 데이터 흐름

Day3 이미지 업로드 → UI에서 "Day3 (2026-01-05)" 선택 → FormData `day_number=3, date_string=2026-01-05` → Gemini가 아티스트/시간만 추출 → route가 전 행에 day_number=3/date_string=2026-01-05 강제 → 미리보기 확인 → batch 저장.

## 비범위 (안 건드림)

- `app/api/admin/timetable/batch/route.ts`(저장 흐름) — day_number/date_string을 그대로 저장하므로 변경 불필요.
- 텍스트 import 파서 `lib/ingestion/timetable-import.ts`의 `DAY_MARKER`/`SINGLE_DATE` 로직 — 텍스트 경로용, 그대로.
- vision 모델 교체(Claude) 안 함. DB 스키마·iOS 동기화 없음.

## 검증

- `npm run typecheck` + `npm run lint`.
- 실측: Day2 이미지 업로드→Day2 선택→미리보기 전 행 day_number=2 확인, 저장 후 `timetable_performances`에 day_number=2/date_string 정확 확인. Day3도 동일.
- 회귀: 단일일 공연(start=end)에서 Day 셀렉터가 Day1만 뜨고 기존과 동일 동작.

## 리스크

- `end_date`가 없거나 파싱 실패 시 셀렉터가 Day1만 → 다일 공연인데 Day 선택 불가. → 숫자 직접입력 fallback으로 완화.
- 잘못된 Day 선택 시 잘못된 day로 저장 → 미리보기에서 사람이 확인 후 저장(선택은 업로드 시 고정, 틀리면 다시 업로드).
