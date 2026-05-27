"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FieldDef } from "@/lib/completeness";

export type CompletenessStats = {
  missingCounts: Record<string, number>;
  duplicateCount: number;
  enrichmentPending?: number;
};

type Props = {
  fields: FieldDef[];
  stats: CompletenessStats | null;
  statsLoading: boolean;
  missingFilter: string | null;
  duplicatesFilter: boolean;
  onMissingFilter: (key: string | null) => void;
  onDuplicatesFilter: (active: boolean) => void;
};

export function CompletenessFilterBar({
  fields,
  stats,
  statsLoading,
  missingFilter,
  duplicatesFilter,
  onMissingFilter,
  onDuplicatesFilter,
}: Props) {
  const hasFilter = missingFilter !== null || duplicatesFilter;
  const allClean =
    stats &&
    fields.every((f) => (stats.missingCounts[f.key] ?? 0) === 0) &&
    stats.duplicateCount === 0;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-caption font-semibold text-text-tertiary">
          누락 현황 — 클릭하여 필터링
        </p>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              onMissingFilter(null);
              onDuplicatesFilter(false);
            }}
            className="flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
          >
            <X className="h-3 w-3" />
            필터 해제
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {statsLoading ? (
          <div className="h-6 w-48 animate-pulse rounded bg-surface-muted" />
        ) : allClean ? (
          <p className="text-caption text-text-tertiary">누락 데이터 없음 ✓</p>
        ) : stats ? (
          <>
            {fields.map((f) => {
              const count = stats.missingCounts[f.key] ?? 0;
              if (count === 0) return null;
              const active = missingFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    onMissingFilter(active ? null : f.key);
                    if (!active) onDuplicatesFilter(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-caption font-medium transition-colors",
                    active
                      ? "border-danger bg-danger-weak text-danger"
                      : "border-border bg-surface text-text-secondary hover:border-danger/50 hover:text-text-primary",
                  )}
                >
                  {f.label} 없음
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] font-semibold",
                      active
                        ? "bg-danger/20 text-danger"
                        : "bg-surface-muted text-text-tertiary",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {(stats.duplicateCount ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  const next = !duplicatesFilter;
                  onDuplicatesFilter(next);
                  if (next) onMissingFilter(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-caption font-medium transition-colors",
                  duplicatesFilter
                    ? "border-warning bg-warning-weak text-warning-foreground"
                    : "border-border bg-surface text-text-secondary hover:border-warning/50 hover:text-text-primary",
                )}
              >
                중복 이름
                <span
                  className={cn(
                    "rounded px-1 text-[10px] font-semibold",
                    duplicatesFilter
                      ? "bg-warning/20 text-warning-foreground"
                      : "bg-surface-muted text-text-tertiary",
                  )}
                >
                  {stats.duplicateCount}
                </span>
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
