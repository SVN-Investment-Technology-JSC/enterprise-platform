/**
 * Tổng hợp giờ làm thêm theo tháng: áp trần, tách giờ dư và quy đổi sang ngày nghỉ bù. Hàm thuần.
 *
 *  giờ tính lương làm thêm = min(làm thêm thực tế, trần tháng, trần năm còn lại)   (khi áp trần)
 *  giờ dư                  = làm thêm thực tế − giờ tính lương làm thêm
 *  số ngày nghỉ bù         = làm tròn(giờ dư / số giờ một ngày × hệ số)
 *  cột "Giờ làm thêm/Ca đêm" = giờ tính lương làm thêm + giờ ca đêm
 *
 * Giờ dư chỉ lấy từ giờ làm thêm; ca đêm không bị cắt trần (trừ khi chính sách bật `nightCapped`).
 */

export type RoundingMethod = 'HALF_UP' | 'DOWN' | 'UP';

export interface MonthlyCapConfig {
  /** Có áp trần tháng và năm vào giờ làm thêm tính lương không. */
  readonly capApplies: boolean;
  readonly monthlyCapHours: number;
  /** Trần năm; null là không giới hạn. */
  readonly yearlyCapHours: number | null;
  /** Ca đêm có bị cắt trần như làm thêm không. */
  readonly nightCapped: boolean;
  /** Hệ số quy đổi giờ dư thành nghỉ bù. */
  readonly compFactor: number;
  /** Số giờ quy đổi thành một ngày nghỉ. */
  readonly dayBasisHours: number;
  readonly decimals: number;
  readonly rounding: RoundingMethod;
}

export interface MonthlyOvertimeInput {
  /** Giờ làm thêm thực tế của tháng (sau phân loại, chưa áp trần). */
  readonly otHours: number;
  /** Giờ ca đêm thực tế của tháng. */
  readonly nightHours: number;
  /** Giờ làm thêm đã tính lương từ đầu năm đến trước tháng này (để áp trần năm). */
  readonly yearToDateCountedOtHours?: number;
}

export interface MonthlyOvertimeSummary {
  readonly actualOtHours: number;
  readonly countedOtHours: number;
  readonly nightHours: number;
  readonly excessOtHours: number;
  /** Số ngày nghỉ bù đề xuất, đã làm tròn theo chính sách. */
  readonly compDays: number;
  /** Giá trị cột "Giờ làm thêm/Ca đêm" của bảng công. */
  readonly payrollHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Làm tròn theo số chữ số thập phân và phương pháp của chính sách (4,3125 với 1 chữ số, gần nhất, ra 4,3). */
export function roundDays(value: number, decimals: number, method: RoundingMethod): number {
  const scale = 10 ** decimals;
  // Cộng sai số nhỏ để 4.35 * 10 không rơi xuống 43.4999...
  const scaled = Math.round(value * scale * 1e6) / 1e6;
  const fn = method === 'DOWN' ? Math.floor : method === 'UP' ? Math.ceil : Math.round;
  return fn(scaled) / scale;
}

/** Số ngày nghỉ bù của một lượng giờ dư. */
export function compOffDays(excessHours: number, config: MonthlyCapConfig): number {
  if (!(excessHours > 0)) return 0;
  return roundDays((excessHours / config.dayBasisHours) * config.compFactor, config.decimals, config.rounding);
}

export function summarizeOvertimeMonth(
  input: MonthlyOvertimeInput,
  config: MonthlyCapConfig,
): MonthlyOvertimeSummary {
  const actual = Math.max(0, input.otHours);
  let counted = actual;
  if (config.capApplies) {
    const yearRemaining =
      config.yearlyCapHours === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, config.yearlyCapHours - Math.max(0, input.yearToDateCountedOtHours ?? 0));
    counted = Math.min(actual, config.monthlyCapHours, yearRemaining);
  }
  const night = Math.max(0, input.nightHours);
  const excess = round2(actual - counted);
  return {
    actualOtHours: round2(actual),
    countedOtHours: round2(counted),
    nightHours: round2(night),
    excessOtHours: excess,
    compDays: config.capApplies ? compOffDays(excess, config) : 0,
    payrollHours: round2(counted + night),
  };
}

/** Số ngày dùng quỹ khi tạo đơn: lớn hơn 0 và là bội số của bước tối thiểu (mặc định 0,5 ngày). */
export function validateCompOffUsageDays(days: number, stepDays: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return 'Số ngày nghỉ bù phải lớn hơn 0';
  const steps = days / stepDays;
  if (Math.abs(steps - Math.round(steps)) > 1e-9)
    return `Số ngày nghỉ bù phải là bội số của ${String(stepDays).replace('.', ',')} ngày`;
  return null;
}
