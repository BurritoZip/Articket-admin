/**
 * 기기 식별자(iPhone18,1) → 마케팅명(iPhone 17 Pro) 표시용 매핑.
 *
 * 왜 admin 쪽에도 두나: iOS 리포터가 마케팅명을 못 붙인 채(맵 미등록 기종) 식별자만 보낸
 * 로그가 이미 쌓여 있다(예: iPhone18,1). iOS 앱을 고쳐도 **기존 로그는 raw 그대로**라
 * 표시 시점에 매핑해야 지금 화면이 읽힌다. iOS 맵과 동일하게 유지할 것.
 */
const MARKETING_NAME: Record<string, string> = {
  // iPhone 17 / Air (2025)
  "iPhone18,3": "iPhone 17",
  "iPhone18,1": "iPhone 17 Pro",
  "iPhone18,2": "iPhone 17 Pro Max",
  "iPhone18,4": "iPhone Air",
  // iPhone 16
  "iPhone17,3": "iPhone 16",
  "iPhone17,4": "iPhone 16 Plus",
  "iPhone17,1": "iPhone 16 Pro",
  "iPhone17,2": "iPhone 16 Pro Max",
  "iPhone17,5": "iPhone 16e",
  // iPhone 15
  "iPhone15,4": "iPhone 15",
  "iPhone15,5": "iPhone 15 Plus",
  "iPhone16,1": "iPhone 15 Pro",
  "iPhone16,2": "iPhone 15 Pro Max",
  // iPhone 14
  "iPhone14,7": "iPhone 14",
  "iPhone14,8": "iPhone 14 Plus",
  "iPhone15,2": "iPhone 14 Pro",
  "iPhone15,3": "iPhone 14 Pro Max",
  // iPhone 13
  "iPhone14,5": "iPhone 13",
  "iPhone14,4": "iPhone 13 mini",
  "iPhone14,2": "iPhone 13 Pro",
  "iPhone14,3": "iPhone 13 Pro Max",
  // iPhone SE / 12
  "iPhone14,6": "iPhone SE (3rd gen)",
  "iPhone13,2": "iPhone 12",
  "iPhone13,1": "iPhone 12 mini",
  "iPhone13,3": "iPhone 12 Pro",
  "iPhone13,4": "iPhone 12 Pro Max",
};

/** 식별자(iPhone18,1) 또는 "iPhone 17 Pro (iPhone18,1)" 형태에서 순수 식별자만 뽑는다. */
function extractIdentifier(value: string): string | null {
  const m = value.match(/(iPhone\d+,\d+|iPad\d+,\d+|Watch\d+,\d+)/i);
  return m ? m[1] : null;
}

/**
 * 표시용 기기 라벨. raw 식별자면 마케팅명으로, 이미 마케팅명이 붙어 있으면 그대로,
 * 미등록/비아이폰이면 원본 그대로 반환. null/빈값이면 null.
 */
export function deviceLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const id = extractIdentifier(raw);
  if (!id) return raw; // 식별자 패턴 아님(이미 사람이 읽는 이름이거나 안드로이드 등)
  const name = MARKETING_NAME[id];
  if (!name) return raw; // 미등록 기종 — 식별자 그대로 노출
  // 이미 "이름 (식별자)" 형태면 그대로, 아니면 "이름 (식별자)"로 조합
  return raw.includes(name) ? raw : `${name} (${id})`;
}
