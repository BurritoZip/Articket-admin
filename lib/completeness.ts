/** 필드 완성도 정의 — 관리 페이지 공통 */

export type FieldDef = {
  key: string;
  label: string;
  isMissing: (value: unknown) => boolean;
};

export const ARTIST_FIELDS: FieldDef[] = [
  { key: "avatar_url", label: "사진", isMissing: (v) => !v },
  { key: "occupation", label: "직종", isMissing: (v) => !v },
  { key: "label", label: "소속사", isMissing: (v) => !v },
  { key: "country", label: "국가", isMissing: (v) => !v },
  { key: "birth_date", label: "생년월일", isMissing: (v) => !v },
  { key: "birth_place", label: "출생지", isMissing: (v) => !v },
  { key: "related", label: "관련", isMissing: (v) => !v },
];

export const VENUE_FIELDS: FieldDef[] = [
  {
    key: "address",
    label: "주소",
    isMissing: (v) => !(v as string)?.trim(),
  },
  {
    key: "phone_number",
    label: "연락처",
    isMissing: (v) => !(v as string)?.trim(),
  },
];

export const EVENT_FIELDS: FieldDef[] = [
  { key: "poster_url", label: "포스터", isMissing: (v) => !v },
  { key: "end_date", label: "종료일", isMissing: (v) => !v },
  { key: "genre", label: "장르", isMissing: (v) => !v },
  { key: "duration", label: "러닝타임", isMissing: (v) => !v },
  { key: "age_restriction", label: "관람연령", isMissing: (v) => !v },
  { key: "ticket_open_date", label: "예매오픈", isMissing: (v) => !v },
  { key: "ticket_provider", label: "예매처", isMissing: (v) => !v },
  {
    key: "notice_text",
    label: "공지",
    isMissing: (v) => !(v as string)?.trim(),
  },
];

export function getMissingFields(
  row: Record<string, unknown>,
  fields: FieldDef[],
): FieldDef[] {
  return fields.filter((f) => f.isMissing(row[f.key]));
}
