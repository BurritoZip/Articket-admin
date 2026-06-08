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

// 표시 제목에서 발표·예매 단계 꼬리표 제거.
// "서울재즈페스티벌 2020 - 2차 라인업" → "서울재즈페스티벌 2020"
// 구분자(- : · – —) 뒤 발표성 세그먼트만 자른다(맨앞 공백 매칭 금지 — 본문 훼손 방지).
// 예매일자는 ticketOpen 으로 따로 표기되므로 제목엔 불필요.
const DISPLAY_SUFFIX_CUT =
  /\s+[\-:·–—]\s*[^\-:·–—]*(?:\d+\s*차|라인업|티켓\s*오픈|티켓\s*정보|선\s*예매|예매\s*(?:방법|안내|오픈)|취소|연기|개최\s*무산|공연\s*취소)[^\-:·–—]*$/;

export function cleanDisplayTitle(raw: string): string {
  const t = raw.replace(/^﻿/, "").trim();
  const cut = t.replace(DISPLAY_SUFFIX_CUT, "").trim();
  // 과삭제 가드: 결과가 너무 짧거나 원본의 30% 미만이면 원본 유지
  if (cut.length >= 4 && cut.length >= t.length * 0.3) return cut;
  return t;
}

export function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(STRIP_EVENT_SUFFIX, "")
    .replace(NORMALIZE_WHITESPACE, " ")
    .toLowerCase()
    .trim();
}

// venue 이름 뒤에 붙는 티켓 정보 suffix 시작 패턴
const VENUE_SUFFIX_CUT =
  /\s+(?:티켓\s*가격|가격\s*[-:·]|가격\s*\(|티켓\s*오픈|오픈\s*[-:·]|예매\s*[-:·]|작성\s|티켓\s*예매|[-·]\s*티켓)/i;

export function normalizeVenueName(
  raw: string | null | undefined,
  eventTitle?: string,
): string | null {
  if (!raw?.trim()) return null;

  // 티켓 정보 suffix 먼저 제거 ("예스24 라이브홀 티켓 가격: ..." → "예스24 라이브홀")
  const cutMatch = VENUE_SUFFIX_CUT.exec(raw);
  const s = (cutMatch ? raw.slice(0, cutMatch.index) : raw).trim();

  if (s.length <= 1) return null;
  // 공연 제목과 동일하면 공연장이 아님
  if (eventTitle && normalizeTitle(s) === normalizeTitle(eventTitle))
    return null;
  // 날짜로 시작하면 공연장이 아님
  if (DATE_RE.test(s.slice(0, 20))) return null;
  // 잘라낸 후에도 가격·티켓등급·URL 포함 시 reject
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

// 공연일자(start/end)와 예매일자(ticketOpen)를 구분해 판정.
//   ended    = 공연 종료일 지남
//   ongoing  = 공연중
//   upcoming = 예매예정 — 공연 전 + 예매오픈일이 미래
//   on_sale  = 예매중   — 공연 전 + 예매오픈됨(또는 오픈일 미상)
// sweepEventStatuses() 가 이후 ticket_close_date 까지 포함해 재판정하는 단순화 버전.
export function inferStatus(
  startDate: string | null,
  endDate?: string | null,
  ticketOpenDate?: string | null,
): "upcoming" | "on_sale" | "ongoing" | "ended" {
  if (!startDate) return "upcoming";
  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  if (end < now) return "ended";
  if (start <= now && now <= end) return "ongoing";
  // 공연 전(start > now): 예매오픈일로 예매중/예매예정 구분
  if (ticketOpenDate && new Date(ticketOpenDate) > now) return "upcoming";
  return "on_sale";
}

export function normalizeEvent(raw: RawScrapedEvent): NormalizedEvent {
  const displayTitle = cleanDisplayTitle(raw.title);
  const normalizedTitle = normalizeTitle(displayTitle);
  const normalizedVenueName = normalizeVenueName(raw.venueName, raw.title);
  const startDate = parseDate(raw.startDate);
  const endDate = parseEndDate(raw.endDate) ?? parseEndDate(raw.startDate);
  const ticketOpenDate = parseDate(raw.ticketOpenDate);

  return {
    title: displayTitle,
    normalizedTitle,
    posterUrl: raw.posterUrl ?? null,
    venueName: raw.venueName?.trim() ?? null,
    normalizedVenueName,
    venueAddress: raw.venueAddress?.trim() ?? null,
    startDate,
    endDate,
    ticketOpenDate,
    ticketProvider: raw.ticketProvider?.trim() ?? null,
    sourceUrls: [raw.sourceUrl],
    sourceName: raw.sourceName,
    artists: raw.artists,
    artistProfiles: raw.artistProfiles,
    genre: raw.genre?.trim() ?? null,
    description: raw.description?.trim() ?? null,
    status: raw.status ?? inferStatus(startDate, endDate, ticketOpenDate),
    dedupKey: generateDedupKey(normalizedTitle, normalizedVenueName, startDate),
  };
}
