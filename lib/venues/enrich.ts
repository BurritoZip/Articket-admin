import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";

async function predictVenueAddress(venueName: string): Promise<string | null> {
  const prompt = `다음 공연장의 실제 주소를 알려주세요. 확실하지 않으면 "모름"이라고만 답변하세요.
공연장: "${venueName}"
주소만 (도로명 주소 형식, 없으면 "모름"):`;
  try {
    const raw = await geminiText(prompt).then((s) => s.trim());
    if (!raw || raw === "모름" || raw.length < 5 || raw.length > 150)
      return null;
    // 주소 키워드 없으면 reject
    const ADDRESS_KW = /시|구|동|로|길|번지|특별시|광역시|도\s|읍|면/;
    if (!ADDRESS_KW.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** 주소 없는 공연장 Gemini로 보강 */
export async function processVenueAddressEnrichment(maxItems = 30): Promise<{
  processed: number;
  filled: number;
}> {
  const db = createServiceRoleClient();

  const { data: venues } = await db
    .from("venues")
    .select("id,name,address")
    .or("address.is.null,address.eq.")
    .is("address_attempted_at", null) // 재선택 방지 — 시도한 건 제외
    .limit(maxItems);

  if (!venues || venues.length === 0) return { processed: 0, filled: 0 };

  const now = new Date().toISOString();
  let filled = 0;
  for (const venue of venues) {
    const address = await predictVenueAddress(venue.name);
    // 성공/실패 모두 시도 마킹 → 다음 run은 다음 배치로 진행
    await db
      .from("venues")
      .update(
        address
          ? { address, address_attempted_at: now }
          : { address_attempted_at: now },
      )
      .eq("id", venue.id);
    if (address) filled++;
  }

  return { processed: venues.length, filled };
}
