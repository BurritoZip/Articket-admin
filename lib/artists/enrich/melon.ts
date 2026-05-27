/**
 * 멜론 아티스트 정보 스크래퍼
 *
 * 플로우: 멜론 검색 → artistId 추출 → 상세 페이지 파싱
 * avatar_url, name_en, 소속사, 국가, 장르, 데뷔일 등 추출
 */

import * as cheerio from "cheerio";

export interface MelonProfile {
  avatar_url?: string;
  name?: string;         // 한글 이름 (멜론 표시명)
  name_en?: string;      // 영문 이름
  label?: string;        // 소속사
  country?: string;      // 국가 코드
  occupation?: string;   // 활동 유형 (솔로, 그룹 등 → 가수)
  debut_date?: string;   // 데뷔일 (birth_date 아님)
  genre?: string;        // 장르 (metadata 용)
  source_url: string;
}

const MELON_BASE = "https://www.melon.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.melon.com/",
  Accept: "text/html,application/xhtml+xml",
};

const RATE_LIMIT_MS = 1000;
let lastCall = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

const COUNTRY_MAP: Record<string, string> = {
  한국: "KR", 국내: "KR", 미국: "US", 일본: "JP",
  중국: "CN", 영국: "GB", 캐나다: "CA",
};

/** 멜론 검색에서 첫 번째 아티스트 ID 추출 */
async function searchMelonArtistId(query: string): Promise<string | null> {
  try {
    await rateLimit();
    const url = `${MELON_BASE}/search/artist/index.htm?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // 첫 번째 아티스트 카드의 링크에서 artistId 추출
    const href = $("a[href*='artistId=']").first().attr("href") ?? "";
    const m = href.match(/artistId=(\d+)/);
    if (!m) return null;

    // 검색 결과 이름이 쿼리와 유사한지 확인 (false positive 방지)
    const resultName = $("a[href*='artistId=']").first().text().trim();
    if (resultName) {
      const qNorm = query.toLowerCase().replace(/\s/g, "");
      const rNorm = resultName.toLowerCase().replace(/\s/g, "");
      if (!qNorm.includes(rNorm) && !rNorm.includes(qNorm)) {
        return null; // 이름이 너무 다르면 건너뜀
      }
    }

    return m[1];
  } catch {
    return null;
  }
}

/** 멜론 아티스트 상세 페이지 파싱 */
async function fetchMelonDetail(artistId: string): Promise<MelonProfile | null> {
  try {
    await rateLimit();
    const url = `${MELON_BASE}/artist/detail.htm?artistId=${artistId}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const profile: Partial<MelonProfile> = { source_url: url };

    // 아티스트 이미지
    const imgSrc =
      $(".thumb_atist img").attr("src") ??
      $(".image_typeAll").attr("src") ??
      $(".image_typeAll").attr("data-src");
    if (imgSrc && !imgSrc.includes("default")) {
      profile.avatar_url = imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc;
    }

    // 한글명 / 영문명
    const titleText = $(".title_atist").clone().children().remove().end().text().trim();
    if (titleText) profile.name = titleText;

    const enName = $(".title_atist .gray, .title_atist .english").text().trim();
    if (enName && /[A-Za-z]/.test(enName)) profile.name_en = enName;

    // dl/dt/dd 프로필 정보
    $(".section_atistinfo01 dl dt, .section_atist_info dt").each((_, dt) => {
      const key = $(dt).text().trim();
      const val = $(dt).next("dd").text().trim();
      if (!val) return;

      if (key.includes("데뷔")) profile.debut_date = val;
      else if (key.includes("소속사") || key.includes("기획사")) profile.label = val;
      else if (key.includes("국가") || key.includes("활동지역")) {
        profile.country = COUNTRY_MAP[val] ?? val;
      } else if (key.includes("장르")) profile.genre = val;
      else if (key.includes("활동유형") || key.includes("분류")) {
        // "남성 솔로", "혼성그룹" 등 → 직업은 "가수"로 통일
        profile.occupation = "가수";
      }
    });

    return Object.keys(profile).length > 1 ? (profile as MelonProfile) : null;
  } catch {
    return null;
  }
}

export async function fetchMelonProfile(query: string): Promise<MelonProfile | null> {
  try {
    const artistId = await searchMelonArtistId(query);
    if (!artistId) return null;
    return await fetchMelonDetail(artistId);
  } catch {
    return null;
  }
}
