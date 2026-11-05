/** Thay đổi ở tab hồ sơ chưa ghi lên server; chỉ chạy khi người dùng xác nhận lưu. */
export interface HrmStagedChange {
  label: string;
  run: () => Promise<void>;
  /** Tab chứa thay đổi, để chuyển về đó khi áp dụng lỗi. */
  tab?: 'documents' | 'family' | 'contracts' | 'custody';
  /** Số hợp đồng đang chờ lưu, dùng để báo trùng ngay khi nhập. */
  contractCode?: string;
  /** Tài sản đang chờ cấp hoặc thu hồi, để thẻ Vật tư đánh dấu dòng và ẩn tài sản đã chọn. */
  custody?: { code: string; action: 'assign' | 'revoke' };
  /** Lỗi từ máy chủ khi áp dụng thay đổi này. */
  error?: string;
}

export type HrmStageChange = (change: HrmStagedChange) => void;

export const STAGED_NOTICE = 'Đã ghi nhận, sẽ lưu khi bấm "Lưu thay đổi"';
