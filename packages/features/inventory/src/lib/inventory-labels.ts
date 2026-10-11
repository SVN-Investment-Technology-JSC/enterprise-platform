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

export const LOT_STATUS_LABEL: Readonly<Record<string, string>> = {
  PASSED: 'Đạt chuẩn (Passed)',
  QUARANTINE: 'Chờ kiểm định (Quarantine)',
  NEAR_EXPIRY: 'Cận hạn dùng (Near Expiry)',
  EXPIRED: 'Hết hạn sử dụng (Expired)',
  BLOCKED: 'Khóa xuất / Niêm phong',
};

export const LOT_STATUS_BADGE: Readonly<Record<string, { bg: string; text: string; border: string }>> = {
  PASSED: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  QUARANTINE: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  NEAR_EXPIRY: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  EXPIRED: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
  BLOCKED: { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
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
  TRANSFER_OUT: 'Xuất kho',
  TRANSFER_IN: 'Nhập kho',
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

/**
 * Trả về cấu hình step và min tăng giảm số lượng linh hoạt theo Đơn vị tính (ĐVT)
 * - Đơn vị đếm (cái, chiếc, bộ, bình, cuộn, hộp, thùng...): step = 1, min = 1
 * - Đơn vị đo lường thể tích/khối lượng/chiều dài (lít, kg, mét, m3...): step = 0.01, min = 0.01
 */
export function getUnitQuantityConfig(unit?: string): { step: string; min: number } {
  if (!unit) return { step: '1', min: 1 };
  const u = unit.trim().toLowerCase();

  // Đơn vị đo lường thể tích, khối lượng, độ dài, diện tích (cho phép số thập phân, bước nhảy 0.01)
  const decimalUnits = new Set([
    'lít', 'lit', 'l', 'ml', 'm3', 'mét khối',
    'kg', 'kilogam', 'kilo', 'g', 'gam', 'gram', 'tấn', 'tan', 'tạ', 'yến',
    'm', 'mét', 'met', 'cm', 'mm', 'km',
    'm2', 'mét vuông', 'ha',
  ]);

  if (
    decimalUnits.has(u) ||
    u.startsWith('lít') ||
    u.startsWith('lit') ||
    u.startsWith('kg') ||
    u.startsWith('mét') ||
    u.startsWith('tan')
  ) {
    return { step: '0.01', min: 0.01 };
  }

  // Mặc định cho các đơn vị đếm (cái, chiếc, bộ, bình, ống, thùng, cuộn, kiện, hộp...) là số nguyên (bước nhảy 1)
  return { step: '1', min: 1 };
}
