import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeVenues } from "./merge";

export interface VenueAutoMergeResult {
  merged: number;
  pairs: Array<{ keepId: string; mergeId: string; name: string }>;
  errors: string[];
}

function normalizeKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^가-힣A-Za-z0-9]/g, "");
}

export async function autoMergeExactVenues(): Promise<VenueAutoMergeResult> {
  const db = createServiceRoleClient();

  const { data: venues } = await db
    .from("venues")
    .select("id,name,normalized_name")
    .limit(5000);

  if (!venues || venues.length === 0)
    return { merged: 0, pairs: [], errors: [] };

  // normalized_name 기준으로 그룹화
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const v of venues as Array<{
    id: string;
    name: string;
    normalized_name: string | null;
  }>) {
    const key = normalizeKey(v.normalized_name ?? v.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: v.id, name: v.name });
  }

  const pairs: Array<{ keepId: string; mergeId: string; name: string }> = [];
  const errors: string[] = [];

  for (const group of Array.from(groups.values())) {
    if (group.length < 2) continue;

    // event_count 많은 쪽 keep
    const counts = await Promise.all(
      group.map(async (v: { id: string; name: string }) => {
        const { count } = await db
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", v.id);
        return { ...v, count: count ?? 0 };
      }),
    );
    counts.sort((a, b) => b.count - a.count);
    const keep = counts[0];

    for (let i = 1; i < counts.length; i++) {
      const merge = counts[i];
      const result = await mergeVenues(keep.id, merge.id);
      if (result.ok) {
        pairs.push({ keepId: keep.id, mergeId: merge.id, name: keep.name });
      } else {
        errors.push(...result.errors);
      }
    }
  }

  return { merged: pairs.length, pairs, errors };
}
