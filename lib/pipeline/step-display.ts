/**
 * 파이프라인 단계 표시용 공유 포맷터.
 * 라이브 스테퍼(대시보드)와 실행 보고 카드(pipeline_runs.summary)가 같은 델타 표기를 쓰도록
 * 한 곳에 둔다. "이번에 뭘 불러오고 뭘 바꿨나"를 단계별 한두 줄로.
 */

export const STEP_LABELS: Record<string, string> = {
  crawl: "크롤링",
  sweep: "상태 업데이트",
  fix: "품질 수정",
  delete: "불량 삭제",
  enrich: "보강",
  merge: "중복 병합",
  score: "점수 산출",
  purge: "옛날공연 숨김",
};

export const STEP_ORDER = [
  "crawl",
  "sweep",
  "fix",
  "delete",
  "enrich",
  "merge",
  "score",
  "purge",
] as const;

/** 단계 결과(result JSONB)를 사람이 읽는 델타 줄들로. 결과 없으면 빈 배열. */
export function stepResultLines(
  stepName: string,
  result: Record<string, unknown> | null,
): string[] {
  const r = result;
  if (!r) return [];
  if (stepName === "crawl") {
    const sources = Object.entries(r) as Array<[string, Record<string, unknown>]>;
    if (sources.length === 0) return ["활성 소스 없음"];
    return sources.map(([src, d]) =>
      d.error
        ? `${src}: 오류`
        : `${src}: 발견 ${d.eventsFound ?? 0} · 저장 ${d.eventsUpserted ?? 0}`,
    );
  }
  if (stepName === "sweep") {
    const lines = [`업데이트 ${r.updated ?? 0}건`];
    const bd = r.breakdown as Record<string, number> | undefined;
    if (bd) {
      const parts = Object.entries(bd)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`);
      if (parts.length) lines.push(parts.join(" · "));
    }
    return lines;
  }
  if (stepName === "fix") {
    const lines = [`필드수정 ${r.fixed ?? 0}건`];
    if ((r.queued as number) > 0) lines.push(`AI큐 등록 ${r.queued}건`);
    if ((r.flagged as number) > 0) lines.push(`이슈감지 ${r.flagged}건`);
    return lines;
  }
  if (stepName === "delete") return [`삭제 ${r.deleted ?? 0}건`];
  if (stepName === "enrich") {
    const total = r.total_in_queue as number | undefined;
    const processed = (r.processed as number) ?? 0;
    const succeeded = (r.succeeded as number) ?? 0;
    const failed = (r.failed as number) ?? 0;
    const lines = total
      ? [`${processed} / ${total}건 처리`]
      : [`처리 ${processed}건`];
    lines.push(`성공 ${succeeded}  실패 ${failed}`);
    return lines;
  }
  if (stepName === "merge")
    return [`아티스트 ${r.artists ?? 0}건`, `공연장 ${r.venues ?? 0}건`];
  if (stepName === "score")
    return [
      `아티스트 ${r.artist_scored ?? 0}건`,
      `공연 ${r.concert_scored ?? 0}건`,
    ];
  if (stepName === "purge") return [`숨김 ${r.hidden ?? 0}건`];
  return [];
}
