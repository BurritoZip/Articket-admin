import { PageHeader } from "@/components/layout/PageHeader";
import { BookingsPageClient } from "@/components/admin/BookingsPageClient";

export default function AdminBookingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "예매" },
        ]}
        title="예매"
        description="예매 현황을 조회합니다. (읽기 전용)"
      />
      <BookingsPageClient />
    </div>
  );
}
