"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";

export interface UnmatchedResolveRow {
  id: string;
  artist_name: string;
  event_title: string | null;
  events: { id: string; title: string } | null;
  stage_name: string | null;
  day_number: number | null;
}

interface ArtistSuggestion {
  id: string;
  name: string;
}

export function UnmatchedResolveSheet({
  row,
  onClose,
  onResolved,
}: {
  row: UnmatchedResolveRow;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [name, setName] = React.useState(row.artist_name);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const { data: suggestData } = useQuery({
    queryKey: ["unmatched-suggest", row.artist_name],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: row.artist_name,
        pageSize: "8",
      });
      const res = await fetch(`/api/admin/artists?${params}`);
      if (!res.ok) return { rows: [] as ArtistSuggestion[] };
      return res.json() as Promise<{ rows: ArtistSuggestion[] }>;
    },
  });
  const suggestions = suggestData?.rows ?? [];

  const resolve = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/admin/timetable/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: row.id, ...payload }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        matched?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "처리 실패");
      return json;
    },
    onSuccess: (json, payload) => {
      if (payload.action === "rename" && json.matched === false) {
        toast.success("이름을 수정했지만 매칭되는 아티스트가 없어 미해결로 남았습니다.");
      } else if (payload.action === "delete") {
        toast.success("삭제했습니다.");
      } else {
        toast.success("아티스트를 연결했습니다.");
      }
      onResolved();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "처리 실패 — 다시 시도하세요."),
  });

  const eventTitle = row.events?.title ?? row.event_title ?? "-";

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle>미매칭 아티스트 처리</SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-surface-muted/40 p-3 text-body-sm">
            <p className="font-semibold text-text-primary">{row.artist_name}</p>
            <p className="text-text-secondary">
              {eventTitle}
              {row.stage_name ? ` · ${row.stage_name}` : ""}
              {row.day_number ? ` · DAY ${row.day_number}` : ""}
            </p>
          </div>

          {/* 이름 수정 재매칭 */}
          <div className="space-y-1.5">
            <Label className="text-caption text-text-secondary">이름 수정</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={resolve.isPending || !name.trim()}
                onClick={() =>
                  resolve.mutate({ action: "rename", newName: name.trim() })
                }
              >
                재매칭
              </Button>
            </div>
          </div>

          {/* 추천 아티스트 연결 */}
          <div className="space-y-1.5">
            <Label className="text-caption text-text-secondary">
              추천 아티스트
            </Label>
            {suggestions.length === 0 ? (
              <p className="text-caption text-text-tertiary">
                일치하는 기존 아티스트가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {suggestions.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded border border-border px-2 py-1.5"
                  >
                    <span className="text-body-sm">{a.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ action: "link", artistId: a.id })
                      }
                    >
                      연결
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 신규 아티스트 추가 */}
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={resolve.isPending || !name.trim()}
              onClick={() =>
                resolve.mutate({ action: "create", name: name.trim() })
              }
            >
              &quot;{name.trim() || row.artist_name}&quot; 신규 아티스트로 추가
            </Button>
          </div>

          {/* 삭제 */}
          <div className="border-t border-border pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-body-sm text-danger">
                  타임테이블 행까지 삭제됩니다. 확실합니까?
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ action: "delete" })}
                >
                  삭제
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                이 항목 삭제
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
