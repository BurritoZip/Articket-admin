/**
 * 일회성 공연장 정리 (Gemini 다운 대응 — Claude 사용):
 *  Phase 1. address==이름 등 오염 주소 → Claude+웹검색으로 실주소 채움(실패 시 null)
 *  Phase 2. 이름 변형 중복(대형 공연장 별칭) → Claude 판정 후 mergeVenues 병합
 *
 * 실행: npx tsx scripts/pipeline/venue-cleanup-claude.ts [--apply]
 *   인자 없으면 dry-run(쓰기 없음). --apply 명시해야 실제 UPDATE/merge.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeVenues } from "@/lib/venues/merge";
import {
  detectDuplicateCandidates,
  type VenueBasic,
} from "@/lib/venues/dedup-detect";

const APPLY = process.argv.includes("--apply");
const db = createServiceRoleClient();
const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용

const MODEL = "claude-opus-4-8";
const ADDRESS_KW = /시|구|동|로|길|번지|특별시|광역시|도\s|읍|면/;

/** address가 실제 주소가 아니라 이름/쓰레기인지 판정 (null·빈값은 제외 — Gemini 담당) */
function isGarbageAddress(name: string, address: string | null): boolean {
  if (!address || address.trim() === "") return false;
  const a = address.trim();
  const norm = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^가-힣a-z0-9]/g, "");
  if (norm(a) === norm(name)) return true;
  if (a.length < 5) return true;
  if (!ADDRESS_KW.test(a)) return true;
  return false;
}

/** Claude 호출(web_search 그라운딩). 최종 text 블록 이어붙여 반환. pause_turn 재개. */
async function askClaude(prompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  for (let i = 0; i < 6; i++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return "";
}

/** 실주소 예측 — 유효하면 주소 문자열, 아니면 null */
async function predictAddress(name: string): Promise<string | null> {
  const out = await askClaude(
    `다음 공연장의 실제 도로명 주소를 웹에서 확인해 알려주세요. 확실하지 않으면 "모름"이라고만 답하세요.\n` +
      `공연장: "${name}"\n` +
      `마지막 줄에 주소만 한 줄로(도로명 주소 형식, 확실치 않으면 "모름"):`,
  );
  const line =
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ?? "";
  if (!line || line === "모름" || line.length < 5 || line.length > 150)
    return null;
  if (!ADDRESS_KW.test(line)) return null;
  return line;
}

/** 두 공연장이 같은 물리적 공간인지 판정 */
async function isSameVenue(
  a: { name: string; address: string | null },
  b: { name: string; address: string | null },
): Promise<boolean> {
  const out = await askClaude(
    `아래 두 공연장이 같은 물리적 공연장(같은 건물/장소, 이름만 다른 경우 포함)인지 판정하세요.\n` +
      `필요하면 웹검색으로 별칭·주소를 확인하세요. 주소가 명확히 다른 별개 장소면 다른 곳입니다.\n` +
      `A: 이름="${a.name}" 주소="${a.address ?? ""}"\n` +
      `B: 이름="${b.name}" 주소="${b.address ?? ""}"\n` +
      `마지막 줄에 SAME 또는 DIFFERENT 만:`,
  );
  return /\bSAME\b/i.test(out.split("\n").pop() ?? "");
}

async function phase1(): Promise<void> {
  console.log(
    `\n=== Phase 1: 주소 오염 수정 ${APPLY ? "(apply)" : "(dry-run)"} ===`,
  );
  const { data: rows } = await db
    .from("venues")
    .select("id,name,address")
    .not("address", "is", null)
    .neq("address", "")
    .is("address_attempted_at", null)
    .limit(2000);

  const garbage = (rows ?? []).filter((v) =>
    isGarbageAddress(v.name, v.address),
  );
  console.log(`오염 후보: ${garbage.length}개`);

  let fixed = 0;
  let nulled = 0;
  for (const v of garbage) {
    let addr: string | null;
    try {
      addr = await predictAddress(v.name);
    } catch (e) {
      console.error(`  [ERROR] predictAddress("${v.name}") 실패, skip: ${e}`);
      continue;
    }
    if (addr) {
      console.log(`  [FIX] "${v.name}": "${v.address}" → "${addr}"`);
      fixed++;
    } else {
      console.log(`  [NULL] "${v.name}": "${v.address}" → (null)`);
      nulled++;
    }
    if (APPLY) {
      const now = new Date().toISOString();
      await db
        .from("venues")
        .update(
          addr
            ? { address: addr, address_attempted_at: now }
            : { address: null, address_attempted_at: now },
        )
        .eq("id", v.id);
    }
  }
  console.log(`Phase 1 결과: fix ${fixed}, null ${nulled}`);
}

async function phase2(): Promise<void> {
  console.log(
    `\n=== Phase 2: 이름 변형 중복 병합 ${APPLY ? "(apply)" : "(dry-run)"} ===`,
  );
  const { data: rawVenues } = await db
    .from("venues")
    .select("id,name,address,normalized_name")
    .limit(3000);
  const venues = (rawVenues ?? []) as VenueBasic[];

  const { data: eventLinks } = await db
    .from("events")
    .select("venue_id")
    .not("venue_id", "is", null);
  const linkedCountMap: Record<string, number> = {};
  for (const { venue_id } of eventLinks ?? []) {
    if (venue_id)
      linkedCountMap[venue_id] = (linkedCountMap[venue_id] ?? 0) + 1;
  }

  const candidates = detectDuplicateCandidates(venues, linkedCountMap);
  console.log(`병합 후보쌍: ${candidates.length}개`);

  let merged = 0;
  let kept = 0;
  const mergedAway = new Set<string>();
  for (const c of candidates) {
    const [keep, other] = c.members; // members[0]=keep(event 많은쪽)
    if (mergedAway.has(keep.id) || mergedAway.has(other.id)) {
      console.log(`  [SKIP] "${keep.name}" ↔ "${other.name}" (이미 병합됨)`);
      continue;
    }
    let same: boolean;
    try {
      same = await isSameVenue(
        { name: keep.name, address: keep.address },
        { name: other.name, address: other.address },
      );
    } catch (e) {
      console.error(
        `  [ERROR] isSameVenue("${keep.name}", "${other.name}") 실패, skip: ${e}`,
      );
      continue;
    }
    if (same) {
      console.log(`  [MERGE] keep "${keep.name}" ← "${other.name}"`);
      merged++;
      mergedAway.add(other.id);
      if (APPLY) {
        const r = await mergeVenues(keep.id, other.id);
        if (!r.ok) console.log(`    실패: ${r.errors.join("; ")}`);
      }
    } else {
      console.log(`  [KEEP] "${keep.name}" ≠ "${other.name}" (별개)`);
      kept++;
    }
  }
  console.log(`Phase 2 결과: merge ${merged}, keep ${kept}`);
}

async function main(): Promise<void> {
  console.log(`공연장 정리 시작 — ${APPLY ? "실제 실행(--apply)" : "DRY-RUN"}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY 환경변수가 없습니다. .env.local 확인.");
    process.exit(1);
  }
  await phase1();
  await phase2();
  console.log("\n완료.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
