"use client";

import { BarChart3 } from "lucide-react";
import { NavLinkList } from "@/components/layout/NavLinkList";
import { cn } from "@/lib/utils";

export function AdminSidebar({
  collapsed,
  onLogout,
}: {
  collapsed: boolean;
  onLogout?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-surface",
        collapsed ? "w-[72px]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-border px-4",
          collapsed && "justify-center px-2",
        )}
      >
        <div
          className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-weak text-primary"
          aria-hidden
        >
          <BarChart3 className="h-5 w-5" strokeWidth={1.6} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-body-sm font-bold text-text-primary">
              Articket Admin
            </p>
            <p className="truncate text-caption text-text-tertiary">
              운영 콘솔
            </p>
          </div>
        )}
      </div>
      <NavLinkList collapsed={collapsed} onLogout={onLogout} />
    </aside>
  );
}
