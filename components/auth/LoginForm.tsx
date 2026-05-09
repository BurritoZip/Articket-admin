"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export function LoginForm({
  nextPath,
  initialError,
}: {
  nextPath: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (initialError !== "forbidden") return;
    const supabase = createClient();
    void supabase.auth.signOut().then(() => {
      toast.error("접근 거부", {
        description:
          "관리자 권한이 있는 계정만 운영 콘솔에 들어갈 수 있습니다.",
      });
    });
  }, [initialError]);

  const safeNext =
    nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/admin/dashboard";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-xl shadow-elevation3">
        <CardHeader>
          <CardTitle className="text-h2">Articket Admin</CardTitle>
          <CardDescription>
            관리자 계정으로 로그인하세요.{" "}
            <code className="text-caption">user_profiles.role = admin</code> 인
            사용자만 입장합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            type="button"
            loading={loading}
            onClick={async () => {
              if (!email.trim() || !password) {
                toast.error("입력 오류", {
                  description: "이메일과 비밀번호를 입력하세요.",
                });
                return;
              }
              setLoading(true);
              try {
                const supabase = createClient();
                const { error } = await supabase.auth.signInWithPassword({
                  email: email.trim(),
                  password,
                });
                if (error) {
                  toast.error("로그인 실패", { description: error.message });
                  return;
                }
                router.push(safeNext);
                router.refresh();
              } catch (err) {
                const message =
                  err instanceof Error
                    ? err.message
                    : "알 수 없는 오류가 발생했습니다.";
                toast.error("로그인 처리 중 오류", { description: message });
                // 개발 중 콘솔에서 원인 추적을 쉽게 하기 위한 출력
                console.error("[LoginForm] signIn failed:", err);
              } finally {
                setLoading(false);
              }
            }}
          >
            로그인
          </Button>
          <p className="text-center text-caption text-text-tertiary">
            문제가 있으면 Supabase Auth 사용자와{" "}
            <code className="text-caption">user_profiles</code> 행을 확인하세요.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
