/**
 * Hợp đồng giao tiếp cho phân loại làm thêm / ca đêm và quỹ nghỉ bù (xem docs/HRM_THIET_KE_QUY_NGHI_BU_VA_CHOT_CHAN_DON_TU.md).
 * Chỉ kiểu dữ liệu: web và API dùng chung.
 */

/** Ngày làm việc kế tiếp sau ca xuyên đêm có được nghỉ không: không, nửa ngày, cả ngày. */
export type HrmNextDayRest = 'NONE' | 'HALF' | 'FULL';

export type HrmOvertimeRuleSet = 'NIGHT_REST' | 'CLOCK_WINDOW';
export type HrmOvertimeRounding = 'HALF_UP' | 'DOWN' | 'UP';

/** Nhóm `overtimeComp` trong `config_json` của phiên bản chính sách làm thêm (OT). */
export interface HrmOvertimeCompConfig {
  readonly enabled: boolean;
  readonly ruleSet: HrmOvertimeRuleSet;
  readonly normalHoursPerDay: number;
  readonly monthlyCapHours: number;
  readonly yearlyCapHours: number | null;
  readonly nightCapped: boolean;
  readonly nightStartMinute: number;
  readonly nightEndMinute: number;
  readonly nightRestHoursPerDay: number;
  readonly allowHalfDay: boolean;
  readonly compFactor: number;
  readonly dayBasisHours: number | null;
  readonly decimals: number;
  readonly rounding: HrmOvertimeRounding;
  readonly usageStepDays: number;
  readonly accrualMonthOffset: 0 | 1;
  readonly expiryMonths: number;
  readonly accumulationCapDays: number | null;
}

export interface HrmOvertimeCompVersionSummary {
  readonly id: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly config: HrmOvertimeCompConfig;
}

/** Cấu hình làm thêm và nghỉ bù đang hiệu lực kèm lịch sử phiên bản. */
export interface HrmOvertimeCompSettings {
  readonly policyId: string | null;
  /** Phiên bản hiệu lực tại tháng được hỏi; null khi tenant chưa có chính sách OT. */
  readonly current: HrmOvertimeCompVersionSummary | null;
  readonly versions: readonly HrmOvertimeCompVersionSummary[];
  readonly legalWarnings: readonly string[];
}

export interface SaveHrmOvertimeCompSettingsRequest {
  /** Ngày hiệu lực: phải là mùng 1 của một tháng chưa chốt công. */
  readonly effectiveFrom: string;
  readonly config: Partial<HrmOvertimeCompConfig>;
  readonly reason?: string;
}

export type HrmOvertimeBlockSource = 'RULE' | 'MANUAL' | 'IMPORT_1OFFICE';

/** Một ca làm thêm đã phân loại (sau khi tách theo tháng). */
export interface HrmOvertimeBlock {
  readonly id: string;
  readonly otRequestId: string;
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly periodMonth: string;
  /** Giờ địa phương dạng YYYY-MM-DDTHH:mm. */
  readonly start: string;
  readonly end: string;
  readonly hours: number;
  readonly crossesMidnight: boolean;
  readonly ruleSet: HrmOvertimeRuleSet;
  readonly restFractionSuggested: number;
  readonly otHoursSuggested: number;
  readonly nightHoursSuggested: number;
  readonly otHoursFinal: number;
  readonly nightHoursFinal: number;
  readonly source: HrmOvertimeBlockSource;
  readonly overrideReason: string | null;
  readonly overriddenAt: string | null;
  /** Kỳ công của tháng đã chốt: không sửa được. */
  readonly locked: boolean;
}

export interface OverrideHrmOvertimeBlockRequest {
  /** Giờ làm thêm chính thức của ca; phần còn lại của ca là ca đêm. */
  readonly otHours?: number;
  /** true: bỏ sửa tay, trả về gợi ý của quy tắc. */
  readonly revert?: boolean;
  readonly reason?: string;
}

export interface HrmOvertimeClassifyPreviewPart {
  readonly periodMonth: string;
  readonly start: string;
  readonly end: string;
  readonly hours: number;
  readonly restFraction: number;
  readonly otHours: number;
  readonly nightHours: number;
  readonly warnings: readonly string[];
}

export interface HrmOvertimeClassifyPreview {
  /** Quy tắc trần và nghỉ bù có đang bật cho tháng của đơn không. */
  readonly enabled: boolean;
  readonly ruleSet: HrmOvertimeRuleSet;
  readonly parts: readonly HrmOvertimeClassifyPreviewPart[];
  readonly otHours: number;
  readonly nightHours: number;
  /** Có ca xuyên đêm: giao diện hiện lựa chọn "Hôm sau nghỉ". */
  readonly askNextDayRest: boolean;
}

export interface PreviewHrmOvertimeClassifyRequest {
  readonly employeeId: string;
  readonly fromAt: string;
  readonly toAt: string;
  readonly nextDayRest?: HrmNextDayRest;
}

/** Tổng hợp làm thêm của một nhân viên trong tháng. */
export interface HrmOvertimeMonthSummary {
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly month: string;
  readonly actualOtHours: number;
  readonly countedOtHours: number;
  readonly nightHours: number;
  readonly excessOtHours: number;
  /** Số ngày nghỉ bù đề xuất theo chính sách. */
  readonly compDays: number;
  /** Cột "Giờ làm thêm/Ca đêm" của bảng công: giờ tính lương làm thêm cộng ca đêm. */
  readonly payrollHours: number;
  /** Tổng ngày nghỉ sau ca đêm của tháng (trừ vào ngày công). */
  readonly nightRestDays: number;
  readonly blockCount: number;
}

export interface HrmCompOffBalanceRow {
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly accrued: number;
  readonly used: number;
  readonly reserved: number;
  readonly expired: number;
  readonly adjusted: number;
  /** Còn dùng được ngay (đã trừ giữ chỗ, không tính lô hết hạn). */
  readonly available: number;
  /** Lô sắp hết hạn gần nhất còn số dư. */
  readonly nextExpiry: { readonly days: number; readonly on: string } | null;
}

export type HrmCompOffLedgerKind = 'ACCRUAL' | 'RESERVE' | 'USAGE' | 'RELEASE' | 'ADJUST' | 'EXPIRE';

export interface HrmCompOffLedgerEntry {
  readonly id: string;
  readonly kind: HrmCompOffLedgerKind;
  readonly days: number;
  readonly occurredOn: string;
  readonly lotId: string;
  readonly expiresOn: string | null;
  readonly periodMonth: string | null;
  readonly sourceHours: number | null;
  readonly capHours: number | null;
  readonly excessHours: number | null;
  readonly requestId: string | null;
  readonly reason: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface HrmCompOffBalanceDetail {
  readonly employeeId: string;
  readonly available: number;
  readonly reserved: number;
  readonly usageStepDays: number;
  readonly lots: readonly {
    readonly lotId: string;
    readonly openedOn: string;
    readonly expiresOn: string | null;
    readonly granted: number;
    readonly remaining: number;
  }[];
  readonly entries: readonly HrmCompOffLedgerEntry[];
}

export type HrmCompOffConversionStatus = 'READY' | 'CONVERTED' | 'NOTHING' | 'CAP_REACHED';

export interface HrmCompOffConversionRow extends HrmOvertimeMonthSummary {
  readonly status: HrmCompOffConversionStatus;
  /** Số ngày đã ghi vào quỹ nếu đã chuyển đổi. */
  readonly convertedDays: number | null;
  readonly accrualOn: string;
  readonly expiresOn: string | null;
  readonly note: string | null;
}

export interface HrmCompOffConversionPreview {
  readonly month: string;
  /** Chỉ chuyển đổi khi bảng công đã chốt. */
  readonly locked: boolean;
  readonly enabled: boolean;
  readonly rows: readonly HrmCompOffConversionRow[];
}

export interface ConfirmHrmCompOffConversionRequest {
  readonly month: string;
  readonly rows: readonly {
    readonly employeeId: string;
    /** Số ngày HR chỉnh; khác đề xuất thì bắt buộc có `reason`. */
    readonly days?: number;
    readonly reason?: string;
  }[];
}

export interface HrmCompOffConversionResult {
  readonly month: string;
  readonly created: number;
  readonly skipped: readonly { readonly employeeId: string; readonly reason: string }[];
}

export interface AdjustHrmCompOffRequest {
  readonly employeeId: string;
  /** Dương cộng quỹ (mở lô mới), âm trừ quỹ theo lô gần hết hạn trước. */
  readonly days: number;
  readonly reason: string;
  /** Hạn dùng cho lô mới khi cộng; bỏ trống theo chính sách. */
  readonly expiresOn?: string | null;
}

/** Số dư khả dụng cho form đơn nghỉ. */
export interface HrmCompOffAvailability {
  readonly enabled: boolean;
  readonly available: number;
  readonly reserved: number;
  readonly usageStepDays: number;
  readonly nextExpiry: { readonly days: number; readonly on: string } | null;
  /** Mã loại nghỉ "Nghỉ bù"; null nếu tenant chưa tạo. */
  readonly leaveTypeId: string | null;
}
