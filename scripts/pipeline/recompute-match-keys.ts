/**
 * dedup_key 재계산 + 기존 중복 collapse. dedup_key 가 UNIQUE 라 "흡수(삭제) → 생존 행 키 세팅" 순서.
 * 실행: npx tsx scripts/pipeline/recompute-match-keys.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import type { Ev } from "../../lib/ingestion/event-auto-merge";

for (const line of readFileSync(
  resolve(process.cwd(), ".env.local"),
  "utf8",
).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k])
      process.env[k] = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

// pickCanonical/infoScore 가 읽는 전체 컬럼 + dedup_key(이 스크립트 전용).
type Row = Ev & { dedup_key: string | null };

async function main() {
  if (process.argv.includes("--check")) {
    const { eventDedupKey } = await import("../../lib/ingestion/match-key");
    assert.equal(
      eventDedupKey("공연", null, "2026-01-01"),
      eventDedupKey("공연", null, "2026-01-01"),
      "null venue stable",
    );
    // null venue 와 명명된 venue 는 서로 다른 키여야 한다(둘 다 "unknown"으로 뭉개지면 안 됨).
    assert.notEqual(
      eventDedupKey("공연", null, "2026-01-01"),
      eventDedupKey("공연", "somevenue", "2026-01-01"),
      "null venue differs from named venue",
    );
    console.log("recompute self-check OK");
    return;
  }

  const dry = process.argv.includes("--dry");
  const { createServiceRoleClient } =
    await import("../../lib/supabase/service-role");
  const { eventDedupKey } = await import("../../lib/ingestion/match-key");
  const db = createServiceRoleClient();

  // 활성 이벤트 fetch — pickCanonical/infoScore 가 읽는 전체 컬럼 + dedup_key.
  const all: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select(
        "id,title,normalized_title,start_date,end_date,artist_id,venue_id,poster_url,genre,age_restriction,ticket_open_date,ticket_provider,notice_text,booking_url,source_urls,created_at,dedup_key",
      )
      .is("merged_into_event_id", null)
      .eq("is_hidden", false)
      .range(f, f + 999);
    if (!data?.length) break;
    all.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // 공연장 정규화명 조회(키 계산용). NULL 은 그대로 보존 — eventDedupKey 의 "unknown"
  // 폴백은 null/undefined 에서만 발동하고 "" 에서는 발동하지 않는다("" ?? "unknown" === "").
  // 여기서 ?? "" 로 뭉개면 NULL-name venue 가 "" 세그먼트를 받아 ingest 와 어긋나고,
  // 서로 다른 NULL-name venue 들이 잘못 병합될 수 있다.
  const vname = new Map<string, string | null>();
  const venueIds = Array.from(
    new Set(all.map((e) => e.venue_id).filter(Boolean)),
  ) as string[];
  for (let i = 0; i < venueIds.length; i += 500) {
    const { data } = await db
      .from("venues")
      .select("id,normalized_name")
      .in("id", venueIds.slice(i, i + 500));
    for (const v of (data as {
      id: string;
      normalized_name: string | null;
    }[]) ?? [])
      vname.set(v.id, v.normalized_name);
  }

  // 새 키로 그룹핑(미리보기/요약용 — 실제 collapse 는 lib 의 collapseByStrongKey 가 재계산해서 한다)
  const groups = new Map<string, Row[]>();
  for (const e of all) {
    const key = eventDedupKey(
      e.title,
      e.venue_id ? (vname.get(e.venue_id) ?? null) : null,
      e.start_date,
    );
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const dupGroups = Array.from(groups.entries()).filter(
    ([, g]) => g.length > 1,
  );
  console.log(
    `이벤트 ${all.length}, 새 키 그룹 ${groups.size}, 중복 그룹 ${dupGroups.length}, 흡수 예정 ${dupGroups.reduce((n, [, g]) => n + g.length - 1, 0)}`,
  );

  if (dry) {
    for (const [key, g] of dupGroups.slice(0, 40)) {
      console.log(`\n[${key.slice(0, 10)}]`);
      for (const e of g)
        console.log(
          `  "${e.title.slice(0, 45)}" ${e.start_date?.slice(0, 10)} v=${e.venue_id?.slice(0, 8)}`,
        );
    }
    console.log("\n(--dry. 적용하려면 --dry 없이)");
    return;
  }

  // canonical 선정 + 흡수 + 생존 행 키 세팅 — lib/ingestion/event-auto-merge 의
  // collapseByStrongKey() 로 위임(파이프라인 pass0 와 동일 로직, 중복 구현 금지).
  const { collapseByStrongKey } =
    await import("../../lib/ingestion/event-auto-merge");
  const { collapsed } = await collapseByStrongKey();

  // 단일 그룹(중복 아님)도 키 갱신
  let keyed = 0;
  for (const [key, g] of Array.from(groups)) {
    if (g.length !== 1) continue;
    if (g[0].dedup_key === key) continue;
    await db.from("events").update({ dedup_key: key }).eq("id", g[0].id);
    keyed++;
  }
  console.log(`\n흡수 ${collapsed}, 키 갱신 ${keyed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
