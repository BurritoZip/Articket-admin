import { processVenueAddressEnrichment } from "../../lib/venues/enrich";

// 1회 백필 — 주소 없는 공연장(address_attempted_at IS NULL)을 소진할 때까지 반복.
async function main() {
  let totalFilled = 0;
  let totalProcessed = 0;
  let rounds = 0;

  for (;;) {
    const r = await processVenueAddressEnrichment(40);
    totalProcessed += r.processed;
    totalFilled += r.filled;
    rounds++;
    console.log(`round ${rounds}: processed=${r.processed} filled=${r.filled}`);
    if (r.processed === 0) break;
    if (rounds >= 50) {
      console.log("⚠️ 안전 상한(50 rounds) 도달 — 중단");
      break;
    }
  }

  console.log(
    `\n=== 공연장 주소 백필 완료 (${rounds} rounds) ===\n` +
      `시도: ${totalProcessed}  주소채움: ${totalFilled}  실패(주소 못찾음): ${totalProcessed - totalFilled}`,
  );
}
main().catch(console.error);
