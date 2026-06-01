/**
 * Wikipedia 아티스트 정보 스크래퍼 (TypeScript)
 *
 * 기존 scripts/scraper/enrich_artists.py의 TypeScript 이식.
 * ko.wikipedia → en.wikipedia 순으로 인포박스 파싱 시도.
 */

import * as cheerio from "cheerio";

export interface WikipediaProfile {
  name?: string;
  name_en?: string;
  occupation?: string; // 장르 의미로 사용 (음악 장르; 가수/배우 같은 직업 아님)
  birth_date?: string;
  birth_place?: string;
  country?: string;
  related?: string; // Associated acts / 그룹
  label?: string; // Record label
  source_url: string;
}

const HEADERS = {
  "User-Agent":
    "ArticketBot/1.0 (https://github.com/BurritoZip/Articket-admin; shinjw4675@gmail.com)",
  Accept: "text/html",
};

const RATE_LIMIT_MS = 500;
let lastCall = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Wikipedia API 검색 → 페이지 제목 반환 */
async function searchWiki(
  query: string,
  lang: "ko" | "en",
): Promise<string | null> {
  try {
    await rateLimit();
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    return data.query?.search?.[0]?.title ?? null;
  } catch {
    return null;
  }
}

const KO_FIELD_MAP: Record<string, keyof Omit<WikipediaProfile, "source_url">> =
  {
    장르: "occupation",
    출생일: "birth_date",
    생년월일: "birth_date",
    출생지: "birth_place",
    출신지: "birth_place",
    국적: "country",
    국가: "country",
    소속: "related",
    그룹: "related",
    레이블: "label",
    소속사: "label",
    음반사: "label",
  };

const EN_FIELD_MAP: Record<string, keyof Omit<WikipediaProfile, "source_url">> =
  {
    Born: "birth_date",
    Origin: "birth_place",
    Nationality: "country",
    Genres: "occupation",
    "Associated acts": "related",
    Labels: "label",
  };

function parseBirthDate(raw: string): string | undefined {
  const m = raw.match(/(\d{4})[^0-9]*(\d{1,2})[^0-9]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const yearOnly = raw.match(/(\d{4})/);
  if (yearOnly) return yearOnly[1];
  return undefined;
}

function cleanWikiText(raw: string): string {
  return raw
    .replace(/\.mw-[^{]*\{[^}]*\}/g, "") // mediawiki 인라인 CSS 잔재
    .replace(/[^{}]*\{[^}]*\}/g, "") // 기타 CSS 블록
    .replace(/\[.*?\]/g, "") // 각주 [1] 등
    .replace(/\s+/g, " ")
    .trim();
}

function parseInfobox(
  $: cheerio.CheerioAPI,
  fieldMap: Record<string, keyof Omit<WikipediaProfile, "source_url">>,
  lang: "ko" | "en",
  sourceUrl: string,
): WikipediaProfile | null {
  const profile: Partial<WikipediaProfile> = { source_url: sourceUrl };

  // Wikipedia infobox: table.infobox 내 th/td 쌍
  $("table.infobox tr").each((_, tr) => {
    const th = $(tr).find("th").text().trim();
    const td = $(tr).find("td").first();
    if (!th || !td.length) return;

    // infobox 셀에 섞인 <style>(.mw-parser-output{...})·각주를 제거하고 텍스트 추출
    td.find("style, script, sup").remove();
    const tdText = cleanWikiText(td.text());
    if (!tdText) return;

    const fieldKey = Object.keys(fieldMap).find((k) => th.includes(k));
    if (!fieldKey) return;

    const dbField = fieldMap[fieldKey];
    let value = tdText;

    if (dbField === "birth_date") {
      // bday span 우선
      const bday = td.find(".bday").text().trim();
      value = bday || parseBirthDate(tdText) || tdText;
    }

    if (value && !profile[dbField]) {
      (profile as Record<string, string>)[dbField] = value;
    }
  });

  // 한국어 위키에서 영문명 추출 시도 (제목 옆 괄호 내 영문)
  if (lang === "ko" && !profile.name_en) {
    const title = $("h1.firstHeading").text();
    const enMatch = title.match(/\(([A-Za-z][A-Za-z\s'-]+)\)/);
    if (enMatch) profile.name_en = enMatch[1].trim();
  }

  const hasData = Object.keys(profile).length > 1;
  return hasData ? (profile as WikipediaProfile) : null;
}

export async function fetchWikipediaProfile(
  query: string,
): Promise<WikipediaProfile | null> {
  // 1. 한국어 Wikipedia 시도
  try {
    const koTitle = await searchWiki(query, "ko");
    if (koTitle) {
      await rateLimit();
      const url = `https://ko.wikipedia.org/wiki/${encodeURIComponent(koTitle)}`;
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const result = parseInfobox($, KO_FIELD_MAP, "ko", url);
        if (result) return result;
      }
    }
  } catch {
    /* 무시하고 영어로 폴백 */
  }

  // 2. 영어 Wikipedia 폴백
  try {
    const enTitle = await searchWiki(query, "en");
    if (enTitle) {
      await rateLimit();
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(enTitle)}`;
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        return parseInfobox($, EN_FIELD_MAP, "en", url);
      }
    }
  } catch {
    /* 무시 */
  }

  return null;
}
