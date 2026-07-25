import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeKey } from "@/lib/artists/normalize";
import { addArtistAliases } from "@/lib/artists/aliases";

interface ProposalMeta {
  name_en?: string | null;
  aliases?: string[];
  country?: string | null;
  reason?: string;
  source?: string;
  proposed_at?: string;
}

// 대기 중인 이름 제안 목록
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("artists")
    .select("id, name, name_en, name_proposal, name_proposal_meta")
    .not("name_proposal", "is", null)
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { error: "list_failed", detail: error.message },
      { status: 400 },
    );
  }
  return NextResponse.json({ rows: data ?? [], total: (data ?? []).length });
}

// 제안 승인/거절. { id, action: "approve" | "reject" }
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id, action } = (await request.json()) as {
    id?: string;
    action?: "approve" | "reject";
  };
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: artist } = await supabase
    .from("artists")
    .select("id, name, name_en, name_proposal, name_proposal_meta")
    .eq("id", id)
    .maybeSingle();
  if (!artist || !artist.name_proposal) {
    return NextResponse.json({ error: "no_proposal" }, { status: 404 });
  }

  if (action === "reject") {
    await supabase
      .from("artists")
      .update({ name_proposal: null, name_proposal_meta: null })
      .eq("id", id);
    return NextResponse.json({ ok: true, applied: false });
  }

  // approve: 제안명을 표시명으로 승격, 옛 이름·표기는 alias 로 보존
  const meta = (artist.name_proposal_meta ?? {}) as ProposalMeta;
  const newName = artist.name_proposal.trim();
  const { error } = await supabase
    .from("artists")
    .update({
      name: newName,
      normalized_name: normalizeKey(newName),
      name_en: meta.name_en ?? artist.name_en ?? null,
      name_proposal: null,
      name_proposal_meta: null,
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: "approve_failed", detail: error.message },
      { status: 400 },
    );
  }
  await addArtistAliases(
    supabase,
    id,
    [artist.name, meta.name_en, ...(meta.aliases ?? [])],
    "proposal-approve",
  );
  return NextResponse.json({ ok: true, applied: true });
}
