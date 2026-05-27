/**
 * 아티스트 이름 정규화 유틸
 *
 * 기존 lib/ingestion/artist-matcher.ts의 normalizeArtistName()은
 * toLowerCase + trim 수준이라 한/영 혼종을 구분 못 함.
 * 이 모듈은 중복 탐지와 언어 판별까지 커버한다.
 */

/** 한글 유니코드 범위 (완성형 + 자모 + 호환자모) */
const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/;

/** ASCII 라틴 문자 (영문 기준) */
const LATIN_RE = /[A-Za-z]/;

/** 토큰 구분자: 공백, 하이픈, 중점, 언더스코어, 슬래시 */
const TOKEN_SEP_RE = /[\s\-·._/]+/;

/** 정규화 시 제거할 특수문자 (한글·영문·숫자·공백 외) */
const STRIP_RE = /[^가-힯ᄀ-ᇿ㄰-㆏A-Za-z0-9\s]/g;

/**
 * 중복 탐지용 정규화 키 생성
 * - NFC 유니코드 정규화
 * - 소문자
 * - 특수문자 제거 (한글/영문/숫자/공백 유지)
 * - 공백 축약
 */
export function normalizeKey(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(STRIP_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 문자열이 한글을 포함하는지 */
export function isKorean(s: string): boolean {
  return HANGUL_RE.test(s);
}

/** 문자열이 라틴 문자를 포함하는지 */
export function isLatin(s: string): boolean {
  return LATIN_RE.test(s);
}

/** 문자열이 한글 전용인지 (라틴 없음) */
export function isKoreanOnly(s: string): boolean {
  return isKorean(s) && !isLatin(s);
}

/** 문자열이 라틴 전용인지 (한글 없음) */
export function isLatinOnly(s: string): boolean {
  return isLatin(s) && !isKorean(s);
}

/**
 * 이름을 토큰 배열로 분리
 * 예: "SHINee (샤이니)" → ["shinee", "샤이니"]
 */
export function tokenize(name: string): string[] {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ") // 괄호 공백 처리
    .split(TOKEN_SEP_RE)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * 발음 구별 기호 제거 (é → e, ü → u 등)
 * 영문 아티스트명 비교 시 사용
 */
export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); // 결합 발음 기호 제거
}

/**
 * 두 토큰 집합의 자카드 유사도 (0~1)
 * stage D 중복 탐지에 사용
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of Array.from(setA)) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 두 이름의 정규화 키가 동일한지 (exact dedup 판단)
 */
export function isSameNormalized(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}
