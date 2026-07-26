import { PageHeader } from "@/components/layout/PageHeader";
import { ReviewInboxClient } from "@/components/admin/ReviewInboxClient";

export default function AdminReviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "검토 대기" },
        ]}
        title="검토 대기"
        description="사람 판단이 필요한 항목을 한 곳에. 이름 제안은 여기서 바로 승인·거절·삭제하고, 나머지 큐는 개수와 함께 해당 화면으로 이동합니다."
      />
      <ReviewInboxClient />
    </div>
  );
}
