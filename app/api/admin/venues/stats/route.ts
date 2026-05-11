import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();

  const [address, phoneNumber, allNames] = await Promise.all([
    supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .or("address.is.null,address.eq."),
    supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .or("phone_number.is.null,phone_number.eq."),
    supabase.from("venues").select("name"),
  ]);

  const nameCounts: Record<string, number> = {};
  for (const row of allNames.data ?? []) {
    nameCounts[row.name] = (nameCounts[row.name] ?? 0) + 1;
  }
  const duplicateCount = Object.values(nameCounts)
    .filter((c) => c > 1)
    .reduce((sum, c) => sum + c, 0);

  return NextResponse.json({
    missingCounts: {
      address: address.count ?? 0,
      phone_number: phoneNumber.count ?? 0,
    },
    duplicateCount,
  });
}
