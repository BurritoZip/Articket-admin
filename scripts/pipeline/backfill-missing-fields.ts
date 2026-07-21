/**
 * 결손 필드 일괄 백필 — 크롤 재방문이 닿지 않는 과거 코호트를 결정론적으로 메운다.
 *
 * 왜 필요한가: 스크래퍼는 목록 상위 N건(기본 200)만 재방문하므로, 목록에서 밀려난 이벤트는
 * 코드가 고쳐져도 영원히 갱신되지 않는다. 실제로 아래가 남아 있었다:
 *   - booking_url  : NormalizedEvent 에 ticketUrl 필드가 없어 배선이 끊겨 있었음(신규 0%)
 *   - ticket_provider : 스크래퍼가 상수로 박지만 그 코드 이전 생성분은 비어 있음(melon 5%)
 *   - event_venues : venue_id 는 있는데 조인 테이블이 비어 다대다 조회가 깨짐(23%)
 *   - end_date     : festivallife 5월 코호트 파서 버그 잔재(22%)
 *
 * 전부 **fill-only** — 기존 값은 절대 덮지 않는다. Gemini 를 쓰지 않아 비용 0.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-missing-fields.ts        # 미리보기
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-missing-fields.ts --apply
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";

const APPLY = process.argv.includes("--apply");

/** 예매처 호스트 → ticket_provider 값 */
const PROVIDER_BY_HOST: [RegExp, string][] = [
  [/(^|\.)ticket\.melon\.com$/i, "melon"],
  [/(^|\.)ticket\.interpark\.com$/i, "interpark"],
  [/(^|\.)tickets\.interpark\.com$/i, "interpark"],
  [/(^|\.)ticket\.yes24\.com$/i, "yes24"],
  [/(^|\.)nol\.yanolja\.com$/i, "yanolja"],
];

/** source_urls 는 문자열 배열 / {url} 객체 배열이 섞여 있다 */
function urlsOf(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) out.push(item);
    else if (item && typeof item === "object") {
      const u = (item as { url?: unknown }).url;
      if (typeof u === "string" && /^https?:\/\//i.test(u)) out.push(u);
    }
  }
  return out;
}

function providerOf(urls: string[]): string | null {
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    for (const [re, name] of PROVIDER_BY_HOST) if (re.test(host)) return name;
  }
  return null;
}

/** 예매 페이지로 쓸 만한 URL — 예매처 도메인인 것만 */
function bookingUrlOf(urls: string[]): string | null {
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    if (PROVIDER_BY_HOST.some(([re]) => re.test(host))) return u;
  }
  return null;
}

type Row = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  venue_id: string | null;
  booking_url: string | null;
  ticket_provider: string | null;
  source_urls: unknown;
};

async function main() {
  const db = createServiceRoleClient();

  // 1) events 전량 조회
  const rows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("events")
      .select(
        "id,start_date,end_date,venue_id,booking_url,ticket_provider,source_urls",
      )
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // 2) event_venues 기존 링크 수집 (중복 삽입 방지)
  const linked = new Set<string>();
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("event_venues")
      .select("event_id")
      .range(f, f + 999);
    if (!data?.length) break;
    for (const r of data) linked.add(String((r as { event_id: string }).event_id));
    if (data.length < 1000) break;
  }

  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  const venueLinks: { event_id: string; venue_id: string; display_order: number }[] =
    [];
  const counts = {
    booking_url: 0,
    ticket_provider: 0,
    end_date: 0,
    event_venues: 0,
  };

  for (const r of rows) {
    const urls = urlsOf(r.source_urls);
    const patch: Record<string, unknown> = {};

    if (!r.booking_url) {
      const b = bookingUrlOf(urls);
      if (b) {
        patch.booking_url = b;
        counts.booking_url++;
      }
    }
    if (!r.ticket_provider) {
      const p = providerOf(urls);
      if (p) {
        patch.ticket_provider = p;
        counts.ticket_provider++;
      }
    }
    // 단일 날짜 공연은 end_date = start_date (파서가 그렇게 동작하도록 이미 고쳐져 있다)
    if (!r.end_date && r.start_date) {
      patch.end_date = r.start_date;
      counts.end_date++;
    }

    if (Object.keys(patch).length) patches.push({ id: r.id, patch });

    if (r.venue_id && !linked.has(r.id)) {
      venueLinks.push({ event_id: r.id, venue_id: r.venue_id, display_order: 0 });
      counts.event_venues++;
    }
  }

  console.log(`events 조회: ${rows.length}건`);
  console.log("채울 대상:", counts);

  if (!APPLY) {
    console.log("\n미리보기 모드. 실제 적용하려면 --apply 를 붙여 다시 실행.");
    return;
  }

  let updated = 0;
  for (const { id, patch } of patches) {
    const { error } = await db.from("events").update(patch).eq("id", id);
    if (error) console.warn(`  update 실패 ${id}: ${error.message}`);
    else updated++;
  }

  let linksInserted = 0;
  for (let i = 0; i < venueLinks.length; i += 500) {
    const chunk = venueLinks.slice(i, i + 500);
    const { error } = await db.from("event_venues").insert(chunk);
    if (error) console.warn(`  event_venues 삽입 실패: ${error.message}`);
    else linksInserted += chunk.length;
  }

  console.log(`\n적용 완료 — events ${updated}건, event_venues ${linksInserted}건`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
