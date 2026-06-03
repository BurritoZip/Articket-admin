/**
 * 이벤트 이름 중복 검토 리스트 (Gemini 불필요 — 순수 문자열 퍼지매칭)
 *
 * 삭제·병합은 하지 않는다. 중복 후보 클러스터만 뽑아 사람이 검토하도록 출력한다.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/pipeline/dedup-review.ts
 *   결과: 콘솔 요약 + .cache/dedup-review.json (전체 클러스터)
 *
 * 매칭 방식:
 *   - normalized_title 정확 일치 → 강한 중복
 *   - normalized_title Levenshtein 유사도 >= 0.88 → 약한 중복 후보
 *   - 비교 폭주 방지: 앞 4글자 블록으로 버킷팅 후 버킷 내부만 비교
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../../lib/supabase/service-role";

interface Ev {
  id: string;
  title: string;
  normalized_title: string | null;
  start_date: string | null;
  venue_id: string | null;
  status: string | null;
}

function norm(e: Ev): string {
  return (e.normalized_title ?? e.title ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[!-/:-@[-`{-~~·…“”‘’\-–—()[\]<>「」『』【】、，。!?]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

async function fetchAll(): Promise<Ev[]> {
  const db = createServiceRoleClient();
  const all: Ev[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("events")
      .select("id,title,normalized_title,start_date,venue_id,status")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < PAGE) break;
  }
  return all;
}

interface Cluster {
  key: string;
  kind: "exact" | "fuzzy";
  members: {
    id: string;
    title: string;
    start_date: string | null;
    status: string | null;
  }[];
}

async function main() {
  const events = await fetchAll();
  console.log(`[dedup] ${events.length}건 로드`);

  const keyed = events
    .map((e) => ({ e, k: norm(e) }))
    .filter((x) => x.k.length >= 3);

  // 1) 정확 일치 클러스터
  const exactMap = new Map<string, Ev[]>();
  for (const { e, k } of keyed) {
    const arr = exactMap.get(k) ?? [];
    arr.push(e);
    exactMap.set(k, arr);
  }
  const clusters: Cluster[] = [];
  const consumed = new Set<string>(); // 이미 정확클러스터에 묶인 id
  for (const [k, arr] of Array.from(exactMap)) {
    if (arr.length > 1) {
      arr.forEach((e) => consumed.add(e.id));
      clusters.push({
        key: k,
        kind: "exact",
        members: arr.map((e) => ({
          id: e.id,
          title: e.title,
          start_date: e.start_date,
          status: e.status,
        })),
      });
    }
  }

  // 2) 퍼지 클러스터 — 앞 4글자 블록 버킷 내부 비교, 정확클러스터에 안 묶인 것끼리
  const remaining = keyed.filter((x) => !consumed.has(x.e.id));
  const buckets = new Map<string, { e: Ev; k: string }[]>();
  for (const x of remaining) {
    const b = x.k.slice(0, 4);
    const arr = buckets.get(b) ?? [];
    arr.push(x);
    buckets.set(b, arr);
  }
  const used = new Set<string>();
  for (const [, arr] of Array.from(buckets)) {
    for (let i = 0; i < arr.length; i++) {
      if (used.has(arr[i].e.id)) continue;
      const group = [arr[i]];
      for (let j = i + 1; j < arr.length; j++) {
        if (used.has(arr[j].e.id)) continue;
        if (ratio(arr[i].k, arr[j].k) >= 0.88) group.push(arr[j]);
      }
      if (group.length > 1) {
        group.forEach((g) => used.add(g.e.id));
        clusters.push({
          key: arr[i].k,
          kind: "fuzzy",
          members: group.map((g) => ({
            id: g.e.id,
            title: g.e.title,
            start_date: g.e.start_date,
            status: g.e.status,
          })),
        });
      }
    }
  }

  clusters.sort((a, b) => b.members.length - a.members.length);
  const exactN = clusters.filter((c) => c.kind === "exact");
  const fuzzyN = clusters.filter((c) => c.kind === "fuzzy");
  const dupRows = clusters.reduce((s, c) => s + c.members.length, 0);

  console.log(`\n=== 중복 검토 요약 ===`);
  console.log(`정확일치 클러스터: ${exactN.length}`);
  console.log(`퍼지 클러스터:    ${fuzzyN.length}`);
  console.log(
    `중복 연루 이벤트:  ${dupRows} (잠재 삭제여지 ${dupRows - clusters.length})`,
  );

  console.log(`\n상위 25 클러스터:`);
  for (const c of clusters.slice(0, 25)) {
    console.log(`\n[${c.kind}] x${c.members.length}`);
    for (const m of c.members)
      console.log(
        `   ${(m.start_date ?? "-").slice(0, 10)}  ${(m.status ?? "-").padEnd(8)}  ${m.title}`,
      );
  }

  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  const out = join(process.cwd(), ".cache", "dedup-review.json");
  writeFileSync(out, JSON.stringify(clusters, null, 2));
  console.log(`\n전체 클러스터 저장 → ${out}`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
