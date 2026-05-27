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
import type { DedupCandidate, DedupMember } from "@/lib/artists/dedup";

interface ArtistDedupSheetProps {
  open: boolean;
  onClose: () => void;
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  exact_normalized: { label: "이름 완전 일치", color: "destructive" },
  alias_match: { label: "별명 교차 매칭", color: "default" },
  ko_en_pair: { label: "한/영 이름 쌍", color: "secondary" },
  token_overlap: { label: "토큰 유사도", color: "outline" },
  name_contains: { label: "이름 포함 관계", color: "warning" },
};

function MemberCard({
  member,
  isSelected,
  onSelect,
}: {
  member: DedupMember;
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
          name="keep-member"
          value={member.id}
          checked={isSelected}
          onChange={onSelect}
          className="mt-1 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <Label htmlFor={member.id} className="cursor-pointer">
            <div className="font-medium text-sm">{member.name}</div>
            {member.name_en && (
              <div className="text-xs text-muted-foreground">
                {member.name_en}
              </div>
            )}
          </Label>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Badge variant="secondary" className="text-xs">
              공연 {member.linked_event_count}개
            </Badge>
            <Badge variant="secondary" className="text-xs">
              팔로워 {member.followers_count.toLocaleString()}
            </Badge>
            {member.missing_fields.length > 0 && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                누락 {member.missing_fields.length}개
              </Badge>
            )}
          </div>
          {member.missing_fields.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              미완성: {member.missing_fields.join(", ")}
            </div>
          )}
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
  candidate: DedupCandidate;
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
      {/* 헤더 */}
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

      {/* 멤버 선택 */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground font-medium">
          유지할 아티스트 선택:
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
            <AlertDialogTitle>아티스트 머지 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>&ldquo;{mergeMember?.name}&rdquo;</strong>을(를){" "}
                  <strong>&ldquo;{keepMember?.name}&rdquo;</strong>으로
                  흡수합니다.
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>
                    머지된 아티스트의 공연·팔로워·타임테이블이 모두 이전됩니다
                  </li>
                  <li>기존 이름은 별명(alias)으로 보존됩니다</li>
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

export function ArtistDedupSheet({ open, onClose }: ArtistDedupSheetProps) {
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["artist-dedup"],
    queryFn: async () => {
      const res = await fetch("/api/admin/artists/dedup?limit=100");
      if (!res.ok) throw new Error("중복 탐지 실패");
      return res.json() as Promise<{
        candidates: DedupCandidate[];
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
      const res = await fetch("/api/admin/artists/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, mergeId }),
      });
      if (!res.ok) throw new Error("머지 실패");
      return res.json();
    },
    onSuccess: (_, { keepId, mergeId }) => {
      toast.success("머지 완료");
      setSkipped((s) => {
        const next = new Set(s);
        next.add([keepId, mergeId].sort().join("|"));
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["admin-artists"] });
      void qc.invalidateQueries({ queryKey: ["admin-artists-stats"] });
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
          <SheetTitle>🔀 중복 아티스트 검토</SheetTitle>
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
            <p className="text-sm">탐지된 중복 아티스트가 없습니다</p>
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
