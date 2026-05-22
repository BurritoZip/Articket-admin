import * as cheerio from "cheerio";

export interface StagepickListItem {
  detailUrl: string;
  title: string;
  posterUrl: string | null;
}

export interface StagepickDetailData {
  title: string;
  posterUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dateRange: string | null;
  ticketOpenDate: string | null;
  ticketUrl: string | null;
  ticketProvider: string | null;
  artists: string[];
  artistDetails: Array<{ name: string; detailUrl: string | null }>;
  genre: string | null;
  description: string | null;
}

export interface StagepickArtistProfile {
  name: string;
  sourceUrl: string;
  avatarUrl: string | null;
  occupation: string | null;
  birthDate: string | null;
  related: string | null;
  metadata: Record<string, unknown>;
}

const BASE_URL = "https://www.stagepick.co.kr";

function absoluteUrl(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  return BASE_URL + href;
}

export function parseListPage(html: string): StagepickListItem[] {
  const $ = cheerio.load(html);
  const items: StagepickListItem[] = [];

  // StagePick 페스티벌 목록 카드 구조 (다양한 셀렉터 시도)
  const selectors = [
    ".festival-item",
    ".event-card",
    ".concert-item",
    '[class*="festival"]',
    '[class*="event-item"]',
    "article",
    ".item",
  ];

  let cards: ReturnType<typeof $> = $([] as Parameters<typeof $>[0]);
  for (const sel of selectors) {
    const found = $(sel);
    if (found.length > 0) {
      cards = found;
      break;
    }
  }

  // fallback: 링크가 있는 카드 구조 탐지
  if (cards.length === 0) {
    cards = $("a[href*='/festival/'], a[href*='/concert/'], a[href*='/event/']")
      .closest("li, article, div")
      .filter((_, el) => {
        const $el = $(el);
        return $el.find("img").length > 0;
      });
  }

  cards.each((_, el) => {
    const $el = $(el);
    const link = $el.find("a").first();
    const href = link.attr("href") ?? $el.closest("a").attr("href");
    const detailUrl = absoluteUrl(href);
    if (!detailUrl) return;

    const title =
      $el.find('[class*="title"], h2, h3, h4, .name').first().text().trim() ||
      link.attr("title")?.trim() ||
      $el.find("img").attr("alt")?.trim() ||
      "";

    const img = $el.find("img").first();
    const posterUrl =
      absoluteUrl(
        img.attr("src") ?? img.attr("data-src") ?? img.attr("data-lazy-src"),
      ) ?? null;

    if (title || detailUrl) {
      items.push({ detailUrl, title, posterUrl });
    }
  });

  // 완전한 fallback: 페이지 내 모든 /festival/* 링크 수집
  if (items.length === 0) {
    $('a[href*="/festival/"]').each((_, el) => {
      const href = $(el).attr("href");
      const detailUrl = absoluteUrl(href);
      if (detailUrl && detailUrl !== BASE_URL + "/festival") {
        items.push({ detailUrl, title: $(el).text().trim(), posterUrl: null });
      }
    });
  }

  return dedupByUrl(items);
}

function dedupByUrl(items: StagepickListItem[]): StagepickListItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.detailUrl)) return false;
    seen.add(item.detailUrl);
    return true;
  });
}

export function parseDetailPage(
  html: string,
  _sourceUrl: string,
): StagepickDetailData {
  const $ = cheerio.load(html);
  const lines = $("body")
    .text()
    .split(/\r?\n/)
    .map(cleanText)
    .filter((line): line is string => Boolean(line));

  const lineAfter = (label: string): string | null => {
    const index = lines.findIndex((line) => line === label);
    return index >= 0 ? (lines[index + 1] ?? null) : null;
  };
  const statusIndex = lines.findIndex((line) =>
    ["공연중", "공연예정", "공연종료"].includes(line),
  );
  const titleLine =
    statusIndex >= 0
      ? lines[statusIndex + 1]
      : lines[0] === "공연 상세정보"
        ? (lines[1] ?? null)
        : null;

  const headingTitle = $("h1").first().text().trim();
  const title = cleanTitle(
    (headingTitle && headingTitle !== "공연 상세정보" ? headingTitle : null) ||
      titleLine ||
      $('[class*="title"]').first().text().trim() ||
      $("title").text().split("|")[0].trim(),
  );

  const posterUrl = absoluteUrl(
    $('img[class*="poster"], img[class*="main"], .thumbnail img, .cover img')
      .first()
      .attr("src") ?? $('meta[property="og:image"]').attr("content"),
  );

  // 날짜 텍스트 추출
  const dateText =
    $('[class*="date"], [class*="period"], [class*="schedule"]')
      .first()
      .text()
      .trim() ||
    $('dt:contains("기간"), dt:contains("일정"), dt:contains("날짜")')
      .next("dd")
      .text()
      .trim() ||
    lineAfter("공연 기간");

  // 공연장 추출
  const venueIndex = lines.findIndex((line) => line === "공연 장소");
  const venueLine = venueIndex >= 0 ? (lines[venueIndex + 1] ?? null) : null;
  const venueAddressLine =
    venueIndex >= 0 && lines[venueIndex + 2] === "자세히 보기"
      ? (lines[venueIndex + 3] ?? null)
      : null;
  const venueParts = venueLine?.split(/\s*자세히 보기\s*/);
  const venueName =
    $('[class*="venue"], [class*="location"], [class*="place"]')
      .first()
      .text()
      .trim() ||
    $('dt:contains("장소"), dt:contains("공연장")').next("dd").text().trim() ||
    venueParts?.[0] ||
    null;

  const venueAddress =
    $('[class*="address"]').first().text().trim() ||
    $('dt:contains("주소")').next("dd").text().trim() ||
    venueAddressLine ||
    venueParts?.[1] ||
    null;

  // 티켓 오픈일
  const ticketOpenDate =
    $('[class*="ticket-open"], [class*="ticketopen"]').first().text().trim() ||
    $('dt:contains("티켓오픈"), dt:contains("예매오픈")')
      .next("dd")
      .text()
      .trim() ||
    null;

  // 티켓 링크 — 실제 외부 예매처 URL만 검사
  const ticketLink = $(
    'a[href*="interpark"], a[href*="melon"], a[href*="yes24"], a[href*="ticketlink"], a[href*="kyobo"]',
  ).first();
  const ticketUrl = absoluteUrl(ticketLink.attr("href")) ?? null;
  const ticketProvider = detectTicketProvider(ticketUrl);

  // 아티스트 목록
  const artists: string[] = [];
  const artistDetails: Array<{ name: string; detailUrl: string | null }> = [];
  $('[class*="artist"], [class*="lineup"], [class*="performer"]').each(
    (_, el) => {
      const name = $(el).text().trim();
      if (name && name.length > 0 && name.length < 60) artists.push(name);
    },
  );
  const artistStart = lines.findIndex((line) => line === "출연진");
  if (artistStart >= 0) {
    const sectionEndLabels = [
      "최종 업데이트:",
      "등록일:",
      "시즌별 역대 페스티벌",
      "예매하기",
      "예매 상품 선택",
      "공연 소개",
      "다른 회차",
    ];
    for (const line of lines.slice(artistStart + 1)) {
      if (sectionEndLabels.some((stop) => line.startsWith(stop))) {
        break;
      }
      const artist = line
        .replace(/^#+\s*/, "")
        .replace(/\s*자세히 보기\s*$/, "")
        .trim();
      if (artist && artist.length < 80 && !artist.includes("공연 장소")) {
        artists.push(artist);
      }
    }
    const stopText = sectionEndLabels.join("|");
    $("a[href*='/artists/detail/']").each((_, el) => {
      const $el = $(el);
      const name = cleanText($el.text());
      if (!name) return;
      const beforeText = cleanText(
        $el.parent().prevAll().text().split(/\r?\n/).slice(-5).join(" "),
      );
      const aroundText = cleanText($el.parent().text()) ?? "";
      if (beforeText && new RegExp(stopText).test(beforeText)) return;
      if (new RegExp(stopText).test(aroundText)) return;
      artistDetails.push({
        name,
        detailUrl: absoluteUrl($el.attr("href")),
      });
    });
  }

  // 장르
  const genre =
    $('[class*="genre"]').first().text().trim() ||
    $('dt:contains("장르")').next("dd").text().trim() ||
    lineAfter("장르") ||
    null;

  // 설명
  const description =
    $('[class*="description"], [class*="detail-content"], [class*="info"]')
      .first()
      .text()
      .trim() ||
    $('meta[name="description"]').attr("content")?.trim() ||
    null;

  return {
    title,
    posterUrl: posterUrl ?? null,
    venueName: cleanText(venueName),
    venueAddress: cleanText(venueAddress),
    dateRange: cleanText(dateText),
    ticketOpenDate: cleanText(ticketOpenDate),
    ticketUrl,
    ticketProvider,
    artists: Array.from(new Set(artists.filter(Boolean))),
    artistDetails: dedupArtistDetails(artistDetails, artists),
    genre: cleanText(genre),
    description: description ? description.slice(0, 2000) : null,
  };
}

export function parseArtistDetailPage(
  html: string,
  sourceUrl: string,
): StagepickArtistProfile {
  const $ = cheerio.load(html);
  const lines = $("body")
    .text()
    .split(/\r?\n/)
    .map(cleanText)
    .filter((line): line is string => Boolean(line));
  const headingTitle = $("h1").first().text().trim();
  const name =
    (headingTitle && headingTitle !== "아티스트 상세정보"
      ? headingTitle
      : null) ??
    (lines[0] === "아티스트 상세정보" ? lines[1] : null) ??
    $("title").text().split("|")[0].trim();
  const titleIndex = lines.findIndex((line) => line === name);
  const occupation =
    titleIndex >= 0 &&
    lines[titleIndex + 1] &&
    !isArtistProfileLabel(lines[titleIndex + 1])
      ? lines[titleIndex + 1]
      : null;
  const birthDateIndex = lines.findIndex((line) => line === "생년월일");
  const birthDateLine =
    birthDateIndex >= 0
      ? lines[birthDateIndex + 1]
      : lines
          .find((line) => line.startsWith("생년월일"))
          ?.replace(/^생년월일\s*/, "");
  const relatedIndex = lines.findIndex((line) => line === "소속그룹");
  const agencyIndex = lines.findIndex((line) => line === "소속사");
  const debutIndex = lines.findIndex((line) => line === "데뷔");
  const agencyLine =
    agencyIndex >= 0
      ? lines[agencyIndex + 1]
      : lines
          .find((line) => line.startsWith("소속사"))
          ?.replace(/^소속사\s*/, "");
  const debutLine =
    debutIndex >= 0
      ? lines[debutIndex + 1]
      : lines.find((line) => line.startsWith("데뷔"))?.replace(/^데뷔\s*/, "");
  const avatarUrl = absoluteUrl(
    $('meta[property="og:image"]').attr("content") ??
      $("img")
        .filter((_, el) => ($(el).attr("alt") ?? "").includes(name))
        .first()
        .attr("src"),
  );

  return {
    name: name.trim(),
    sourceUrl,
    avatarUrl,
    occupation,
    birthDate: parseKoreanDate(birthDateLine),
    related:
      relatedIndex >= 0 && lines[relatedIndex + 1]
        ? lines[relatedIndex + 1]
        : null,
    metadata: {
      englishName: titleIndex >= 0 ? (lines[titleIndex + 2] ?? null) : null,
      agency: agencyLine ?? null,
      debut: debutLine ?? null,
      sourceUrl,
    },
  };
}

function cleanText(s: string | null | undefined): string | null {
  if (!s?.trim()) return null;
  return s.replace(/\s+/g, " ").trim();
}

function cleanTitle(s: string): string {
  return s
    .replace(/\s*\(\d{4}\.\d{2}\.\d{2}\)\s*-\s*StagePick$/i, "")
    .replace(/\s*-\s*StagePick$/i, "")
    .trim();
}

function dedupArtistDetails(
  details: Array<{ name: string; detailUrl: string | null }>,
  fallbackArtists: string[],
): Array<{ name: string; detailUrl: string | null }> {
  const map = new Map<string, { name: string; detailUrl: string | null }>();
  for (const detail of details) {
    if (!map.has(detail.name)) map.set(detail.name, detail);
  }
  for (const name of fallbackArtists) {
    if (!map.has(name)) map.set(name, { name, detailUrl: null });
  }
  return Array.from(map.values());
}

function isArtistProfileLabel(value: string): boolean {
  return /^(소속사|데뷔|생년월일|소속그룹|AI 연관 아티스트|공연 목록)/.test(
    value,
  );
}

function parseKoreanDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const match = value.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function detectTicketProvider(url: string | null): string | null {
  if (!url) return null;
  if (url.includes("interpark")) return "인터파크";
  if (url.includes("melon")) return "멜론티켓";
  if (url.includes("yes24")) return "예스24";
  if (url.includes("ticketlink")) return "티켓링크";
  if (url.includes("kyobo")) return "교보문고티켓";
  if (url.includes("auction")) return "옥션티켓";
  return null;
}
