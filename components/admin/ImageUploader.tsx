"use client";

import * as React from "react";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  folder?: string;
  placeholder?: string;
}

export function ImageUploader({
  value,
  onChange,
  folder = "misc",
  placeholder = "이미지",
}: ImageUploaderProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const handleFile = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("업로드 실패");
      const json = (await res.json()) as { url: string };
      onChange(json.url);
      setPreview(null);
      toast.success("업로드 완료");
    } catch {
      toast.error("이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const displayUrl = preview ?? value;

  return (
    <div className="space-y-2">
      {displayUrl ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl}
            alt={placeholder}
            className="h-24 w-24 rounded-md border border-border object-cover"
          />
        </div>
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/40">
          <ImageIcon className="h-6 w-6 text-text-tertiary" />
        </div>
      )}
      <div className="flex gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="text-body-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {preview && (
          <Button
            size="sm"
            variant="secondary"
            disabled={uploading}
            onClick={() => void handleUpload()}
          >
            {uploading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3 w-3" />
            )}
            업로드
          </Button>
        )}
      </div>
      {value && !preview && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="이미지 URL 직접 입력"
          className="text-body-sm"
        />
      )}
    </div>
  );
}
