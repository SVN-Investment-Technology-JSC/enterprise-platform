import type {
  AssetCriticality,
  AssetStatus,
  AssetType,
  MaterialCategory,
  ReservationStatus,
  TransactionType,
  WarehouseType,
} from '@enterprise-platform/contracts-inventory';

/**
 * Mọi nhãn tiếng Việt của module Kho gom về một chỗ. Trước đây chỉ AssetType được
 * dịch, còn lại đẩy thẳng giá trị enum của DB ra màn hình (CRITICAL, RESERVED,
 * IMPORT…). Gom lại đây để không còn chỗ nào lỡ hiển thị chuỗi thô.
 */

export const ASSET_TYPE_LABEL: Readonly<Record<AssetType, string>> = {
  PLANT: 'Nhà máy',
  SYSTEM: 'Hệ thống',
  EQUIPMENT: 'Thiết bị',
  COMPONENT: 'Chi tiết',
};

export const ASSET_STATUS_LABEL: Readonly<Record<AssetStatus, string>> = {
  OPERATING: 'Đang vận hành',
  STOPPED: 'Đang dừng',
  MAINTENANCE: 'Đang bảo trì',
  DISPOSED: 'Đã thanh lý',
};

export const ASSET_CRITICALITY_LABEL: Readonly<Record<AssetCriticality, string>> = {
  CRITICAL: 'Trọng yếu',
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

export const WAREHOUSE_TYPE_LABEL: Readonly<Record<WarehouseType, string>> = {
  PHYSICAL: 'Kho vật lý',
  VIRTUAL_IN_TRANSIT: 'Kho ảo — đang luân chuyển',
};

export const MATERIAL_CATEGORY_LABEL: Readonly<Record<MaterialCategory, string>> = {
  SPARE_PART: 'Phụ tùng',
  CONSUMABLE: 'Vật tư tiêu hao',
  TOOL: 'Dụng cụ',
  ROTABLE: 'Vật tư luân chuyển',
};

export const TRANSACTION_TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  TRANSFER_OUT: 'Chuyển đi',
  TRANSFER_IN: 'Chuyển đến',
  BORROW: 'Mượn',
  RETURN: 'Trả lại',
  ADJUST: 'Điều chỉnh',
};

export const RESERVATION_STATUS_LABEL: Readonly<Record<ReservationStatus, string>> = {
  PENDING: 'Chờ xử lý',
  RESERVED: 'Đang giữ',
  PARTIALLY_ISSUED: 'Đã xuất một phần',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
};

/**
 * Nguồn phát sinh giao dịch là chuỗi tự do (`referenceType: string`), do bên gọi
 * đặt chứ không phải union trong contract — nên phải có đường lui trả nguyên
 * trạng. Danh sách dưới đây phủ các giá trị đang thực sự có trong dữ liệu.
 */
export function referenceLabel(value?: string): string {
  if (!value) return '—';
  const known: Record<string, string> = {
    OPENING_BALANCE: 'Tồn đầu kỳ',
    inventory_transaction: 'Giao dịch kho',
    PROCEDURE: 'Quy trình',
    MAINTENANCE: 'Bảo trì',
    RESERVATION: 'Phiếu giữ chỗ',
    MANUAL: 'Nhập tay',
    ADJUSTMENT: 'Kiểm kê',
  };
  return known[value] ?? value;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(value?: string): string {
  return value ? dateTime.format(new Date(value)) : '—';
}
