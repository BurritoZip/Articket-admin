import { createHash } from "crypto";

export function generateDedupKey(
  normalizedTitle: string,
  normalizedVenueName: string | null,
  startDate: string | null,
): string {
  const parts = [
    normalizedTitle.toLowerCase().trim(),
    (normalizedVenueName ?? "unknown").toLowerCase().trim(),
    startDate ?? "unknown",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function isDuplicate(keyA: string, keyB: string): boolean {
  return keyA === keyB;
}
