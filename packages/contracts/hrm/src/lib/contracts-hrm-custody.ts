/**
 * Tài sản công ty cấp cho nhân viên, như HRM thấy qua API của Kho (`/v1/internal/custody/...`). Dữ liệu thuộc Kho;
 * HRM không lưu bản sao và không có giá mua, kho hay lịch sử bảo trì.
 */
export interface HrmCustodyAsset {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly assetCategory?: 'INDUSTRIAL' | 'IT_OFFICE' | 'TOOL_PPE' | 'VEHICLE';
  readonly serialNumber?: string;
  readonly status?: string;
  readonly assignedAt?: string;
}

/** Thân `POST /v1/employees/:employeeId/custody`. */
export interface AssignHrmCustodyRequest {
  readonly materialCode: string;
}
