import { enrichEventArtists } from "../../lib/ingestion/event-enrich";

// 1회 백필 — 활성 미연결 이벤트(enrich_attempted_at IS NULL)를 소진할 때까지 반복.
// 페스티벌은 Gemini 호출 없이 regex로 multi_artist 분류 → 빠름.
// 개별 콘서트만 Gemini 추출. 마킹 덕에 매 라운드 다음 배치로 진행.
async function main() {
  let totalLinked = 0;
  let totalMulti = 0;
  let totalNone = 0;
  let rounds = 0;

  for (;;) {
    const r = await enrichEventArtists(200);
    const handled = r.linked + r.multiArtist + r.noArtist;
    totalLinked += r.linked;
    totalMulti += r.multiArtist;
    totalNone += r.noArtist;
    rounds++;
    console.log(
      `round ${rounds}: linked=${r.linked} multi_artist=${r.multiArtist} no_artist=${r.noArtist}`,
    );
    if (handled === 0) break; // 처리할 미시도 이벤트 없음
    if (rounds >= 50) {
      console.log("⚠️ 안전 상한(50 rounds) 도달 — 중단");
      break;
    }
  }

  console.log(
    `\n=== 백필 완료 (${rounds} rounds) ===\n` +
      `linked(단일연결):       ${totalLinked}\n` +
      `multi_artist(페스티벌): ${totalMulti}\n` +
      `no_artist(추출불가):    ${totalNone}`,
  );
}
main().catch(console.error);
