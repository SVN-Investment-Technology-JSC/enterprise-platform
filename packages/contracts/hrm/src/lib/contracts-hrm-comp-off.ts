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
  /** Bật quản lý quỹ nghỉ bù (giữ chỗ & trừ quỹ khi tạo/duyệt đơn Nghỉ bù) độc lập với tính toán tự động từ OT. */
  readonly fundEnabled?: boolean;
  readonly ruleSet: HrmOvertimeRuleSet;
  readonly normalHoursPerDay: number;
  readonly monthlyCapHours: number;
  readonly yearlyCapHours: number | null;
  readonly nightCapped: boolean;
  readonly nightStartMinute: number;
  readonly nightEndMinute: number;
  readonly nightRestHoursPerDay: number;
  readonly allowHalfDay: boolean;
  /**
   * Đơn công tác khai giờ theo ngày: phần làm thêm nằm trong khung đêm được tách thành giờ đêm (true), hoặc gộp chung
   * vào làm thêm không phân biệt (false). Dùng khung giờ đêm `nightStartMinute` và `nightEndMinute`.
   */
  readonly declaredNightWindow: boolean;
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
  /** Mốc khóa lạc quan: gửi lại khi xóa phiên bản để không xóa nhầm bản người khác vừa đổi. */
  readonly updatedAt?: string;
  readonly config: HrmOvertimeCompConfig;
}

export interface RemoveHrmOvertimeCompVersionRequest {
  readonly reason: string;
  readonly expectedUpdatedAt: string;
}

/** Cấu hình làm thêm và nghỉ bù đang hiệu lực kèm lịch sử phiên bản. */
export interface HrmOvertimeCompSettings {
  readonly policyId: string | null;
  /** Phiên bản hiệu lực tại tháng được hỏi; null khi tenant chưa có chính sách OT. */
  readonly current: HrmOvertimeCompVersionSummary | null;
  readonly versions: readonly HrmOvertimeCompVersionSummary[];
  readonly legalWarnings: readonly string[];
}

/** Khi khoảng hiệu lực giao với phiên bản đã có: báo lỗi (mặc định) hoặc ghi đè phần giao nhau. */
export type HrmPolicyConflictMode = 'REPORT' | 'OVERWRITE';

export interface SaveHrmOvertimeCompSettingsRequest {
  /** Ngày hiệu lực: phải là mùng 1 của một tháng chưa chốt công. */
  readonly effectiveFrom: string;
  readonly onConflict?: HrmPolicyConflictMode;
  readonly config: Partial<HrmOvertimeCompConfig>;
  readonly reason?: string;
}

export type HrmOvertimeBlockSource = 'RULE' | 'MANUAL' | 'IMPORT_1OFFICE' | 'CT_DECLARED';

/** Một ca làm thêm đã phân loại (sau khi tách theo tháng). */
export interface HrmOvertimeBlock {
  readonly id: string;
  /** Mã đơn làm thêm; null với ca sinh từ giờ thực tế của đơn công tác. */
  readonly otRequestId: string | null;
  /** Dòng ngày của đơn công tác sinh ra ca này (nếu có). */
  readonly tripDayLineId?: string | null;
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly periodMonth: string;
  /** Giờ địa phương dạng YYYY-MM-DDTHH:mm. */
  readonly start: string;
  readonly end: string;
  readonly hours: number;
  readonly crossesMidnight: boolean;
  readonly ruleSet: HrmOvertimeRuleSet | 'DECLARED';
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

export type HrmCompOffLedgerSource = 'MANUAL' | 'IMPORT';

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
  /** Người thực hiện (mã · tên); null khi dòng do hệ thống ghi. */
  readonly actorLabel?: string | null;
  readonly actorEmail?: string | null;
  /** Nguồn của dòng điều chỉnh: bấm tay hoặc import Excel; null với dòng khác hoặc dữ liệu cũ. */
  readonly source?: HrmCompOffLedgerSource | null;
  /** Mã lô import: các dòng cùng một lần import có chung giá trị. */
  readonly batchId?: string | null;
  /** Dòng này là dòng đảo của dòng điều chỉnh có id này. */
  readonly reversesId?: string | null;
  /** Id dòng đảo đã ghi cho dòng điều chỉnh này; null nếu chưa đảo. */
  readonly reversedById?: string | null;
}

/** Trạng thái cấu hình quỹ nghỉ bù hiện tại, cho màn Quỹ nghỉ bù biết quỹ có đang được dùng không. */
export interface HrmCompOffStatus {
  /** Bật dùng quỹ nghỉ bù: giữ chỗ và trừ quỹ khi tạo, duyệt đơn nghỉ bù. */
  readonly fundEnabled: boolean;
  /** Bật công thức tự tính từ làm thêm và ca đêm. */
  readonly formulaEnabled: boolean;
}

/** Dòng điều chỉnh quỹ nghỉ bù kèm thông tin nhân viên, dùng cho màn lịch sử điều chỉnh toàn công ty. */
export interface HrmCompOffAdjustmentRow extends HrmCompOffLedgerEntry {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeCode: string;
  readonly department: string | null;
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

export interface ImportHrmCompOffRow {
  readonly employeeCode: string;
  readonly days: number;
  readonly reason: string;
  readonly expiresOn?: string | null;
}

export interface ReverseHrmCompOffAdjustmentRequest {
  readonly reason: string;
}

export interface ImportHrmCompOffRequest {
  readonly rows: readonly ImportHrmCompOffRow[];
  readonly importKey?: string;
  /** Tên tệp Excel, chỉ để ghi nhật ký. */
  readonly fileName?: string;
}

export interface ImportHrmCompOffResult {
  /** Mã lô của lần import này; có ở mọi dòng điều chỉnh đã ghi. */
  readonly batchId?: string;
  readonly applied: number;
  readonly skipped: readonly {
    readonly rowIndex: number;
    readonly employeeCode: string;
    readonly reason: string;
  }[];
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

// ---------------------------------------------------------------- giờ làm theo ngày của đơn công tác

/** Một khung giờ làm việc trong ngày: HH:mm; giờ kết thúc không sau giờ bắt đầu nghĩa là sang ngày hôm sau. */
export interface HrmTripDayWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * PLANNED: giờ dự kiến (đăng ký trước, chỉ xem trước); ACTUAL_PENDING: giờ thực tế chờ người duyệt;
 * ACTUAL_APPROVED: đã duyệt và tính vào làm thêm; ACTUAL_REJECTED: bị từ chối hoặc đơn bị hủy hiệu lực.
 */
export type HrmTripDayLineStatus = 'PLANNED' | 'ACTUAL_PENDING' | 'ACTUAL_APPROVED' | 'ACTUAL_REJECTED';

export interface HrmTripDayLine {
  readonly date: string;
  readonly plannedWindows: readonly HrmTripDayWindow[];
  readonly actualWindows: readonly HrmTripDayWindow[];
  readonly status: HrmTripDayLineStatus;
  readonly decisionNote: string | null;
  /** Số phút ca của nhân viên trong ngày (0 khi không có ca). */
  readonly scheduledMinutes: number;
  /** Phút trong ca, phút làm thêm và phút đêm trong làm thêm; xem trước cho đến khi giờ thực tế được duyệt. */
  readonly normalMinutes: number;
  readonly otMinutes: number;
  readonly nightMinutes: number;
  /** Ngày kế tiếp bắt đầu làm từ chiều nên sáng hôm sau nghỉ (gợi ý hiển thị). */
  readonly restsNextMorning: boolean;
}

export interface HrmTripDayLines {
  readonly tripId: string;
  readonly employeeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly tripStatus: string;
  readonly lines: readonly HrmTripDayLine[];
  /** Người xem được duyệt hoặc từ chối giờ thực tế (quản lý trực tiếp hoặc người dự phòng). */
  readonly canDecide?: boolean;
  /** Người xem sửa được giờ khai (chính nhân viên hoặc người lập hộ). */
  readonly canEdit?: boolean;
}

export interface SaveHrmTripDayLinesRequest {
  readonly mode: 'PLANNED' | 'ACTUAL';
  readonly lines: readonly { readonly date: string; readonly windows: readonly HrmTripDayWindow[] }[];
}

export interface DecideHrmTripDayLinesRequest {
  readonly decision: 'APPROVE' | 'REJECT';
  /** Chỉ xử lý các ngày này; bỏ trống là mọi ngày đang chờ. */
  readonly dates?: readonly string[];
  /** Bắt buộc khi từ chối. */
  readonly note?: string;
}
