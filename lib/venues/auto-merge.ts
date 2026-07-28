import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeVenues } from "./merge";

export interface VenueAutoMergeResult {
  merged: number;
  pairs: Array<{ keepId: string; mergeId: string; name: string }>;
  heldBack: Array<{ name: string; reason: string }>;
  errors: string[];
}

function normalizeKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^가-힣A-Za-z0-9]/g, "");
}

/** 주소 비교용 정규화 — 층/호/지하 등 세부 제거 후 비교 */
export function normalizeAddress(a: string | null): string {
  if (!a) return "";
  return a
    .normalize("NFKC")
    .toLowerCase()
    .replace(/지하\s*\d*/g, "")
    .replace(/\d+\s*층/g, "")
    .replace(/\d+\s*호/g, "")
    .replace(/\s+/g, "")
    .replace(/[^가-힣a-z0-9]/g, "");
}

/** 한쪽 주소가 비었거나 정규화 주소가 같으면 병합 가능. 둘 다 있고 다르면 보류. */
export function shouldMergeByAddress(
  keepAddr: string | null,
  memberAddr: string | null,
): boolean {
  const k = normalizeAddress(keepAddr);
  const m = normalizeAddress(memberAddr);
  if (!k || !m) return true;
  return k === m;
}

export async function autoMergeExactVenues(): Promise<VenueAutoMergeResult> {
  const db = createServiceRoleClient();

  const { data: venues } = await db
    .from("venues")
    .select("id,name,normalized_name,address")
    .limit(5000);

  if (!venues || venues.length === 0)
    return { merged: 0, pairs: [], heldBack: [], errors: [] };

  // normalized_name 기준 그룹화
  const groups = new Map<
    string,
    Array<{ id: string; name: string; address: string | null }>
  >();
  for (const v of venues as Array<{
    id: string;
    name: string;
    normalized_name: string | null;
    address: string | null;
  }>) {
    const key = normalizeKey(v.normalized_name ?? v.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: v.id, name: v.name, address: v.address });
  }

  const pairs: Array<{ keepId: string; mergeId: string; name: string }> = [];
  const heldBack: Array<{ name: string; reason: string }> = [];
  const errors: string[] = [];

  for (const group of Array.from(groups.values())) {
    if (group.length < 2) continue;

    // event_count 많은 쪽 keep
    const counts = await Promise.all(
      group.map(async (v) => {
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
      if (!shouldMergeByAddress(keep.address, merge.address)) {
        heldBack.push({
          name: keep.name,
          reason: `주소 상이: "${keep.address}" vs "${merge.address}"`,
        });
        continue;
      }
      const result = await mergeVenues(keep.id, merge.id);
      if (result.ok) {
        pairs.push({ keepId: keep.id, mergeId: merge.id, name: keep.name });
      } else {
        errors.push(...result.errors);
      }
    }
  }

  return { merged: pairs.length, pairs, heldBack, errors };
}
