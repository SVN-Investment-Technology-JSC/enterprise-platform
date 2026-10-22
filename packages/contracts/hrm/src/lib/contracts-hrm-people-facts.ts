/**
 * Hợp đồng API nội bộ `GET /v1/internal/people/profile-facts` của HRM, dùng cho phân hệ khác (Mạng nội bộ)
 * cần ngày sinh và ngày vào công ty. Chỉ đọc; nhân sự không có tài khoản hoặc đã nghỉ việc không có mặt.
 */
export interface HrmPersonProfileFact {
  /** Id người dùng Core (`core_schema.employees.user_id`), không phải id hồ sơ nhân sự. */
  readonly userId: string;
  /** 1-12. Thiếu khi nhân sự chưa khai ngày sinh. */
  readonly birthMonth?: number;
  /** 1-31. Thiếu khi nhân sự chưa khai ngày sinh. */
  readonly birthDay?: number;
  /** Năm sinh; bên nhận chỉ dùng để tính tuổi, không được hiển thị lại nguyên văn. */
  readonly birthYear?: number;
  /** Ngày vào công ty, `YYYY-MM-DD`. */
  readonly joinDate?: string;
}

export interface HrmPersonProfileFactsResponse {
  readonly data: readonly HrmPersonProfileFact[];
}
