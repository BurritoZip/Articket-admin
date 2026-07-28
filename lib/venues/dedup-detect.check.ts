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
