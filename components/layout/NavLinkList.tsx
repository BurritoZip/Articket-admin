"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { ADMIN_NAV } from "@/components/layout/admin-nav";
import { cn } from "@/lib/utils";

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

  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="주 메뉴">
        {ADMIN_NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-body-sm font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active &&
                  "bg-primary-weak text-primary hover:bg-primary-weak hover:text-primary",
                collapsed && "justify-center px-2",
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className="h-5 w-5 shrink-0"
                strokeWidth={1.6}
                aria-hidden
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
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
