/** 표시용 타임존 — 스펙: 모든 일시 KST */
export const KST = "Asia/Seoul";

const kstDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const kstDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** yyyy.MM.dd 또는 yyyy.MM.dd HH:mm 형태 (KST) */
export function formatKst(
  iso: string | null | undefined,
  withTime = true,
): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";

  if (!withTime) {
    return kstDateFormatter
      .format(d)
      .replace(/\.\s*/g, ".")
      .replace(/,\s*/g, " ")
      .trim();
  }

  const parts = kstDateTimeFormatter.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const day = get("day");
  const h = get("hour");
  const min = get("minute");
  return `${y}.${m}.${day} ${h}:${min}`;
}
