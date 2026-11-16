export type MaintenanceErrorCode = 'validation' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';

export class MaintenanceError extends Error {
  /**
   * `responseCode`: mã máy đọc được trả trong body thay cho mã chung theo
   * `code` (vd. `UPLOAD_NOT_FOUND` thay vì `CONFLICT`), để giao diện phân biệt
   * các lỗi cùng mã HTTP.
   */
  constructor(
    readonly code: MaintenanceErrorCode,
    message: string,
    readonly responseCode?: string,
  ) {
    super(message);
    this.name = 'MaintenanceError';
  }
}
