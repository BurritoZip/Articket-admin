import type { RawScrapedEvent, NormalizedEvent } from "@/types/ingestion";
import { generateDedupKey } from "./dedup";
import {
  PRICE_RE,
  TICKET_GRADE_RE,
  DATE_RE,
  URL_RE,
} from "@/lib/data-quality/patterns";

const STRIP_EVENT_SUFFIX =
  /[\s\-_·]*(공연|콘서트|페스티벌|festival|concert|show|tour|live)$/i;
const NORMALIZE_WHITESPACE = /\s+/g;
const REMOVE_SPECIALS = /[^\w\s가-힣]/g;

export function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(STRIP_EVENT_SUFFIX, "")
    .replace(NORMALIZE_WHITESPACE, " ")
    .toLowerCase()
    .trim();
}

export function normalizeVenueName(
  raw: string | null | undefined,
  eventTitle?: string,
): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  if (s.length <= 1) return null;
  // 공연 제목과 동일하면 공연장이 아님
  if (eventTitle && normalizeTitle(s) === normalizeTitle(eventTitle))
    return null;
  // 날짜로 시작하면 공연장이 아님
  if (DATE_RE.test(s.slice(0, 20))) return null;
  // 가격·티켓등급·URL 포함 시 공연장이 아님
  if (PRICE_RE.test(s) || TICKET_GRADE_RE.test(s) || URL_RE.test(s))
    return null;
  return s.replace(NORMALIZE_WHITESPACE, " ").trim().toLowerCase();
}

const ARTIST_DATE_BRACKET = /\s*\([^)]*\d{4}[^)]*\)/g;
const ARTIST_SLASH_AGENCY = /\s*\/\s*.+$/;
const KNOWN_AGENCIES =
  /\s*[-–]\s*(SM|YG|JYP|HYBE|빅히트|카카오|카카오엔터|큐브|스타쉽|울림|젤리피쉬|FNC|플레디스|WM|DSP|IST).*/i;

export function normalizeArtistName(raw: string): string {
  return raw
    .replace(ARTIST_DATE_BRACKET, "") // (2026.06.01~03) 등 날짜 포함 괄호 제거
    .replace(ARTIST_SLASH_AGENCY, "") // "밴드 / 소속사" → "밴드"
    .replace(KNOWN_AGENCIES, "") // " - SM엔터테인먼트" 등 제거
    .replace(DATE_RE, "") // 남은 날짜 패턴 제거
    .trim();
}

const KOREAN_DATE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // 2025.07.04 ~ 07.06
  [
    /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*[~–-]\s*\d{1,2}\.(\d{1,2})/,
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  ],
  // 2025년 7월 4일
  [
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  ],
  // 2025.07.04
  [
    /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  ],
  // 25.07.04
  [
    /(\d{2})\.(\d{1,2})\.(\d{1,2})/,
    (m) => `20${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  ],
  // ISO: 2025-07-04
  [/(\d{4}-\d{2}-\d{2})/, (m) => m[1]],
];

export function parseDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  for (const [pattern, transform] of KOREAN_DATE_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      const iso = transform(match);
      if (!isNaN(Date.parse(iso))) return iso;
    }
  }
  return null;
}

export function parseEndDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  // 2025.07.04 ~ 07.06 — extract trailing date
  const rangeMatch = raw.match(
    /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*[~–-]\s*(\d{1,2})\.(\d{1,2})/,
  );
  if (rangeMatch) {
    const end = `${rangeMatch[1]}-${rangeMatch[4].padStart(2, "0")}-${rangeMatch[5].padStart(2, "0")}`;
    if (!isNaN(Date.parse(end))) return end;
  }
  return parseDate(raw);
}

export function inferStatus(
  startDate: string | null,
): "upcoming" | "on_sale" | "ended" {
  if (!startDate) return "upcoming";
  const now = new Date();
  const start = new Date(startDate);
  if (start < now) return "ended";
  const twoWeeksBefore = new Date(start.getTime() - 14 * 24 * 60 * 60 * 1000);
  if (now >= twoWeeksBefore) return "on_sale";
  return "upcoming";
}

export function normalizeEvent(raw: RawScrapedEvent): NormalizedEvent {
  const normalizedTitle = normalizeTitle(raw.title);
  const normalizedVenueName = normalizeVenueName(raw.venueName, raw.title);
  const startDate = parseDate(raw.startDate);
  const endDate = parseEndDate(raw.endDate) ?? parseEndDate(raw.startDate);

  return {
    title: raw.title.trim(),
    normalizedTitle,
    posterUrl: raw.posterUrl ?? null,
    venueName: raw.venueName?.trim() ?? null,
    normalizedVenueName,
    venueAddress: raw.venueAddress?.trim() ?? null,
    startDate,
    endDate,
    ticketOpenDate: parseDate(raw.ticketOpenDate),
    ticketProvider: raw.ticketProvider?.trim() ?? null,
    sourceUrls: [raw.sourceUrl],
    sourceName: raw.sourceName,
    artists: raw.artists,
    artistProfiles: raw.artistProfiles,
    genre: raw.genre?.trim() ?? null,
    description: raw.description?.trim() ?? null,
    status: raw.status ?? inferStatus(startDate),
    dedupKey: generateDedupKey(normalizedTitle, normalizedVenueName, startDate),
  };
}
