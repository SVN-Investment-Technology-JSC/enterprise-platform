/**
 * Danh mục thuộc tính do hệ thống nguồn (HRM) cấp mặc định cho quy trình.
 *
 * Chỉ là dữ liệu tra cứu thuần: PE không import HRM; HRM (hoặc bất kỳ module
 * nào) dùng lại bảng này qua contracts. Mã so khớp không phân biệt hoa thường.
 */
export type ProcedureHostRequestKind = 'leave' | 'ot' | 'business_trip' | 'salary_advance' | 'shift_change' | 'common';

export interface ProcedureHostAttributeInfo {
  readonly code: string;
  /** Tên trường trên đơn HRM, hiển thị sau "Lấy từ đơn HRM:". */
  readonly fieldLabel: string;
  readonly meaning: string;
  readonly requestKind: ProcedureHostRequestKind;
}

export const PROCEDURE_HOST_REQUEST_KIND_LABELS: Readonly<Record<ProcedureHostRequestKind, string>> = {
  leave: 'Đơn nghỉ phép',
  ot: 'Đơn làm thêm giờ (OT)',
  business_trip: 'Đơn công tác',
  salary_advance: 'Đơn tạm ứng lương',
  shift_change: 'Đơn đổi ca',
  common: 'Dùng chung nhiều loại đơn',
};

export const PROCEDURE_HOST_ATTRIBUTES: readonly ProcedureHostAttributeInfo[] = [
  { code: 'so_ngay_nghi', fieldLabel: 'số ngày nghỉ', meaning: 'Tổng số ngày nghỉ của đơn', requestKind: 'leave' },
  { code: 'duration', fieldLabel: 'thời lượng', meaning: 'Số ngày nghỉ (đơn nghỉ) hoặc số giờ (đơn OT)', requestKind: 'leave' },
  { code: 'leave_type_id', fieldLabel: 'loại phép', meaning: 'Mã loại phép được chọn trong đơn', requestKind: 'leave' },
  { code: 'is_negative_leave', fieldLabel: 'nghỉ âm phép', meaning: 'Đơn làm số dư phép bị âm', requestKind: 'leave' },
  { code: 'so_gio_ot', fieldLabel: 'số giờ OT', meaning: 'Tổng số giờ làm thêm', requestKind: 'ot' },
  { code: 'ot_hours', fieldLabel: 'số giờ OT', meaning: 'Tổng số giờ làm thêm (mã tiếng Anh)', requestKind: 'ot' },
  { code: 'loai_ot', fieldLabel: 'loại OT', meaning: 'Loại làm thêm giờ (ngày thường, nghỉ, lễ)', requestKind: 'ot' },
  { code: 'is_night_ot', fieldLabel: 'OT ban đêm', meaning: 'Có làm thêm vào ban đêm', requestKind: 'ot' },
  { code: 'allow_ot', fieldLabel: 'cho phép OT', meaning: 'Nhân viên được phép làm thêm giờ', requestKind: 'ot' },
  { code: 'so_ngay_cong_tac', fieldLabel: 'số ngày công tác', meaning: 'Tổng số ngày công tác', requestKind: 'business_trip' },
  { code: 'days_count', fieldLabel: 'số ngày công tác', meaning: 'Tổng số ngày công tác (mã tiếng Anh)', requestKind: 'business_trip' },
  { code: 'loai_cong_tac', fieldLabel: 'loại công tác', meaning: 'Loại công tác (trong nước, nước ngoài...)', requestKind: 'business_trip' },
  { code: 'dia_diem', fieldLabel: 'địa điểm', meaning: 'Địa điểm công tác', requestKind: 'business_trip' },
  { code: 'so_tien', fieldLabel: 'số tiền', meaning: 'Số tiền tạm ứng', requestKind: 'salary_advance' },
  { code: 'amount', fieldLabel: 'số tiền', meaning: 'Số tiền tạm ứng (mã tiếng Anh)', requestKind: 'salary_advance' },
  { code: 'so_ky_tra', fieldLabel: 'số kỳ trả', meaning: 'Số kỳ hoàn trả khoản tạm ứng', requestKind: 'salary_advance' },
  { code: 'loai_doi_ca', fieldLabel: 'loại đổi ca', meaning: 'Hình thức đổi ca', requestKind: 'shift_change' },
  { code: 'ngay', fieldLabel: 'ngày', meaning: 'Ngày áp dụng của đơn (ví dụ ngày đổi ca)', requestKind: 'shift_change' },
  { code: 'ly_do', fieldLabel: 'lý do', meaning: 'Lý do ghi trên đơn', requestKind: 'common' },
  { code: 'tu_ngay', fieldLabel: 'từ ngày', meaning: 'Ngày bắt đầu của đơn', requestKind: 'common' },
  { code: 'den_ngay', fieldLabel: 'đến ngày', meaning: 'Ngày kết thúc của đơn', requestKind: 'common' },
];

const BY_CODE: ReadonlyMap<string, ProcedureHostAttributeInfo> = new Map(
  PROCEDURE_HOST_ATTRIBUTES.map((item) => [item.code, item]),
);

/** Tra thuộc tính do HRM cấp theo mã (không phân biệt hoa thường, bỏ khoảng trắng đầu cuối). */
export function lookupHostAttribute(code: string | null | undefined): ProcedureHostAttributeInfo | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.trim().toLowerCase());
}

/** Nhãn "Lấy từ đơn HRM: số ngày nghỉ", hoặc undefined nếu mã không do HRM cấp. */
export function hostAttributeSourceLabel(code: string | null | undefined): string | undefined {
  const info = lookupHostAttribute(code);
  return info ? `Lấy từ đơn HRM: ${info.fieldLabel}` : undefined;
}

/** Danh mục gom theo loại đơn, theo thứ tự cố định, cho danh sách tham chiếu. */
export function groupHostAttributesByKind(): { kind: ProcedureHostRequestKind; label: string; items: ProcedureHostAttributeInfo[] }[] {
  return (Object.keys(PROCEDURE_HOST_REQUEST_KIND_LABELS) as ProcedureHostRequestKind[])
    .map((kind) => ({
      kind,
      label: PROCEDURE_HOST_REQUEST_KIND_LABELS[kind],
      items: PROCEDURE_HOST_ATTRIBUTES.filter((item) => item.requestKind === kind),
    }))
    .filter((group) => group.items.length > 0);
}
