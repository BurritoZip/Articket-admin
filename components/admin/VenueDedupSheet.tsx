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

// ── 타입 ────────────────────────────────────────────────────────────

interface VenueMember {
  id: string;
  name: string;
  address: string | null;
  linked_event_count: number;
}

interface VenueDedupCandidate {
  reason: "exact_normalized" | "name_contains" | "token_overlap";
  similarity: number;
  suggestedKeepId: string;
  members: VenueMember[];
}

interface VenueDedupSheetProps {
  open: boolean;
  onClose: () => void;
}

// ── 레이블 ──────────────────────────────────────────────────────────

const REASON_LABELS: Record<
  string,
  { label: string; color: "danger" | "default" | "secondary" | "warning" | "outline" }
> = {
  exact_normalized: { label: "이름 완전 일치", color: "danger" },
  name_contains: { label: "이름 포함 관계", color: "warning" },
  token_overlap: { label: "이름 유사도", color: "secondary" },
};

// ── MemberCard ──────────────────────────────────────────────────────

function VenueMemberCard({
  member,
  isSelected,
  onSelect,
}: {
  member: VenueMember;
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
          id={`venue-${member.id}`}
          name="keep-venue"
          value={member.id}
          checked={isSelected}
          onChange={onSelect}
          className="mt-1 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <Label htmlFor={`venue-${member.id}`} className="cursor-pointer">
            <div className="font-medium text-sm">{member.name}</div>
            {member.address && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {member.address}
              </div>
            )}
          </Label>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Badge variant="secondary" className="text-xs">
              공연 {member.linked_event_count}개
            </Badge>
            {!member.address && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                주소 없음
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CandidateCard ───────────────────────────────────────────────────

function VenueCandidateCard({
  candidate,
  onMerge,
  onSkip,
}: {
  candidate: VenueDedupCandidate;
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
    color: "outline" as const,
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <Badge variant={reason.color}>{reason.label}</Badge>
        <span className="text-xs text-muted-foreground">
          유사도 {(candidate.similarity * 100).toFixed(0)}%
        </span>
      </div>

      {/* 멤버 선택 */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground font-medium">
          유지할 공연장 선택:
        </p>
        {candidate.members.map((member) => (
          <VenueMemberCard
            key={member.id}
            member={member}
            isSelected={keepId === member.id}
            onSelect={() => setKeepId(member.id)}
          />
        ))}
      </div>

      {/* 액션 버튼 */}
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

      {/* 확인 다이얼로그 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공연장 머지 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>&ldquo;{mergeMember?.name}&rdquo;</strong>을(를){" "}
                  <strong>&ldquo;{keepMember?.name}&rdquo;</strong>으로
                  흡수합니다.
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>머지된 공연장에 연결된 공연이 모두 이전됩니다</li>
                  <li>주소·연락처는 비어있는 쪽을 채우는 방식으로 병합됩니다</li>
                  <li>
                    <strong>이 작업은 되돌릴 수 없습니다</strong>
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

// ── Sheet ───────────────────────────────────────────────────────────

export function VenueDedupSheet({ open, onClose }: VenueDedupSheetProps) {
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["venue-dedup"],
    queryFn: async () => {
      const res = await fetch("/api/admin/venues/dedup?limit=100");
      if (!res.ok) throw new Error("공연장 중복 탐지 실패");
      return res.json() as Promise<{
        candidates: VenueDedupCandidate[];
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
      const res = await fetch("/api/admin/venues/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, mergeId }),
      });
      if (!res.ok) throw new Error("머지 실패");
      return res.json();
    },
    onSuccess: (_, { keepId, mergeId }) => {
      toast.success("공연장 머지 완료");
      setSkipped((s) => {
        const next = new Set(s);
        next.add([keepId, mergeId].sort().join("|"));
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["admin-venues"] });
      void qc.invalidateQueries({ queryKey: ["admin-venues-stats"] });
      void qc.invalidateQueries({ queryKey: ["admin-events"] });
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
          <SheetTitle>🏟️ 중복 공연장 검토</SheetTitle>
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
            <span className="animate-pulse">중복 탐지 중 (AI 검증 포함)...</span>
          </div>
        )}

        {!isLoading && visibleCandidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <span className="text-2xl">✅</span>
            <p className="text-sm">탐지된 중복 공연장이 없습니다</p>
          </div>
        )}

        <div className="space-y-3" style={{ opacity: isMerging ? 0.5 : 1 }}>
          {visibleCandidates.map((candidate, i) => {
            const key = candidate.members
              .map((m) => m.id)
              .sort()
              .join("|");
            return (
              <VenueCandidateCard
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
