import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "대시보드" },
        ]}
        title="대시보드"
        description="곧 요약 카드·차트·최근 예매가 이 페이지에 연결됩니다."
        action={
          <Button asChild variant="secondary">
            <Link href="/admin/events">공연 관리</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>준비 중</CardTitle>
        </CardHeader>
        <CardContent className="text-body-sm text-text-secondary">
          <p>
            상세 스펙의 대시보드 위젯은 Supabase 연동과 함께 구현할 수 있습니다.
          </p>
          <Button asChild className="mt-4">
            <Link href="/admin/users">사용자 관리 UI 보기</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
