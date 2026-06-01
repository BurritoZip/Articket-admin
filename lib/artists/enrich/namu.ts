/**
 * 나무위키 아티스트 정보 스크래퍼
 *
 * 나무위키는 JS 렌더링이 필요하지만, 검색 API와 정적 미러(namu.la)를
 * 조합해 인포박스를 파싱한다.
 * 한국 아티스트의 name_en(영문명), 본명, 소속사 등이 주요 추출 대상.
 */

import * as cheerio from "cheerio";

export interface NamuProfile {
  name?: string; // 본명 (한글)
  name_en?: string; // 영문 예명
  occupation?: string; // 직업 (예: 가수, 배우)
  birth_date?: string; // YYYY-MM-DD
  birth_place?: string; // 출생지
  label?: string; // 소속사
  related?: string; // 소속 그룹
  country?: string; // 국가 코드 (예: KR)
  source_url: string;
}

const BASE = "https://namu.wiki";
const SEARCH_API = "https://search.namu.wiki/api/v1/search";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/html",
  Referer: "https://namu.wiki/",
};

const RATE_LIMIT_MS = 800;
let lastCall = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** 나무위키 검색 → 첫 번째 아티스트 항목 URL 반환 */
async function searchNamu(query: string): Promise<string | null> {
  try {
    await rateLimit();
    const url = `${SEARCH_API}?query=${encodeURIComponent(query)}&namespace=0&limit=5`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { items?: Array<{ title: string }> };
    const first = data.items?.[0]?.title;
    return first ? `${BASE}/w/${encodeURIComponent(first)}` : null;
  } catch {
    return null;
  }
}

/** 인포박스 키워드 → DB 필드 매핑 */
const KO_FIELD_MAP: Record<string, keyof Omit<NamuProfile, "source_url">> = {
  본명: "name",
  영문명: "name_en",
  로마자: "name_en",
  영어: "name_en",
  장르: "occupation", // occupation = 장르 의미 (직업 아님)
  출생일: "birth_date",
  생년월일: "birth_date",
  출생: "birth_date",
  출생지: "birth_place",
  출신: "birth_place",
  국적: "country",
  소속사: "label",
  레이블: "label",
  음반사: "label",
  소속: "related",
  그룹: "related",
};

const COUNTRY_MAP: Record<string, string> = {
  대한민국: "KR",
  한국: "KR",
  미국: "US",
  일본: "JP",
  중국: "CN",
  영국: "GB",
  캐나다: "CA",
  호주: "AU",
  프랑스: "FR",
};

function cleanValue(raw: string): string {
  return raw
    .replace(/\[\d+\]/g, "") // 각주 제거
    .replace(/\s+/g, " ")
    .trim();
}

function parseBirthDate(raw: string): string | undefined {
  // "1993년 5월 16일" → "1993-05-16"
  const m = raw.match(/(\d{4})[년\s.]?\s*(\d{1,2})[월\s.]?\s*(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // "1993-05-16" 형식 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return undefined;
}

/** 나무위키 HTML에서 인포박스 파싱 */
function parseNamuHtml(html: string, sourceUrl: string): NamuProfile | null {
  const $ = cheerio.load(html);
  const profile: Partial<NamuProfile> = { source_url: sourceUrl };

  // 나무위키 인포박스: table.NamuTable 또는 .wiki-table 내의 th/td 쌍
  $("table").each((_, table) => {
    $(table)
      .find("tr")
      .each((_, tr) => {
        const th = $(tr).find("th").first().text().trim();
        const td = $(tr).find("td").first().text().trim();
        if (!th || !td) return;

        const fieldKey = Object.keys(KO_FIELD_MAP).find((k) => th.includes(k));
        if (!fieldKey) return;

        const dbField = KO_FIELD_MAP[fieldKey];
        let value = cleanValue(td);

        if (dbField === "birth_date") value = parseBirthDate(value) ?? value;
        if (dbField === "country") value = COUNTRY_MAP[value] ?? value;
        if (dbField === "name_en") {
          // 영문만 추출 (괄호 안 영문 이름)
          const enMatch = value.match(/[A-Za-z][A-Za-z\s'-]+/);
          if (enMatch) value = enMatch[0].trim();
        }

        if (value && !profile[dbField]) {
          (profile as Record<string, string>)[dbField] = value;
        }
      });
  });

  // 직접 h2 제목 아래에 병렬 구조로 있는 경우도 처리
  // 추출된 필드가 최소 1개 있어야 유효
  const hasData = Object.keys(profile).length > 1; // source_url 외
  return hasData ? (profile as NamuProfile) : null;
}

export async function fetchNamuProfile(
  query: string,
): Promise<NamuProfile | null> {
  try {
    const pageUrl = await searchNamu(query);
    if (!pageUrl) return null;

    await rateLimit();
    const res = await fetch(pageUrl, {
      headers: { ...HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    return parseNamuHtml(html, pageUrl);
  } catch {
    return null;
  }
}
