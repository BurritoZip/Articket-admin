/**
 * enrich_artist 큐 등록 + 처리 단독 테스트 (최대 5개만)
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { geminiText } from "../../lib/gemini";
import { matchOrCreateArtist } from "../../lib/ingestion/artist-matcher";

async function main() {
  const db = createServiceRoleClient();

  // artist_id 없는 이벤트 5개
  const { data: events } = await db.from("events")
    .select("id,title,artist_id")
    .is("artist_id", null)
    .not("status", "eq", "ended")
    .limit(5);

  console.log(`\n대상 이벤트 ${events?.length ?? 0}개`);

  for (const event of events ?? []) {
    console.log(`\n제목: "${event.title}"`);

    // 1. 큐 upsert 테스트
    const { error: upsertErr } = await db.from("ai_processing_queue").upsert(
      {
        entity_type: "event",
        entity_id: event.id,
        task_type: "enrich_artist",
        field_name: "artist_id",
        status: "pending",
        priority: 2,
        processed_at: null,
        error: null,
      },
      { onConflict: "entity_id,task_type" },
    );
    console.log(`  큐 upsert: ${upsertErr ? `실패 — ${upsertErr.message}` : "성공"}`);

    // 2. Gemini 추출 테스트
    const prompt = `다음 공연/콘서트 제목에서 주요 아티스트(가수/그룹) 이름만 추출하세요. 아티스트 이름이 없거나 확실하지 않으면 "없음"이라고만 답변하세요.\n공연 제목: "${event.title}"\n아티스트 이름만 (없으면 "없음"):`;
    const geminiResult = await geminiText(prompt).then(s => s.trim()).catch(e => `ERROR: ${e.message}`);
    console.log(`  Gemini 결과: "${geminiResult}"`);

    // 3. 아티스트 매칭 테스트 (없음 아닌 경우)
    if (geminiResult && geminiResult !== "없음" && !geminiResult.startsWith("ERROR")) {
      const artistId = await matchOrCreateArtist(geminiResult).catch(() => null);
      console.log(`  matchOrCreate: ${artistId ? `성공 (${artistId})` : "실패"}`);
      if (artistId) {
        await db.from("events").update({ artist_id: artistId }).eq("id", event.id);
        console.log(`  ✓ artist_id 업데이트 완료`);
      }
    }
  }

  // 최종 큐 상태
  const { data: queueRows } = await db.from("ai_processing_queue")
    .select("entity_id,task_type,status")
    .eq("task_type", "enrich_artist")
    .limit(10);
  console.log(`\n큐 enrich_artist 현황: ${queueRows?.length ?? 0}개`);
  for (const r of queueRows ?? []) console.log(`  ${r.entity_id.slice(0,8)} → ${r.status}`);
}
main().catch(console.error);
