import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardPageClient } from "@/components/admin/DashboardPageClient";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "대시보드" },
        ]}
        title="대시보드"
        description="전체 현황 및 즉각 처리가 필요한 항목을 확인합니다."
      />
      <DashboardPageClient />
    </div>
  );
}
