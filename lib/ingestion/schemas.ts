import { z } from "zod";
import {
  PRICE_RE,
  TICKET_GRADE_RE,
  DATE_RE,
  URL_RE,
} from "@/lib/data-quality/patterns";

// ── 공통 체커 ────────────────────────────────────────────────────────

function isGarbage(s: string): boolean {
  const stripped = s
    .replace(PRICE_RE, "")
    .replace(TICKET_GRADE_RE, "")
    .replace(DATE_RE, "")
    .replace(/[\s\-·_,]+/g, "")
    .trim();
  return stripped.length <= 1;
}

// ── 공연 (Event) 스키마 ───────────────────────────────────────────────

export const EventIngestionSchema = z.object({
  title: z
    .string()
    .min(2, "제목은 최소 2자 이상")
    .max(300, "제목은 300자 이하")
    .refine((v) => !URL_RE.test(v), "제목에 URL 포함 불가")
    .refine((v) => v.trim().length > 0, "제목이 비어 있음"),

  start_date: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => !v || !isNaN(Date.parse(v)),
      "start_date 날짜 형식 오류",
    ),

  end_date: z
    .string()
    .nullable()
    .optional(),

  status: z
    .enum(["upcoming", "on_sale", "ongoing", "ended"])
    .optional(),

  dedup_key: z
    .string()
    .min(1, "dedup_key 필수"),

  source_name: z
    .string()
    .min(1, "source_name 필수"),
}).superRefine((data, ctx) => {
  if (data.start_date && data.end_date) {
    if (new Date(data.end_date) < new Date(data.start_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end_date는 start_date 이후여야 함",
        path: ["end_date"],
      });
    }
  }
});

// ── 아티스트 스키마 ───────────────────────────────────────────────────

export const ArtistIngestionSchema = z.object({
  name: z
    .string()
    .min(1, "아티스트 이름 필수")
    .max(100, "이름은 100자 이하")
    .refine((v) => !URL_RE.test(v), "아티스트 이름에 URL 포함 불가")
    .refine((v) => v.trim().length > 0, "이름이 비어 있음")
    .refine((v) => !/^\d+$/.test(v.trim()), "이름이 숫자만으로 구성됨"),

  avatar_url: z.string().url("avatar_url이 유효한 URL이 아님").optional().nullable(),
});

// ── 공연장 스키마 ─────────────────────────────────────────────────────

export const VenueIngestionSchema = z.object({
  name: z
    .string()
    .min(2, "공연장 이름은 최소 2자 이상")
    .max(200, "공연장 이름은 200자 이하")
    .refine((v) => !PRICE_RE.test(v), "공연장 이름에 가격 정보 포함")
    .refine((v) => !TICKET_GRADE_RE.test(v), "공연장 이름에 티켓 등급 포함")
    .refine((v) => !DATE_RE.test(v), "공연장 이름에 날짜 포함")
    .refine((v) => !URL_RE.test(v), "공연장 이름에 URL 포함")
    .refine((v) => !isGarbage(v), "공연장 이름이 의미 없는 값"),

  address: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || !PRICE_RE.test(v), "주소에 가격 정보 포함")
    .refine((v) => !v || !URL_RE.test(v), "주소에 URL 포함"),
});

// ── 유틸 ──────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

export function validateEvent(
  input: Record<string, unknown>,
): ValidationResult<z.infer<typeof EventIngestionSchema>> {
  const result = EventIngestionSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) };
}

export function validateArtist(
  input: Record<string, unknown>,
): ValidationResult<z.infer<typeof ArtistIngestionSchema>> {
  const result = ArtistIngestionSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) };
}

export function validateVenue(
  input: Record<string, unknown>,
): ValidationResult<z.infer<typeof VenueIngestionSchema>> {
  const result = VenueIngestionSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`) };
}
