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
