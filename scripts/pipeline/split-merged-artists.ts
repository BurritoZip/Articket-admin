import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { matchOrCreateArtist } from "../../lib/ingestion/artist-matcher";

// 합쳐진 아티스트 레코드("선우정아 X 적재")를 개별로 분리 → event_artists 다중 재연결 → 고아 삭제.
// 기본 dry-run. 실제 적용: `--apply` 인자.
const APPLY = process.argv.includes("--apply");

// 분리 구분자 (공백 포함 X/&/feat/with/vs, 콤마). "양파X존박" 같은 공백없는 X는 오분리 위험이라 제외.
const SPLIT_RE = /\s+(?:[xX×]|&|feat\.?|with|vs\.?)\s+|\s*[,、]\s*/i;
const MULTI_RE = /\s[xX×]\s|\s&\s|,\s|\sfeat\.?\s|\swith\s|\svs\.?\s/i;

async function main() {
  const db = createServiceRoleClient();

  // 합쳐진 레코드 수집
  const bad: { id: string; name: string }[] = [];
  let from = 0;
  for (;;) {
    const { data } = await db.from("artists").select("id,name").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const a of data) if (MULTI_RE.test(a.name)) bad.push(a);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`합쳐진 레코드 ${bad.length}건 (apply=${APPLY})\n`);

  let split = 0;
  let skipped = 0;
  let deleted = 0;

  for (const a of bad) {
    const names = a.name
      .split(SPLIT_RE)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (names.length < 2) {
      skipped++;
      continue;
    }

    console.log(`"${a.name}" → ${JSON.stringify(names)}`);
    if (!APPLY) {
      split++;
      continue;
    }

    // 개별 아티스트 매칭/생성
    const ids: { id: string; name: string }[] = [];
    for (const nm of names) {
      const id = await matchOrCreateArtist(nm).catch(() => null);
      if (id && !ids.some((x) => x.id === id)) ids.push({ id, name: nm });
    }
    if (ids.length < 2) {
      skipped++;
      continue;
    }

    // a가 연결된 이벤트들 → 개별 아티스트로 재연결
    const { data: eas } = await db
      .from("event_artists")
      .select("id,event_id")
      .eq("artist_id", a.id);
    for (const ea of eas ?? []) {
      await db.from("event_artists").upsert(
        ids.map((m, i) => ({
          event_id: ea.event_id,
          artist_id: m.id,
          artist_name: m.name,
          role: i === 0 ? "main" : "lineup",
          display_order: i + 1,
        })),
        { onConflict: "event_id,artist_id", ignoreDuplicates: true },
      );
      await db.from("event_artists").delete().eq("id", ea.id);
    }

    // FK 재지정 (대표 = 첫 번째)
    await db.from("events").update({ artist_id: ids[0].id }).eq("artist_id", a.id);
    await db
      .from("timetable_performances")
      .update({ artist_id: ids[0].id })
      .eq("artist_id", a.id);

    // 고아 레코드 삭제
    const { error } = await db.from("artists").delete().eq("id", a.id);
    if (error) {
      console.log(`  ⚠️ 삭제 실패(FK 잔존): ${a.name} — ${error.message}`);
      skipped++;
    } else {
      deleted++;
    }
    split++;
  }

  console.log(
    `\n=== ${APPLY ? "적용" : "DRY-RUN"} 완료 ===\n분리대상 ${split} / 건너뜀 ${skipped} / 삭제 ${deleted}`,
  );
  if (!APPLY) console.log("실제 적용: --apply 인자 추가");
}
main().catch(console.error);
