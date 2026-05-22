import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    name?: string;
    address?: string;
    phone_number?: string;
  };

  const payload: Record<string, string> = {};
  if (typeof body.name === "string") payload.name = body.name.trim();
  if (typeof body.address === "string") payload.address = body.address.trim();
  if (typeof body.phone_number === "string") {
    payload.phone_number = body.phone_number.trim();
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("venues")
    .update(payload)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("venues").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
