import { PageHeader } from "@/components/layout/PageHeader";
import { RecommendationsPageClient } from "@/components/admin/RecommendationsPageClient";

export default function AdminRecommendationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "추천" },
        ]}
        title="추천"
        description="인기 아티스트 랭킹과 유저별 개인화 추천을 미리봅니다."
      />
      <RecommendationsPageClient />
    </div>
  );
}
