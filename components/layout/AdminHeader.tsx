"use client";

import {
  Bell,
  HelpCircle,
  Menu,
  Moon,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export function AdminHeader({
  onMenuClick,
  className,
}: {
  onMenuClick?: () => void;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 md:px-6",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        type="button"
        onClick={onMenuClick}
        aria-label="메뉴 열기"
      >
        <Menu className="h-6 w-6" strokeWidth={1.6} />
      </Button>
      <div className="hidden min-w-0 flex-1 md:block md:max-w-md">
        <label className="relative block">
          <span className="sr-only">전역 검색</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-tertiary"
            strokeWidth={1.6}
            aria-hidden
          />
          <Input
            className="h-11 pl-10 pr-10"
            placeholder="사용자, 공연, 예매 번호 검색…"
            type="search"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label="알림"
          className="hidden sm:inline-flex"
        >
          <Bell className="h-6 w-6" strokeWidth={1.6} />
        </Button>
        <Button variant="ghost" size="sm" type="button" className="gap-2">
          <HelpCircle className="h-5 w-5" strokeWidth={1.6} aria-hidden />
          <span className="hidden lg:inline">도움말</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() =>
            setTheme(
              theme === "dark" ? "light" : theme === "light" ? "dark" : "light",
            )
          }
          aria-label={
            mounted && theme === "dark"
              ? "라이트 모드로 전환"
              : "다크 모드로 전환"
          }
        >
          {mounted && theme === "dark" ? (
            <Sun className="h-6 w-6" strokeWidth={1.6} />
          ) : (
            <Moon className="h-6 w-6" strokeWidth={1.6} />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="gap-2 rounded-md"
              type="button"
            >
              <UserRound className="h-5 w-5" strokeWidth={1.6} aria-hidden />
              <span className="hidden sm:inline">관리자</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-semibold text-text-primary">
                  운영 계정
                </span>
                <span className="text-caption text-text-tertiary">
                  admin@articket.app
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>프로필 설정</DropdownMenuItem>
            <DropdownMenuItem>감사 로그</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
