import { z } from "zod";

export const RawScrapedEventSchema = z.object({
  sourceUrl: z.string().url(),
  sourceName: z.string(),
  title: z.string().min(1),
  posterUrl: z.string().url().nullable().optional(),
  venueName: z.string().nullable().optional(),
  venueAddress: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  ticketOpenDate: z.string().nullable().optional(),
  ticketProvider: z.string().nullable().optional(),
  ticketUrl: z.string().nullable().optional(),
  artists: z.array(z.string()).default([]),
  genre: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["upcoming", "on_sale", "ended"]).default("upcoming"),
  rawHtml: z.string().nullable().optional(),
});

export type RawScrapedEvent = z.infer<typeof RawScrapedEventSchema>;

export interface NormalizedEvent {
  title: string;
  normalizedTitle: string;
  posterUrl: string | null;
  venueName: string | null;
  normalizedVenueName: string | null;
  venueAddress: string | null;
  startDate: string | null;
  endDate: string | null;
  ticketOpenDate: string | null;
  ticketProvider: string | null;
  sourceUrls: string[];
  sourceName: string;
  artists: string[];
  genre: string | null;
  description: string | null;
  status: "upcoming" | "on_sale" | "ended";
  dedupKey: string;
}

export interface UpsertResult {
  action: "inserted" | "updated" | "skipped";
  eventId: string;
  changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>;
}

export interface IngestionPipelineResult {
  jobId: string;
  sourceName: string;
  pagesCrawled: number;
  eventsFound: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errorCount: number;
  durationMs: number;
  errors: Array<{ url: string; step: string; message: string }>;
}
