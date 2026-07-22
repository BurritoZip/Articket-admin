/**
 * 멜론 아티스트 정보 스크래퍼
 *
 * 플로우: 멜론 검색 → artistId 추출 → 상세 페이지 파싱
 * avatar_url, name_en, 소속사, 국가, 장르, 데뷔일 등 추출
 */

import * as cheerio from "cheerio";

export interface MelonProfile {
  avatar_url?: string;
  name?: string; // 한글 이름 (멜론 표시명)
  name_en?: string; // 영문 이름
  label?: string; // 소속사
  country?: string; // 국가 코드
  occupation?: string; // 활동 유형 (솔로, 그룹 등 → 가수)
  debut_date?: string; // 데뷔일 (birth_date 아님)
  genre?: string; // 장르 (metadata 용)
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
  한국: "KR",
  국내: "KR",
  미국: "US",
  일본: "JP",
  중국: "CN",
  영국: "GB",
  캐나다: "CA",
};

/**
 * 멜론 검색에서 첫 아티스트의 id + avatar 추출.
 *
 * 2026-07 사이트 개편으로 검색 결과가 `<a href="artistId=...">` 링크에서
 * `<a href="javascript:...melon.link.goArtistDetail('261143');" class="thumb">` 로 바뀌어
 * 옛 셀렉터가 artistId 를 못 뽑아 avatar 보강이 전멸했다(성공률 0). 새 구조 대응 + 검색 결과
 * 카드에 이미 있는 아티스트 이미지(artistcrop)를 그 자리에서 가져온다(상세 페이지 불필요).
 */
async function searchMelonArtist(
  query: string,
): Promise<{ artistId: string; avatarUrl?: string } | null> {
  try {
    await rateLimit();
    const url = `${MELON_BASE}/search/artist/index.htm?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // 새 구조: goArtistDetail('id') 우선, 구 구조: artistId= 폴백
    const first = $("a[href*='goArtistDetail'], a[href*='artistId=']").first();
    const href = first.attr("href") ?? "";
    const m =
      href.match(/goArtistDetail\('(\d+)'\)/) ?? href.match(/artistId=(\d+)/);
    if (!m) return null;
    const artistId = m[1];

    // 이름 유사도 확인 (false positive 방지) — title="아이유 - 페이지 이동"
    const resultName = (first.attr("title") ?? first.text())
      .replace(/\s*-\s*페이지.*$/, "")
      .trim();
    if (resultName) {
      const qNorm = query.toLowerCase().replace(/\s/g, "");
      const rNorm = resultName.toLowerCase().replace(/\s/g, "");
      if (!qNorm.includes(rNorm) && !rNorm.includes(qNorm)) return null;
    }

    // 검색 카드 이미지 = avatar (artistcrop, default 제외)
    let avatarUrl: string | undefined;
    const img = first.find("img").attr("src");
    if (img && /artistcrop/i.test(img) && !/default/i.test(img)) {
      avatarUrl = img.startsWith("//") ? `https:${img}` : img;
    }

    return { artistId, avatarUrl };
  } catch {
    return null;
  }
}

/** 멜론 아티스트 상세 페이지 파싱 */
async function fetchMelonDetail(
  artistId: string,
): Promise<MelonProfile | null> {
  try {
    await rateLimit();
    const url = `${MELON_BASE}/artist/detail.htm?artistId=${artistId}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
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
    const titleText = $(".title_atist")
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();
    if (titleText) profile.name = titleText;

    const enName = $(".title_atist .gray, .title_atist .english").text().trim();
    if (enName && /[A-Za-z]/.test(enName)) profile.name_en = enName;

    // dl/dt/dd 프로필 정보
    $(".section_atistinfo01 dl dt, .section_atist_info dt").each((_, dt) => {
      const key = $(dt).text().trim();
      const val = $(dt).next("dd").text().trim();
      if (!val) return;

      if (key.includes("데뷔")) profile.debut_date = val;
      else if (key.includes("소속사") || key.includes("기획사"))
        profile.label = val;
      else if (key.includes("국가") || key.includes("활동지역")) {
        profile.country = COUNTRY_MAP[val] ?? val;
      } else if (key.includes("장르")) {
        // occupation = 장르 의미 (직업 아님)
        profile.genre = val;
        profile.occupation = val;
      }
    });

    return Object.keys(profile).length > 1 ? (profile as MelonProfile) : null;
  } catch {
    return null;
  }
}

export async function fetchMelonProfile(
  query: string,
): Promise<MelonProfile | null> {
  try {
    const found = await searchMelonArtist(query);
    if (!found) return null;
    const detail = await fetchMelonDetail(found.artistId);
    // 검색 카드에서 얻은 avatar 를 상세가 못 채웠으면 사용(상세 페이지 셀렉터도 개편 취약)
    if (found.avatarUrl) {
      if (detail) {
        if (!detail.avatar_url) detail.avatar_url = found.avatarUrl;
        return detail;
      }
      return {
        avatar_url: found.avatarUrl,
        source_url: `${MELON_BASE}/artist/detail.htm?artistId=${found.artistId}`,
      } as MelonProfile;
    }
    return detail;
  } catch {
    return null;
  }
}
