import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { VenueRow } from "@/types/venue";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("id, name, address, phone_number")
    .order("name", { ascending: true });

  if (error) {
    // 테이블 미생성 시에도 페이지는 열리도록 처리
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ rows: [], warning: "venues 테이블이 아직 없습니다." });
    }
    return NextResponse.json(
      { error: "list_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ rows: (data ?? []) as VenueRow[] });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<VenueRow>;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const supabase = createClient();
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
