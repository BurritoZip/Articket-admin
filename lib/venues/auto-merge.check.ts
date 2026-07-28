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
