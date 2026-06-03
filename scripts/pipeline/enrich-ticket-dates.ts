/**
 * 예매일자 그라운딩 보강 실행 — 구글검색으로 예매오픈/마감일 채움.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/pipeline/enrich-ticket-dates.ts [건수]
 *   기본 200건. 종료 안 된 + ticket_open_date 미상 이벤트를 공연일 임박순으로 처리.
 *
 * 못 찾으면 null 유지(가짜날짜 안 박음). 반복 실행하면 다음 배치 진행.
 */
import { enrichEventTicketDates } from "../../lib/ingestion/event-enrich";

async function main() {
  const max = Number(process.argv[2] ?? 200) || 200;
  console.log(`[ticket-dates] 최대 ${max}건 그라운딩 보강 시작...`);
  const r = await enrichEventTicketDates(max);
  console.log(`[ticket-dates] 완료 — 확인 ${r.checked}건, 채움 ${r.filled}건`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
