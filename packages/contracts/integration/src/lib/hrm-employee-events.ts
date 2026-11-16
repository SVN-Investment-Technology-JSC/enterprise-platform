/**
 * Sự kiện nhân viên nghỉ việc. Bên phát là trigger `hrm_schema.record_employee_offboarded_event`
 * (migrations/tenant/hrm/0034) khi hồ sơ chuyển sang RESIGNED hoặc TERMINATED; tên loại sự kiện đã phát, không đổi.
 * Bên nghe là Core (platform-identity, hàng đợi `identity.integrations.v1`): vô hiệu tài khoản, đóng bổ nhiệm, thu hồi
 * phiên. HRM không ghi `core_schema` (ISS-BE-020).
 */
export const HRM_EMPLOYEE_OFFBOARDED = 'hrm.employee.offboarded';

export interface HrmEmployeeOffboardedPayload {
  /** `core_schema.employees.id` (dòng liên kết nhân sự); Core tự tra tài khoản từ đây. */
  readonly employeeId: string;
  readonly employmentStatus?: 'RESIGNED' | 'TERMINATED' | string;
  /**
   * Ngày nghỉ việc dạng YYYY-MM-DD: `inactive_from` của hồ sơ HRM, ngày đầu tiên không còn làm việc (migration hrm/0077;
   * hồ sơ không có `inactive_from` thì là ngày ghi sự kiện). HRM chỉ cho nhập ngày không sau hôm nay.
   */
  readonly effectiveDate?: string;
  /** Tài khoản Core nếu bên phát biết; bản trigger hiện tại không gửi. */
  readonly userId?: string;
}
