/**
 * 아티스트 머지 코어 로직
 *
 * keepId 아티스트를 살리고, mergeId 아티스트를 흡수한다.
 * - FK 4개 테이블 재지정 (unique 충돌 → mergeId 행 제거 후 진행)
 * - merge의 name/name_en → keep의 artist_aliases에 이관
 * - 필드 병합: 비어있는 쪽 채우기, followers_count는 합산
 * - 머지 직전 스냅샷을 artist_merge_logs에 기록
 *
 * ⚠️ Supabase JS는 진정한 트랜잭션 미지원.
 *    실패 시 artist_merge_logs.merged_snapshot으로 수동 복구 가능.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface MergeResult {
  keepId: string;
  mergedId: string;
  fkReassignments: Record<string, number>;
  aliasesAdded: number;
  mergedFields: string[]; // keep에 새로 채워진 필드 목록
  errors: string[];
}

/** 비어있으면 fallback 값 사용 */
function pickNonNull<T>(
  keep: T | null | undefined,
  merge: T | null | undefined,
): T | null {
  if (keep !== null && keep !== undefined && keep !== "") return keep as T;
  return (merge ?? null) as T | null;
}

/** JSONB 객체 얕은 병합 (keep 우선) */
function mergeJsonb(
  keep: Record<string, unknown> | null,
  merge: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...(merge ?? {}), ...(keep ?? {}) };
}

export async function mergeArtists(params: {
  keepId: string;
  mergeId: string;
}): Promise<MergeResult> {
  const { keepId, mergeId } = params;
  const db = createServiceRoleClient();
  const errors: string[] = [];
  const fkReassignments: Record<string, number> = {};

  // ── 1. 두 아티스트 로드 ─────────────────────────────────────────
  const [keepRes, mergeRes] = await Promise.all([
    db.from("artists").select("*").eq("id", keepId).single(),
    db.from("artists").select("*").eq("id", mergeId).single(),
  ]);

  if (keepRes.error || !keepRes.data) {
    throw new Error(`keep 아티스트 없음: ${keepId}`);
  }
  if (mergeRes.error || !mergeRes.data) {
    throw new Error(`merge 아티스트 없음: ${mergeId}`);
  }

  const keepArtist = keepRes.data as Record<string, unknown>;
  const mergeArtist = mergeRes.data as Record<string, unknown>;

  // ── 2. 머지 직전 스냅샷 로그 기록 ─────────────────────────────
  await db.from("artist_merge_logs").insert({
    keep_artist_id: keepId,
    merged_artist_id: mergeId,
    merged_snapshot: mergeArtist,
    fk_reassignments: {}, // 아래에서 업데이트
  });

  // ── 3. FK 재지정 헬퍼 ──────────────────────────────────────────
  async function reassignFK(
    table: string,
    uniqueConflictCheck?: { col1: string; col2: string },
  ) {
    if (uniqueConflictCheck) {
      // unique 충돌 가능 테이블: keep에 이미 존재하는 행은 merge 행을 먼저 삭제
      const { col1, col2 } = uniqueConflictCheck;

      // keep에 이미 존재하는 (col1, artist_id=keepId) 조합 조회
      const { data: existingKeep } = await db
        .from(table)
        .select(col1)
        .eq("artist_id", keepId);

      const existingKeys = new Set(
        ((existingKeep as unknown as Record<string, unknown>[]) ?? []).map(
          (r) => r[col1],
        ),
      );

      // merge 행 중 충돌하는 것만 삭제
      const { data: mergeRows } = await db
        .from(table)
        .select(`id,${col1}`)
        .eq("artist_id", mergeId);

      const conflictIds = (
        (mergeRows as unknown as Record<string, unknown>[]) ?? []
      )
        .filter((r) => existingKeys.has(r[col1]))
        .map((r) => r.id as string);

      if (conflictIds.length > 0) {
        await db.from(table).delete().in("id", conflictIds);
      }

      void col2; // 사용 안 함 (나중을 위해 시그니처 유지)
    }

    const { data: updated, error } = await db
      .from(table)
      .update({ artist_id: keepId })
      .eq("artist_id", mergeId)
      .select("id");

    if (error) {
      errors.push(`${table} FK 재지정 실패: ${error.message}`);
    } else {
      fkReassignments[table] = (updated ?? []).length;
    }
  }

  // ── 4. FK 재지정 (4개 테이블) ──────────────────────────────────
  await reassignFK("event_artists", { col1: "event_id", col2: "artist_id" });
  await reassignFK("timetable_performances");
  await reassignFK("user_artist_followings", {
    col1: "user_id",
    col2: "artist_id",
  });
  // artist_aliases는 별도 처리 (아래)

  // ── 5. alias 이관 + merge name/name_en alias 등록 ───────────────
  // merge의 기존 alias를 keep으로 이전
  const { data: mergeAliases } = await db
    .from("artist_aliases")
    .select("id,alias,source")
    .eq("artist_id", mergeId);

  let aliasesAdded = 0;
  const aliasesToInsert: Array<{
    artist_id: string;
    alias: string;
    source: string;
  }> = [];

  // merge의 name과 name_en을 alias로 등록
  const nameAsAlias = mergeArtist.name as string | null;
  const nameEnAsAlias = mergeArtist.name_en as string | null;
  if (nameAsAlias)
    aliasesToInsert.push({
      artist_id: keepId,
      alias: nameAsAlias,
      source: "merge",
    });
  if (nameEnAsAlias && nameEnAsAlias !== nameAsAlias) {
    aliasesToInsert.push({
      artist_id: keepId,
      alias: nameEnAsAlias,
      source: "merge",
    });
  }

  // 기존 alias 이관
  for (const a of mergeAliases ?? []) {
    aliasesToInsert.push({
      artist_id: keepId,
      alias: a.alias,
      source: a.source ?? "merge",
    });
  }

  // keep의 기존 alias와 중복 제거 후 upsert
  const { data: keepAliases } = await db
    .from("artist_aliases")
    .select("alias")
    .eq("artist_id", keepId);
  const existingAliasSet = new Set(
    (keepAliases ?? []).map((a: Record<string, unknown>) =>
      (a.alias as string).toLowerCase(),
    ),
  );

  const uniqueAliases = aliasesToInsert.filter(
    (a) => !existingAliasSet.has(a.alias.toLowerCase()),
  );

  if (uniqueAliases.length > 0) {
    const { data: inserted } = await db
      .from("artist_aliases")
      .insert(uniqueAliases)
      .select("id");
    aliasesAdded = (inserted ?? []).length;
  }

  // merge의 기존 alias 행들은 삭제 (artist_id=mergeId 전부)
  await db.from("artist_aliases").delete().eq("artist_id", mergeId);

  // ── 6. 필드 병합 (keep에 없는 값만 채움) ───────────────────────
  const FILL_FIELDS = [
    "name_en",
    "avatar_url",
    "occupation",
    "birth_date",
    "birth_place",
    "related",
    "label",
    "country",
  ] as const;

  const mergedFields: string[] = [];
  const patch: Record<string, unknown> = {};

  for (const field of FILL_FIELDS) {
    const filled = pickNonNull(
      keepArtist[field] as string | null,
      mergeArtist[field] as string | null,
    );
    if (filled !== keepArtist[field]) {
      patch[field] = filled;
      mergedFields.push(field);
    }
  }

  // sns_links, metadata는 JSONB 병합
  const mergedSnsLinks = mergeJsonb(
    keepArtist.sns_links as Record<string, unknown> | null,
    mergeArtist.sns_links as Record<string, unknown> | null,
  );
  if (JSON.stringify(mergedSnsLinks) !== JSON.stringify(keepArtist.sns_links)) {
    patch.sns_links = mergedSnsLinks;
  }

  // followers_count 합산
  patch.followers_count =
    ((keepArtist.followers_count as number) ?? 0) +
    ((mergeArtist.followers_count as number) ?? 0);

  // ── 7. keep row 업데이트 ────────────────────────────────────────
  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await db
      .from("artists")
      .update(patch)
      .eq("id", keepId);
    if (updateError) errors.push(`keep 업데이트 실패: ${updateError.message}`);
  }

  // ── 8. merge row 삭제 ───────────────────────────────────────────
  const { error: deleteError } = await db
    .from("artists")
    .delete()
    .eq("id", mergeId);
  if (deleteError)
    errors.push(`merge 아티스트 삭제 실패: ${deleteError.message}`);

  // ── 9. 로그 fk_reassignments 업데이트 ───────────────────────────
  await db
    .from("artist_merge_logs")
    .update({ fk_reassignments: fkReassignments })
    .eq("keep_artist_id", keepId)
    .eq("merged_artist_id", mergeId)
    .order("performed_at", { ascending: false })
    .limit(1);

  return {
    keepId,
    mergedId: mergeId,
    fkReassignments,
    aliasesAdded,
    mergedFields,
    errors,
  };
}
