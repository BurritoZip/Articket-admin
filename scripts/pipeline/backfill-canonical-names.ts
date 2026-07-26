/**
 * 이름 canonical 백필 — 이벤트 연결(활성) 아티스트를 개정 Gemini 프롬프트로 재보강.
 *
 * 재개 가능: 활성 아티스트의 gemini_checked_at 을 한 번 null 로 리셋한 뒤
 * 비-force 로 60개씩 드레인한다. 쿼터(429)로 끊겨도 이미 처리된 건은 checked 로 남아
 * 다음 실행이 남은 것부터 이어서 처리한다.
 *
 * 실행: npx tsx scripts/pipeline/backfill-canonical-names.ts
 *   (Gemini spend cap 이 풀려 있어야 함. 429 나면 중단 — cap 확인 후 재실행)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// .env.local 로드 (dotenv 미설치 환경 대비 직접 파싱)
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
  const { createServiceRoleClient } =
    await import("../../lib/supabase/service-role");
  const { geminiEnrichArtists } =
    await import("../../lib/artists/enrich/gemini-enrich");
  const db = createServiceRoleClient();

  const reset = process.argv.includes("--reset");

  if (reset) {
    // 활성 아티스트 id 수집 후 gemini_checked_at 리셋 — primary + lineup 둘 다.
    const active = new Set<string>();
    for (let f = 0; ; f += 1000) {
      const { data } = await db
        .from("events")
        .select("artist_id")
        .not("artist_id", "is", null)
        .range(f, f + 999);
      if (!data?.length) break;
      for (const e of data as { artist_id: string }[]) active.add(e.artist_id);
      if (data.length < 1000) break;
    }
    for (let f = 0; ; f += 1000) {
      const { data } = await db
        .from("event_artists")
        .select("artist_id")
        .range(f, f + 999);
      if (!data?.length) break;
      for (const e of data as { artist_id: string }[]) active.add(e.artist_id);
      if (data.length < 1000) break;
    }
    const ids = Array.from(active);
    for (let i = 0; i < ids.length; i += 200) {
      await db
        .from("artists")
        .update({ gemini_checked_at: null })
        .in("id", ids.slice(i, i + 200));
    }
    console.log(`reset gemini_checked_at for ${ids.length} active artists`);
  }

  // 드레인
  let totalChecked = 0;
  for (let round = 1; ; round++) {
    const r = await geminiEnrichArtists({ maxItems: 60 });
    totalChecked += r.checked;
    console.log(
      `round ${round}: checked=${r.checked} filled=${r.filled} notMusic=${r.notMusic} (누적 ${totalChecked})`,
    );
    if (r.checked === 0) break; // 남은 것 없음 또는 쿼터로 조기중단
  }

  // 결과 요약
  const { count: proposals } = await db
    .from("artists")
    .select("id", { count: "exact", head: true })
    .not("name_proposal", "is", null);
  console.log(
    `\n완료. 총 checked=${totalChecked}, 검토큐 대기 제안=${proposals ?? 0}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
