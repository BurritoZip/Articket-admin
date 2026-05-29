import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";

const GENRES = ["뮤지컬", "콘서트", "연극", "전시", "무용", "클래식", "오페라", "축제", "기타"] as const;

async function predictGenre(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 장르를 하나만 선택하세요. 반드시 아래 목록 중 하나만 답변하세요.
장르 목록: ${GENRES.join(", ")}
공연 제목: "${title}"
답변 (장르 이름만):`;

  try {
    const raw = await geminiText(prompt);
    const matched = GENRES.find((g) => raw.includes(g));
    return matched ?? null;
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
    const matched = options.find((o) => raw.includes(o));
    return matched ?? null;
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

  if (!tasks || tasks.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

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
          if (genre) {
            await db.from("events").update({ genre }).eq("id", eventId);
          }
        }
      } else if (taskType === "enrich_age") {
        const { data: event } = await db
          .from("events")
          .select("title,age_restriction")
          .eq("id", eventId)
          .maybeSingle();

        if (event && !event.age_restriction) {
          const age = await predictAgeRestriction(event.title);
          if (age) {
            await db.from("events").update({ age_restriction: age }).eq("id", eventId);
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

  const { data: events } = await db
    .from("events")
    .select("id,title,genre,age_restriction")
    .or("genre.is.null,age_restriction.is.null")
    .limit(500);

  for (const event of events ?? []) {
    const tasks: { task_type: string; field: string }[] = [];
    if (!event.genre) tasks.push({ task_type: "enrich_genre", field: "genre" });
    if (!event.age_restriction) tasks.push({ task_type: "enrich_age", field: "age_restriction" });

    for (const t of tasks) {
      const { error } = await db.from("ai_processing_queue").upsert(
        {
          entity_type: "event",
          entity_id: event.id,
          task_type: t.task_type,
          field_name: t.field,
          status: "pending",
          priority: 1,
        },
        {
          onConflict: "entity_id,task_type",
          ignoreDuplicates: true,
        },
      );
      if (!error) queued++;
    }
  }

  return { queued };
}
