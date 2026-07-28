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
