"use client";

import { Badge } from "@/components/ui/Badge";
import { getMissingFields, type FieldDef } from "@/lib/completeness";

export function MissingFieldChips({
  row,
  fields,
}: {
  row: Record<string, unknown>;
  fields: FieldDef[];
}) {
  const missing = getMissingFields(row, fields);
  if (missing.length === 0) {
    return (
      <Badge variant="success" className="whitespace-nowrap">
        ✓ 완성
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {missing.map((f) => (
        <Badge key={f.key} variant="danger" className="whitespace-nowrap">
          {f.label}
        </Badge>
      ))}
    </div>
  );
}
