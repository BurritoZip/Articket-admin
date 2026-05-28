/**
 * 데이터 품질 스캔 API
 *
 * 각 테이블의 컬럼에 "어울리지 않는 값"이 들어간 행을 탐지한다.
 * - venues: name에 가격/날짜/티켓등급, address에 장소명이 들어간 경우
 * - artists: name에 URL/괄호 설명, occupation/label 등에 주소가 들어간 경우
 * - events: title이 지나치게 짧거나 venue_id/artist_id가 모두 없는 경우
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { geminiText } from "@/lib/gemini";
import {
  PRICE_RE,
  TICKET_GRADE_RE,
  DATE_RE,
  URL_RE,
  ADDRESS_KEYWORDS_RE,
  VENUE_LIKE_RE,
} from "@/lib/data-quality/patterns";

export const maxDuration = 60;

// ── 체커 함수들 ────────────────────────────────────────────────────

interface QualityIssue {
  table: string;
  rowId: string;
  field: string;
  value: string;
  reason: string;
}

function checkVenues(
  rows: Array<{ id: string; name: string; address: string | null }>,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const row of rows) {
    // name에 가격이 들어있는 경우
    if (PRICE_RE.test(row.name)) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "name",
        value: row.name,
        reason: "공연장 이름에 가격 정보 포함",
      });
    }
    // name에 티켓 등급이 들어있는 경우
    if (TICKET_GRADE_RE.test(row.name)) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "name",
        value: row.name,
        reason: "공연장 이름에 티켓 등급 포함 (R석/VIP 등)",
      });
    }
    // name에 날짜가 들어있는 경우
    if (DATE_RE.test(row.name)) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "name",
        value: row.name,
        reason: "공연장 이름에 날짜 포함",
      });
    }
    // address에 가격이 들어있는 경우
    if (row.address && PRICE_RE.test(row.address)) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "address",
        value: row.address,
        reason: "주소 필드에 가격 정보 포함",
      });
    }
    // address가 공연장명처럼 생긴 경우 (주소 키워드 없고 공연장 키워드 있음)
    if (
      row.address &&
      row.address.length > 2 &&
      !ADDRESS_KEYWORDS_RE.test(row.address) &&
      VENUE_LIKE_RE.test(row.address)
    ) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "address",
        value: row.address,
        reason: "주소 필드에 주소가 아닌 공연장명이 들어있는 것으로 보임",
      });
    }
    // address가 name과 동일한 경우
    if (row.address && row.address.trim() === row.name.trim()) {
      issues.push({
        table: "venues",
        rowId: row.id,
        field: "address",
        value: row.address,
        reason: "주소 필드 값이 공연장 이름과 동일",
      });
    }
  }
  return issues;
}

function checkArtists(
  rows: Array<{
    id: string;
    name: string;
    occupation: string | null;
    label: string | null;
    country: string | null;
    birth_place: string | null;
  }>,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const row of rows) {
    // name에 URL 포함
    if (URL_RE.test(row.name)) {
      issues.push({
        table: "artists",
        rowId: row.id,
        field: "name",
        value: row.name,
        reason: "아티스트 이름에 URL 포함",
      });
    }
    // occupation에 주소처럼 보이는 값
    if (row.occupation && ADDRESS_KEYWORDS_RE.test(row.occupation)) {
      issues.push({
        table: "artists",
        rowId: row.id,
        field: "occupation",
        value: row.occupation,
        reason: "직종 필드에 주소처럼 보이는 값 포함",
      });
    }
    // label에 가격 포함
    if (row.label && PRICE_RE.test(row.label)) {
      issues.push({
        table: "artists",
        rowId: row.id,
        field: "label",
        value: row.label,
        reason: "소속사 필드에 가격 정보 포함",
      });
    }
    // country가 너무 길면 이상 (국가명은 보통 10자 이내)
    if (row.country && row.country.length > 30) {
      issues.push({
        table: "artists",
        rowId: row.id,
        field: "country",
        value: row.country,
        reason: "국가 필드가 비정상적으로 길음",
      });
    }
    // birth_place에 가격 포함
    if (row.birth_place && PRICE_RE.test(row.birth_place)) {
      issues.push({
        table: "artists",
        rowId: row.id,
        field: "birth_place",
        value: row.birth_place,
        reason: "출생지 필드에 가격 정보 포함",
      });
    }
  }
  return issues;
}

function checkEvents(
  rows: Array<{
    id: string;
    title: string;
    venue_id: string | null;
    artist_id: string | null;
    start_date: string | null;
  }>,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const row of rows) {
    // 제목이 너무 짧음 (2자 이하)
    if (row.title.trim().length <= 2) {
      issues.push({
        table: "events",
        rowId: row.id,
        field: "title",
        value: row.title,
        reason: "공연 제목이 너무 짧음 (2자 이하)",
      });
    }
    // 제목에 URL 포함
    if (URL_RE.test(row.title)) {
      issues.push({
        table: "events",
        rowId: row.id,
        field: "title",
        value: row.title,
        reason: "공연 제목에 URL 포함",
      });
    }
    // venue_id도 artist_id도 없는 이벤트
    if (!row.venue_id && !row.artist_id) {
      issues.push({
        table: "events",
        rowId: row.id,
        field: "venue_id,artist_id",
        value: row.title,
        reason: "공연장과 아티스트 정보가 모두 없음",
      });
    }
    // start_date가 없는 이벤트 (schema상 NOT NULL이지만 방어용)
    if (!row.start_date) {
      issues.push({
        table: "events",
        rowId: row.id,
        field: "start_date",
        value: row.title,
        reason: "공연 날짜 없음",
      });
    }
  }
  return issues;
}

// ── Gemini 추가 검사 ───────────────────────────────────────────────

/**
 * 규칙 기반으로 잡지 못한 이상값을 Gemini로 추가 탐지
 * venues.name / venues.address 각 최대 50행 샘플 전송
 */
async function geminiCheckVenues(
  rows: Array<{ id: string; name: string; address: string | null }>,
): Promise<QualityIssue[]> {
  if (rows.length === 0) return [];
  const sample = rows.slice(0, 50);
  const lines = sample.map(
    (r, i) => `${i}|name="${r.name}"|address="${r.address ?? ""}"`,
  );
  const prompt = `아래는 공연장 DB 행 목록입니다(인덱스|name|address).
각 행에서 다음 문제를 찾아주세요:
1. name 필드에 가격, 날짜, 티켓등급(R석/VIP 등), URL이 포함됨
2. address 필드가 공연장명과 동일하거나, 가격/티켓 정보가 포함됨
3. address가 실제 주소가 아닌 공연장 이름처럼 보임

문제가 있는 행만 JSON 배열로 반환하세요:
[{"index": 숫자, "field": "name"|"address", "reason": "설명"}, ...]
문제 없으면 빈 배열 [].

${lines.join("\n")}`;

  try {
    const raw = await geminiText(prompt);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const findings = JSON.parse(cleaned) as Array<{
      index: number;
      field: string;
      reason: string;
    }>;
    return findings.map((f) => ({
      table: "venues",
      rowId: sample[f.index]?.id ?? "",
      field: f.field,
      value:
        f.field === "address"
          ? (sample[f.index]?.address ?? "")
          : (sample[f.index]?.name ?? ""),
      reason: `[AI] ${f.reason}`,
    }));
  } catch {
    return [];
  }
}

// ── Route Handler ──────────────────────────────────────────────────

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const useAI = url.searchParams.get("ai") !== "false";

  const supabase = createClient();

  const [venueRes, artistRes, eventRes] = await Promise.all([
    supabase.from("venues").select("id,name,address").limit(2000),
    supabase
      .from("artists")
      .select("id,name,occupation,label,country,birth_place")
      .limit(5000),
    supabase
      .from("events")
      .select("id,title,venue_id,artist_id,start_date")
      .limit(5000),
  ]);

  const venueRows = (venueRes.data ?? []) as Parameters<typeof checkVenues>[0];
  const venueIssues = checkVenues(venueRows);
  const artistIssues = checkArtists(
    (artistRes.data ?? []) as Parameters<typeof checkArtists>[0],
  );
  const eventIssues = checkEvents(
    (eventRes.data ?? []) as Parameters<typeof checkEvents>[0],
  );

  // Gemini로 규칙 기반이 놓친 이상값 추가 탐지
  const aiVenueIssues = useAI ? await geminiCheckVenues(venueRows) : [];

  // 이미 규칙 기반에서 잡은 rowId+field는 중복 제거
  const ruleKeys = new Set(venueIssues.map((i) => `${i.rowId}:${i.field}`));
  const dedupedAI = aiVenueIssues.filter(
    (i) => !ruleKeys.has(`${i.rowId}:${i.field}`),
  );

  const allIssues = [
    ...venueIssues,
    ...dedupedAI,
    ...artistIssues,
    ...eventIssues,
  ];

  return NextResponse.json({
    total: allIssues.length,
    byTable: {
      venues: venueIssues.length,
      artists: artistIssues.length,
      events: eventIssues.length,
    },
    issues: allIssues,
  });
}
