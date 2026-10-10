import type { ProjectRequest, WorkdayRule, WorkdayRuleSet } from '@enterprise-platform/contracts-workspace';

/**
 * Công theo ngày của thành viên dự án, phục vụ chia thưởng.
 *
 * Mỗi ngày chỉ một đơn "thắng": đơn có thứ tự ưu tiên cao hơn (rank nhỏ hơn)
 * ghi đè đơn thấp hơn. Ví dụ công tác ngày 1–3 và nghỉ phép ngày 2 cho ra
 * 1,5 / 0 / 1,5 — không cần huỷ rồi tách đơn công tác. Thứ tự và số công do
 * quản trị cấu hình (`/workday-rules`). Chỉ đơn đã duyệt mới được tính.
 */

/** Cấu hình mặc định khi chưa đọc được từ server. */
export const DEFAULT_WORKDAY_RULES: Pick<WorkdayRuleSet, 'rules' | 'normalUnits'> = {
  rules: [
    { kind: 'leave', label: 'Nghỉ phép', rank: 1, units: 0 },
    { kind: 'business_trip', label: 'Công tác', rank: 2, units: 1.5 },
  ],
  normalUnits: 1,
};

export interface MemberRef {
  readonly userId: string;
  readonly name: string;
}

export interface MemberWorkdays {
  readonly userId: string;
  readonly name: string;
  /** Công từng ngày trong tháng, theo thứ tự ngày. */
  readonly units: readonly number[];
  readonly total: number;
  /** Số ngày công tác còn hiệu lực sau khi áp ưu tiên. */
  readonly tripDays: number;
  /** Số ngày công tác bị đơn ưu tiên cao hơn ghi đè. */
  readonly overriddenTripDays: number;
}

/** Mọi ngày của tháng `YYYY-MM`, dạng `YYYY-MM-DD`. */
export function monthDays(month: string): string[] {
  const [year, monthIndex] = month.split('-').map(Number);
  if (!year || !monthIndex) return [];
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

function covers(request: ProjectRequest, day: string): boolean {
  const from = request.fromDate;
  const to = request.toDate ?? request.fromDate;
  return Boolean(from && to && from <= day && day <= to);
}

export function computeMonthlyWorkdays(
  members: readonly MemberRef[],
  requests: readonly ProjectRequest[],
  month: string,
  config: Pick<WorkdayRuleSet, 'rules' | 'normalUnits'> = DEFAULT_WORKDAY_RULES,
): MemberWorkdays[] {
  const days = monthDays(month);
  const ruleOf = new Map<string, WorkdayRule>(config.rules.map((rule) => [rule.kind, rule]));
  return members.map((member) => {
    const own = requests.filter(
      (request) =>
        request.requesterUserId === member.userId &&
        request.status === 'APPROVED' &&
        ruleOf.has(request.sourceKind),
    );
    let tripDays = 0;
    let overriddenTripDays = 0;
    const units = days.map((day) => {
      const matched = own
        .filter((request) => covers(request, day))
        .map((request) => ruleOf.get(request.sourceKind) as WorkdayRule)
        .sort((left, right) => left.rank - right.rank);
      const hasTrip = matched.some((rule) => rule.kind === 'business_trip');
      const winner = matched[0];
      if (hasTrip && winner?.kind === 'business_trip') tripDays += 1;
      else if (hasTrip) overriddenTripDays += 1;
      return winner ? winner.units : config.normalUnits;
    });
    return {
      userId: member.userId,
      name: member.name,
      units,
      total: Math.round(units.reduce((sum, value) => sum + value, 0) * 100) / 100,
      tripDays,
      overriddenTripDays,
    };
  });
}

/** Số công hiển thị trên màn hình: `1,5`, `0`, `1`. */
export function formatUnits(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV chuẩn: mỗi hàng một thành viên, mỗi cột một ngày trong tháng, cột cuối
 * là tổng. Phân cách bằng dấu phẩy và số dùng dấu chấm (`1.5`) để Excel, Numbers
 * và Google Sheets đều tách đúng cột; có BOM để đọc đúng tiếng Việt.
 */
export function workdaysCsv(rows: readonly MemberWorkdays[], month: string): string {
  const days = monthDays(month);
  const header = [
    'Thành viên',
    ...days.map((day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`),
    'Tổng công',
  ];
  const lines = [
    header,
    ...rows.map((row) => [row.name, ...row.units.map(String), String(row.total)]),
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}`;
}
