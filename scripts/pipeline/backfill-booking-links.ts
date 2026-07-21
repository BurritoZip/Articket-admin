/**
 * booking_links 백필 — 기존 이벤트의 source_urls 에서 예매처 선택지를 정제해 채운다.
 *
 * 실측 62건이 2곳 이상 예매처를 가졌지만 booking_url 단일 컬럼이라 선택지가 앱에서 안 보였다.
 * source_urls 에는 이미 모든 예매처 URL 이 있으므로 재파싱만으로 복구된다(비용 0, fill/replace).
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-booking-links.ts        # 미리보기
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-booking-links.ts --apply
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { extractBookingLinks } from "../../lib/ingestion/booking-links";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = createServiceRoleClient();
  const rows: {
    id: string;
    source_urls: unknown;
    booking_url: string | null;
    booking_links: unknown;
  }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("events")
      .select("id,source_urls,booking_url,booking_links")
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }

  const updates: { id: string; links: ReturnType<typeof extractBookingLinks> }[] =
    [];
  const dist: Record<number, number> = {};
  for (const r of rows) {
    const links = extractBookingLinks(r.source_urls, r.booking_url);
    dist[links.length] = (dist[links.length] ?? 0) + 1;
    if (JSON.stringify(links) !== JSON.stringify(r.booking_links ?? []))
      updates.push({ id: r.id, links });
  }

  console.log(`이벤트 ${rows.length}건 스캔`);
  console.log("예매처 수 분포:", dist);
  console.log(
    `2곳 이상 선택지 보유: ${Object.entries(dist)
      .filter(([k]) => Number(k) >= 2)
      .reduce((n, [, v]) => n + v, 0)}건`,
  );
  console.log(`갱신 대상: ${updates.length}건`);

  if (!APPLY) {
    console.log("\n미리보기. --apply 로 적용.");
    return;
  }
  let done = 0;
  for (const u of updates) {
    const { error } = await db
      .from("events")
      .update({ booking_links: u.links })
      .eq("id", u.id);
    if (!error) done++;
    else console.warn(`  실패 ${u.id}: ${error.message}`);
  }
  console.log(`\n적용 완료: ${done}/${updates.length}`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
