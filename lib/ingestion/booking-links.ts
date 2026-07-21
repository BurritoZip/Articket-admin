/**
 * 예매처 선택지 정제 — source_urls 에서 예매처 링크만 뽑아 [{provider, url}] 로.
 *
 * 같은 공연이 여러 예매처에서 팔리는 건 중복이 아니라 사용자 선택지다. dedup 이 소스를 합치며
 * source_urls 에 모든 예매처 URL 을 보존하지만, 형식이 지저분하고(문자열/객체 혼합, aggregator·
 * 가짜 URL 섞임) 앱 노출용이 아니다. 이 함수가 예매 가능한 링크만 정제한다.
 */

/** 배열 순서 = 앱 표시 우선순위 */
const PROVIDERS: { re: RegExp; provider: string; label: string }[] = [
  { re: /tickets?\.interpark\.com\/goods/i, provider: "interpark", label: "인터파크" },
  { re: /ticket\.yes24\.com/i, provider: "yes24", label: "YES24" },
  { re: /ticket\.melon\.com/i, provider: "melon", label: "멜론티켓" },
  // yanolja 는 예매 상품 페이지(products)만. places 는 공연장 페이지라 제외.
  { re: /nol\.yanolja\.com\/ticket\/products/i, provider: "yanolja", label: "놀(야놀자)" },
  { re: /klook\.com/i, provider: "klook", label: "클룩" },
];

export interface BookingLink {
  provider: string;
  label: string;
  url: string;
}

function providerOf(url: string): { provider: string; label: string } | null {
  for (const p of PROVIDERS) if (p.re.test(url)) return { provider: p.provider, label: p.label };
  return null;
}

/** source_urls(문자열/{url,site} 혼합) → URL 문자열 배열 */
function urlStrings(sourceUrls: unknown): string[] {
  if (!Array.isArray(sourceUrls)) return [];
  const out: string[] = [];
  for (const item of sourceUrls) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) out.push(item);
    else if (item && typeof item === "object") {
      const u = (item as { url?: unknown }).url;
      if (typeof u === "string" && /^https?:\/\//i.test(u)) out.push(u);
    }
  }
  return out;
}

/**
 * 예매처 선택지 추출. provider 당 첫 URL 1개, PROVIDERS 순서로 정렬.
 * bookingUrl(대표 예매 링크)도 후보에 포함한다.
 */
export function extractBookingLinks(
  sourceUrls: unknown,
  bookingUrl?: string | null,
): BookingLink[] {
  const urls = [...urlStrings(sourceUrls)];
  if (bookingUrl && /^https?:\/\//i.test(bookingUrl)) urls.unshift(bookingUrl);

  const seen = new Map<string, string>(); // provider -> url
  for (const url of urls) {
    const hit = providerOf(url);
    if (hit && !seen.has(hit.provider)) seen.set(hit.provider, url);
  }
  // PROVIDERS 순서대로
  return PROVIDERS.filter((p) => seen.has(p.provider)).map((p) => ({
    provider: p.provider,
    label: p.label,
    url: seen.get(p.provider)!,
  }));
}
