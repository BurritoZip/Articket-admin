"use client";
import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { formatKst } from "@/lib/format-kst";
import type { EventRow, EventStatus } from "@/types/event";
import type { TimetablePerformanceRow } from "@/types/timetable";

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "예정",
  on_sale: "예매중",
  ongoing: "진행중",
  ended: "종료",
};

export function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 break-all text-text-primary">{value}</p>
    </div>
  );
}

export function EventDetailTab({
  event,
  artistNames,
  venueNames,
  timetable,
}: {
  event: EventRow;
  artistNames: string;
  venueNames: string;
  timetable: TimetablePerformanceRow[] | undefined;
}) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto py-4 text-body-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoItem label="아티스트" value={artistNames || "-"} />
        <InfoItem label="공연장" value={venueNames || "-"} />
        <InfoItem label="상태" value={STATUS_LABEL[event.status]} />
        <InfoItem label="배너 노출" value={event.is_banner ? "ON" : "OFF"} />
        <InfoItem label="시작일시" value={formatKst(event.start_date)} />
        <InfoItem label="종료일시" value={formatKst(event.end_date)} />
        <InfoItem label="장르" value={event.genre ?? "-"} />
        <InfoItem label="러닝타임" value={event.duration ?? "-"} />
        <InfoItem label="관람 연령" value={event.age_restriction ?? "-"} />
        <InfoItem
          label="예매 오픈일"
          value={formatKst(event.ticket_open_date)}
        />
        <InfoItem label="예매처" value={event.ticket_provider ?? "-"} />
      </div>
      {event.poster_url && (
        <div>
          <p className="mb-2 text-caption font-semibold text-text-tertiary">
            포스터
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.poster_url}
            alt="포스터"
            className="h-40 w-auto rounded-md border border-border object-contain"
          />
        </div>
      )}
      {event.has_timetable && (
        <div>
          <p className="mb-2 text-caption font-semibold text-text-tertiary">
            타임테이블
          </p>
          <div className="space-y-1">
            {(timetable ?? []).length === 0 ? (
              <p className="text-caption text-text-tertiary">불러오는 중...</p>
            ) : (
              (timetable ?? []).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body-sm"
                >
                  <span className="w-6 shrink-0 text-caption font-semibold text-text-tertiary">
                    D{p.day_number}
                  </span>
                  <span className="w-[90px] shrink-0 text-caption text-text-tertiary">
                    {p.start_time}–{p.end_time}
                  </span>
                  <span className="flex-1 font-medium">{p.artist_name}</span>
                  <span className="text-caption text-text-tertiary">
                    {p.stage_name}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 text-caption font-semibold text-text-tertiary">
          공지
        </p>
        <div className="rounded-md border border-border bg-surface-muted/30 p-3 text-text-secondary whitespace-pre-wrap">
          {event.notice_text?.trim() || "등록된 공지가 없습니다."}
        </div>
      </div>

      {/* 점수 상세 — score_breakdown 설명(왜 이 점수인가) */}
      {event.score_breakdown && (
        <div>
          <p className="mb-2 text-caption font-semibold text-text-tertiary">
            점수 상세
          </p>
          <div className="space-y-2 rounded-md border border-border p-3 text-body-sm">
            <div className="flex items-center gap-4 text-caption">
              <span>
                인기 <b>{event.popularity_score?.toFixed(1) ?? "-"}</b>
              </span>
              <span>
                트렌드 <b>{event.trending_score?.toFixed(1) ?? "-"}</b>
              </span>
              {event.score_breakdown.lowConfidence && (
                <Badge variant="warning" className="text-[10px]">
                  저신뢰
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              {event.score_breakdown.signals.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-caption text-text-tertiary">
                    {s.label}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-surface-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.max(0, Math.min(100, s.normalized))}%`,
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-caption tabular-nums">
                    {s.contribution.toFixed(2)}{" "}
                    <span className="text-text-tertiary">(w{s.weight})</span>
                  </span>
                </div>
              ))}
            </div>
            {event.score_breakdown.notes.length > 0 && (
              <ul className="list-inside list-disc text-caption text-text-tertiary">
                {event.score_breakdown.notes.map((n) => (
                  <li key={n.key}>{n.note}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* 필드 출처 — 각 필드를 어떤 소스가 채웠나(provenance) */}
      {event.field_sources && Object.keys(event.field_sources).length > 0 && (
        <div>
          <p className="mb-2 text-caption font-semibold text-text-tertiary">
            필드 출처
          </p>
          <div className="space-y-1 rounded-md border border-border p-3 text-caption">
            {Object.entries(event.field_sources).map(([field, src]) => (
              <div key={field} className="flex gap-2">
                <span className="w-32 shrink-0 text-text-tertiary">
                  {field}
                </span>
                <span className="font-medium">{src?.source ?? "-"}</span>
                {src?.at && (
                  <span className="text-text-tertiary">
                    · {formatKst(src.at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 잠금 필드 — 운영자가 잠가 크롤이 덮지 못하는 필드 */}
      {(event.locked_fields ?? []).length > 0 && (
        <div>
          <p className="mb-2 text-caption font-semibold text-text-tertiary">
            잠금 필드 <span className="font-normal">(크롤이 덮지 않음)</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {event.locked_fields.map((f) => (
              <Badge key={f} variant="secondary" className="text-[10px]">
                🔒 {f}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
