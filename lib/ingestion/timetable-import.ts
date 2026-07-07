import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { matchExistingArtist } from "./artist-matcher";
import { logUnmatchedTimetableArtist } from "./timetable-unmatched";

export type ParsedTimetableRow = {
  day_number: number;
  date_string: string;
  start_time: string;
  end_time: string;
  artist_name: string;
  stage_name: string;
  genre: string;
};

export type TimetableImportIssue = {
  line: string;
  reason: string;
};

export type TimetableImportResult = {
  parsedCount: number;
  insertedCount: number;
  skippedCount: number;
  issues: TimetableImportIssue[];
  rows: ParsedTimetableRow[];
  /** 기존 아티스트 리스트에 매칭 안 돼 로그로 분리된 이름들 (신규 생성 안 함) */
  unmatched: string[];
};

type EventInfo = {
  id: string;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  genre: string | null;
};

const TIME_RANGE =
  /(\d{1,2}[:.]\d{2})\s*(?:~|-|–|—|부터|to)\s*(\d{1,2}[:.]\d{2})/i;
const SINGLE_DATE =
  /(?:^|\s)(?:(\d{4})\s*(?:[./-]|년)\s*)?(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:일)?(?=\s|$)/;
const DAY_MARKER = /(?:day|데이)\s*(\d{1,2})/i;
const STAGE_MARKER =
  /(?:@|스테이지|stage|무대|장소)\s*[:\-]?\s*([A-Za-z0-9가-힣\s._-]+)$/i;

function toTime(value: string): string {
  const [h, m] = value.replace(".", ":").split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

function isValidTime(t: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(t);
  if (!match) return false;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function toDateString(year: number, month: string, day: string): string {
  return `${year}.${month.padStart(2, "0")}.${day.padStart(2, "0")}`;
}

function eventDateAt(event: EventInfo, dayNumber: number): string {
  const base = event.start_date ? new Date(event.start_date) : new Date();
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + Math.max(0, dayNumber - 1));
  return `${base.getFullYear()}.${String(base.getMonth() + 1).padStart(2, "0")}.${String(base.getDate()).padStart(2, "0")}`;
}

function dayNumberFromDate(event: EventInfo, dateString: string): number {
  if (!event.start_date) return 1;
  const start = new Date(event.start_date.slice(0, 10));
  const current = new Date(dateString.replace(/\./g, "-"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) {
    return 1;
  }
  const diff = Math.round(
    (current.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  return Math.max(1, diff + 1);
}

function cleanLine(line: string): string {
  return line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
}

function parseLine(
  rawLine: string,
  event: EventInfo,
  context: { dayNumber: number; dateString: string; stageName: string },
): ParsedTimetableRow | null {
  let line = cleanLine(rawLine);
  if (!line) return null;

  const timeMatch = line.match(TIME_RANGE);
  if (!timeMatch) return null;

  let dayNumber = context.dayNumber;
  let dateString = context.dateString || eventDateAt(event, dayNumber);
  let stageName = context.stageName;

  const dayMatch = line.match(DAY_MARKER);
  if (dayMatch?.[1]) {
    dayNumber = Number(dayMatch[1]);
    dateString = eventDateAt(event, dayNumber);
    line = line.replace(dayMatch[0], " ");
  }

  const dateMatch = line.match(SINGLE_DATE);
  if (dateMatch?.[2] && dateMatch[3]) {
    const fallbackYear = event.start_date
      ? new Date(event.start_date).getFullYear()
      : new Date().getFullYear();
    dateString = toDateString(
      Number(dateMatch[1] ?? fallbackYear),
      dateMatch[2],
      dateMatch[3],
    );
    dayNumber = dayNumberFromDate(event, dateString);
    line = line.replace(dateMatch[0], " ");
  }

  const stageMatch = line.match(STAGE_MARKER);
  if (stageMatch?.[1]) {
    stageName = stageMatch[1].trim();
    line = line.replace(stageMatch[0], " ");
  }

  line = line.replace(timeMatch[0], " ");
  const artistName = line
    .replace(/(?:line\s*up|라인업|artist|아티스트)\s*[:\-]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!artistName || !stageName) return null;

  const startTime = toTime(timeMatch[1]);
  const endTime = toTime(timeMatch[2]);

  if (!isValidTime(startTime) || !isValidTime(endTime)) return null;
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) return null;

  return {
    day_number: dayNumber,
    date_string: dateString,
    start_time: startTime,
    end_time: endTime,
    artist_name: artistName,
    stage_name: stageName,
    genre: event.genre ?? "",
  };
}

type PendingSlot = {
  day_number: number;
  date_string: string;
  start_time: string;
  end_time: string;
  stage_name: string;
};

function parseStageTimeSlot(
  rawLine: string,
  event: EventInfo,
  context: { dayNumber: number; dateString: string },
): PendingSlot | null {
  const line = cleanLine(rawLine);
  const timeMatch = line.match(TIME_RANGE);
  if (!timeMatch) return null;

  const stageName = line.replace(timeMatch[0], " ").trim();
  if (!stageName || /\d{1,2}[:.]\d{2}/.test(stageName)) return null;

  const startTime = toTime(timeMatch[1]);
  const endTime = toTime(timeMatch[2]);
  if (!isValidTime(startTime) || !isValidTime(endTime)) return null;
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) return null;

  return {
    day_number: context.dayNumber,
    date_string: context.dateString || eventDateAt(event, context.dayNumber),
    start_time: startTime,
    end_time: endTime,
    stage_name: stageName,
  };
}

export function parseTimetableText(
  text: string,
  event: EventInfo,
): { rows: ParsedTimetableRow[]; issues: TimetableImportIssue[] } {
  const rows: ParsedTimetableRow[] = [];
  const issues: TimetableImportIssue[] = [];
  const context = {
    dayNumber: 1,
    dateString: eventDateAt(event, 1),
    stageName: "MAIN STAGE",
  };
  let pendingSlot: PendingSlot | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    const dayMatch = line.match(DAY_MARKER);
    const dateMatch = line.match(SINGLE_DATE);
    const stageOnlyMatch = line.match(
      /^(?:@|스테이지|stage|무대|장소)?\s*[:\-]?\s*([A-Za-z0-9가-힣\s._-]+)\s*(?:stage|스테이지|무대)?$/i,
    );

    if (!TIME_RANGE.test(line)) {
      if (pendingSlot) {
        rows.push({
          ...pendingSlot,
          artist_name: line,
          genre: event.genre ?? "",
        });
        pendingSlot = null;
        continue;
      }

      if (dayMatch?.[1]) {
        context.dayNumber = Number(dayMatch[1]);
        context.dateString = eventDateAt(event, context.dayNumber);
      }
      if (dateMatch?.[2] && dateMatch[3]) {
        const fallbackYear = event.start_date
          ? new Date(event.start_date).getFullYear()
          : new Date().getFullYear();
        context.dateString = toDateString(
          Number(dateMatch[1] ?? fallbackYear),
          dateMatch[2],
          dateMatch[3],
        );
        context.dayNumber = dayNumberFromDate(event, context.dateString);
      } else if (
        stageOnlyMatch &&
        /(stage|스테이지|무대|main|sub|green|blue|red|club|zone)/i.test(line)
      ) {
        context.stageName = stageOnlyMatch[1].trim();
      }
      continue;
    }

    const stageTimeSlot = parseStageTimeSlot(line, event, context);
    if (stageTimeSlot) {
      pendingSlot = stageTimeSlot;
      context.stageName = stageTimeSlot.stage_name;
      continue;
    }

    const parsed = parseLine(line, event, context);
    if (parsed) {
      rows.push(parsed);
    } else {
      issues.push({
        line,
        reason: "시간, 아티스트, 스테이지를 확정하지 못했습니다.",
      });
    }
  }

  if (pendingSlot) {
    issues.push({
      line: `${pendingSlot.stage_name} ${pendingSlot.start_time}-${pendingSlot.end_time}`,
      reason: "다음 줄에서 아티스트명을 찾지 못했습니다.",
    });
  }

  return { rows, issues };
}

export async function importTimetableText(params: {
  eventId: string;
  text: string;
  replaceExisting?: boolean;
}): Promise<TimetableImportResult> {
  const db = createServiceRoleClient();
  const { data: eventData, error: eventError } = await db
    .from("events")
    .select("id, title, start_date, end_date, genre")
    .eq("id", params.eventId)
    .single();

  if (eventError || !eventData) {
    throw new Error(eventError?.message ?? "event_not_found");
  }

  const event = eventData as EventInfo;
  const parsed = parseTimetableText(params.text, event);
  const insertedRows: ParsedTimetableRow[] = [];
  const unmatched: string[] = [];

  if (params.replaceExisting) {
    await db.from("timetable_performances").delete().eq("event_id", event.id);
  }

  for (const row of parsed.rows) {
    // 기존 아티스트에 연결만 — 없으면 신규 생성 대신 로그로 분리
    const artistId = await matchExistingArtist(row.artist_name);
    if (!artistId) {
      unmatched.push(row.artist_name);
      await logUnmatchedTimetableArtist({
        eventId: event.id,
        eventTitle: event.title,
        artistName: row.artist_name,
        stageName: row.stage_name,
        dayNumber: row.day_number,
        source: "text",
      });
    }

    const { error } = await db.from("timetable_performances").insert({
      event_id: event.id,
      artist_id: artistId,
      day_number: row.day_number,
      date_string: row.date_string,
      start_time: row.start_time,
      end_time: row.end_time,
      artist_name: row.artist_name,
      stage_name: row.stage_name,
      genre: row.genre,
    });

    if (error) {
      parsed.issues.push({ line: row.artist_name, reason: error.message });
      continue;
    }
    insertedRows.push(row);
  }

  if (insertedRows.length > 0) {
    await db.from("events").update({ has_timetable: true }).eq("id", event.id);
  }

  return {
    parsedCount: parsed.rows.length,
    insertedCount: insertedRows.length,
    skippedCount: parsed.rows.length - insertedRows.length,
    issues: parsed.issues,
    rows: insertedRows,
    unmatched: Array.from(new Set(unmatched)),
  };
}
