import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SweepResult {
  updated: number;
  breakdown: { ended: number; ongoing: number; on_sale: number; upcoming: number };
}

export async function sweepEventStatuses(): Promise<SweepResult> {
  const db = createServiceRoleClient();
  const now = new Date().toISOString();
  const onSaleThreshold = new Date(Date.now() + 14 * 86_400_000).toISOString();

  const breakdown = { ended: 0, ongoing: 0, on_sale: 0, upcoming: 0 };

  // ended: end_date 지남
  {
    const { data } = await db
      .from("events")
      .update({ status: "ended" })
      .lt("end_date", now)
      .neq("status", "ended")
      .select("id");
    breakdown.ended = data?.length ?? 0;
  }

  // ongoing: start_date <= now <= end_date
  {
    const { data } = await db
      .from("events")
      .update({ status: "ongoing" })
      .lte("start_date", now)
      .gte("end_date", now)
      .neq("status", "ongoing")
      .select("id");
    breakdown.ongoing = data?.length ?? 0;
  }

  // on_sale: 14일 이내 시작, 아직 시작 전
  {
    const { data } = await db
      .from("events")
      .update({ status: "on_sale" })
      .gt("start_date", now)
      .lte("start_date", onSaleThreshold)
      .not("status", "in", '("ended","ongoing","on_sale")')
      .select("id");
    breakdown.on_sale = data?.length ?? 0;
  }

  // upcoming: 14일 이후 시작
  {
    const { data } = await db
      .from("events")
      .update({ status: "upcoming" })
      .gt("start_date", onSaleThreshold)
      .not("status", "in", '("ended","ongoing","upcoming")')
      .select("id");
    breakdown.upcoming = data?.length ?? 0;
  }

  const updated =
    breakdown.ended + breakdown.ongoing + breakdown.on_sale + breakdown.upcoming;

  return { updated, breakdown };
}
