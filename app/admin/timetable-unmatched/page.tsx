import { PageHeader } from "@/components/layout/PageHeader";
import { TimetableUnmatchedPageClient } from "@/components/admin/TimetableUnmatchedPageClient";

export default function AdminTimetableUnmatchedPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "타임테이블 미매칭" },
        ]}
        title="타임테이블 미매칭 아티스트"
        description="타임테이블(캡쳐/텍스트) 임포트 시 기존 아티스트 리스트에 없어 자동 연결되지 못한 이름입니다. 별칭 추가·신규 생성·무시를 판단한 뒤 해결됨으로 표시하세요."
      />
      <TimetableUnmatchedPageClient />
    </div>
  );
}
