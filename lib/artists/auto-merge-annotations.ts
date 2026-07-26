/**
 * 주석 변형(annotation) 자동 병합 — 안전 부분집합만.
 *
 * "NEMOPHILA(JP)" / "SEVENTEEN VERNON THE 8 [V8]" 처럼 괄호·대괄호 주석을 떼면
 * 다른 아티스트의 이름과 **정확히** 일치하는 경우만 병합한다(주석 붙은 쪽 → 클린 쪽).
 *
 * 오탐 0 을 위한 가드:
 *  - core(주석 제거 정규화 키)가 비어있지 않고, 주석이 실제로 있었을 것(full != core)
 *  - 그 core 에 해당하는 "클린"(주석 없는) 아티스트가 **정확히 1명** — 여러 명이면
 *    (KR)/(NO) 같은 디스앰비규에이션일 수 있어 스킵 → 검토로
 *  - 같은 core 에 주석 아티스트가 2명 이상이면(예: Aurora(KR)/Aurora(NO)) 전부 스킵
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeKey } from "@/lib/artists/normalize";
import { mergeArtists } from "@/lib/artists/merge";

/** 괄호/대괄호 주석(닫힘 생략 허용)을 떼고 정규화. */
export function annotationCore(name: string): string {
  return normalizeKey(
    name
      .replace(/[([][^)\]]*[)\]]?/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function hasAnnotation(name: string): boolean {
  return /[([]/.test(name);
}

interface Row {
  id: string;
  name: string;
}

export async function autoMergeAnnotationVariants(opts?: {
  apply?: boolean;
}): Promise<{
  merged: number;
  pairs: Array<{ keep: string; drop: string }>;
}> {
  const apply = opts?.apply ?? false;
  const db = createServiceRoleClient();

  const { data } = await db.from("artists").select("id,name").limit(5000);
  const artists = (data ?? []) as Row[];

  // 이벤트 연결 수 (keep 선택용)
  const { data: links } = await db
    .from("event_artists")
    .select("artist_id")
    .in(
      "artist_id",
      artists.map((a) => a.id),
    );
  const eventCount = new Map<string, number>();
  for (const l of (links ?? []) as { artist_id: string }[])
    eventCount.set(l.artist_id, (eventCount.get(l.artist_id) ?? 0) + 1);

  // core → { clean: [], annotated: [] }
  const byCore = new Map<string, { clean: Row[]; annotated: Row[] }>();
  for (const a of artists) {
    const core = annotationCore(a.name);
    if (!core) continue;
    let g = byCore.get(core);
    if (!g) byCore.set(core, (g = { clean: [], annotated: [] }));
    if (hasAnnotation(a.name) && normalizeKey(a.name) !== core)
      g.annotated.push(a);
    else if (normalizeKey(a.name) === core) g.clean.push(a);
  }

  const pairs: Array<{ keep: string; drop: string }> = [];
  for (const g of Array.from(byCore.values())) {
    // 가드: 클린 정확히 1명 + 주석 정확히 1명일 때만(다대일=디스앰비규에이션 위험)
    if (g.clean.length !== 1 || g.annotated.length !== 1) continue;
    const clean = g.clean[0];
    const annotated = g.annotated[0];
    // keep = 이벤트 많은 쪽(동률이면 클린)
    const keep =
      (eventCount.get(annotated.id) ?? 0) > (eventCount.get(clean.id) ?? 0)
        ? annotated
        : clean;
    const drop = keep.id === clean.id ? annotated : clean;
    pairs.push({ keep: `${keep.name}`, drop: `${drop.name}` });
    if (apply) {
      await mergeArtists({ keepId: keep.id, mergeId: drop.id });
    }
  }

  return { merged: pairs.length, pairs };
}
