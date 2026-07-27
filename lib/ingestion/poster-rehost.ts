/**
 * 포스터 재호스팅 — 소스 CDN(interpark/yes24/melon 등) 이미지를 Supabase 스토리지
 * (concert-posters 버킷)로 복사하고 events.poster_url 을 우리 public URL 로 교체한다.
 *
 * 왜: 소스 CDN 은 만료·핫링크 차단·http(ATS) 위험이 있어 앱에서 포스터가 안 뜰 수 있다.
 * 레거시 Python(scripts/scraper/utils/image.py)이 하던 걸 TS 파이프라인으로 되살린 것.
 * 이미 supabase.co 호스트인 poster_url 은 재호스팅하지 않는다(멱등).
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET = "concert-posters";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — 이상은 스킵(비정상)

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  return "jpg"; // jpeg 및 기타 기본
}

/** 소스 이미지 URL → Supabase public URL. 실패 시 null. */
export async function rehostPoster(
  sourceUrl: string,
  eventId: string,
): Promise<string | null> {
  const db = createServiceRoleClient();
  let bytes: Buffer;
  let contentType: string;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(sourceUrl.replace(/^http:\/\//i, "https://"), {
      signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0 (ArticketBot)" },
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null; // HTML 에러페이지 등 방어
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    bytes = buf;
  } catch {
    return null; // 타임아웃·네트워크 실패
  }

  const path = `${eventId}.${extFromContentType(contentType)}`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) return null;

  const {
    data: { publicUrl },
  } = db.storage.from(BUCKET).getPublicUrl(path);
  return publicUrl;
}

/**
 * 배치 재호스팅 — poster_url 이 우리 스토리지가 아닌(소스 CDN) 이벤트를 골라 재호스팅.
 * 파이프라인 enrich 단계 + 백필 스크립트가 공유.
 */
export async function rehostEventPosters(
  maxItems = 30,
): Promise<{ rehosted: number; checked: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,poster_url")
    .not("poster_url", "is", null)
    .not("poster_url", "ilike", "%supabase.co%") // 이미 재호스팅된 건 제외
    .eq("is_hidden", false)
    .limit(maxItems);

  let rehosted = 0;
  let checked = 0;
  for (const e of events ?? []) {
    checked++;
    const url = (e as { id: string; poster_url: string }).poster_url;
    const publicUrl = await rehostPoster(url, (e as { id: string }).id);
    if (publicUrl) {
      await db
        .from("events")
        .update({ poster_url: publicUrl })
        .eq("id", (e as { id: string }).id);
      rehosted++;
    }
  }
  return { rehosted, checked };
}
