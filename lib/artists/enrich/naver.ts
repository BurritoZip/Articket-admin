/**
 * 네이버 검색 인물 카드 스크래퍼
 *
 * 네이버 검색 결과의 인물/연예인 정보 카드를 파싱한다.
 * birth_date, birth_place, occupation 보완에 주로 사용.
 */

import * as cheerio from "cheerio";

export interface NaverProfile {
  name?: string;
  name_en?: string;
  avatar_url?: string;
  occupation?: string;
  birth_date?: string;
  birth_place?: string;
  label?: string;
  related?: string;
  source_url: string;
}

const NAVER_SEARCH = "https://search.naver.com/search.naver";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Referer: "https://www.naver.com/",
};

const RATE_LIMIT_MS = 1200;
let lastCall = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function parseBirthDate(raw: string): string | undefined {
  // "1993. 5. 16." or "1993년 5월 16일" or "1993-05-16"
  const m = raw.match(/(\d{4})[.년\s-]\s*(\d{1,2})[.월\s-]\s*(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return undefined;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export async function fetchNaverProfile(query: string): Promise<NaverProfile | null> {
  try {
    await rateLimit();
    const url = `${NAVER_SEARCH}?query=${encodeURIComponent(query)}&where=nexearch&sm=top_hty&fbm=0&ie=utf8`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const profile: Partial<NaverProfile> = { source_url: url };

    // 인물 정보 카드 셀렉터 (네이버 UI 버전별 대응)
    const card =
      $(".api_subject_badge_module").first() ||
      $(".people_info_area").first() ||
      $("[data-section='people']").first();

    if (!card.length) return null;

    // 이름
    const name = card.find(".name, .tit_area .name, h2.tit").first().text().trim();
    if (name) profile.name = cleanText(name);

    // 영문명
    const nameEn = card.find(".eng_name, .sub_tit").first().text().trim();
    if (nameEn && /[A-Za-z]/.test(nameEn)) profile.name_en = cleanText(nameEn);

    // 프로필 이미지
    const imgSrc = card.find("img.thumb").attr("src") ?? card.find(".img_area img").attr("src");
    if (imgSrc) profile.avatar_url = imgSrc;

    // dl/dt/dd 또는 테이블 형식 정보
    card.find("dl dt, .info_group .info_title").each((_, dt) => {
      const key = $(dt).text().trim();
      const val = $(dt).next("dd, .info_desc").text().trim();
      if (!val) return;

      const k = key.replace(/\s/g, "");
      if (k.includes("직업") || k.includes("직종")) {
        profile.occupation = cleanText(val);
      } else if (k.includes("출생일") || k.includes("생년월일")) {
        profile.birth_date = parseBirthDate(val) ?? cleanText(val);
      } else if (k.includes("출생지") || k.includes("출신지")) {
        profile.birth_place = cleanText(val);
      } else if (k.includes("소속사") || k.includes("기획사")) {
        profile.label = cleanText(val);
      } else if (k.includes("소속") || k.includes("그룹")) {
        profile.related = cleanText(val);
      }
    });

    // 텍스트 기반 파싱 (구조화 카드 없을 때 fallback)
    if (!profile.birth_date) {
      const bodyText = card.text();
      const dateMatch = bodyText.match(/(\d{4})[.년]\s*(\d{1,2})[.월]\s*(\d{1,2})/);
      if (dateMatch) {
        profile.birth_date = parseBirthDate(dateMatch[0]);
      }
    }

    const hasData = Object.keys(profile).length > 1;
    return hasData ? (profile as NaverProfile) : null;
  } catch {
    return null;
  }
}
