import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { VenueRow } from "@/types/venue";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const missingField = url.searchParams.get("missing")?.trim();
  const duplicatesOnly = url.searchParams.get("duplicates") === "true";
  const searchQ = url.searchParams.get("q")?.trim() ?? "";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const VALID_MISSING = new Set(["address", "phone_number"]);

  const supabase = createClient();
  let venueQuery = supabase
    .from("venues")
    .select("id, name, address, phone_number", { count: "exact" })
    .order("name", { ascending: true });

  if (searchQ) {
    venueQuery = venueQuery.ilike("name", `%${searchQ}%`);
  }

  if (missingField && VALID_MISSING.has(missingField)) {
    venueQuery = venueQuery.or(`${missingField}.is.null,${missingField}.eq.`);
  }

  if (duplicatesOnly) {
    const { data: allNames } = await supabase.from("venues").select("name");
    const nameCounts: Record<string, number> = {};
    for (const { name } of allNames ?? []) {
      nameCounts[name] = (nameCounts[name] ?? 0) + 1;
    }
    const duplicateNames = Object.keys(nameCounts).filter(
      (n) => nameCounts[n] > 1,
    );
    if (duplicateNames.length === 0) {
      return NextResponse.json({
        rows: [],
        ...buildPaginationMeta(page, pageSize, 0),
      });
    }
    venueQuery = venueQuery.in("name", duplicateNames);
  }

  const { data, error, count } = await venueQuery.range(from, to);

  if (error) {
    // 테이블 미생성 시에도 페이지는 열리도록 처리
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({
        rows: [],
        ...buildPaginationMeta(page, pageSize, 0),
        warning: "venues 테이블이 아직 없습니다.",
      });
    }
    return NextResponse.json(
      { error: "list_failed", detail: error.message },
      { status: 400 },
    );
  }

  const total = count ?? 0;
  return NextResponse.json({
    rows: (data ?? []) as VenueRow[],
    ...buildPaginationMeta(page, pageSize, total),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<VenueRow>;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("venues").insert({
    name: body.name.trim(),
    address: body.address?.trim() ?? "",
    phone_number: body.phone_number?.trim() ?? "",
  });

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
