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
  genre: string | null;
  description: string | null;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cards: ReturnType<typeof $> = $([] as any);
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

  const title =
    $("h1").first().text().trim() ||
    $('[class*="title"]').first().text().trim() ||
    $("title").text().split("|")[0].trim();

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
      .trim();

  // 공연장 추출
  const venueName =
    $('[class*="venue"], [class*="location"], [class*="place"]')
      .first()
      .text()
      .trim() ||
    $('dt:contains("장소"), dt:contains("공연장")').next("dd").text().trim() ||
    null;

  const venueAddress =
    $('[class*="address"]').first().text().trim() ||
    $('dt:contains("주소")').next("dd").text().trim() ||
    null;

  // 티켓 오픈일
  const ticketOpenDate =
    $('[class*="ticket-open"], [class*="ticketopen"]').first().text().trim() ||
    $('dt:contains("티켓오픈"), dt:contains("예매오픈")')
      .next("dd")
      .text()
      .trim() ||
    null;

  // 티켓 링크
  const ticketLink = $(
    'a[href*="ticket"], a[href*="interpark"], a[href*="melon"], a[href*="yes24"]',
  ).first();
  const ticketUrl = absoluteUrl(ticketLink.attr("href")) ?? null;
  const ticketProvider =
    detectTicketProvider(ticketUrl) ?? (ticketLink.text().trim() || null);

  // 아티스트 목록
  const artists: string[] = [];
  $('[class*="artist"], [class*="lineup"], [class*="performer"]').each(
    (_, el) => {
      const name = $(el).text().trim();
      if (name && name.length > 0 && name.length < 60) artists.push(name);
    },
  );

  // 장르
  const genre =
    $('[class*="genre"]').first().text().trim() ||
    $('dt:contains("장르")').next("dd").text().trim() ||
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
    genre: cleanText(genre),
    description: description ? description.slice(0, 2000) : null,
  };
}

function cleanText(s: string | null | undefined): string | null {
  if (!s?.trim()) return null;
  return s.replace(/\s+/g, " ").trim();
}

function detectTicketProvider(url: string | null): string | null {
  if (!url) return null;
  if (url.includes("interpark")) return "인터파크";
  if (url.includes("melon")) return "멜론티켓";
  if (url.includes("yes24")) return "예스24";
  if (url.includes("ticketlink")) return "티켓링크";
  if (url.includes("stagepick")) return "스테이지픽";
  return null;
}
