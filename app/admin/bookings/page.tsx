import { PageHeader } from "@/components/layout/PageHeader";

export default function AdminBookingsPage() {
  return (
    <PageHeader
      breadcrumb={[
        { label: "관리", href: "/admin/dashboard" },
        { label: "예매" },
      ]}
      title="예매"
      description="예매 관리 페이지 — 구현 예정"
    />
  );
}
