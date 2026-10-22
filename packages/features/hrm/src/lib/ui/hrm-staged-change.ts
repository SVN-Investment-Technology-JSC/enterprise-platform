/** Thay đổi ở tab hồ sơ chưa ghi lên server; chỉ chạy khi người dùng xác nhận lưu. */
export interface HrmStagedChange {
  label: string;
  run: () => Promise<void>;
  /** Tab chứa thay đổi, để chuyển về đó khi áp dụng lỗi. */
  tab?: 'documents' | 'family' | 'contracts';
  /** Số hợp đồng đang chờ lưu, dùng để báo trùng ngay khi nhập. */
  contractCode?: string;
  /** Lỗi từ máy chủ khi áp dụng thay đổi này. */
  error?: string;
}

export type HrmStageChange = (change: HrmStagedChange) => void;

export const STAGED_NOTICE = 'Đã ghi nhận, sẽ lưu khi bấm "Lưu thay đổi"';
