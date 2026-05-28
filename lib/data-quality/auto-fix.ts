import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PRICE_RE,
  TICKET_GRADE_RE,
  DATE_RE,
  URL_RE,
  ADDRESS_KEYWORDS_RE,
  VENUE_LIKE_RE,
} from "./patterns";

export type FixMethod = "null_field" | "queued_ai";

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
    const log: FixLog = {
      entityType,
      entityId,
      fieldName,
      issueType,
      oldValue,
      fixMethod: "queued_ai",
    };
    logs.push(log);
    if (!dryRun) {
      await db.from("ai_processing_queue").upsert(
        {
          task_type: taskType,
          entity_type: entityType,
          entity_id: entityId,
          status: "pending",
          priority: 2,
          payload: { ...payload, issueType, fieldName },
        },
        { onConflict: "entity_id,task_type", ignoreDuplicates: true },
      );
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

    if (PRICE_RE.test(name))
      await queueAI("venue", id, "normalize_venue", "name", name, "venue_name_price", { venueName: name });
    else if (TICKET_GRADE_RE.test(name))
      await queueAI("venue", id, "normalize_venue", "name", name, "venue_name_ticket_grade", { venueName: name });
    else if (DATE_RE.test(name))
      await queueAI("venue", id, "normalize_venue", "name", name, "venue_name_date", { venueName: name });

    if (address) {
      if (PRICE_RE.test(address))
        await nullField("venues", "venue", id, "address", address, "venue_address_price");
      else if (URL_RE.test(address))
        await nullField("venues", "venue", id, "address", address, "venue_address_url");
      else if (
        address.length > 2 &&
        !ADDRESS_KEYWORDS_RE.test(address) &&
        VENUE_LIKE_RE.test(address)
      )
        await nullField("venues", "venue", id, "address", address, "venue_address_looks_like_name");
      else if (address.trim() === name.trim())
        await nullField("venues", "venue", id, "address", address, "venue_address_same_as_name");
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
      await queueAI("artist", id, "clean_data", "name", name, "artist_name_url", { artistName: name });

    if (occupation && ADDRESS_KEYWORDS_RE.test(occupation))
      await nullField("artists", "artist", id, "occupation", occupation, "artist_occupation_address");

    if (label && PRICE_RE.test(label))
      await nullField("artists", "artist", id, "label", label, "artist_label_price");

    if (country && country.length > 30)
      await nullField("artists", "artist", id, "country", country, "artist_country_too_long");

    if (birth_place && PRICE_RE.test(birth_place))
      await nullField("artists", "artist", id, "birth_place", birth_place, "artist_birthplace_price");
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
      await queueAI("event", id, "clean_data", "title", title, "event_title_too_short", { eventTitle: title });
    else if (URL_RE.test(title))
      await queueAI("event", id, "clean_data", "title", title, "event_title_url", { eventTitle: title });

    if (!venue_id && !artist_id)
      await queueAI("event", id, "match_artist", "venue_id,artist_id", title, "event_no_venue_artist", { eventTitle: title });

    if (!start_date)
      await queueAI("event", id, "parse_dates", "start_date", null, "event_no_start_date", { eventTitle: title });
  }

  const fixed = logs.filter((l) => l.fixMethod === "null_field").length;
  const queued = logs.filter((l) => l.fixMethod === "queued_ai").length;

  return { fixed, queued, details: logs };
}
