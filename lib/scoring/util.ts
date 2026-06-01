import type { SupabaseClient } from "@supabase/supabase-js";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

type RangeQuery<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Supabase 1000행 기본 한도 우회 — range 페이지네이션으로 전체 행 수집 */
export async function fetchAll<T>(q: RangeQuery<T>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/** 점수 일괄 적용 — apply_artist_scores / apply_event_scores RPC를 청크 단위 호출 */
export async function applyScores(
  db: SupabaseClient,
  fn: "apply_artist_scores" | "apply_event_scores",
  rows: Record<string, unknown>[],
  chunk = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.rpc(fn, { updates: rows.slice(i, i + chunk) });
    if (error) throw new Error(error.message);
  }
}
