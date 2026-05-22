import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ArtistProfileInput = {
  name: string;
  sourceUrl?: string | null;
  avatarUrl?: string | null;
  occupation?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  related?: string | null;
  metadata?: Record<string, unknown>;
};

function normalizeArtistName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildArtistPatch(
  profile: ArtistProfileInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (profile.avatarUrl) patch.avatar_url = profile.avatarUrl;
  if (profile.occupation) patch.occupation = profile.occupation;
  if (profile.birthDate) patch.birth_date = profile.birthDate;
  if (profile.birthPlace) patch.birth_place = profile.birthPlace;
  if (profile.related) patch.related = profile.related;
  if (profile.metadata) patch.metadata = profile.metadata;
  return patch;
}

async function fillMissingArtistProfile(
  artistId: string,
  profile?: ArtistProfileInput,
): Promise<void> {
  if (!profile) return;
  const patchInput = buildArtistPatch(profile);
  if (Object.keys(patchInput).length === 0) return;

  const db = createServiceRoleClient();
  const { data } = await db
    .from("artists")
    .select(
      "avatar_url, occupation, birth_date, birth_place, related, metadata",
    )
    .eq("id", artistId)
    .single();
  const current = (data ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patchInput)) {
    if (value && !current[key]) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return;
  await db.from("artists").update(patch).eq("id", artistId);
}

export async function matchOrCreateArtist(
  rawName: string,
  profile?: ArtistProfileInput,
): Promise<string | null> {
  if (!rawName?.trim()) return null;
  const db = createServiceRoleClient();
  const normalized = normalizeArtistName(rawName);

  // 1. 정확한 이름 매칭
  const { data: exact } = await db
    .from("artists")
    .select("id")
    .ilike("name", rawName.trim())
    .limit(1)
    .maybeSingle();
  if (exact) {
    const id = (exact as { id: string }).id;
    await fillMissingArtistProfile(id, profile);
    return id;
  }

  // 2. normalized_name 매칭
  const { data: normMatch } = await db
    .from("artists")
    .select("id")
    .ilike("normalized_name", normalized)
    .limit(1)
    .maybeSingle();
  if (normMatch) {
    const id = (normMatch as { id: string }).id;
    await fillMissingArtistProfile(id, profile);
    return id;
  }

  // 3. artist_aliases 매칭
  const { data: alias } = await db
    .from("artist_aliases")
    .select("artist_id")
    .ilike("alias", rawName.trim())
    .limit(1)
    .maybeSingle();
  if (alias) {
    const id = (alias as { artist_id: string }).artist_id;
    await fillMissingArtistProfile(id, profile);
    return id;
  }

  // 4. 매칭 실패 시 새 아티스트 생성
  const { data: created, error } = await db
    .from("artists")
    .insert({
      name: rawName.trim(),
      normalized_name: normalized,
      upcoming_event_count: 0,
      followers_count: 0,
      ...buildArtistPatch(profile ?? { name: rawName.trim() }),
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      `[ArtistMatcher] Failed to create artist "${rawName}": ${error.message}`,
    );
    return null;
  }
  return (created as { id: string }).id;
}

export async function matchOrCreateArtists(
  rawNames: string[],
  profiles: ArtistProfileInput[] = [],
): Promise<Array<{ name: string; id: string | null }>> {
  const uniqueNames = Array.from(
    new Set(rawNames.map((name) => name.trim()).filter(Boolean)),
  );
  const profileByName = new Map(
    profiles.map((profile) => [normalizeArtistName(profile.name), profile]),
  );
  const results: Array<{ name: string; id: string | null }> = [];
  for (const name of uniqueNames) {
    results.push({
      name,
      id: await matchOrCreateArtist(
        name,
        profileByName.get(normalizeArtistName(name)),
      ),
    });
  }
  return results;
}

export async function linkEventArtists(
  eventId: string,
  artists: Array<{ name: string; id: string | null }>,
  sourceName: string,
): Promise<void> {
  const rows = artists
    .filter((artist): artist is { name: string; id: string } =>
      Boolean(artist.id),
    )
    .map((artist, index) => ({
      event_id: eventId,
      artist_id: artist.id,
      artist_name: artist.name,
      display_order: index + 1,
      role: index === 0 ? "primary" : "lineup",
      source_name: sourceName,
    }));
  if (rows.length === 0) return;
  const db = createServiceRoleClient();
  const { error } = await db
    .from("event_artists")
    .upsert(rows, { onConflict: "event_id,artist_id" });
  if (error) {
    throw new Error(`Event artist link failed: ${error.message}`);
  }
}

export async function linkEventVenues(
  eventId: string,
  venueIds: string[],
): Promise<void> {
  const validIds = venueIds.filter(Boolean);
  if (validIds.length === 0) return;
  const db = createServiceRoleClient();
  const rows = validIds.map((venueId, index) => ({
    event_id: eventId,
    venue_id: venueId,
    display_order: index,
  }));
  const { error } = await db
    .from("event_venues")
    .upsert(rows, { onConflict: "event_id,venue_id" });
  if (error) {
    throw new Error(`Event venue link failed: ${error.message}`);
  }
}

export async function matchOrCreateVenue(
  venueName: string | null,
  venueAddress: string | null,
): Promise<string | null> {
  if (!venueName?.trim()) return null;
  const db = createServiceRoleClient();

  // 1. 이름 정확 매칭
  const { data: exact } = await db
    .from("venues")
    .select("id")
    .ilike("name", venueName.trim())
    .limit(1)
    .maybeSingle();
  if (exact) return (exact as { id: string }).id;

  // 2. normalized_name 매칭
  const normalized = venueName.toLowerCase().replace(/\s+/g, " ").trim();
  const { data: normMatch } = await db
    .from("venues")
    .select("id")
    .ilike("normalized_name", normalized)
    .limit(1)
    .maybeSingle();
  if (normMatch) return (normMatch as { id: string }).id;

  // 3. 새 공연장 생성
  const { data: created, error } = await db
    .from("venues")
    .insert({
      name: venueName.trim(),
      normalized_name: normalized,
      address: venueAddress?.trim() ?? "",
      phone_number: "",
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      `[VenueMatcher] Failed to create venue "${venueName}": ${error.message}`,
    );
    return null;
  }
  return (created as { id: string }).id;
}
