import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";
import { PRICE_RE, TICKET_GRADE_RE, DATE_RE, URL_RE } from "./patterns";

export interface DeleteLog {
  entityType: "venue" | "artist" | "event";
  entityId: string;
  entityTitle: string;
  reason: string;
  method: "rule" | "gemini";
}

export interface AutoDeleteResult {
  deleted: number;
  details: DeleteLog[];
}

function isNamePureGarbage(name: string): boolean {
  const stripped = name
    .replace(PRICE_RE, "")
    .replace(TICKET_GRADE_RE, "")
    .replace(DATE_RE, "")
    .replace(/[\s\-·_,]+/g, "")
    .trim();
  return stripped.length <= 1;
}

function isNamePureUrl(name: string): boolean {
  return (
    URL_RE.test(name) &&
    name.replace(URL_RE, "").replace(/\S+/g, "").trim().length === 0
  );
}

async function geminiDeleteDecision(
  items: Array<{ id: string; label: string }>,
  entityType: string,
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const lines = items
    .map((it, i) => `${i}|id=${it.id}|값="${it.label}"`)
    .join("\n");
  const prompt = `다음 ${entityType} 데이터 목록을 검토해주세요.
각 항목이 DB에서 삭제해야 할 쓰레기 데이터인지 판단하세요.
삭제 기준: 이름/제목이 의미 없는 숫자, 가격, 날짜, URL, 기호만으로 구성됨.

${lines}

삭제해야 할 항목의 인덱스만 JSON 배열로 반환: [0, 3, 5, ...]
삭제 불필요하면 빈 배열: []`;

  try {
    const raw = await geminiText(prompt);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const indices = JSON.parse(cleaned) as number[];
    return new Set(indices.map((i) => items[i]?.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function runDataQualityAutoDelete(opts: {
  dryRun?: boolean;
}): Promise<AutoDeleteResult> {
  const db = createServiceRoleClient();
  const dryRun = opts.dryRun ?? false;
  const logs: DeleteLog[] = [];

  async function deleteEntity(
    table: string,
    type: DeleteLog["entityType"],
    id: string,
    title: string,
    reason: string,
    method: DeleteLog["method"],
  ) {
    logs.push({
      entityType: type,
      entityId: id,
      entityTitle: title,
      reason,
      method,
    });
    if (!dryRun) {
      await db.from(table).delete().eq("id", id);
      await db.from("data_quality_fix_logs").insert({
        entity_type: type,
        entity_id: id,
        field_name: "row",
        issue_type: reason,
        old_value: title,
        new_value: null,
        fix_method: "deleted",
      });
    }
  }

  // ── Venues ────────────────────────────────────────────────────────
  const { data: venues } = await db
    .from("venues")
    .select("id,name")
    .limit(2000);
  const venueGeminiCandidates: Array<{ id: string; label: string }> = [];

  for (const v of venues ?? []) {
    const { id, name } = v as { id: string; name: string };
    if (isNamePureGarbage(name)) {
      await deleteEntity(
        "venues",
        "venue",
        id,
        name,
        "venue_name_pure_garbage",
        "rule",
      );
    } else if (
      PRICE_RE.test(name) ||
      TICKET_GRADE_RE.test(name) ||
      DATE_RE.test(name)
    ) {
      venueGeminiCandidates.push({ id, label: name });
    }
  }

  const venueGeminiDelete = await geminiDeleteDecision(
    venueGeminiCandidates.slice(0, 50),
    "공연장",
  );
  for (const c of venueGeminiCandidates.slice(0, 50)) {
    if (venueGeminiDelete.has(c.id)) {
      await deleteEntity(
        "venues",
        "venue",
        c.id,
        c.label,
        "gemini_venue_garbage",
        "gemini",
      );
    }
  }

  // ── Artists ───────────────────────────────────────────────────────
  const { data: artists } = await db
    .from("artists")
    .select("id,name")
    .limit(10000);
  const artistGeminiCandidates: Array<{ id: string; label: string }> = [];

  for (const a of artists ?? []) {
    const { id, name } = a as { id: string; name: string };
    if (isNamePureUrl(name)) {
      await deleteEntity(
        "artists",
        "artist",
        id,
        name,
        "artist_name_pure_url",
        "rule",
      );
    } else if (URL_RE.test(name)) {
      artistGeminiCandidates.push({ id, label: name });
    }
  }

  const artistGeminiDelete = await geminiDeleteDecision(
    artistGeminiCandidates.slice(0, 50),
    "아티스트",
  );
  for (const c of artistGeminiCandidates.slice(0, 50)) {
    if (artistGeminiDelete.has(c.id)) {
      await deleteEntity(
        "artists",
        "artist",
        c.id,
        c.label,
        "gemini_artist_garbage",
        "gemini",
      );
    }
  }

  // ── Events ────────────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: events } = await db
    .from("events")
    .select("id,title,venue_id,artist_id,created_at")
    .limit(10000);
  const eventGeminiCandidates: Array<{ id: string; label: string }> = [];

  for (const e of events ?? []) {
    const { id, title, venue_id, artist_id, created_at } = e as {
      id: string;
      title: string;
      venue_id: string | null;
      artist_id: string | null;
      created_at: string;
    };
    const isOrphan = !venue_id && !artist_id;
    const isOld = created_at < sevenDaysAgo;

    if (title.trim().length <= 2 && isOrphan) {
      await deleteEntity(
        "events",
        "event",
        id,
        title,
        "event_orphan_stub",
        "rule",
      );
    } else if (isOrphan && isOld) {
      // 7일 지난 고아 이벤트 → Gemini 판단
      eventGeminiCandidates.push({ id, label: title });
    } else if (title.trim().length <= 2 || URL_RE.test(title)) {
      eventGeminiCandidates.push({ id, label: title });
    }
  }

  const eventGeminiDelete = await geminiDeleteDecision(
    eventGeminiCandidates.slice(0, 50),
    "공연",
  );
  for (const c of eventGeminiCandidates.slice(0, 50)) {
    if (eventGeminiDelete.has(c.id)) {
      await deleteEntity(
        "events",
        "event",
        c.id,
        c.label,
        "gemini_event_garbage",
        "gemini",
      );
    }
  }

  return { deleted: logs.length, details: logs };
}
