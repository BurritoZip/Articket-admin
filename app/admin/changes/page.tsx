import { PageHeader } from "@/components/layout/PageHeader";
import { ChangeLogsPageClient } from "@/components/admin/ChangeLogsPageClient";

export default function AdminChangesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "변경 내역" },
        ]}
        title="변경 내역"
        description="파이프라인(크롤·보강)이 공연 데이터를 어떤 필드에서 어떻게 바꿨는지 기록입니다. 필드·공연으로 필터해 무엇이 업데이트됐는지 확인하세요."
      />
      <ChangeLogsPageClient />
    </div>
  );
}
