import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PRICE_RE,
  TICKET_GRADE_RE,
  DATE_RE,
  URL_RE,
  ADDRESS_KEYWORDS_RE,
  VENUE_LIKE_RE,
} from "./patterns";

export type FixMethod = "null_field" | "queued_ai" | "flagged";

export interface FixLog {
  entityType: "venue" | "artist" | "event";
  entityId: string;
  fieldName: string;
  issueType: string;
  oldValue: string | null;
  fixMethod: FixMethod;
}

export interface AutoFixResult {
  fixed: number;
  queued: number;
  flagged: number;
  details: FixLog[];
}

export interface AutoFixOptions {
  scope: "recent_1_days" | "recent_7_days" | "all";
  dryRun?: boolean;
}

function dateCutoff(scope: AutoFixOptions["scope"]): string | null {
  if (scope === "all") return null;
  const days = scope === "recent_1_days" ? 1 : 7;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function runDataQualityAutoFix(
  opts: AutoFixOptions,
): Promise<AutoFixResult> {
  const db = createServiceRoleClient();
  const dryRun = opts.dryRun ?? false;
  const cutoff = dateCutoff(opts.scope);

  const logs: FixLog[] = [];
  const seen = new Set<string>(); // `${entityId}:${fieldName}`

  function mark(key: string) {
    seen.add(key);
  }
  function seen_(id: string, field: string) {
    return seen.has(`${id}:${field}`);
  }

  async function nullField(
    table: string,
    entityType: FixLog["entityType"],
    id: string,
    field: string,
    oldValue: string | null,
    issueType: string,
  ) {
    if (seen_(id, field)) return;
    mark(`${id}:${field}`);
    const log: FixLog = {
      entityType,
      entityId: id,
      fieldName: field,
      issueType,
      oldValue,
      fixMethod: "null_field",
    };
    logs.push(log);
    if (!dryRun) {
      await db
        .from(table)
        .update({ [field]: null })
        .eq("id", id);
      await db.from("data_quality_fix_logs").insert({
        entity_type: entityType,
        entity_id: id,
        field_name: field,
        issue_type: issueType,
        old_value: oldValue,
        new_value: null,
        fix_method: "null_field",
      });
    }
  }

  async function queueAI(
    entityType: FixLog["entityType"],
    entityId: string,
    taskType: string,
    fieldName: string,
    oldValue: string | null,
    issueType: string,
    payload: Record<string, unknown>,
  ) {
    if (seen_(entityId, fieldName)) return;
    mark(`${entityId}:${fieldName}`);

    if (!dryRun) {
      // 이미 pending/processing 상태면 새로 큐에 넣지 않음 (중복 카운트 방지)
      const { count } = await db
        .from("ai_processing_queue")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", entityId)
        .eq("task_type", taskType)
        .in("status", ["pending", "processing"]);

      if ((count ?? 0) > 0) return; // 이미 큐에 있음 — 카운트 안 함

      await db.from("ai_processing_queue").insert({
        task_type: taskType,
        entity_type: entityType,
        entity_id: entityId,
        status: "pending",
        priority: 2,
        payload: { ...payload, issueType, fieldName },
      });
      await db.from("data_quality_fix_logs").insert({
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
        issue_type: issueType,
        old_value: oldValue,
        new_value: null,
        fix_method: "queued_ai",
      });
    }

    const log: FixLog = {
      entityType,
      entityId,
      fieldName,
      issueType,
      oldValue,
      fixMethod: "queued_ai",
    };
    logs.push(log);
  }

  // ── venues ────────────────────────────────────────────────────────
  let venueQuery = db.from("venues").select("id,name,address").limit(5000);
  if (cutoff) venueQuery = venueQuery.gte("created_at", cutoff);
  const { data: venues } = await venueQuery;

  for (const row of venues ?? []) {
    const { id, name, address } = row as {
      id: string;
      name: string;
      address: string | null;
    };

    // venue 이름 오염 → venue_id를 참조하는 이벤트의 venue_id를 null로 처리
    // (처리 코드 없는 AI 큐에 넣지 않고 직접 nullField 처리)
    if (
      PRICE_RE.test(name) ||
      TICKET_GRADE_RE.test(name) ||
      DATE_RE.test(name)
    ) {
      await nullField(
        "venues",
        "venue",
        id,
        "name",
        name,
        "venue_name_contaminated",
      );
    }

    if (address) {
      if (PRICE_RE.test(address))
        await nullField(
          "venues",
          "venue",
          id,
          "address",
          address,
          "venue_address_price",
        );
      else if (URL_RE.test(address))
        await nullField(
          "venues",
          "venue",
          id,
          "address",
          address,
          "venue_address_url",
        );
      else if (
        address.length > 2 &&
        !ADDRESS_KEYWORDS_RE.test(address) &&
        VENUE_LIKE_RE.test(address)
      )
        await nullField(
          "venues",
          "venue",
          id,
          "address",
          address,
          "venue_address_looks_like_name",
        );
      else if (address.trim() === name.trim())
        await nullField(
          "venues",
          "venue",
          id,
          "address",
          address,
          "venue_address_same_as_name",
        );
    }
  }

  // ── artists ───────────────────────────────────────────────────────
  let artistQuery = db
    .from("artists")
    .select("id,name,occupation,label,country,birth_place")
    .limit(10000);
  if (cutoff) artistQuery = artistQuery.gte("created_at", cutoff);
  const { data: artists } = await artistQuery;

  for (const row of artists ?? []) {
    const { id, name, occupation, label, country, birth_place } = row as {
      id: string;
      name: string;
      occupation: string | null;
      label: string | null;
      country: string | null;
      birth_place: string | null;
    };

    if (URL_RE.test(name))
      await queueAI(
        "artist",
        id,
        "clean_data",
        "name",
        name,
        "artist_name_url",
        { artistName: name },
      );

    if (occupation && ADDRESS_KEYWORDS_RE.test(occupation))
      await nullField(
        "artists",
        "artist",
        id,
        "occupation",
        occupation,
        "artist_occupation_address",
      );

    if (label && PRICE_RE.test(label))
      await nullField(
        "artists",
        "artist",
        id,
        "label",
        label,
        "artist_label_price",
      );

    if (country && country.length > 30)
      await nullField(
        "artists",
        "artist",
        id,
        "country",
        country,
        "artist_country_too_long",
      );

    if (birth_place && PRICE_RE.test(birth_place))
      await nullField(
        "artists",
        "artist",
        id,
        "birth_place",
        birth_place,
        "artist_birthplace_price",
      );
  }

  // ── events ────────────────────────────────────────────────────────
  let eventQuery = db
    .from("events")
    .select("id,title,venue_id,artist_id,start_date")
    .limit(10000);
  if (cutoff) eventQuery = eventQuery.gte("created_at", cutoff);
  const { data: events } = await eventQuery;

  for (const row of events ?? []) {
    const { id, title, venue_id, artist_id, start_date } = row as {
      id: string;
      title: string;
      venue_id: string | null;
      artist_id: string | null;
      start_date: string | null;
    };

    if (title.trim().length <= 2)
      await queueAI(
        "event",
        id,
        "clean_data",
        "title",
        title,
        "event_title_too_short",
        { eventTitle: title },
      );
    else if (URL_RE.test(title))
      await queueAI(
        "event",
        id,
        "clean_data",
        "title",
        title,
        "event_title_url",
        { eventTitle: title },
      );

    // venue + artist 둘 다 없음 → flagged (처리 코드 없지만 이슈 기록)
    if (!venue_id && !artist_id && !seen_(id, "venue_id,artist_id")) {
      mark(`${id}:venue_id,artist_id`);
      logs.push({
        entityType: "event",
        entityId: id,
        fieldName: "venue_id,artist_id",
        issueType: "event_no_venue_artist",
        oldValue: title,
        fixMethod: "flagged",
      });
    }

    // start_date 없음 → flagged
    if (!start_date && !seen_(id, "start_date")) {
      mark(`${id}:start_date`);
      logs.push({
        entityType: "event",
        entityId: id,
        fieldName: "start_date",
        issueType: "event_no_start_date",
        oldValue: null,
        fixMethod: "flagged",
      });
    }
  }

  const fixed = logs.filter((l) => l.fixMethod === "null_field").length;
  const queued = logs.filter((l) => l.fixMethod === "queued_ai").length;
  const flagged = logs.filter((l) => l.fixMethod === "flagged").length;

  return { fixed, queued, flagged, details: logs };
}
