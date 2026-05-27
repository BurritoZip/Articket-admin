"use client";

import * as React from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/Sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Separator } from "@/components/ui/Separator";
import type { CrawlerSource, CrawlerSourceSelectors } from "@/types/crawler";

interface CrawlerSourceSheetProps {
  source: CrawlerSource | null;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: CrawlerSource) => void;
}

const SELECTOR_FIELDS: {
  key: keyof CrawlerSourceSelectors;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "item",
    label: "목록 아이템",
    placeholder: ".card, li.item, ...",
  },
  {
    key: "title",
    label: "공연명",
    placeholder: ".title, h3.name, ...",
  },
  {
    key: "venue",
    label: "공연장",
    placeholder: ".venue, span.place, ...",
  },
  {
    key: "date",
    label: "날짜",
    placeholder: ".date, time, ...",
  },
  {
    key: "link",
    label: "상세 링크",
    placeholder: "a.card-link, .item > a, ...",
  },
  {
    key: "image",
    label: "이미지",
    placeholder: "img.poster, .thumbnail img, ...",
  },
];

export function CrawlerSourceSheet({
  source,
  open,
  onClose,
  onSaved,
}: CrawlerSourceSheetProps) {
  const [selectors, setSelectors] = React.useState<CrawlerSourceSelectors>({});
  const [rateLimit, setRateLimit] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // 소스가 바뀔 때 폼 초기화
  React.useEffect(() => {
    if (source) {
      setSelectors(source.config.selectors ?? {});
      setRateLimit(String(source.config.rateLimit ?? ""));
    }
  }, [source]);

  const consecutiveZeroCount = source?.config.consecutiveZeroCount ?? 0;
  const lastStructureChangeAt = source?.config.lastStructureChangeAt;

  const handleSave = async () => {
    if (!source) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/crawler/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            selectors,
            rateLimit: rateLimit ? parseInt(rateLimit) : undefined,
            // 저장 시 연속 0건 카운터 리셋 (선택자 수정으로 해결됐다고 간주)
            consecutiveZeroCount: 0,
            lastStructureChangeAt: undefined,
          },
        }),
      });
      const json = (await res.json()) as { ok?: boolean; source?: CrawlerSource; error?: string };
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      toast.success(`${source.display_name} 선택자 저장 완료`);
      onSaved(json.source!);
      onClose();
    } catch (e) {
      toast.error("저장 실패", {
        description: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSelector = (key: keyof CrawlerSourceSelectors, value: string) => {
    setSelectors((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
      >
        {/* 헤더 */}
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2 text-text-tertiary">
            <Settings2 className="h-4 w-4" />
            <span className="text-caption">선택자 설정</span>
          </div>
          <SheetTitle className="text-h2">{source?.display_name ?? ""}</SheetTitle>
          <SheetDescription>
            CSS 선택자를 수정하면 다음 크롤링부터 즉시 적용됩니다.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex flex-1 flex-col gap-6 py-6">
          {/* 구조 변경 경고 */}
          {consecutiveZeroCount >= 3 && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>구조 변경 감지</AlertTitle>
              <AlertDescription>
                최근 {consecutiveZeroCount}회 연속으로 수집 결과가 0건입니다.
                {lastStructureChangeAt && (
                  <span className="mt-1 block text-caption text-text-tertiary">
                    최초 감지:{" "}
                    {new Date(lastStructureChangeAt).toLocaleString("ko-KR")}
                  </span>
                )}
                <br />
                아래 CSS 선택자를 현재 사이트 구조에 맞게 수정해 주세요.
              </AlertDescription>
            </Alert>
          )}

          {consecutiveZeroCount > 0 && consecutiveZeroCount < 3 && (
            <Alert variant="default">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>수집 결과 주의</AlertTitle>
              <AlertDescription>
                최근 {consecutiveZeroCount}회 수집 결과가 0건이었습니다.
                선택자를 확인해 주세요.
              </AlertDescription>
            </Alert>
          )}

          {/* CSS 선택자 입력 */}
          <div className="flex flex-col gap-4">
            <p className="text-label font-semibold text-text-primary">
              CSS 선택자
            </p>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
              {SELECTOR_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`selector-${key}`}
                    className="text-caption text-text-secondary"
                  >
                    {label}
                  </Label>
                  <Input
                    id={`selector-${key}`}
                    value={selectors[key] ?? ""}
                    onChange={(e) => updateSelector(key, e.target.value)}
                    placeholder={placeholder}
                    className="font-mono text-body-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Rate Limit */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rate-limit" className="text-label font-semibold">
              Rate Limit (ms)
            </Label>
            <p className="text-caption text-text-tertiary">
              요청 사이 대기 시간 (기본: 800ms)
            </p>
            <Input
              id="rate-limit"
              type="number"
              min={200}
              max={5000}
              step={100}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              placeholder="800"
              className="w-32"
            />
          </div>
        </div>

        {/* 푸터 */}
        <Separator />
        <SheetFooter className="pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button loading={saving} onClick={() => void handleSave()}>
            저장
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
