import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorLogsPageClient } from "@/components/admin/ErrorLogsPageClient";

export default function AdminErrorLogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "앱 에러 로그" },
        ]}
        title="앱 에러 로그"
        description="iOS 등 클라이언트 앱에서 발생한 런타임 에러·크래시 기록입니다. 행을 눌러 스택 트레이스와 환경 정보를 확인하고, 처리 후 해결됨으로 표시하세요."
      />
      <ErrorLogsPageClient />
    </div>
  );
}
