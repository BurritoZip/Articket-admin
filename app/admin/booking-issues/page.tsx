import { PageHeader } from "@/components/layout/PageHeader";
import { BookingIssuesPageClient } from "@/components/admin/BookingIssuesPageClient";

export default function AdminBookingIssuesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "예매 링크 이슈" },
        ]}
        title="예매 링크 이슈"
        description="예매 링크가 연결되지 않은 공연에서 사용자가 예매를 시도한 기록입니다. 우선 링크를 채워야 할 공연을 파악하세요."
      />
      <BookingIssuesPageClient />
    </div>
  );
}
