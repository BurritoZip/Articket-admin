"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { toast } from "sonner";

interface ProposalRow {
  id: string;
  name: string;
  name_en: string | null;
  name_proposal: string;
  name_proposal_meta: {
    name_en?: string | null;
    aliases?: string[];
    country?: string | null;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ArtistNameProposalSheet({ open, onClose }: Props) {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["artist-name-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/admin/artists/name-proposals");
      if (!res.ok) throw new Error("제안 조회 실패");
      return res.json() as Promise<{ rows: ProposalRow[]; total: number }>;
    },
    enabled: open,
  });

  const { mutate: resolve, isPending } = useMutation({
    mutationFn: async (v: { id: string; action: "approve" | "reject" }) => {
      const res = await fetch("/api/admin/artists/name-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) throw new Error("처리 실패");
      return res.json();
    },
    onSuccess: (_, v) => {
      toast.success(v.action === "approve" ? "이름 교체됨" : "제안 거절됨");
      void qc.invalidateQueries({ queryKey: ["admin-artists-list"] });
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = data?.rows ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>✏️ 이름 교정 제안 검토</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Gemini 가 현재 이름에 없던 새 표시명을 제안한 건들. 승인하면 표시명이
            바뀌고 기존 이름은 별명으로 보존됩니다.
          </p>
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            불러오는 중...
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <span className="text-2xl">✅</span>
            <p className="text-sm">대기 중인 이름 제안이 없습니다</p>
          </div>
        )}

        <div className="space-y-3" style={{ opacity: isPending ? 0.5 : 1 }}>
          {rows.map((r) => {
            const aliases = r.name_proposal_meta?.aliases ?? [];
            return (
              <div
                key={r.id}
                className="rounded-xl border bg-card p-4 space-y-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">
                    {r.name}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold">{r.name_proposal}</span>
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {r.name_proposal_meta?.country && (
                    <Badge variant="outline">
                      {r.name_proposal_meta.country}
                    </Badge>
                  )}
                  {r.name_proposal_meta?.name_en && (
                    <Badge variant="secondary">
                      EN: {r.name_proposal_meta.name_en}
                    </Badge>
                  )}
                  {aliases.slice(0, 6).map((a) => (
                    <Badge key={a} variant="outline" className="font-normal">
                      {a}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={isPending}
                    onClick={() => resolve({ id: r.id, action: "approve" })}
                  >
                    승인 (이름 교체)
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => resolve({ id: r.id, action: "reject" })}
                  >
                    거절
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
