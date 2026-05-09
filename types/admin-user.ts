export type AdminUserRow = {
  id: string;
  displayName: string;
  email: string;
  role: "user" | "admin";
  lastVisitDate: string | null;
  bookingCount: number;
  followingCount: number;
  createdAt: string;
  /** 데모용 승인/요청 상태 — 색+텍스트 병행 */
  accountStatus: "active" | "pending" | "suspended";
};
