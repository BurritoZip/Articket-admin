"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EventFormFields } from "./EventFormFields";
import type { EventRow, OptionItem } from "@/types/event";

export const EMPTY_EVENT_FORM: Partial<EventRow> = {
  title: "",
  artist_id: "",
  venue_id: "",
  start_date: "",
  end_date: "",
  status: "upcoming",
  genre: "",
  duration: "",
  age_restriction: "",
  ticket_open_date: "",
  ticket_provider: "",
  notice_text: "",
  is_banner: false,
};

function toPayload(
  form: Partial<EventRow>,
  artistIds: string[],
  venueIds: string[],
) {
  const n = (v?: string | null) => (v && String(v).trim() ? v : null);
  return {
    ...form,
    title: form.title?.trim(),
    artist_ids: artistIds,
    venue_ids: venueIds,
    end_date: n(form.end_date),
    ticket_open_date: n(form.ticket_open_date),
    duration: n(form.duration),
    age_restriction: n(form.age_restriction),
    ticket_provider: n(form.ticket_provider),
    notice_text: n(form.notice_text),
    booking_url: n(form.booking_url),
  };
}

export function EventEditTab({
  event,
  artists,
  venues,
  onSaved,
  onDirtyChange,
  initialForm,
  initialArtistIds,
  initialVenueIds,
}: {
  event: EventRow | null;
  artists: OptionItem[];
  venues: OptionItem[];
  onSaved: (saved: EventRow) => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialForm?: Partial<EventRow>;
  initialArtistIds?: string[];
  initialVenueIds?: string[];
}) {
  const isCreate = event === null;
  const [form, setForm] = React.useState<Partial<EventRow>>(
    initialForm ?? (isCreate ? { ...EMPTY_EVENT_FORM } : { ...event }),
  );
  const [artistIds, setArtistIds] = React.useState<string[]>(
    initialArtistIds ?? [],
  );
  const [venueIds, setVenueIds] = React.useState<string[]>(
    initialVenueIds ?? [],
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
  };
  // setter 를 래핑해 폼 필드 어떤 변경이든 dirty 로 표시한다. onInput 만 쓰면 Radix Select·
  // 다중선택 칩 제거·ImageUploader 처럼 native input 이벤트를 안 내는 변경을 놓쳐 dirty 가드가
  // 헛돈다. 재시드/저장 경로는 raw setter 를 쓰므로 dirty 로 안 잡힌다.
  const setFormDirty: typeof setForm = (v) => {
    markDirty();
    setForm(v);
  };
  const setArtistIdsDirty: typeof setArtistIds = (v) => {
    markDirty();
    setArtistIds(v);
  };
  const setVenueIdsDirty: typeof setVenueIds = (v) => {
    markDirty();
    setVenueIds(v);
  };

  // event(또는 initial* prefill) 변경 시 재시드. 편집 진입 시 join 된 artist/venue id,
  // URL-import prefill 은 상위(EventsPageClient)가 initialArtistIds/initialVenueIds/initialForm 으로 넘긴다.
  React.useEffect(() => {
    setForm(initialForm ?? (isCreate ? { ...EMPTY_EVENT_FORM } : { ...event }));
    setArtistIds(initialArtistIds ?? []);
    setVenueIds(initialVenueIds ?? []);
    setDirty(false);
    onDirtyChange?.(false);
    // 대상 이벤트가 바뀌거나 폼이 재마운트될 때만 재시드 — 배경 refetch 로 인한 prop 참조 변경으로는
    // 재시드하지 않아 작성 중 미저장 편집이 날아가지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, isCreate]);

  const save = async () => {
    if (!form.title?.trim() || !form.start_date) {
      toast.error("공연명과 시작일은 필수입니다.");
      return;
    }
    if (isCreate && (artistIds.length === 0 || venueIds.length === 0)) {
      toast.error("아티스트와 공연장을 선택하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const url = isCreate
        ? "/api/admin/events"
        : `/api/admin/events/${event!.id}`;
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form, artistIds, venueIds)),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.detail ?? "저장 실패");
      toast.success(
        isCreate ? "공연이 추가되었습니다." : "공연이 수정되었습니다.",
      );
      setDirty(false);
      onDirtyChange?.(false);
      // 생성: 반환 id 로 최소 EventRow 구성해 onSaved (상위가 상세 GET 로 보강)
      const saved: EventRow = isCreate
        ? { ...(form as EventRow), id: json.id }
        : { ...(event as EventRow), ...(form as EventRow) };
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <EventFormFields
        form={form}
        setForm={setFormDirty}
        artists={artists}
        venues={venues}
        artistIds={artistIds}
        setArtistIds={setArtistIdsDirty}
        venueIds={venueIds}
        setVenueIds={setVenueIdsDirty}
      />
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={submitting}>
          {submitting ? "저장 중..." : isCreate ? "생성" : "저장"}
        </Button>
      </div>
    </div>
  );
}
