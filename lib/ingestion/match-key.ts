import { createHash } from "crypto";
import { strict as assert } from "node:assert";

// 티켓 종류 마커 — coreTitleKey 에서 이건 안 뗀다(스탠딩/지정석은 auto-merge 다른 패스가 처리).
const TICKET =
  /스탠딩|지정석|얼리버드|예매|선예매|티켓|블라인드|vip|premium|pass|[rsa]석/i;
const FEST = /페스티벌|페스타|페스트|festival|fes\b|fest\b/i;
const LISTING =
  /라인업|얼리버드|티켓|발표|개최|크루|예매|오픈|lineup|[0-9]\s*차|최종/i;

/** NFKC + lowercase + 영숫자·한글만(기호·공백 제거). auto-merge normTitle 과 동일. */
export function normTitleKey(raw: string): string {
  return (raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

/** normTitleKey + 앞 [도시]·뒤 "- 도시"(1~6자) 제거. 티켓 마커는 보존. auto-merge coreKey 와 동일. */
export function coreTitleKey(raw: string): string {
  let t = (raw ?? "").normalize("NFKC");
  const lead = t.match(/^\s*[[(［（]([^\])］）]{1,10})[\])］）]\s*/);
  if (lead && !TICKET.test(lead[1])) t = t.slice(lead[0].length);
  t = t.replace(/[ \t]*[-－‐‑–—―_⎽~∼][ \t]*[가-힣A-Za-z]{1,6}[ \t]*$/, "");
  return t.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

/** 페스티벌/서브listing 신호가 있을 때만 정렬 토큰셋 키. auto-merge festPrefix 와 동일. */
export function festivalKey(raw: string): string | null {
  const s = (raw ?? "").normalize("NFKC");
  const idx = s.search(/\s[-–—]\s/);
  const head = idx >= 0 ? s.slice(0, idx) : s;
  const tail = idx >= 0 ? s.slice(idx) : "";
  if (!FEST.test(head) && !(tail && LISTING.test(tail))) return null;
  const toks = head
    .toLowerCase()
    .split(/[\s·,]+/)
    .map((t) => t.replace(/[^a-z0-9가-힣]/g, ""))
    .filter(
      (t) =>
        t.length >= 2 &&
        !/^20\d\d$/.test(t) &&
        !LISTING.test(t) &&
        !/^[a-z]{1,5}$/.test(t),
    )
    .sort();
  const k = toks.join("");
  return k.length >= 6 ? k : null;
}

/** 이벤트 제목 매칭 키 — 페스티벌이면 토큰셋, 아니면 도시마커 제거 core. */
export function strongTitleKey(raw: string): string {
  return festivalKey(raw) ?? coreTitleKey(raw);
}

/** 이벤트 dedup 키 = strongTitleKey | 공연장 | 날짜. 기존 generateDedupKey 대체. */
export function eventDedupKey(
  rawTitle: string,
  normalizedVenueName: string | null,
  startDate: string | null,
): string {
  const title = strongTitleKey(rawTitle) || (rawTitle ?? "").toLowerCase().trim();
  const parts = [
    title,
    (normalizedVenueName ?? "unknown").toLowerCase().trim(),
    startDate ?? "unknown",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function demo(): void {
  // 도시 마커 흡수(비페스티벌 → coreTitleKey)
  assert.equal(
    strongTitleKey("[부산] 유승우 콘서트"),
    strongTitleKey("유승우 콘서트 - 부산"),
    "city marker collapse",
  );
  // 전각/반각
  assert.equal(strongTitleKey("［서울］ 아이유"), strongTitleKey("[서울] 아이유"), "fullwidth");
  // 회차 보존(합치면 안 됨)
  assert.notEqual(
    strongTitleKey("굴다리 콘서트 1부"),
    strongTitleKey("굴다리 콘서트 2부"),
    "session preserved",
  );
  // 티켓 종류는 core 에서 보존(스탠딩≠지정석) — auto-merge 다른 패스가 판단
  assert.notEqual(
    coreTitleKey("[스탠딩] 어떤공연"),
    coreTitleKey("[지정석] 어떤공연"),
    "ticket grade kept",
  );
  // 페스티벌 티켓팅 분할 → 같은 토큰셋 키
  assert.equal(
    strongTitleKey("2026 서울숲재즈페스티벌 - 얼리버드"),
    strongTitleKey("2026 서울숲재즈페스티벌 - 1차 라인업"),
    "festival ticketing split collapse",
  );
  // 서로 다른 페스티벌은 안 합침
  assert.notEqual(
    strongTitleKey("서울숲재즈페스티벌 - 티켓"),
    strongTitleKey("부산국제록페스티벌 - 티켓"),
    "different festivals kept",
  );
  console.log("match-key demo OK");
}

if (require.main === module) demo();
