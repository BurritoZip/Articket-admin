import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { parseDetailPage } from "@/lib/scrapers/stagepick/parser";
import { parseDate, parseEndDate } from "@/lib/ingestion/normalize";

const FETCH_HEADERS = {
  Referer: "https://www.stagepick.co.kr/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as { url?: string };
  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url_required" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e) },
      { status: 502 },
    );
  }

  const detail = parseDetailPage(html, url);

  return NextResponse.json({
    sourceUrl: url,
    parsed: {
      title: detail.title || null,
      posterUrl: detail.posterUrl,
      venueName: detail.venueName,
      startDate: parseDate(detail.dateRange),
      endDate: parseEndDate(detail.dateRange),
      ticketOpenDate: parseDate(detail.ticketOpenDate),
      ticketProvider: detail.ticketProvider,
      genre: detail.genre,
      artists: detail.artists,
    },
  });
}
