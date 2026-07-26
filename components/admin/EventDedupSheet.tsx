"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Label } from "@/components/ui/Label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";
import { toast } from "sonner";
import type { EventDedupCandidate, EventDedupMember } from "@/lib/events/dedup";

interface EventDedupSheetProps {
  open: boolean;
  onClose: () => void;
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  same_title_diff_day: { label: "제목 동일·날짜 다름", color: "warning" },
  same_artist_similar: { label: "같은 아티스트·유사 제목", color: "secondary" },
};

function fmtRange(start: string | null, end: string | null): string {
  const s = start ? String(start).slice(0, 10) : "?";
  const e = end ? String(end).slice(0, 10) : null;
  return e && e !== s ? `${s} ~ ${e}` : s;
}

function MemberCard({
  member,
  isSelected,
  onSelect,
}: {
  member: EventDedupMember;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          id={member.id}
          name={`keep-${member.id}`}
          value={member.id}
          checked={isSelected}
          onChange={onSelect}
          className="mt-1 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <Label htmlFor={member.id} className="cursor-pointer">
            <div className="font-medium text-sm break-words">
              {member.title}
            </div>
          </Label>
          <div className="text-xs text-muted-foreground mt-0.5">
            📅 {fmtRange(member.start_date, member.end_date)}
            {member.venue_name ? ` · 📍 ${member.venue_name}` : ""}
            {member.artist_name ? ` · 🎤 ${member.artist_name}` : ""}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {member.sources.map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">
                {s}
              </Badge>
            ))}
            {member.poster_url && (
              <Badge variant="outline" className="text-xs">
                포스터
              </Badge>
            )}
            <Badge variant="outline" className="text-xs text-muted-foreground">
              정보 {member.info_score}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  onMerge,
  onSkip,
}: {
  candidate: EventDedupCandidate;
  onMerge: (keepId: string, mergeId: string) => void;
  onSkip: () => void;
}) {
  const [keepId, setKeepId] = useState(candidate.suggestedKeepId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mergeId = candidate.members.find((m) => m.id !== keepId)?.id;
  const keepMember = candidate.members.find((m) => m.id === keepId);
  const mergeMember = candidate.members.find((m) => m.id === mergeId);
  const reason = REASON_LABELS[candidate.reason] ?? {
    label: candidate.reason,
    color: "outline",
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Badge
          variant={
            reason.color as
              | "default"
              | "secondary"
              | "danger"
              | "outline"
              | "warning"
          }
        >
          {reason.label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          유사도 {(candidate.similarity * 100).toFixed(0)}%
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground font-medium">
          유지할 공연 선택 (나머지가 흡수됩니다):
        </p>
        {candidate.members.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            isSelected={keepId === member.id}
            onSelect={() => setKeepId(member.id)}
          />
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={!mergeId}
          className="flex-1"
        >
          🔀 머지
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          건너뛰기
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공연 머지 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>&ldquo;{mergeMember?.title}&rdquo;</strong>을(를){" "}
                  <strong>&ldquo;{keepMember?.title}&rdquo;</strong>으로
                  흡수합니다.
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>
                    비어있는 필드·예매/관심/리뷰가 유지 공연으로 이전됩니다
                  </li>
                  <li>흡수된 공연은 삭제됩니다(스냅샷 복구 가능)</li>
                  <li>
                    투어·회차라면 머지하지 말고 <strong>건너뛰기</strong>를
                    누르세요
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mergeId) onMerge(keepId, mergeId);
                setConfirmOpen(false);
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              머지 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function EventDedupSheet({ open, onClose }: EventDedupSheetProps) {
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["event-dedup"],
    queryFn: async () => {
      const res = await fetch("/api/admin/events/dedup?limit=100");
      if (!res.ok) throw new Error("중복 탐지 실패");
      return res.json() as Promise<{
        candidates: EventDedupCandidate[];
        total: number;
        byReason: Record<string, number>;
      }>;
    },
    enabled: open,
    staleTime: 1000 * 60 * 5,
  });

  const { mutate: doMerge, isPending: isMerging } = useMutation({
    mutationFn: async ({
      keepId,
      mergeId,
    }: {
      keepId: string;
      mergeId: string;
    }) => {
      const res = await fetch("/api/admin/events/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, mergeId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "머지 실패");
      }
      return res.json();
    },
    onSuccess: (_, { keepId, mergeId }) => {
      toast.success("머지 완료");
      setSkipped((s) => {
        const next = new Set(s);
        next.add([keepId, mergeId].sort().join("|"));
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["admin-events"] });
      void qc.invalidateQueries({ queryKey: ["admin-events-stats"] });
      void refetch();
    },
    onError: (e) => toast.error(`머지 실패: ${e.message}`),
  });

  const visibleCandidates = (data?.candidates ?? []).filter((c) => {
    const key = c.members
      .map((m) => m.id)
      .sort()
      .join("|");
    return !skipped.has(key);
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>🔀 중복 공연 검토</SheetTitle>
          {data && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(data.byReason).map(([reason, count]) =>
                count > 0 ? (
                  <Badge key={reason} variant="outline">
                    {REASON_LABELS[reason]?.label ?? reason}: {count}
                  </Badge>
                ) : null,
              )}
            </div>
          )}
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            중복 탐지 중...
          </div>
        )}

        {!isLoading && visibleCandidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <span className="text-2xl">✅</span>
            <p className="text-sm">검토할 중복 공연이 없습니다</p>
          </div>
        )}

        <div className="space-y-3" style={{ opacity: isMerging ? 0.5 : 1 }}>
          {visibleCandidates.map((candidate, i) => {
            const key = candidate.members
              .map((m) => m.id)
              .sort()
              .join("|");
            return (
              <CandidateCard
                key={`${key}-${i}`}
                candidate={candidate}
                onMerge={(keepId, mergeId) => doMerge({ keepId, mergeId })}
                onSkip={() =>
                  setSkipped((s) => {
                    const next = new Set(s);
                    next.add(key);
                    return next;
                  })
                }
              />
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
