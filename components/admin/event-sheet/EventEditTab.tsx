"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EventFormFields } from "./EventFormFields";
import type { EventRow, OptionItem } from "@/types/event";

const emptyForm: Partial<EventRow> = {
  title: "", artist_id: "", venue_id: "", start_date: "", end_date: "",
  status: "upcoming", genre: "", duration: "", age_restriction: "",
  ticket_open_date: "", ticket_provider: "", notice_text: "", is_banner: false,
};

function toPayload(form: Partial<EventRow>, artistIds: string[], venueIds: string[]) {
  const n = (v?: string | null) => (v && String(v).trim() ? v : null);
  return {
    ...form,
    title: form.title?.trim(),
    artist_ids: artistIds,
    venue_ids: venueIds,
    end_date: n(form.end_date), ticket_open_date: n(form.ticket_open_date),
    duration: n(form.duration), age_restriction: n(form.age_restriction),
    ticket_provider: n(form.ticket_provider), notice_text: n(form.notice_text),
    booking_url: n(form.booking_url),
  };
}

export function EventEditTab({
  event, artists, venues, onSaved, onDirtyChange,
}: {
  event: EventRow | null; artists: OptionItem[]; venues: OptionItem[];
  onSaved: (saved: EventRow) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const isCreate = event === null;
  const [form, setForm] = React.useState<Partial<EventRow>>(
    isCreate ? { ...emptyForm } : { ...event },
  );
  const [artistIds, setArtistIds] = React.useState<string[]>([]);
  const [venueIds, setVenueIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const markDirty = () => { if (!dirty) { setDirty(true); onDirtyChange?.(true); } };

  // event 로 초기화 (편집 진입 시 join 된 artist/venue id 는 상위에서 seed 하거나 상세 GET 응답으로 채운다 — 아래 주석)
  React.useEffect(() => {
    setForm(isCreate ? { ...emptyForm } : { ...event });
    setDirty(false); onDirtyChange?.(false);
  }, [event, isCreate, onDirtyChange]);

  const save = async () => {
    if (!form.title?.trim() || !form.start_date) {
      toast.error("공연명과 시작일은 필수입니다."); return;
    }
    if (isCreate && (artistIds.length === 0 || venueIds.length === 0)) {
      toast.error("아티스트와 공연장을 선택하세요."); return;
    }
    setSubmitting(true);
    try {
      const url = isCreate ? "/api/admin/events" : `/api/admin/events/${event!.id}`;
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form, artistIds, venueIds)),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.detail ?? "저장 실패");
      toast.success(isCreate ? "공연이 추가되었습니다." : "공연이 수정되었습니다.");
      setDirty(false); onDirtyChange?.(false);
      // 생성: 반환 id 로 최소 EventRow 구성해 onSaved (상위가 상세 GET 로 보강)
      const saved: EventRow = isCreate ? ({ ...(form as EventRow), id: json.id }) : ({ ...(event as EventRow), ...(form as EventRow) });
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4" onInput={markDirty}>
      <EventFormFields
        form={form} setForm={setForm} artists={artists} venues={venues}
        artistIds={artistIds} setArtistIds={setArtistIds}
        venueIds={venueIds} setVenueIds={setVenueIds}
      />
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={submitting}>
          {submitting ? "저장 중..." : isCreate ? "생성" : "저장"}
        </Button>
      </div>
    </div>
  );
}
