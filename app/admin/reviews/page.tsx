import { PageHeader } from "@/components/layout/PageHeader";
import { ReviewsPageClient } from "@/components/admin/ReviewsPageClient";

export default function AdminReviewsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "리뷰" },
        ]}
        title="리뷰"
        description="공연 리뷰를 조회하고 관리합니다."
      />
      <ReviewsPageClient />
    </div>
  );
}
