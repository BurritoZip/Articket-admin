import { findDuplicateGroups } from "./dedup";
import { mergeArtists } from "./merge";

export interface ArtistAutoMergeResult {
  merged: number;
  pairs: Array<{
    keepId: string;
    mergeId: string;
    keepName: string;
    mergeName: string;
  }>;
  errors: string[];
}

export async function autoMergeExactArtists(): Promise<ArtistAutoMergeResult> {
  const groups = await findDuplicateGroups({ minSimilarity: 1.0 });

  // exact_normalized만 (similarity 1.0, 자동 병합 안전 기준)
  const exactGroups = groups.filter((g) => g.reason === "exact_normalized");

  const pairs: ArtistAutoMergeResult["pairs"] = [];
  const errors: string[] = [];

  for (const group of exactGroups) {
    const keep =
      group.members.find((m) => m.id === group.suggestedKeepId) ??
      group.members[0];
    const toMerge = group.members.filter((m) => m.id !== keep.id);

    for (const merge of toMerge) {
      try {
        await mergeArtists({ keepId: keep.id, mergeId: merge.id });
        pairs.push({
          keepId: keep.id,
          mergeId: merge.id,
          keepName: keep.name,
          mergeName: merge.name,
        });
      } catch (e) {
        errors.push(
          `merge 실패 (${keep.name} ← ${merge.name}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return { merged: pairs.length, pairs, errors };
}
