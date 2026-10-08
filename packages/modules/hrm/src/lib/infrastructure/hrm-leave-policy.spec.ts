import type { PoolClient } from 'pg';
import {
  advanceHeadroom,
  entitledToDate,
  isProbationContract,
  monthlyAccrual,
  projectedYearEntitlement,
  resolveBasisDate,
  eligibleFrom,
  seniorityBonus,
  seniorityYears,
  yearEntitlement,
  type PolicyContract,
  type PolicySchedule,
} from './hrm-leave-policy';
import { leaveAvailability } from './hrm-leave-availability';
import { loadAdvanceHeadroom } from './hrm-leave-policy-data';

const schedule = (over: Partial<PolicySchedule> = {}): PolicySchedule => ({
  accrualFrequency: 'MONTHLY',
  accrualAmount: 1,
  prorationRule: 'NONE',
  seniorityBonusYears: 5,
  seniorityBonusDays: 1,
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
  basisDateSource: 'JOIN_DATE',
  startDelayMonths: 0,
  accrualTiming: 'END_OF_MONTH',
  milestones: [],
  ...over,
});
const contract = (over: Partial<PolicyContract> = {}): PolicyContract => ({
  contractType: 'DEFINITE',
  signDate: '2026-03-01',
  effectiveFrom: '2026-03-05',
  effectiveTo: null,
  status: 'ACTIVE',
  ...over,
});

describe('resolveBasisDate', () => {
  it('JOIN_DATE giữ ngày vào làm, bỏ qua hợp đồng', () => {
    expect(resolveBasisDate('JOIN_DATE', '2025-01-10', [contract()], '2026-06-30'))
      .toEqual({ date: '2025-01-10' });
  });

  it('dùng ngày ký hợp đồng hiện hành không tính thử việc', () => {
    const contracts = [
      contract({
        contractType: 'PROBATION',
        signDate: '2026-01-01',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-02-28',
        status: 'EXPIRED',
      }),
      contract(),
    ];
    expect(
      resolveBasisDate('CURRENT_CONTRACT_SIGN_DATE', '2026-01-01', contracts, '2026-06-30').date,
    ).toBe('2026-03-01');
  });

  it('chưa có hợp đồng chính thức (chỉ thử việc) thì không có mốc và nêu lý do', () => {
    const r = resolveBasisDate(
      'CURRENT_CONTRACT_SIGN_DATE',
      '2026-01-01',
      [contract({ contractType: 'Thử việc', effectiveFrom: '2026-01-01', signDate: '2026-01-01' })],
      '2026-06-30',
    );
    expect(r.date).toBeNull();
    expect(r.reason).toContain('hợp đồng chính thức');
  });

  it('sign_date null thì dùng effective_from', () => {
    expect(
      resolveBasisDate('CURRENT_CONTRACT_SIGN_DATE', '2026-01-01', [contract({ signDate: null })], '2026-06-30').date,
    ).toBe('2026-03-05');
  });

  it('nhiều hợp đồng: lấy hợp đồng hiệu lực tại ngày tính, gia hạn đổi mốc', () => {
    const contracts = [
      contract({ contractType: 'DEFINITE', signDate: '2025-03-01', effectiveFrom: '2025-03-01', effectiveTo: '2026-02-28', status: 'EXPIRED' }),
      contract({ contractType: 'INDEFINITE', signDate: '2026-02-20', effectiveFrom: '2026-03-01' }),
    ];
    const at = (d: string) =>
      resolveBasisDate('CURRENT_CONTRACT_SIGN_DATE', '2025-03-01', contracts, d).date;
    expect(at('2026-01-31')).toBe('2025-03-01');
    expect(at('2026-06-30')).toBe('2026-02-20');
  });

  it('bỏ hợp đồng nháp/đã chấm dứt và hợp đồng chưa hiệu lực', () => {
    const contracts = [
      contract({ status: 'DRAFT' }),
      contract({ status: 'TERMINATED' }),
      contract({ effectiveFrom: '2027-01-01', signDate: '2026-12-01' }),
    ];
    expect(
      resolveBasisDate('CURRENT_CONTRACT_SIGN_DATE', '2026-01-01', contracts, '2026-06-30').date,
    ).toBeNull();
  });

  it('nhận diện thử việc không phân biệt hoa thường/dấu', () => {
    for (const t of ['PROBATION', 'probation', 'Thử việc', 'THU VIEC', 'thử  việc'])
      expect(isProbationContract(t)).toBe(true);
    expect(isProbationContract('DEFINITE')).toBe(false);
  });
});

describe('trễ N tháng', () => {
  it('N=0 tính ngay từ tháng của mốc, N=3 bắt đầu sau 3 tháng', () => {
    const basis = '2026-01-01';
    expect(monthlyAccrual(schedule(), basis, '2026-01').amount).toBe(1);
    const s3 = schedule({ startDelayMonths: 3 });
    expect(monthlyAccrual(s3, basis, '2026-03')).toEqual({ amount: 0, notEligible: true });
    expect(monthlyAccrual(s3, basis, '2026-04').amount).toBe(1);
  });

  it('trễ qua năm', () => {
    const s = schedule({ startDelayMonths: 3 });
    expect(eligibleFrom('2025-11-10', 3)).toBe('2026-02-01');
    expect(monthlyAccrual(s, '2025-11-10', '2026-01').notEligible).toBe(true);
    expect(monthlyAccrual(s, '2025-11-10', '2026-02').amount).toBe(1);
  });
});

describe('thâm niên', () => {
  it('seniorityYears theo năm tròn', () => {
    expect(seniorityYears('2019-03-15', '2024-03-15')).toBe(5);
    expect(seniorityYears('2019-03-15', '2024-03-14')).toBe(4);
  });

  const ms = [
    { years: 5, extraDays: 1 },
    { years: 10, extraDays: 3 },
  ];
  it('lấy mốc cao nhất đã đạt, không cộng dồn', () => {
    const legacy = { years: 5, days: 1 };
    const bonus = (y: number) => seniorityBonus(ms, legacy, y);
    expect(bonus(4)).toBe(0);
    expect(bonus(5)).toBe(1);
    expect(bonus(7)).toBe(1);
    expect(bonus(10)).toBe(3);
    expect(bonus(12)).toBe(3);
  });

  it('lịch không có mốc dùng cặp cũ floor(thâm niên/N)*M', () => {
    const legacy = { years: 5, days: 2 };
    expect(seniorityBonus([], legacy, 4)).toBe(0);
    expect(seniorityBonus([], legacy, 5)).toBe(2);
    expect(seniorityBonus([], legacy, 11)).toBe(4);
  });

  it('cộng ở tháng kỷ niệm của mốc hợp đồng', () => {
    const s = schedule({ milestones: ms });
    expect(monthlyAccrual(s, '2014-03-01', '2024-03').amount).toBe(1 + 3);
    expect(monthlyAccrual(s, '2014-03-01', '2024-04').amount).toBe(1);
    expect(monthlyAccrual(schedule(), '2019-03-01', '2024-03').amount).toBe(2);
  });
});

describe('quỹ phép năm dự kiến và ứng phép', () => {
  const employee = (join: string) => ({ joinDate: join, contracts: [] });

  it('vào giữa năm NONE: cộng từ tháng vào đến hết tháng 12', () => {
    expect(
      projectedYearEntitlement([schedule()], employee('2026-05-10'), 2026, '2026-06-15'),
    ).toBe(8);
  });

  it('vào giữa năm BY_JOIN_DATE: tháng đầu theo tỷ lệ ngày', () => {
    const total = projectedYearEntitlement(
      [schedule({ prorationRule: 'BY_JOIN_DATE' })],
      employee('2026-05-10'),
      2026,
      '2026-06-15',
    );
    expect(total).toBeCloseTo(7 + 22 / 31, 2);
  });

  it('theo hợp đồng: chưa có hợp đồng chính thức thì quỹ năm bằng 0', () => {
    expect(
      yearEntitlement(
        [schedule({ basisDateSource: 'CURRENT_CONTRACT_SIGN_DATE' })],
        { joinDate: '2026-01-01', contracts: [contract({ contractType: 'PROBATION' })] },
        2026,
        '2026-06-15',
      ),
    ).toBe(0);
  });

  it('theo hợp đồng ký 2026-03-01 và trễ 0: tháng 3 đến 12 = 10 ngày', () => {
    expect(
      yearEntitlement(
        [schedule({ basisDateSource: 'CURRENT_CONTRACT_SIGN_DATE' })],
        { joinDate: '2026-01-01', contracts: [contract()] },
        2026,
        '2026-06-15',
      ),
    ).toBe(10);
  });

  it('advanceHeadroom bật/tắt', () => {
    expect(advanceHeadroom(true, 12, 3)).toBe(9);
    expect(advanceHeadroom(false, 12, 3)).toBe(0);
    expect(advanceHeadroom(true, 3, 5)).toBe(0);
  });

  it('entitledToDate cắt theo ngày nghỉ việc', () => {
    expect(
      entitledToDate([schedule()], employee('2025-01-01'), 2026, '2026-06-15'),
    ).toBeCloseTo(5.5, 2);
    expect(
      entitledToDate([schedule()], employee('2025-01-01'), 2026, '2026-06-30'),
    ).toBe(6);
  });
});

describe('khả dụng khi nộp đơn', () => {
  const base = { remaining: 3, pending: 0, allowAdvance: true, advanceHeadroom: 9, negativeLimit: 2 };
  it('ứng phép bật: dùng đúng bằng cả quỹ năm, vượt thì từ chối', () => {
    expect(leaveAvailability({ ...base, amount: 12 }).allowed).toBe(true);
    expect(leaveAvailability({ ...base, amount: 12.5 }).allowed).toBe(false);
    expect(leaveAvailability({ ...base, amount: 12 }).isNegative).toBe(true);
    expect(leaveAvailability({ ...base, amount: 2 }).isNegative).toBe(false);
  });
  it('đơn chờ duyệt được trừ vào quỹ', () => {
    expect(leaveAvailability({ ...base, pending: 2, amount: 11 }).allowed).toBe(false);
    expect(leaveAvailability({ ...base, pending: 2, amount: 10 }).allowed).toBe(true);
  });
  it('ứng phép tắt: dùng negative_limit như cũ', () => {
    const off = { ...base, allowAdvance: false };
    expect(leaveAvailability({ ...off, amount: 5 }).allowed).toBe(true);
    expect(leaveAvailability({ ...off, amount: 5.5 }).allowed).toBe(false);
  });
  it('ứng phép bật ưu tiên hơn negative_limit', () => {
    expect(leaveAvailability({ ...base, negativeLimit: 0, amount: 12 }).allowed).toBe(true);
  });
});

describe('loadAdvanceHeadroom', () => {
  function db(sched: Record<string, unknown>) {
    return {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM hrm_schema.employee_profiles'))
          return { rows: [{ join_date: '2026-01-01', inactive_from: null, employment_status: 'OFFICIAL' }], rowCount: 1 };
        if (sql.includes('employment_contracts')) return { rows: [], rowCount: 0 };
        if (sql.includes('leave_accrual_schedules'))
          return { rows: [{ id: 's1', ...sched }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
  }
  const row = {
    accrual_frequency: 'MONTHLY',
    accrual_amount: '1',
    proration_rule: 'NONE',
    seniority_bonus_years: 5,
    seniority_bonus_days: '1',
    effective_from: '2020-01-01',
    effective_to: null,
  };
  it('bật: quỹ năm 12 trừ đã cộng 5 = 7; tắt: 0', async () => {
    expect(await loadAdvanceHeadroom(db(row), 't', 'e', 'lt', 2026, 5, true, '2026-06-15')).toBe(7);
    expect(await loadAdvanceHeadroom(db(row), 't', 'e', 'lt', 2026, 5, false, '2026-06-15')).toBe(0);
  });
});
