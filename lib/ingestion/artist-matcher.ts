import { createServiceRoleClient } from "@/lib/supabase/service-role";

function normalizeArtistName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function matchOrCreateArtist(rawName: string): Promise<string | null> {
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
  if (exact) return (exact as { id: string }).id;

  // 2. normalized_name 매칭
  const { data: normMatch } = await db
    .from("artists")
    .select("id")
    .ilike("normalized_name", normalized)
    .limit(1)
    .maybeSingle();
  if (normMatch) return (normMatch as { id: string }).id;

  // 3. artist_aliases 매칭
  const { data: alias } = await db
    .from("artist_aliases")
    .select("artist_id")
    .ilike("alias", rawName.trim())
    .limit(1)
    .maybeSingle();
  if (alias) return (alias as { artist_id: string }).artist_id;

  // 4. 매칭 실패 시 새 아티스트 생성
  const { data: created, error } = await db
    .from("artists")
    .insert({
      name: rawName.trim(),
      normalized_name: normalized,
      upcoming_event_count: 0,
      followers_count: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.warn(`[ArtistMatcher] Failed to create artist "${rawName}": ${error.message}`);
    return null;
  }
  return (created as { id: string }).id;
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
    console.warn(`[VenueMatcher] Failed to create venue "${venueName}": ${error.message}`);
    return null;
  }
  return (created as { id: string }).id;
}
