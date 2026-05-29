/**
 * venue 데이터 정리 (배치 최적화):
 * 1. 예매하기 포함 쓰레기 venue → 실제 venue명 추출 → 그룹별 일괄 재연결 → 일괄 삭제
 * 2. 세부홀 포함 venue → canonical venue로 병합
 *
 * 실행: npx tsx scripts/pipeline/venue-cleanup.ts [--dry-run]
 */

import { createServiceRoleClient } from "../../lib/supabase/service-role";

const DRY_RUN = process.argv.includes("--dry-run");
const db = createServiceRoleClient();

// 이미 처리된 venue 캐시 (name → id)
const venueCache = new Map<string, string>();

async function findOrCreate(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return null;
  if (venueCache.has(trimmed)) return venueCache.get(trimmed)!;

  const { data: rows } = await db.from("venues")
    .select("id, name")
    .ilike("name", trimmed)
    .not("name", "ilike", "%예매하기%")
    .limit(1);

  if (rows?.[0]) {
    venueCache.set(trimmed, rows[0].id);
    return rows[0].id;
  }
  if (DRY_RUN) return "DRY_RUN_ID";

  const { data: created } = await db.from("venues")
    .insert({ name: trimmed, address: "", phone_number: "" })
    .select("id")
    .single();

  if (created?.id) {
    venueCache.set(trimmed, created.id);
    return created.id;
  }
  return null;
}

async function main() {
  console.log(`\n=== venue 정리 ${DRY_RUN ? "(dry-run)" : "(실제 실행)"} ===\n`);

  // ── 1. 쓰레기 venue 일괄 처리 ─────────────────────────────────────
  const { data: trashVenues } = await db.from("venues")
    .select("id, name")
    .ilike("name", "%예매하기%");

  console.log(`[쓰레기 venue] ${trashVenues?.length ?? 0}개 처리 시작...`);

  // 실제 venue명별로 그룹화
  const groups = new Map<string, string[]>(); // realName → [trashId, ...]
  for (const v of trashVenues ?? []) {
    const realName = v.name.split(/예매하기/)[0].trim();
    if (!groups.has(realName)) groups.set(realName, []);
    groups.get(realName)!.push(v.id);
  }

  let trashFixed = 0, trashNulled = 0;

  for (const [realName, trashIds] of groups) {
    const toId = realName.length >= 2 ? await findOrCreate(realName) : null;

    if (!DRY_RUN) {
      // 이벤트 일괄 재연결
      await db.from("events")
        .update({ venue_id: toId })
        .in("venue_id", trashIds);
      // event_venues 일괄 삭제
      await db.from("event_venues").delete().in("venue_id", trashIds);
      // trash venues 일괄 삭제
      await db.from("venues").delete().in("id", trashIds);
    }

    if (toId) {
      console.log(`  "${realName}" (${trashIds.length}개 venue → 재연결 OK)`);
      trashFixed += trashIds.length;
    } else {
      console.log(`  "${realName}" (${trashIds.length}개 venue → venue_id=null)`);
      trashNulled += trashIds.length;
    }
  }

  console.log(`  → 재연결: ${trashFixed}개, venue null: ${trashNulled}개\n`);

  // ── 2. 세부홀 venue 병합 ─────────────────────────────────────────────
  const MERGE_MAP: Array<{ pattern: RegExp; canonical: string }> = [
    { pattern: /킨텍스/i, canonical: "킨텍스" },
    { pattern: /벡스코|bexco/i, canonical: "BEXCO" },
    { pattern: /올림픽공원/i, canonical: "올림픽공원" },
    { pattern: /올림픽체조경기장|kspo\s*dome/i, canonical: "KSPO DOME" },
    { pattern: /잠실종합운동장|잠실주경기장/i, canonical: "잠실종합운동장" },
    { pattern: /세종문화회관/i, canonical: "세종문화회관" },
    { pattern: /예술의전당/i, canonical: "예술의전당" },
    { pattern: /고양아람누리|아람누리/i, canonical: "고양아람누리" },
    { pattern: /성남아트리움/i, canonical: "성남아트리움" },
    { pattern: /경기아트센터/i, canonical: "경기아트센터" },
    { pattern: /lg아트센터/i, canonical: "LG아트센터 서울" },
    { pattern: /yes24.*live|예스24.*라이브/i, canonical: "YES24 LIVE HALL" },
  ];

  const SUB_SUFFIX =
    /(대극장|소극장|중극장|블랙박스|제\d+전시장|제\d+관|\d+홀|\d+번홀|야외광장|후면광장)/i;

  const { data: allVenues } = await db.from("venues")
    .select("id, name")
    .not("name", "ilike", "%예매하기%");

  console.log(`[세부홀 병합]`);
  let merged = 0;

  for (const v of allVenues ?? []) {
    if (!SUB_SUFFIX.test(v.name)) continue;
    const target = MERGE_MAP.find((m) => m.pattern.test(v.name));
    if (!target) continue;
    if (v.name.toLowerCase() === target.canonical.toLowerCase()) continue;

    const toId = await findOrCreate(target.canonical);
    if (!toId) continue;

    console.log(`  "${v.name}" → "${target.canonical}"`);

    if (!DRY_RUN) {
      await db.from("events").update({ venue_id: toId }).eq("venue_id", v.id);
      await db.from("event_venues").update({ venue_id: toId }).eq("venue_id", v.id);
      await db.from("venues").delete().eq("id", v.id);
    }
    merged++;
  }

  console.log(`  → ${merged}개 병합\n`);
  console.log("=== 완료 ===");
}

main().catch(console.error);
