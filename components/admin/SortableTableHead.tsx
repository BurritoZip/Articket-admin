"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/Table";

export type SortDir = "asc" | "desc";

interface SortableTableHeadProps {
  children: React.ReactNode;
  field: string;
  sortBy: string;
  sortDir: SortDir;
  onSort: (field: string) => void;
  className?: string;
}

export function SortableTableHead({
  children,
  field,
  sortBy,
  sortDir,
  onSort,
  className,
}: SortableTableHeadProps) {
  const active = sortBy === field;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-foreground transition-colors select-none"
      >
        {children}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-primary" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </button>
    </TableHead>
  );
}
