"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import {
  ADMIN_NAV,
  NAV_GROUPS,
  type NavItem,
} from "@/components/layout/admin-nav";
import { cn } from "@/lib/utils";

interface AttentionResponse {
  counts: Record<string, number>;
}

export function NavLinkList({
  collapsed,
  onLogout,
  onNavigate,
}: {
  collapsed: boolean;
  onLogout?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // 이슈·로그 미해결 건수 — 뱃지로 표시. 가벼운 count 쿼리, 30초 폴링.
  const { data: attention } = useQuery<AttentionResponse>({
    queryKey: ["admin-attention-counts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/attention-counts");
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<AttentionResponse>;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const counts = attention?.counts ?? {};

  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="주 메뉴">
        {NAV_GROUPS.map((group) => {
          const items = ADMIN_NAV.filter((i) => i.group === group.key);
          if (items.length === 0) return null;
          return (
            <div key={group.key} className="flex flex-col gap-1">
              {group.label && !collapsed && (
                <p className="px-3 pb-1 pt-3 text-caption font-semibold uppercase tracking-wide text-text-tertiary">
                  {group.label}
                </p>
              )}
              {group.label && collapsed && (
                <div className="mx-2 my-2 border-t border-border" aria-hidden />
              )}
              {items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  active={
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`)
                  }
                  count={counts[item.href] ?? 0}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => {
            onLogout?.();
            onNavigate?.();
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-body-sm font-medium text-text-secondary transition-colors hover:bg-danger-weak hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-2",
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.6} aria-hidden />
          {!collapsed && <span>로그아웃</span>}
        </button>
      </div>
    </>
  );
}

function NavRow({
  item,
  active,
  count,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const hasBadge = count > 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-body-sm font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active &&
          "bg-primary-weak text-primary hover:bg-primary-weak hover:text-primary",
        collapsed && "justify-center px-2",
      )}
      title={collapsed ? `${item.label}${hasBadge ? ` (${count})` : ""}` : undefined}
    >
      <span className="relative shrink-0">
        <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden />
        {hasBadge && collapsed && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger"
            aria-hidden
          />
        )}
      </span>
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && hasBadge && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-caption font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
