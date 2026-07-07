import {
  Activity,
  Bug,
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Mic2,
  Rss,
  Sparkles,
  Star,
  TriangleAlert,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

/** 사이드바 섹션 정의 (렌더 순서 = 이 배열 순서). label=null 이면 헤더 없이 상단 노출. */
export const NAV_GROUPS: { key: string; label: string | null }[] = [
  { key: "main", label: null },
  { key: "content", label: "콘텐츠" },
  { key: "ops", label: "운영" },
  { key: "automation", label: "자동화" },
  { key: "issues", label: "이슈 · 로그" },
];

export const ADMIN_NAV: NavItem[] = [
  // main
  { href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard, group: "main" },

  // 콘텐츠
  { href: "/admin/events", label: "공연", icon: CalendarDays, group: "content" },
  { href: "/admin/artists", label: "아티스트", icon: Mic2, group: "content" },
  { href: "/admin/venues", label: "공연장", icon: Building2, group: "content" },

  // 운영
  { href: "/admin/users", label: "사용자", icon: Users, group: "ops" },
  { href: "/admin/bookings", label: "예매", icon: ClipboardList, group: "ops" },
  { href: "/admin/reviews", label: "리뷰", icon: Star, group: "ops" },
  { href: "/admin/recommendations", label: "추천", icon: Sparkles, group: "ops" },

  // 자동화
  { href: "/admin/crawler", label: "크롤러", icon: Rss, group: "automation" },
  { href: "/admin/ingestion", label: "인제스천", icon: Activity, group: "automation" },

  // 이슈 · 로그 (미해결 건수 뱃지 표시 대상)
  { href: "/admin/booking-issues", label: "예매 링크 이슈", icon: TriangleAlert, group: "issues" },
  { href: "/admin/error-logs", label: "앱 에러 로그", icon: Bug, group: "issues" },
  { href: "/admin/timetable-unmatched", label: "타임테이블 미매칭", icon: UserX, group: "issues" },
];
