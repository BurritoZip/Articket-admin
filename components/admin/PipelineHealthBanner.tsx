"use client";

import { useQuery } from "@tanstack/react-query";

interface Health {
  level: "green" | "yellow" | "red";
  reason: string;
}

const STYLE: Record<
  Health["level"],
  { dot: string; box: string; label: string }
> = {
  green: {
    dot: "bg-emerald-500",
    box: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    label: "정상",
  },
  yellow: {
    dot: "bg-amber-500",
    box: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    label: "주의",
  },
  red: {
    dot: "bg-red-500",
    box: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    label: "조치 필요",
  },
};

export function PipelineHealthBanner() {
  const { data } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/pipeline/health");
      if (!res.ok) throw new Error("health fetch failed");
      return res.json() as Promise<Health>;
    },
    refetchInterval: 10_000,
    staleTime: 0,
  });

  if (!data) return null;
  const s = STYLE[data.level];

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${s.box}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {data.level !== "green" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${s.dot}`}
          />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${s.dot}`}
        />
      </span>
      <span className="text-sm font-semibold">{s.label}</span>
      <span className="text-sm opacity-90">{data.reason}</span>
    </div>
  );
}
