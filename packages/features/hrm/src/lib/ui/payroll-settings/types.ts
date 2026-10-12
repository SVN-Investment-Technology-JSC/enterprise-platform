/** Kiểu và hàm thuần dùng chung cho màn cấu hình Lương & OT (không đổi nghiệp vụ so với bản cũ). */

export type Component = { code: string; name: string; type: string; formula: string };

export type Version = {
  id: string;
  policy_id: string;
  policy_type: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  updated_at: string;
  status: string;
  /** Đã được kỳ lương / OT / phép tham chiếu: khóa sửa và xóa. */
  used?: boolean;
  used_by_finalized?: boolean;
  config_json: {
    components?: Component[];
    inputs?: Record<string, number>;
    salaryType?: string;
    standardMinutes?: number;
    standardWorkMode?: 'DYNAMIC' | 'FIXED' | 'MINUTES';
    standardWorkdays?: number;
    [key: string]: unknown;
  };
};

export const OT_FIELDS = [
  ['dailyLimitMinutes', 'Giới hạn phút / ngày'],
  ['weeklyLimitMinutes', 'Giới hạn phút / tuần'],
  ['monthlyLimitMinutes', 'Giới hạn phút / tháng'],
  ['yearlyLimitMinutes', 'Giới hạn phút / năm'],
  ['weekdayRate', 'Hệ số ngày thường'],
  ['offRate', 'Hệ số ngày OFF'],
  ['holidayRate', 'Hệ số lễ / Tết'],
  ['nightRate', 'Hệ số ban đêm'],
  ['nightOffRate', 'Hệ số ban đêm ngày OFF'],
  ['nightHolidayRate', 'Hệ số ban đêm lễ / Tết'],
] as const;

export const COMPONENT_TYPES = [
  ['EARNING', 'Lương / thưởng'],
  ['ALLOWANCE', 'Phụ cấp'],
  ['OVERTIME', 'Tăng ca'],
  ['STATUTORY_DEDUCTION', 'Bảo hiểm / bắt buộc'],
  ['TAX_DEDUCTION', 'Thuế TNCN'],
  ['ADVANCE_DEDUCTION', 'Thu hồi ứng lương'],
  ['OTHER_DEDUCTION', 'Khấu trừ khác'],
  ['NET_PAY', 'Thực lĩnh'],
].map(([value, label]) => ({ value, label }));

/** Bộ thành phần khởi tạo khi soạn công thức lương mới. */
export function defaultComponents(): Component[] {
  return [
    { code: 'SALARY', name: 'Lương theo công', type: 'EARNING', formula: 'PRORATED_BASE_PAY' },
    { code: 'ADVANCE', name: 'Thu hồi ứng lương', type: 'ADVANCE_DEDUCTION', formula: 'ADVANCE_DUE' },
    {
      code: 'NET',
      name: 'Thực lĩnh',
      type: 'NET_PAY',
      formula: 'SALARY + MANUAL_EARNINGS - ADVANCE - MANUAL_DEDUCTIONS',
    },
  ];
}

/**
 * Lý do khóa nút Sửa: backend từ chối sửa phiên bản đã được tham chiếu hoặc đã có
 * phiên bản mới hơn cùng chính sách (assertUnusedConfiguration).
 */
export function editLockReason(v: Version, all: Version[]): string {
  if (v.used) return 'Đã được kỳ lương/OT/phép tham chiếu: tạo phiên bản kế tiếp để thay đổi';
  const newer = all.find(
    (x) => x.policy_type === v.policy_type && x.policy_id === v.policy_id && x.version_no > v.version_no,
  );
  if (newer)
    return `Đã có phiên bản mới hơn (v${newer.version_no}): chỉ sửa được phiên bản mới nhất, hãy tạo phiên bản kế tiếp`;
  return '';
}

/** Tham số dạng `MA=giá trị; MA_KHAC=giá trị` thành đối tượng; sai định dạng thì ném lỗi (như bản cũ). */
export function parameters(text: string) {
  const result: Record<string, number> = {};
  for (const line of text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [key, value, ...rest] = line.split('=');
    if (rest.length || !key?.trim() || !value?.trim() || !Number.isFinite(Number(value)))
      throw new Error('Tham số theo dạng MA=giá trị; mỗi tham số cách bằng dấu chấm phẩy');
    if (Object.hasOwn(result, key.trim())) throw new Error('Trùng mã tham số');
    result[key.trim()] = Number(value);
  }
  return result;
}

export type VersionState = 'upcoming' | 'ended' | 'active';

export function versionState(v: Pick<Version, 'effective_from' | 'effective_to'>, day = new Date().toLocaleDateString('en-CA')): VersionState {
  const from = v.effective_from.slice(0, 10);
  const to = v.effective_to?.slice(0, 10) ?? null;
  if (from > day) return 'upcoming';
  if (to && to < day) return 'ended';
  return 'active';
}

export const VERSION_STATE_LABEL: Record<VersionState, string> = {
  upcoming: 'Chưa hiệu lực',
  ended: 'Hết hiệu lực',
  active: 'Đang áp dụng',
};
export const VERSION_STATE_TONE = { upcoming: 'amber', ended: 'slate', active: 'green' } as const;
