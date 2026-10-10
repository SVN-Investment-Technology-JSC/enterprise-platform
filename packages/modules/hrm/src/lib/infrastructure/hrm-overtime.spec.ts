import { BadRequestException } from '@nestjs/common';
import { assertNoRequestOverlap } from './hrm-request-overlap';
import { assertOpenDate, dayKindOf, resolvePolicy, shiftForDate } from './hrm-time';
import { approveOvertime, createOvertime, validateOt, type OtScheduleInput } from './hrm-overtime';

jest.mock('./hrm-time.js', () => ({
  ...jest.requireActual('./hrm-time.js'),
  assertOpenDate: jest.fn(async () => undefined),
  lockEmployee: jest.fn(async () => undefined),
  resolvePolicy: jest.fn(),
  dayKindOf: jest.fn(),
  shiftForDate: jest.fn(),
}));
jest.mock('./hrm-request-overlap.js', () => ({ assertNoRequestOverlap: jest.fn(async () => undefined) }));

const dayKind = dayKindOf as jest.Mock;
const shiftFor = shiftForDate as jest.Mock;
const policyOf = resolvePolicy as jest.Mock;
const overlap = assertNoRequestOverlap as jest.Mock;
const openDate = assertOpenDate as jest.Mock;

const OT_POLICY = {
  id: 'pol-ot',
  config_json: {
    dailyLimitMinutes: 240,
    weeklyLimitMinutes: 1200,
    monthlyLimitMinutes: 2400,
    yearlyLimitMinutes: 20000,
    weekdayRate: 1.5,
    offRate: 2,
    holidayRate: 3,
    nightRate: 2.1,
    nightOffRate: 2.7,
    nightHolidayRate: 3.9,
    nightStartMinute: 1320,
    nightEndMinute: 360,
  },
};

const DATE = '2026-10-05';
const NEXT_DATE = '2026-10-06';
const at = (startTime: string, endTime: string): OtScheduleInput => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return {
    employeeId: 'emp-1',
    workDate: DATE,
    startTime,
    endTime,
    plannedMinutes: (minutes(endTime) - minutes(startTime) + 1440) % 1440,
  };
};

interface DbOptions {
  /** Tổng phút OT theo ngày/tuần/tháng/năm mà truy vấn tổng hợp trả về. */
  totals?: number;
}
function makeDb(options: DbOptions = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const total = options.totals ?? 120;
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('allow_ot=false')) return { rows: [], rowCount: 0 };
      if (sql.includes('tsrange(work_date+start_time')) return { rows: [], rowCount: 0 };
      if (sql.includes('WITH requested'))
        return {
          rows: ['day', 'week', 'month', 'year'].map((unit) => ({ unit, total })),
          rowCount: 4,
        };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db: db as never, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  policyOf.mockImplementation(async (_db: unknown, _tenant: string, type: string) =>
    type === 'OT' ? OT_POLICY : { id: 'pol-att', config_json: { timezone: 'Asia/Ho_Chi_Minh' } },
  );
  dayKind.mockResolvedValue(null);
  shiftFor.mockResolvedValue(null);
});

describe('validateOt: loại OT và hệ số do hệ thống suy ra theo chính sách OT', () => {
  it('ngày làm việc thường ban ngày: WEEKDAY, hệ số weekdayRate; không cần lý do hay loại OT trong đơn', async () => {
    const { db } = makeDb();
    const result = await validateOt(db, 't', at('18:00', '20:00'));
    expect(result).toEqual({ policyId: 'pol-ot', kind: 'WEEKDAY', rate: 1.5, duration: 120 });
  });

  it('ngày nghỉ hằng tuần hoặc nghỉ theo lịch phân ca: WEEKEND, hệ số offRate, không kiểm tra ca', async () => {
    dayKind.mockResolvedValue('OFF');
    const { db } = makeDb();
    const result = await validateOt(db, 't', at('08:00', '10:00'));
    expect(result).toMatchObject({ kind: 'WEEKEND', rate: 2 });
    expect(shiftFor).not.toHaveBeenCalled();
  });

  it('ngày lễ: HOLIDAY, hệ số holidayRate', async () => {
    dayKind.mockResolvedValue('HOLIDAY');
    const { db } = makeDb();
    expect(await validateOt(db, 't', at('08:00', '10:00'))).toMatchObject({ kind: 'HOLIDAY', rate: 3 });
  });

  it('nhận biết lịch phân ca: dayKindOf nhận đúng ngày và nhân viên của đơn', async () => {
    const { db } = makeDb();
    await validateOt(db, 't', at('18:00', '19:00'));
    expect(dayKind).toHaveBeenCalledWith(db, 't', DATE, 'emp-1');
  });

  it('giờ đêm: NIGHT, hệ số nightRate; đêm ngày nghỉ và đêm ngày lễ có hệ số riêng', async () => {
    const { db } = makeDb();
    expect(await validateOt(db, 't', at('22:00', '23:00'))).toMatchObject({ kind: 'NIGHT', rate: 2.1 });
    dayKind.mockResolvedValue('OFF');
    expect(await validateOt(db, 't', at('22:00', '23:00'))).toMatchObject({ kind: 'NIGHT', rate: 2.7 });
    dayKind.mockResolvedValue('HOLIDAY');
    expect(await validateOt(db, 't', at('22:00', '23:00'))).toMatchObject({ kind: 'NIGHT', rate: 3.9 });
  });

  it('thiếu hệ số của loại suy ra: báo chính sách OT chưa cấu hình hợp lệ', async () => {
    policyOf.mockImplementation(async (_db: unknown, _t: string, type: string) =>
      type === 'OT'
        ? { id: 'pol-ot', config_json: { ...OT_POLICY.config_json, nightRate: undefined } }
        : { id: 'pol-att', config_json: {} },
    );
    const { db } = makeDb();
    await expect(validateOt(db, 't', at('22:00', '23:00'))).rejects.toThrow(/Hệ số OT chưa được cấu hình/);
  });

  it('đơn vắt qua ranh giới giờ ngày/đêm: yêu cầu tách đơn', async () => {
    const { db } = makeDb();
    await expect(validateOt(db, 't', at('21:00', '23:00'))).rejects.toThrow(/Tách đơn tại ranh giới giờ ngày\/đêm/);
    await expect(validateOt(db, 't', at('05:00', '07:00'))).rejects.toThrow(/Tách đơn tại ranh giới giờ ngày\/đêm/);
  });

  it('đơn qua 00:00 trong khung đêm: kiểm tra cả ngày hôm sau; đổi loại ngày thì yêu cầu tách tại 00:00', async () => {
    const { db } = makeDb();
    const result = await validateOt(db, 't', at('23:00', '01:00'));
    expect(result).toMatchObject({ kind: 'NIGHT', rate: 2.1, duration: 120 });
    expect(openDate).toHaveBeenCalledWith(db, 't', NEXT_DATE);
    expect(overlap).toHaveBeenCalledWith(db, 't', 'emp-1', { kind: 'ot', fromDate: DATE, toDate: NEXT_DATE, startTime: '23:00', endTime: '01:00' });

    dayKind.mockImplementation(async (_db: unknown, _t: string, date: string) => (date === NEXT_DATE ? 'HOLIDAY' : null));
    await expect(validateOt(db, 't', at('23:00', '01:00'))).rejects.toThrow(/Tách đơn tại 00:00/);
  });
});

describe('validateOt: quy tắc của đơn từ giữ lại', () => {
  const shift = {
    id: 'shift-1',
    window: { start: '2026-10-05T01:00:00.000Z', end: '2026-10-05T10:00:00.000Z' }, // 08:00-17:00 giờ Việt Nam
  };

  it('ngày làm việc có ca: OT phải nằm ngoài ca của nhân viên', async () => {
    shiftFor.mockResolvedValue(shift);
    const { db } = makeDb();
    await expect(validateOt(db, 't', at('16:00', '18:00'))).rejects.toThrow(/nằm trong ca làm việc/);
    await expect(validateOt(db, 't', at('10:00', '11:00'))).rejects.toBeInstanceOf(BadRequestException);
    // Sát biên ca vẫn được: kết thúc đúng giờ vào ca, bắt đầu đúng giờ tan ca.
    await expect(validateOt(db, 't', at('06:00', '08:00'))).resolves.toMatchObject({ kind: 'WEEKDAY' });
    await expect(validateOt(db, 't', at('17:00', '19:00'))).resolves.toMatchObject({ kind: 'WEEKDAY' });
    expect(shiftFor).toHaveBeenCalledWith(db, 't', 'emp-1', DATE, 'Asia/Ho_Chi_Minh');
  });

  it('tạo mới: không được chồng ngày nghỉ phép hoặc công tác (assertNoRequestOverlap); bước duyệt không kiểm tra lại', async () => {
    const { db } = makeDb();
    await validateOt(db, 't', at('18:00', '20:00'));
    expect(overlap).toHaveBeenCalledWith(db, 't', 'emp-1', { kind: 'ot', fromDate: DATE, toDate: DATE, startTime: '18:00', endTime: '20:00' });

    overlap.mockClear();
    await validateOt(db, 't', at('18:00', '20:00'), 'ot-existing');
    expect(overlap).not.toHaveBeenCalled();
  });

  it('chồng ngày nghỉ phép hoặc công tác: lỗi của assertNoRequestOverlap được giữ nguyên', async () => {
    overlap.mockRejectedValueOnce(new BadRequestException('Đã có đơn nghỉ phép chồng ngày'));
    const { db } = makeDb();
    await expect(validateOt(db, 't', at('18:00', '20:00'))).rejects.toThrow(/đơn nghỉ phép/);
  });

  it('số phút phải khớp giờ đăng ký và giờ phải đúng định dạng', async () => {
    const { db } = makeDb();
    await expect(validateOt(db, 't', { ...at('18:00', '20:00'), plannedMinutes: 90 })).rejects.toThrow(/khớp giờ/);
    await expect(validateOt(db, 't', { ...at('18:00', '20:00'), startTime: '25:00' })).rejects.toThrow(/Giờ OT/);
  });

  it('cần chính sách OT hiệu lực', async () => {
    policyOf.mockResolvedValue(null);
    const { db } = makeDb();
    await expect(validateOt(db, 't', at('18:00', '20:00'))).rejects.toThrow(/chính sách OT/);
  });

  it('vượt giới hạn OT theo ngày (gồm đơn chờ duyệt): từ chối', async () => {
    const { db } = makeDb({ totals: 300 });
    await expect(validateOt(db, 't', at('18:00', '20:00'))).rejects.toThrow(/Vượt giới hạn OT/);
  });
});

describe('createOvertime và approveOvertime', () => {
  it('tạo đơn: lưu loại và hệ số do hệ thống suy ra cùng lý do đã chọn và mô tả', async () => {
    dayKind.mockResolvedValue('OFF');
    const { db, calls } = makeDb();
    await createOvertime(db, 't', at('08:00', '10:00'), {
      reasonId: 'reason-1',
      reasonName: 'Tự nguyện',
      paid: false,
      description: 'Hỗ trợ kiểm kê',
    });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.ot_requests'));
    expect(insert?.sql).toMatch(/ot_type,ot_rate_multiplier,reason,reason_id,reason_name,paid,policy_version_id/);
    expect(insert?.params).toEqual([
      't',
      'emp-1',
      DATE,
      '08:00',
      '10:00',
      120,
      'WEEKEND',
      2,
      'Hỗ trợ kiểm kê',
      'reason-1',
      'Tự nguyện',
      false,
      'pol-ot',
    ]);
  });

  it('tạo đơn không truyền lý do: có lương, mô tả rỗng; mô tả kiểu cũ trong body vẫn được giữ', async () => {
    const first = makeDb();
    await createOvertime(first.db, 't', at('18:00', '20:00'));
    const bare = first.calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.ot_requests'));
    expect(bare?.params.slice(8)).toEqual(['', null, null, true, 'pol-ot']);

    const second = makeDb();
    await createOvertime(second.db, 't', { ...at('18:00', '20:00'), reason: '  Việc gấp ' } as OtScheduleInput);
    const legacy = second.calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.ot_requests'));
    expect(legacy?.params[8]).toBe('Việc gấp');
  });

  it('duyệt đơn: tính lại hệ số theo chính sách hiện hành, không kiểm tra chồng ngày và không đụng cột paid', async () => {
    const otRow = {
      id: 'ot-1',
      employee_id: 'emp-1',
      status: 'PENDING',
      work_date: DATE,
      start_time: '18:00:00',
      end_time: '20:00:00',
      planned_minutes: 120,
    };
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FOR UPDATE')) return { rows: [otRow], rowCount: 1 };
        if (sql.includes('UPDATE hrm_schema.ot_requests')) return { rows: [{ ...otRow, status: 'APPROVED' }], rowCount: 1 };
        if (sql.includes('WITH requested')) return { rows: [{ unit: 'day', total: 120 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await approveOvertime(db as never, 't', 'approver-1', 'ot-1');
    expect(result.status).toBe('APPROVED');
    expect(overlap).not.toHaveBeenCalled();
    const update = calls.find((c) => c.sql.includes('UPDATE hrm_schema.ot_requests'));
    expect(update?.params).toEqual(['t', 'ot-1', 'approver-1', 1.5, 'pol-ot']);
    expect(update?.sql).not.toMatch(/\bpaid\b/);
  });
});
