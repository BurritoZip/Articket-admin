import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SweepResult {
  updated: number;
  breakdown: {
    ended: number;
    ongoing: number;
    on_sale: number;
    upcoming: number;
  };
}

// 상태 판정 기준 (공연일자 ≠ 예매일자 구분):
//   ended   = 공연 종료     → end_date < now
//   ongoing = 공연중         → start_date <= now <= end_date
//   upcoming= 예매예정       → 공연 전 + 예매오픈일이 미래 (ticket_open_date > now)
//   on_sale = 예매중         → 공연 전 + 예매오픈 됨 + 예매마감 안 지남
//                              (open이 null이면 "공연 안 끝났으면 예매중"으로 간주)
export async function sweepEventStatuses(): Promise<SweepResult> {
  const db = createServiceRoleClient();
  const now = new Date().toISOString();

  const breakdown = { ended: 0, ongoing: 0, on_sale: 0, upcoming: 0 };

  // DB 에러를 조용히 삼키지 않도록 — 실패 시 어느 단계인지 명시해 throw(라우트가 500 반환)
  const count = (
    phase: keyof SweepResult["breakdown"],
    res: { data: unknown[] | null; error: { message: string } | null },
  ): number => {
    if (res.error) {
      throw new Error(`sweep ${phase} 실패: ${res.error.message}`);
    }
    return res.data?.length ?? 0;
  };

  // ended: 공연 종료일 지남 (end_date 가 null 이면 start_date 로 판정)
  breakdown.ended = count(
    "ended",
    await db
      .from("events")
      .update({ status: "ended" })
      .or(`end_date.lt.${now},and(end_date.is.null,start_date.lt.${now})`)
      .neq("status", "ended")
      .select("id"),
  );

  // ongoing: 공연중 (start_date <= now <= end_date)
  breakdown.ongoing = count(
    "ongoing",
    await db
      .from("events")
      .update({ status: "ongoing" })
      .lte("start_date", now)
      .gte("end_date", now)
      .neq("status", "ongoing")
      .select("id"),
  );

  // upcoming: 예매예정 — 공연 전이고 예매오픈일이 아직 미래
  breakdown.upcoming = count(
    "upcoming",
    await db
      .from("events")
      .update({ status: "upcoming" })
      .gt("start_date", now)
      .gt("ticket_open_date", now)
      .not("status", "in", '("ended","ongoing","upcoming")')
      .select("id"),
  );

  // on_sale: 예매중 — 공연 전 + 예매오픈됨(또는 오픈일 미상) + 예매마감 안 지남
  //   open  조건: ticket_open_date IS NULL OR ticket_open_date <= now
  //   close 조건: ticket_close_date IS NULL OR ticket_close_date >= now
  //   (PostgREST에서 .or() 를 두 번 체이닝하면 두 조건이 AND 로 결합됨)
  breakdown.on_sale = count(
    "on_sale",
    await db
      .from("events")
      .update({ status: "on_sale" })
      .gt("start_date", now)
      .or(`ticket_open_date.is.null,ticket_open_date.lte.${now}`)
      .or(`ticket_close_date.is.null,ticket_close_date.gte.${now}`)
      .not("status", "in", '("ended","ongoing","on_sale")')
      .select("id"),
  );

  const updated =
    breakdown.ended +
    breakdown.ongoing +
    breakdown.on_sale +
    breakdown.upcoming;

  return { updated, breakdown };
}
