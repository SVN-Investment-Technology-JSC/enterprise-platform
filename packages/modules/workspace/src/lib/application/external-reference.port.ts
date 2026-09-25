import type { ExternalModuleKey } from '@enterprise-platform/contracts-workspace';

/**
 * Token là **Symbol**, không phải chuỗi.
 *
 * Quy ước của repo: store Postgres của chính module dùng token chuỗi, còn
 * port HTTP gọi sang module khác dùng Symbol — xem `ASSET_DIRECTORY` của
 * Maintenance. Nhìn token là biết lời gọi có đi qua mạng hay không.
 */
export const EXTERNAL_REFERENCE_READER = Symbol('EXTERNAL_REFERENCE_READER');

/** Trạng thái hiện tại của một hồ sơ ở module gốc. */
export interface ExternalSnapshot {
  readonly externalId: string;
  readonly code?: string;
  readonly label?: string;
  readonly status?: string;
}

/**
 * Danh tính của người đang xem, để gọi sang module khác **dưới tên họ**.
 *
 * Không dùng service token: người dùng chỉ được thấy những hồ sơ họ vốn có
 * quyền thấy ở module gốc. Gọi bằng service token là cho Workspace một
 * đường vòng để đọc thứ mà chính người dùng không mở được.
 */
export interface ExternalViewer {
  readonly tenantId: string;
  readonly userId: string;
  /** Access token của chính người dùng, chuyển tiếp nguyên vẹn. */
  readonly accessToken: string;
}

/**
 * Đọc trạng thái hồ sơ ở module khác. **Chỉ đọc** — Workspace không bao giờ
 * ghi ngược sang module khác từ phía server.
 *
 * Cài đặt được phép ném lỗi khi module gốc không trả lời; tầng application
 * sẽ bắt lại và rơi về nhãn cache. Không được treo quá thời hạn đã hẹn.
 */
export interface ExternalReferenceReader {
  read(
    viewer: ExternalViewer,
    moduleKey: ExternalModuleKey,
    externalIds: readonly string[],
  ): Promise<ReadonlyMap<string, ExternalSnapshot>>;
}
