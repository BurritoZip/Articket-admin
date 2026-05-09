"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { NavLinkList } from "@/components/layout/NavLinkList";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("로그아웃되었습니다.");
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-dvh bg-background">
      {/* 모바일: 하단 드로어 */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="bottom"
          className="h-[min(85dvh,560px)] rounded-t-xl p-0"
        >
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
            <SheetTitle className="text-h3">메뉴</SheetTitle>
          </SheetHeader>
          <div className="flex h-[calc(100%-3.5rem)] flex-col overflow-y-auto">
            <NavLinkList
              collapsed={false}
              onLogout={handleLogout}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 태블릿: 아이콘 전용 고정 레일 */}
      <div className="fixed left-0 top-0 z-40 hidden h-dvh md:flex lg:hidden">
        <AdminSidebar collapsed onLogout={handleLogout} />
      </div>

      {/* 데스크톱: 전체 사이드바 */}
      <div className="fixed left-0 top-0 z-40 hidden h-dvh lg:flex">
        <AdminSidebar collapsed={false} onLogout={handleLogout} />
      </div>

      <div
        className={cn(
          "flex min-h-dvh flex-col",
          "pl-0 md:pl-[72px] lg:pl-[var(--sidebar-width)]",
        )}
      >
        <AdminHeader onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 px-[var(--content-margin)] pb-10 pt-6">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
