/**
 * 비-콘서트 제거 스크립트
 *
 * 정책: 가수/밴드 콘서트 + 음악 페스티벌만 남기고 나머지(뮤지컬·클래식·연극·전시 등) 전부 삭제.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/pipeline/purge-non-concerts.ts          # dry-run 미리보기(분류 후 결정파일 저장)
 *   npx tsx --env-file=.env.local scripts/pipeline/purge-non-concerts.ts --apply  # 결정파일대로 실제 삭제
 *   추가 옵션: --reclassify  (저장된 결정 무시하고 Gemini 재분류)
 *
 * 흐름: dry 실행 → 미리보기/결정파일 → 사람이 확인 → --apply 로 cascade 삭제.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import {
  classifyTitlesKeep,
  type KeepVerdict,
} from "../../lib/data-quality/classify-keep";

const DECISION_FILE = join(process.cwd(), ".cache", "purge-decisions.json");

interface Decision {
  id: string;
  title: string;
  genre: string | null;
  // unknown(분류 실패)도 올 수 있다. apply 는 drop 만 삭제하므로 unknown=보존이 되어 안전.
  verdict: KeepVerdict;
}

async function classifyAll(): Promise<Decision[]> {
  const db = createServiceRoleClient();
  const all: { id: string; title: string; genre: string | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("events")
      .select("id,title,genre")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as typeof all));
    if (data.length < PAGE) break;
  }
  console.log(`[classify] 총 ${all.length}건 분류 시작 (Gemini 배치)...`);

  const verdicts = await classifyTitlesKeep(
    all.map((e) => e.title),
    (done, total) => {
      if (done % 250 === 0 || done === total)
        console.log(`  분류 진행 ${done}/${total}`);
    },
  );

  return all.map((e, i) => ({ ...e, verdict: verdicts[i] }));
}

function preview(decisions: Decision[]) {
  const drop = decisions.filter((d) => d.verdict === "drop");
  const keep = decisions.filter((d) => d.verdict === "keep");
  console.log(`\n=== 미리보기 ===`);
  console.log(`KEEP(남김): ${keep.length}`);
  console.log(`DROP(삭제): ${drop.length}`);

  // 기존 genre 분포로 DROP 교차검증
  const byGenre = new Map<string, number>();
  for (const d of drop) {
    const g = d.genre ?? "(null)";
    byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
  }
  console.log(`\nDROP 대상 기존 genre 분포:`);
  for (const [g, n] of Array.from(byGenre).sort((a, b) => b[1] - a[1]))
    console.log(`  ${g.padEnd(10)} ${n}`);

  console.log(`\nDROP 샘플 40건:`);
  for (const d of drop.slice(0, 40))
    console.log(`  [${(d.genre ?? "-").padEnd(6)}] ${d.title}`);

  // KEEP 인데 의심스러운 것(기존 genre가 전시/뮤지컬 등) — 오분류 점검용
  const suspectKeep = keep.filter(
    (d) => d.genre && /전시|뮤지컬|연극|클래식|오페라|무용/.test(d.genre),
  );
  if (suspectKeep.length) {
    console.log(
      `\n⚠️ KEEP 인데 기존 genre가 비음악인 의심건 ${suspectKeep.length} (샘플 20):`,
    );
    for (const d of suspectKeep.slice(0, 20))
      console.log(`  [${d.genre}] ${d.title}`);
  }
}

async function apply(decisions: Decision[]) {
  const db = createServiceRoleClient();
  const drop = decisions.filter((d) => d.verdict === "drop");
  console.log(`\n[apply] ${drop.length}건 삭제 시작 (cascade)...`);
  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < drop.length; i += CHUNK) {
    const ids = drop.slice(i, i + CHUNK).map((d) => d.id);
    const { error } = await db.from("events").delete().in("id", ids);
    if (error) {
      console.error(`  삭제 실패 @${i}:`, error.message);
      continue;
    }
    deleted += ids.length;
    if (deleted % 500 === 0 || i + CHUNK >= drop.length)
      console.log(`  삭제 진행 ${deleted}/${drop.length}`);
  }
  console.log(`[apply] 완료 — ${deleted}건 삭제됨`);
}

async function main() {
  const args = process.argv.slice(2);
  const doApply = args.includes("--apply");
  const reclassify = args.includes("--reclassify");

  let decisions: Decision[];
  if (existsSync(DECISION_FILE) && !reclassify) {
    decisions = JSON.parse(readFileSync(DECISION_FILE, "utf8"));
    console.log(
      `[load] 저장된 결정 ${decisions.length}건 사용 (${DECISION_FILE})`,
    );
  } else {
    decisions = await classifyAll();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
    writeFileSync(DECISION_FILE, JSON.stringify(decisions, null, 0));
    console.log(`[save] 결정 저장 → ${DECISION_FILE}`);
  }

  preview(decisions);

  if (doApply) {
    await apply(decisions);
  } else {
    console.log(
      `\n실제 삭제하려면: npx tsx --env-file=.env.local scripts/pipeline/purge-non-concerts.ts --apply`,
    );
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
