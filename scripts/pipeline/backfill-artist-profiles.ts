import {
  queueArtistEnrichment,
  processArtistEnrichmentQueue,
} from "../../lib/artists/enrich";

// 1회 백필 — 미보강 아티스트를 큐에 적재 후 큐가 빌 때까지 드레인.
// (namu/melon/naver/wikipedia 스크래핑 — 라운드당 시간 소요)
async function main() {
  let succeeded = 0;
  let failed = 0;
  let totalQueued = 0;
  let rounds = 0;

  // 외부 루프: queueArtistEnrichment는 한 번에 최대 500만 적재 → 큐가 빌 때까지 재적재·드레인
  for (let batch = 0; batch < 20; batch++) {
    const q = await queueArtistEnrichment();
    if (q.queued === 0) break; // 더 적재할 미보강 아티스트 없음
    totalQueued += q.queued;
    console.log(`[batch ${batch + 1}] 큐 적재 ${q.queued}건`);

    for (;;) {
      const r = await processArtistEnrichmentQueue(20);
      succeeded += r.succeeded;
      failed += r.failed;
      rounds++;
      if (rounds % 5 === 0)
        console.log(
          `  round ${rounds}: 누적 성공 ${succeeded} / 실패 ${failed}`,
        );
      if (r.processed === 0) break;
    }
  }

  console.log(
    `\n=== 아티스트 프로필 백필 완료 (${rounds} rounds) ===\n` +
      `적재 ${totalQueued} / 성공 ${succeeded} / 실패 ${failed}`,
  );
}
main().catch(console.error);
