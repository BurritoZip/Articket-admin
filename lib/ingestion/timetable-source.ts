import * as cheerio from "cheerio";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TIME_RANGE =
  /(\d{1,2}[:.]\d{2})\s*(?:~|-|–|—|부터|to)\s*(\d{1,2}[:.]\d{2})/i;
const TIMETABLE_KEYWORD =
  /(타임\s*테이블|타임테이블|time\s*table|timetable|schedule|스케줄|라인업|line\s*up|lineup)/i;
const CONTEXT_LINE =
  /(day|데이|stage|스테이지|무대|zone|존|main|sub|green|blue|red|\d{1,2}\s*[./월]\s*\d{1,2})/i;

export type TimetableSourceResult = {
  text: string;
  sourceUrl: string | null;
  sourceName: string | null;
  assetUrls: string[];
  issues: string[];
};

type RawPayloadRow = {
  source_name: string | null;
  source_url: string | null;
  raw_html: string | null;
  parsed_json: Record<string, unknown> | null;
};

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function candidateImageUrls($: cheerio.CheerioAPI): string[] {
  const urls: string[] = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const label = `${$el.attr("alt") ?? ""} ${$el.attr("src") ?? ""}`;
    if (!TIMETABLE_KEYWORD.test(label)) return;
    const src =
      $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-lazy-src");
    if (src) urls.push(src);
  });
  return unique(urls);
}

export function extractTimetableTextFromHtml(html: string): {
  text: string;
  assetUrls: string[];
  issues: string[];
} {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const lines = $("body")
    .text()
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const selected = new Set<number>();
  lines.forEach((line, index) => {
    if (!TIME_RANGE.test(line) && !TIMETABLE_KEYWORD.test(line)) return;
    const radius = TIME_RANGE.test(line) ? 3 : 8;
    for (
      let cursor = Math.max(0, index - radius);
      cursor <= Math.min(lines.length - 1, index + radius);
      cursor += 1
    ) {
      const nearby = lines[cursor];
      if (
        TIME_RANGE.test(nearby) ||
        CONTEXT_LINE.test(nearby) ||
        TIMETABLE_KEYWORD.test(nearby) ||
        selected.has(cursor - 1)
      ) {
        selected.add(cursor);
      }
    }
  });

  const text = Array.from(selected)
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join("\n");
  const assetUrls = candidateImageUrls($);
  const issues =
    !text && assetUrls.length > 0
      ? ["타임테이블 이미지는 찾았지만 OCR 텍스트가 없어 자동 파싱하지 못했습니다."]
      : !text
        ? ["원본 페이지에서 시간 범위가 포함된 타임테이블 텍스트를 찾지 못했습니다."]
        : [];

  return { text, assetUrls, issues };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`source_http_${res.status}`);
  return res.text();
}

export async function deriveTimetableTextForEvent(
  eventId: string,
): Promise<TimetableSourceResult> {
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("raw_event_payloads")
    .select("source_name, source_url, raw_html, parsed_json")
    .eq("event_id", eventId)
    .order("crawled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const payload = data as RawPayloadRow | null;
  if (!payload) {
    return {
      text: "",
      sourceUrl: null,
      sourceName: null,
      assetUrls: [],
      issues: ["이 이벤트와 연결된 원본 수집 payload가 없습니다."],
    };
  }

  let html = payload.raw_html;
  const issues: string[] = [];
  if (!html && payload.source_url) {
    try {
      html = await fetchHtml(payload.source_url);
    } catch (e) {
      issues.push(e instanceof Error ? e.message : "원본 페이지 fetch 실패");
    }
  }

  if (!html) {
    return {
      text: "",
      sourceUrl: payload.source_url,
      sourceName: payload.source_name,
      assetUrls: [],
      issues: issues.length ? issues : ["원본 HTML을 찾지 못했습니다."],
    };
  }

  const extracted = extractTimetableTextFromHtml(html);
  return {
    text: extracted.text,
    sourceUrl: payload.source_url,
    sourceName: payload.source_name,
    assetUrls: extracted.assetUrls,
    issues: [...issues, ...extracted.issues],
  };
}
