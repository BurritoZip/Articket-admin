import { PageHeader } from "@/components/layout/PageHeader";

export default function AdminReviewsPage() {
  return (
    <PageHeader
      breadcrumb={[
        { label: "관리", href: "/admin/dashboard" },
        { label: "리뷰" },
      ]}
      title="리뷰"
      description="리뷰 관리 페이지 — 구현 예정"
    />
  );
}
