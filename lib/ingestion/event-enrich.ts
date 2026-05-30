import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";
import { matchOrCreateArtist } from "./artist-matcher";

const GENRES = [
  "뮤지컬",
  "콘서트",
  "연극",
  "전시",
  "무용",
  "클래식",
  "오페라",
  "축제",
  "기타",
] as const;

async function predictGenre(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 장르를 하나만 선택하세요. 반드시 아래 목록 중 하나만 답변하세요.
장르 목록: ${GENRES.join(", ")}
공연 제목: "${title}"
답변 (장르 이름만):`;
  try {
    const raw = await geminiText(prompt);
    return GENRES.find((g) => raw.includes(g)) ?? null;
  } catch {
    return null;
  }
}

async function predictAgeRestriction(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 관람 연령 제한을 추론하세요. 반드시 다음 중 하나만 답변하세요: "전체관람가", "12세이상", "15세이상", "18세이상", "모름"
공연 제목: "${title}"
답변 (연령제한만):`;
  try {
    const raw = await geminiText(prompt);
    const options = ["전체관람가", "12세이상", "15세이상", "18세이상"];
    return options.find((o) => raw.includes(o)) ?? null;
  } catch {
    return null;
  }
}

async function extractArtistFromTitle(title: string): Promise<string | null> {
  const prompt = `다음 공연/콘서트 제목에서 주요 아티스트(가수/그룹) 이름만 추출하세요.
아티스트 이름이 없거나 확실하지 않으면 "없음"이라고만 답변하세요.
공연 제목: "${title}"
아티스트 이름만 (없으면 "없음"):`;
  try {
    const raw = await geminiText(prompt).then((s) => s.trim());
    if (!raw || raw === "없음" || raw.length > 60) return null;
    // 따옴표, 불필요한 설명 제거
    return raw.replace(/^["'\[({]|["'\])}]$/g, "").trim() || null;
  } catch {
    return null;
  }
}

/** ai_processing_queue의 event 보강 작업 처리 */
export async function processEventEnrichmentQueue(maxItems = 20): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const db = createServiceRoleClient();

  const { data: tasks } = await db
    .from("ai_processing_queue")
    .select("id,entity_id,task_type,payload")
    .eq("entity_type", "event")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .limit(maxItems);

  if (!tasks || tasks.length === 0)
    return { processed: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await db
        .from("ai_processing_queue")
        .update({ status: "processing" })
        .eq("id", task.id);

      const eventId = task.entity_id as string;
      const taskType = task.task_type as string;

      if (taskType === "enrich_genre") {
        const { data: event } = await db
          .from("events")
          .select("title,genre")
          .eq("id", eventId)
          .maybeSingle();
        if (event && !event.genre) {
          const genre = await predictGenre(event.title);
          if (genre)
            await db.from("events").update({ genre }).eq("id", eventId);
        }
      } else if (taskType === "enrich_age") {
        const { data: event } = await db
          .from("events")
          .select("title,age_restriction")
          .eq("id", eventId)
          .maybeSingle();
        if (event && !event.age_restriction) {
          const age = await predictAgeRestriction(event.title);
          if (age)
            await db
              .from("events")
              .update({ age_restriction: age })
              .eq("id", eventId);
        }
      } else if (taskType === "enrich_artist") {
        const { data: event } = await db
          .from("events")
          .select("title,artist_id")
          .eq("id", eventId)
          .maybeSingle();
        if (event && !event.artist_id) {
          const artistName = await extractArtistFromTitle(event.title);
          if (artistName) {
            const artistId = await matchOrCreateArtist(artistName);
            if (artistId) {
              await db
                .from("events")
                .update({ artist_id: artistId })
                .eq("id", eventId);
              await db.from("event_artists").upsert(
                {
                  event_id: eventId,
                  artist_id: artistId,
                  artist_name: artistName,
                  role: "main",
                  display_order: 1,
                },
                { onConflict: "event_id,artist_id", ignoreDuplicates: true },
              );
            }
          }
        }
      }

      await db
        .from("ai_processing_queue")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("id", task.id);
      succeeded++;
    } catch (e) {
      await db
        .from("ai_processing_queue")
        .update({
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          processed_at: new Date().toISOString(),
        })
        .eq("id", task.id);
      failed++;
    }
  }

  return { processed: tasks.length, succeeded, failed };
}

/** 보강이 필요한 이벤트를 큐에 등록 */
export async function queueEventEnrichment(): Promise<{ queued: number }> {
  const db = createServiceRoleClient();
  let queued = 0;

  // genre/age_restriction 없는 이벤트
  const { data: events } = await db
    .from("events")
    .select("id,title,genre,age_restriction,artist_id")
    .or("genre.is.null,age_restriction.is.null,artist_id.is.null")
    .limit(500);

  for (const event of events ?? []) {
    const tasks: { task_type: string; field: string; priority: number }[] = [];
    if (!event.genre)
      tasks.push({ task_type: "enrich_genre", field: "genre", priority: 1 });
    if (!event.age_restriction)
      tasks.push({
        task_type: "enrich_age",
        field: "age_restriction",
        priority: 1,
      });
    if (!event.artist_id)
      tasks.push({
        task_type: "enrich_artist",
        field: "artist_id",
        priority: 2,
      });

    for (const t of tasks) {
      // pending/processing이면 skip, done/failed면 pending으로 리셋(upsert)
      const { count: activeCount } = await db
        .from("ai_processing_queue")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", event.id)
        .eq("task_type", t.task_type)
        .in("status", ["pending", "processing"]);
      if ((activeCount ?? 0) > 0) continue;

      const { error } = await db.from("ai_processing_queue").upsert(
        {
          entity_type: "event",
          entity_id: event.id,
          task_type: t.task_type,
          field_name: t.field,
          status: "pending",
          priority: t.priority,
          processed_at: null,
          error: null,
        },
        { onConflict: "entity_id,task_type" },
      );
      if (!error) queued++;
    }
  }

  return { queued };
}
