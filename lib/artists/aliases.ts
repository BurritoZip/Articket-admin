import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type DB = ReturnType<typeof createServiceRoleClient>;

/**
 * 아티스트의 별칭들을 artist_aliases 에 적재 (중복 무시).
 * ingest·enrich·병합·제안승인이 공유 — 알려진 모든 표기를 모아 매칭/중복탐지를 강화한다.
 */
export async function addArtistAliases(
  db: DB,
  artistId: string,
  aliases: Array<string | null | undefined>,
  source: string,
): Promise<void> {
  const rows = Array.from(
    new Set(aliases.map((a) => a?.trim()).filter((a): a is string => !!a)),
  ).map((alias) => ({ artist_id: artistId, alias, source }));
  if (rows.length === 0) return;
  await db
    .from("artist_aliases")
    .upsert(rows, { onConflict: "artist_id,alias", ignoreDuplicates: true });
}
