"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/Sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { EventDetailTab } from "./EventDetailTab";
import { EventEditTab } from "./EventEditTab";
import type { EventRow, OptionItem } from "@/types/event";
import type { TimetablePerformanceRow } from "@/types/timetable";

type Tab = "detail" | "edit" | "timetable";

export function EventSheet({
  open,
  onOpenChange,
  event,
  defaultTab,
  artists,
  venues,
  initialArtistIds,
  initialVenueIds,
  initialForm,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event: EventRow | null;
  defaultTab: Tab;
  artists: OptionItem[];
  venues: OptionItem[];
  initialArtistIds?: string[];
  initialVenueIds?: string[];
  /** 생성 모드 프리필(URL 임포트 등) — 편집 모드에서는 current 가 우선한다 */
  initialForm?: Partial<EventRow>;
  onChanged: () => void;
}) {
  // 생성 후 수정 모드 전환용 로컬 event (prop 을 seed)
  const [current, setCurrent] = React.useState<EventRow | null>(event);
  const [tab, setTab] = React.useState<Tab>(defaultTab);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setCurrent(event);
    setTab(defaultTab);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, defaultTab, open]);

  const isCreate = current === null;

  // 상세 GET — 목록 API 가 안 내리는 score_breakdown·field_sources 등을 채운다.
  // current.id 가 바뀔 때만(탭 전환 등으로는 재요청하지 않음) 실행.
  React.useEffect(() => {
    if (!open || !current?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/events/${current.id}`);
        if (!res.ok) return;
        const { event: full } = (await res.json()) as { event: EventRow };
        if (!cancelled) setCurrent(full);
      } catch {
        /* 실패 시 기존 행 데이터 유지 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.id]);

  const { data: timetable } = useQuery({
    queryKey: ["sheet-timetable", current?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timetable?event_id=${current!.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) return [] as TimetablePerformanceRow[];
      const json = (await res.json()) as { rows: TimetablePerformanceRow[] };
      return json.rows;
    },
    enabled: open && !!current?.id && !!current?.has_timetable,
  });

  const artistNameMap = React.useMemo(
    () => new Map(artists.map((a) => [a.id, a.name])),
    [artists],
  );
  const venueNameMap = React.useMemo(
    () => new Map(venues.map((v) => [v.id, v.name])),
    [venues],
  );
  const artistNames = React.useMemo(() => {
    if (!current) return "";
    if (initialArtistIds && initialArtistIds.length > 0)
      return initialArtistIds
        .map((id) => artistNameMap.get(id) ?? id)
        .join(", ");
    return current.artist_id
      ? (artistNameMap.get(current.artist_id) ?? "-")
      : "-";
  }, [current, initialArtistIds, artistNameMap]);
  const venueNames = React.useMemo(() => {
    if (!current) return "";
    if (initialVenueIds && initialVenueIds.length > 0)
      return initialVenueIds
        .map((id) => venueNameMap.get(id) ?? id)
        .join(", ");
    return current.venue_id ? (venueNameMap.get(current.venue_id) ?? "-") : "-";
  }, [current, initialVenueIds, venueNameMap]);

  const guardedSetTab = (next: Tab) => {
    if (next === tab) return;
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 이동/닫으시겠어요?"))
      return;
    setTab(next);
  };
  const requestOpenChange = (o: boolean) => {
    if (!o && dirty && !confirm("저장하지 않은 변경이 있습니다. 이동/닫으시겠어요?"))
      return;
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{isCreate ? "공연 추가" : current!.title}</SheetTitle>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => guardedSetTab(v as Tab)}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          <TabsList>
            <TabsTrigger value="detail" disabled={isCreate}>
              상세
            </TabsTrigger>
            <TabsTrigger value="edit">편집</TabsTrigger>
            <TabsTrigger value="timetable" disabled={isCreate}>
              타임테이블
            </TabsTrigger>
          </TabsList>
          <TabsContent value="detail" className="flex-1 overflow-y-auto">
            {current && (
              <EventDetailTab
                event={current}
                artistNames={artistNames}
                venueNames={venueNames}
                timetable={timetable}
              />
            )}
          </TabsContent>
          <TabsContent value="edit" className="flex-1 overflow-y-auto">
            <EventEditTab
              event={current}
              artists={artists}
              venues={venues}
              initialForm={current ?? initialForm}
              initialArtistIds={initialArtistIds}
              initialVenueIds={initialVenueIds}
              onDirtyChange={setDirty}
              onSaved={(saved) => {
                setDirty(false);
                setCurrent(saved); // 생성 → 이제 수정 모드
                setTab("detail");
                onChanged(); // 목록 refetch
              }}
            />
          </TabsContent>
          <TabsContent value="timetable" className="flex-1 overflow-y-auto">
            {current && (
              <div className="py-4 text-body-sm text-text-secondary">
                타임테이블 — Task 4
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
