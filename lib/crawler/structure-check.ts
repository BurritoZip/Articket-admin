/**
 * 사이트 구조 변경 감지 모듈
 *
 * 크롤링 결과 eventsFound = 0인 경우 구조 변경을 의심하여:
 * 1. ingestion_errors에 step: 'structure_change' 로 기록
 * 2. crawler_sources.config.consecutiveZeroCount 증가
 * 3. 연속 3회 이상이면 lastStructureChangeAt 기록
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logIngestionError } from "@/lib/crawler/error-logger";
import type { CrawlerSourceConfig } from "@/types/crawler";

interface StructureCheckParams {
  jobId: string;
  sourceName: string;
  eventsFound: number;
}

/** 크롤링 완료 후 구조 변경 여부 체크 — eventsFound가 0이면 감지 처리 */
export async function checkStructureChange(
  params: StructureCheckParams,
): Promise<{ detected: boolean; consecutiveZeroCount: number }> {
  const { jobId, sourceName, eventsFound } = params;

  const db = createServiceRoleClient();

  // 현재 소스 config 조회
  const { data: sourceRow } = await db
    .from("crawler_sources")
    .select("id, config")
    .eq("name", sourceName)
    .single();

  if (!sourceRow) return { detected: false, consecutiveZeroCount: 0 };

  const config = (sourceRow.config ?? {}) as CrawlerSourceConfig;
  let consecutiveZeroCount = config.consecutiveZeroCount ?? 0;

  if (eventsFound === 0) {
    // 연속 0건 카운터 증가
    consecutiveZeroCount += 1;

    const newConfig: CrawlerSourceConfig = {
      ...config,
      consecutiveZeroCount,
      ...(consecutiveZeroCount >= 3
        ? { lastStructureChangeAt: new Date().toISOString() }
        : {}),
    };

    // config 업데이트
    await db
      .from("crawler_sources")
      .update({ config: newConfig })
      .eq("id", sourceRow.id);

    // ingestion_errors에 기록
    await logIngestionError({
      jobId,
      sourceName,
      step: "structure_change",
      error: new Error(
        `${sourceName} 크롤링 결과 0건 (연속 ${consecutiveZeroCount}회) — CSS 선택자 변경 의심`,
      ),
      rawPayload: { consecutiveZeroCount, eventsFound },
    });

    return { detected: true, consecutiveZeroCount };
  } else {
    // 성공 시 카운터 리셋
    if (consecutiveZeroCount > 0) {
      await db
        .from("crawler_sources")
        .update({
          config: {
            ...config,
            consecutiveZeroCount: 0,
            lastSuccessCount: eventsFound,
          },
        })
        .eq("id", sourceRow.id);
    }
    return { detected: false, consecutiveZeroCount: 0 };
  }
}
