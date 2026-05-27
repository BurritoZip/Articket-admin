/**
 * 아티스트 보강 오케스트레이터
 *
 * 소스 우선순위: 나무위키 → 멜론 → 네이버 → Wikipedia
 * 기본 동작: missing 필드만 채움 (기존 값 절대 덮어쓰지 않음)
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchNamuProfile, type NamuProfile } from "./namu";
import { fetchMelonProfile, type MelonProfile } from "./melon";
import { fetchNaverProfile, type NaverProfile } from "./naver";
import { fetchWikipediaProfile, type WikipediaProfile } from "./wikipedia";

export type EnrichSource = "namu" | "melon" | "naver" | "wikipedia";

export interface EnrichmentDelta {
  artistId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  sourcesUsed: Partial<Record<EnrichSource, boolean>>;
  addedFields: string[];
  skipped: boolean; // 모든 필드가 이미 채워져 있으면 true
}

/** 보강 대상 필드 */
const ENRICH_FIELDS = [
  "name_en",
  "avatar_url",
  "occupation",
  "birth_date",
  "birth_place",
  "label",
  "country",
  "related",
] as const;

type EnrichField = (typeof ENRICH_FIELDS)[number];

/** 각 소스가 제공하는 필드 */
const SOURCE_FIELDS: Record<EnrichSource, EnrichField[]> = {
  namu: [
    "name_en",
    "occupation",
    "birth_date",
    "birth_place",
    "label",
    "related",
    "country",
  ],
  melon: ["avatar_url", "name_en", "label", "country", "occupation"],
  naver: ["birth_date", "birth_place", "occupation", "label", "related"],
  wikipedia: ["occupation", "birth_date", "birth_place", "related", "label"],
};

type AnyProfile = NamuProfile | MelonProfile | NaverProfile | WikipediaProfile;

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** 소스 프로필을 DB 패치로 변환 (missing 필드만) */
function buildPatch(
  artist: Record<string, unknown>,
  profiles: Partial<Record<EnrichSource, AnyProfile | null>>,
  force: boolean,
): { patch: Record<string, unknown>; addedFields: string[] } {
  const patch: Record<string, unknown> = {};
  const addedFields: string[] = [];

  for (const field of ENRICH_FIELDS) {
    // force=false이면 기존 값이 있으면 건너뜀
    if (!force && !isMissing(artist[field])) continue;

    // 소스 우선순위: namu → melon → naver → wikipedia
    const sources: EnrichSource[] = ["namu", "melon", "naver", "wikipedia"];
    for (const source of sources) {
      const profile = profiles[source];
      if (!profile) continue;

      const val = (profile as unknown as Record<string, unknown>)[field];
      if (!isMissing(val)) {
        patch[field] = val;
        addedFields.push(field);
        break;
      }
    }
  }

  return { patch, addedFields };
}

export async function enrichArtist(
  artistId: string,
  opts?: {
    sources?: EnrichSource[];
    force?: boolean;
  },
): Promise<EnrichmentDelta> {
  const db = createServiceRoleClient();
  const sources =
    opts?.sources ??
    (["namu", "melon", "naver", "wikipedia"] as EnrichSource[]);
  const force = opts?.force ?? false;

  // 아티스트 로드
  const { data: artist, error } = await db
    .from("artists")
    .select(
      "id,name,name_en,avatar_url,occupation,birth_date,birth_place,label,country,related,enrichment_status",
    )
    .eq("id", artistId)
    .single();

  if (error || !artist) throw new Error(`아티스트 없음: ${artistId}`);

  // 이미 모든 필드가 채워져 있으면 스킵 (force=false 시)
  const missingFields = ENRICH_FIELDS.filter((f) =>
    isMissing(artist[f as keyof typeof artist]),
  );
  if (!force && missingFields.length === 0) {
    return {
      artistId,
      before: artist as Record<string, unknown>,
      after: artist as Record<string, unknown>,
      sourcesUsed: {},
      addedFields: [],
      skipped: true,
    };
  }

  // 보강 진행 중 상태 표시
  await db
    .from("artists")
    .update({
      enrichment_status: "in_progress",
      enrichment_attempted_at: new Date().toISOString(),
    })
    .eq("id", artistId);

  // 각 소스에서 프로필 fetch (순차 실행으로 rate limit 준수)
  const profiles: Partial<Record<EnrichSource, AnyProfile | null>> = {};
  const sourcesUsed: Partial<Record<EnrichSource, boolean>> = {};
  const enrichmentSources: Record<string, { at: string; ok: boolean }> = {};

  const query = artist.name;
  for (const source of sources) {
    try {
      let profile: AnyProfile | null = null;
      if (source === "namu") profile = await fetchNamuProfile(query);
      else if (source === "melon") profile = await fetchMelonProfile(query);
      else if (source === "naver") profile = await fetchNaverProfile(query);
      else if (source === "wikipedia")
        profile = await fetchWikipediaProfile(query);

      profiles[source] = profile;
      sourcesUsed[source] = profile !== null;
      enrichmentSources[source] = {
        at: new Date().toISOString(),
        ok: profile !== null,
      };
    } catch {
      profiles[source] = null;
      sourcesUsed[source] = false;
      enrichmentSources[source] = { at: new Date().toISOString(), ok: false };
    }
  }

  // 패치 생성
  const { patch, addedFields } = buildPatch(
    artist as Record<string, unknown>,
    profiles,
    force,
  );

  // name_en이 새로 채워지면 artist_aliases에도 추가
  if (patch.name_en && typeof patch.name_en === "string") {
    const nameEn = patch.name_en;
    const { data: existingAlias } = await db
      .from("artist_aliases")
      .select("id")
      .eq("artist_id", artistId)
      .ilike("alias", nameEn)
      .maybeSingle();

    if (!existingAlias) {
      await db.from("artist_aliases").insert({
        artist_id: artistId,
        alias: nameEn,
        source: `enrich:${sources.find((s) => (profiles[s] as unknown as Record<string, unknown>)?.name_en === nameEn)}`,
      });
    }
  }

  // DB 업데이트
  const finalPatch = {
    ...patch,
    enrichment_status: addedFields.length > 0 ? "enriched" : "skipped",
    enrichment_sources: enrichmentSources,
    enrichment_attempted_at: new Date().toISOString(),
  };

  await db.from("artists").update(finalPatch).eq("id", artistId);

  return {
    artistId,
    before: artist as Record<string, unknown>,
    after: { ...artist, ...patch },
    sourcesUsed,
    addedFields,
    skipped: false,
  };
}

/** ai_processing_queue에서 대기 중인 아티스트 보강 작업 처리 */
export async function processArtistEnrichmentQueue(maxItems = 20): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const db = createServiceRoleClient();

  const { data: tasks } = await db
    .from("ai_processing_queue")
    .select("id,entity_id,payload")
    .eq("task_type", "clean_data")
    .eq("entity_type", "artist")
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

      const artistId = task.entity_id as string;
      await enrichArtist(artistId);

      await db
        .from("ai_processing_queue")
        .update({ status: "completed" })
        .eq("id", task.id);
      succeeded++;
    } catch (e) {
      await db
        .from("ai_processing_queue")
        .update({
          status: "failed",
          error_message: e instanceof Error ? e.message : String(e),
        })
        .eq("id", task.id);
      failed++;
    }
  }

  return { processed: tasks.length, succeeded, failed };
}
