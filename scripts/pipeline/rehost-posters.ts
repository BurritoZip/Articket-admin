/**
 * 포스터 재호스팅 백필 — 소스 CDN poster_url 을 Supabase 스토리지로 복사·교체.
 * 실행: npx tsx scripts/pipeline/rehost-posters.ts [--dry]
 * 재개 가능(멱등): 이미 supabase.co 인 건 스킵. 실패분은 다음 실행에서 재시도.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(
  resolve(process.cwd(), ".env.local"),
  "utf8",
).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k])
      process.env[k] = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const { createServiceRoleClient } = await import(
    "../../lib/supabase/service-role"
  );
  const db = createServiceRoleClient();

  // 재호스팅 대상 카운트/도메인
  const { data: cand } = await db
    .from("events")
    .select("poster_url")
    .not("poster_url", "is", null)
    .not("poster_url", "ilike", "%supabase.co%")
    .eq("is_hidden", false);
  const dom: Record<string, number> = {};
  for (const r of (cand ?? []) as { poster_url: string }[]) {
    try {
      const h = new URL(r.poster_url).hostname;
      dom[h] = (dom[h] ?? 0) + 1;
    } catch {
      dom["(invalid)"] = (dom["(invalid)"] ?? 0) + 1;
    }
  }
  console.log(`재호스팅 대상(소스CDN poster) ${cand?.length ?? 0}건`);
  for (const [d, n] of Object.entries(dom).sort((a, b) => b[1] - a[1]))
    console.log(`  ${n}\t${d}`);
  if (dry) {
    console.log("\n(--dry. 적용하려면 --dry 없이)");
    return;
  }

  const { rehostEventPosters } = await import(
    "../../lib/ingestion/poster-rehost"
  );
  let total = 0;
  for (let round = 1; ; round++) {
    const r = await rehostEventPosters(40);
    total += r.rehosted;
    console.log(
      `round ${round}: 재호스팅 ${r.rehosted}/${r.checked} (누적 ${total})`,
    );
    if (r.checked === 0) break; // 남은 대상 없음
    if (r.rehosted === 0 && r.checked > 0) {
      // 남았지만 전부 실패(만료·차단) — 무한루프 방지
      console.log("  남은 대상이 전부 재호스팅 실패 — 중단");
      break;
    }
  }
  console.log(`\n완료. 총 재호스팅 ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
