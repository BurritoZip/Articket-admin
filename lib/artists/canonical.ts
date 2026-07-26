/**
 * 아티스트 이름 "틀" — ingest·enrich·백필이 공유하는 단일 구조화 소스.
 *
 * raw 스크래퍼 문자열을 { displayName, nameEn, aliases, normalizedKey } 로 결정론적으로 쪼갠다.
 * 언어(한/영) 판정과 공식명 선택은 Gemini(enrich)가 마무리하지만, 여기서 최소한
 *   - `한글(영문)` / `영문(한글)` 통짜 분리
 *   - 공백으로 나뉜 이중표기(`Luna Li 루나 리`) 분리
 *   - 깨진 괄호 정리
 *   - 원본은 항상 alias 로 보존(매칭 무손실)
 * 을 보장해 재발을 막는다.
 */
import { normalizeKey, isKorean, isLatin } from "./normalize";

export interface StructuredName {
  displayName: string;
  nameEn: string | null;
  aliases: string[];
  normalizedKey: string;
}

/** "A(B)" 또는 깨진 "A(B" 를 [A, B] 로. 괄호 없으면 [raw]. */
function splitParen(raw: string): string[] {
  const m = raw.match(/^(.+?)\s*[(（]\s*([^)）]+?)\s*[)）]?\s*$/);
  if (m && m[1].trim() && m[2].trim()) return [m[1].trim(), m[2].trim()];
  return [raw.trim()];
}

/** 한/영 혼재 + 괄호 없음 → 한글 구간·라틴 구간으로 분리. 아니면 null. */
function splitBilingual(raw: string): [string, string] | null {
  if (!isKorean(raw) || !isLatin(raw)) return null;
  // 숫자+영문 붙은 토큰(10CM, 2NE1)은 라틴 통짜로 취급 — 쪼개지 않는다.
  const korean = raw
    .replace(/[A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const latin = raw
    .replace(/[가-힯ᄀ-ᇿ㄰-㆏]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!korean || !latin) return null;
  return [korean, latin];
}

export function structureArtistName(rawInput: string): StructuredName {
  const raw = rawInput.trim();

  // 후보 조각 추출 (원본 순서 보존)
  let parts: string[];
  const paren = splitParen(raw);
  if (paren.length === 2) {
    parts = paren;
  } else {
    const bi = splitBilingual(raw);
    parts = bi
      ? // 라틴이 먼저 나오면 라틴을 앞에(원본 순서 반영)
        raw.search(/[A-Za-z]/) < raw.search(/[가-힯]/)
        ? [bi[1], bi[0]]
        : [bi[0], bi[1]]
      : [raw];
  }
  parts = Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean)));

  const displayName = parts[0] || raw;
  const latinPart =
    parts.find((p) => p !== displayName && isLatin(p) && !isKorean(p)) ?? null;

  const aliases = Array.from(
    new Set([...parts, raw].filter((n) => n && n !== displayName)),
  );

  return {
    displayName,
    nameEn: latinPart,
    aliases,
    normalizedKey: normalizeKey(displayName),
  };
}

/**
 * enrich(Gemini)가 제안한 표시명을 어떻게 반영할지 결정.
 * - keep    : 변경 없음 (제안 없음/동일)
 * - auto    : 제안명이 현재 이름의 조각 → 환각 위험 0, 자동 교체
 * - propose : 새 텍스트(철자교정·번역 등) → 검토큐로
 */
export type NameDecision =
  | { kind: "keep" }
  | { kind: "auto"; name: string; normalizedKey: string }
  | { kind: "propose"; name: string };

export function decideArtistName(
  current: string,
  proposed: string | null,
  isMusic: boolean | null,
): NameDecision {
  if (!proposed) return { kind: "keep" };
  const propKey = normalizeKey(proposed);
  const curKey = normalizeKey(current);
  if (!propKey || propKey === curKey) return { kind: "keep" };
  if (curKey.includes(propKey) && isMusic !== false)
    return { kind: "auto", name: proposed.trim(), normalizedKey: propKey };
  return { kind: "propose", name: proposed.trim() };
}

// ── self-check ────────────────────────────────────────────────────────
export function demo(): void {
  const cases: Array<[string, Partial<StructuredName>]> = [
    ["디플로(Diplo)", { displayName: "디플로", nameEn: "Diplo" }],
    ["십센치(10CM)", { displayName: "십센치", nameEn: "10CM" }],
    ["우즈(WOODZ", { displayName: "우즈", nameEn: "WOODZ" }], // 깨진 괄호
    ["Luna Li 루나 리", { displayName: "Luna Li", nameEn: null }],
    ["지코 Zico", { displayName: "지코", nameEn: "Zico" }],
    ["아이유", { displayName: "아이유", nameEn: null }],
    ["10CM", { displayName: "10CM", nameEn: null }],
    ["Charlie Puth", { displayName: "Charlie Puth", nameEn: null }],
  ];
  for (const [raw, want] of cases) {
    const got = structureArtistName(raw);
    for (const k of Object.keys(want) as (keyof StructuredName)[]) {
      const g = JSON.stringify(got[k]);
      const w = JSON.stringify(want[k]);
      if (g !== w) throw new Error(`"${raw}".${k}: got ${g}, want ${w}`);
    }
    // 원본은 항상 복원 가능해야 함 (display 또는 alias 에 존재)
    if (got.displayName !== raw && !got.aliases.includes(raw))
      throw new Error(`"${raw}": raw lost from aliases`);
  }

  // decideArtistName
  const dc: Array<[string, string | null, boolean | null, string]> = [
    ["디플로(Diplo)", "Diplo", true, "auto"], // 조각 → 자동
    ["지코(Zico)", "지코", true, "auto"],
    ["십센치(10CM)", "10CM", true, "auto"],
    ["Chalie Puth", "Charlie Puth", true, "propose"], // 철자교정 → 검토
    ["아이유", "아이유", true, "keep"], // 동일
    ["방탄소년단", "BTS", true, "propose"], // 새 텍스트 → 검토
    ["디플로(Diplo)", "Diplo", false, "propose"], // 음악인 아님 → 자동 안 함
    ["지코", null, true, "keep"], // 제안 없음
  ];
  for (const [cur, prop, music, want] of dc) {
    const got = decideArtistName(cur, prop, music).kind;
    if (got !== want)
      throw new Error(`decide("${cur}","${prop}"): got ${got}, want ${want}`);
  }
  console.log("canonical.demo OK");
}

if (require.main === module) demo();
