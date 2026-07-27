"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { ImageUploader } from "@/components/admin/ImageUploader";
import type { EventRow, EventStatus, OptionItem } from "@/types/event";

export function MultiSelect({
  label,
  required,
  options,
  selectedIds,
  setSelectedIds,
  placeholder,
}: {
  label: string;
  required?: boolean;
  options: OptionItem[];
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  placeholder: string;
}) {
  const selectedSet = new Set(selectedIds);
  const unselected = options.filter((o) => !selectedSet.has(o.id));
  const nameMap = new Map(options.map((o) => [o.id, o.name]));

  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs"
            >
              {nameMap.get(id) ?? id}
              <button
                type="button"
                className="ml-0.5 text-text-tertiary hover:text-text-primary"
                onClick={() =>
                  setSelectedIds((prev) => prev.filter((x) => x !== id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {unselected.length > 0 && (
        <Select
          value=""
          onValueChange={(v) => {
            if (v) setSelectedIds((prev) => [...prev, v]);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {unselected.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function EventFormFields({
  form,
  setForm,
  artists,
  venues,
  artistIds,
  setArtistIds,
  venueIds,
  setVenueIds,
}: {
  form: Partial<EventRow>;
  setForm: React.Dispatch<React.SetStateAction<Partial<EventRow>>>;
  artists: OptionItem[];
  venues: OptionItem[];
  artistIds: string[];
  setArtistIds: React.Dispatch<React.SetStateAction<string[]>>;
  venueIds: string[];
  setVenueIds: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="grid gap-4 py-2">
      {/* 기본 정보 */}
      <div className="space-y-2">
        <Label htmlFor="event-title">
          공연명 <span className="text-red-500">*</span>
        </Label>
        <Input
          id="event-title"
          value={form.title ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MultiSelect
          label="아티스트"
          required
          options={artists}
          selectedIds={artistIds}
          setSelectedIds={setArtistIds}
          placeholder="아티스트 추가"
        />
        <MultiSelect
          label="공연장"
          required
          options={venues}
          selectedIds={venueIds}
          setSelectedIds={setVenueIds}
          placeholder="공연장 추가"
        />
      </div>

      {/* 날짜 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-start">
            시작일시 <span className="text-red-500">*</span>
          </Label>
          <Input
            id="event-start"
            type="datetime-local"
            value={form.start_date ? form.start_date.slice(0, 16) : ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, start_date: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-end">종료일시</Label>
          <Input
            id="event-end"
            type="datetime-local"
            value={form.end_date ? form.end_date.slice(0, 16) : ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, end_date: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-ticket-open">예매 오픈일시</Label>
          <Input
            id="event-ticket-open"
            type="datetime-local"
            value={
              form.ticket_open_date ? form.ticket_open_date.slice(0, 16) : ""
            }
            onChange={(e) =>
              setForm((s) => ({ ...s, ticket_open_date: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-ticket-provider">예매처</Label>
          <Input
            id="event-ticket-provider"
            placeholder="예) 인터파크, YES24"
            value={form.ticket_provider ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, ticket_provider: e.target.value }))
            }
          />
        </div>
      </div>

      {/* 예매 링크 — 앱 '예매하기' 버튼이 여는 외부 URL */}
      <div className="space-y-2">
        <Label htmlFor="event-booking-url">예매 링크 (booking_url)</Label>
        <Input
          id="event-booking-url"
          type="url"
          placeholder="https://tickets.interpark.com/goods/..."
          value={form.booking_url ?? ""}
          onChange={(e) =>
            setForm((s) => ({ ...s, booking_url: e.target.value }))
          }
        />
      </div>

      {/* 공연 정보 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>
            상태 <span className="text-red-500">*</span>
          </Label>
          <Select
            value={(form.status as string) ?? "upcoming"}
            onValueChange={(v: EventStatus) =>
              setForm((s) => ({ ...s, status: v }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">예정</SelectItem>
              <SelectItem value="on_sale">예매중</SelectItem>
              <SelectItem value="ongoing">진행중</SelectItem>
              <SelectItem value="ended">종료</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-genre">장르</Label>
          <Input
            id="event-genre"
            placeholder="예) K-POP, ROCK"
            value={form.genre ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, genre: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-duration">러닝타임</Label>
          <Input
            id="event-duration"
            placeholder="예) 120분"
            value={form.duration ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, duration: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-age">관람 연령</Label>
          <Input
            id="event-age"
            placeholder="예) 전체관람가, 만 12세 이상"
            value={form.age_restriction ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, age_restriction: e.target.value }))
            }
          />
        </div>
      </div>

      {/* 포스터 */}
      <div className="space-y-2">
        <Label>포스터 이미지</Label>
        <ImageUploader
          value={form.poster_url ?? ""}
          onChange={(url) => setForm((s) => ({ ...s, poster_url: url }))}
          folder="posters"
          placeholder="포스터 이미지"
        />
      </div>

      {/* 공지 */}
      <div className="space-y-2">
        <Label htmlFor="event-notice">공지사항</Label>
        <Textarea
          id="event-notice"
          placeholder="관람객에게 안내할 내용을 입력하세요."
          rows={4}
          value={form.notice_text ?? ""}
          onChange={(e) =>
            setForm((s) => ({ ...s, notice_text: e.target.value }))
          }
        />
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-body-sm text-text-secondary">
        <CalendarDays className="h-4 w-4" />
        모든 날짜/시간은 KST 기준으로 표시됩니다.
      </div>
    </div>
  );
}
