import {
  Activity,
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Mic2,
  Rss,
  Star,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/dashboard",
    label: "대시보드",
    icon: LayoutDashboard,
    group: "main",
  },
  { href: "/admin/events", label: "공연", icon: CalendarDays, group: "main" },
  { href: "/admin/artists", label: "아티스트", icon: Mic2, group: "main" },
  { href: "/admin/venues", label: "공연장", icon: Building2, group: "main" },
  { href: "/admin/users", label: "사용자", icon: Users, group: "main" },
  {
    href: "/admin/bookings",
    label: "예매",
    icon: ClipboardList,
    group: "main",
  },
  { href: "/admin/reviews", label: "리뷰", icon: Star, group: "main" },
  {
    href: "/admin/crawler",
    label: "크롤러",
    icon: Rss,
    group: "automation",
  },
  {
    href: "/admin/ingestion",
    label: "인제스천",
    icon: Activity,
    group: "automation",
  },
];
