import {
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Mic2,
  Star,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ADMIN_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/admin/events", label: "공연", icon: CalendarDays },
  { href: "/admin/artists", label: "아티스트", icon: Mic2 },
  { href: "/admin/venues", label: "공연장", icon: Building2 },
  { href: "/admin/users", label: "사용자", icon: Users },
  { href: "/admin/bookings", label: "예매", icon: ClipboardList },
  { href: "/admin/reviews", label: "리뷰", icon: Star },
];
