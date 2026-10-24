import { generateAutoAttendance } from './hrm-auto-attendance';
import * as time from './hrm-time';
import * as resolve from './hrm-work-schedule-resolve';

jest.mock('./hrm-time', () => ({
  dayContextForDate: jest.fn(),
  recalculateAttendance: jest.fn(async () => ({})),
  resolvePolicy: jest.fn(async () => ({ id: 'pv1', config_json: { timezone: 'Asia/Ho_Chi_Minh' } })),
}));
jest.mock('./hrm-work-schedule-resolve', () => ({
  resolveRuleDays: jest.fn(async () => []),
}));

const E1 = '00000000-0000-4000-8000-0000000000e1';
// Thứ Bảy 10/10/2026, ca 07:30-11:30 giờ Việt Nam (UTC+7).
const SAT = '2026-10-10';
const window = { start: '2026-10-10T00:30:00.000Z', end: '2026-10-10T04:30:00.000Z' };

interface PersonalRule {
  employee_id: string;
  weekdays: number[] | null;
  from_date: string;
  to_date: string | null;
}

interface Settings {
  enabled: boolean;
  weekdays: number[];
  enabled_from: string | null;
}
/** Cấu hình mặc định của test: bật, áp dụng thứ Bảy (6), bật từ trước ngày thử. */
const SATURDAY_ON: Settings = { enabled: true, weekdays: [6], enabled_from: '2026-10-01' };

function fakeDb(
  opts: {
    events?: number;
    leave?: number;
    locked?: boolean;
    rows?: object[];
    migrated?: boolean;
    settings?: Settings | null;
    personal?: PersonalRule[];
  } = {},
) {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('to_regclass')) return { rows: [{ ok: opts.migrated !== false }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.auto_attendance_employees')) {
      const rows = opts.personal ?? [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM hrm_schema.auto_attendance_settings')) {
      const settings = opts.settings === undefined ? SATURDAY_ON : opts.settings;
      return { rows: settings ? [settings] : [], rowCount: settings ? 1 : 0 };
    }
    if (sql.includes('FROM hrm_schema.employee_work_days'))
      return {
        rows: opts.rows ?? [{ employee_id: E1, date: SAT, day_type: 'SHIFT' }],
        rowCount: 1,
      };
    if (sql.includes('work_schedule_rules')) return { rows: [{ ok: false }], rowCount: 1 };
    if (sql.includes('timesheet_periods'))
      return { rows: opts.locked ? [{ from_date: '2026-10-01', to_date: '2026-10-31' }] : [], rowCount: opts.locked ? 1 : 0 };
    if (sql.includes('FROM hrm_schema.attendance_events')) return { rows: [], rowCount: opts.events ?? 0 };
    if (sql.includes('leave_request_days')) return { rows: [], rowCount: opts.leave ?? 0 };
    if (sql.includes('INSERT INTO hrm_schema.attendance_events')) {
      inserts.push({ sql, params });
      return { rows: [], rowCount: 2 };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  });
  return { db: { query } as never, inserts };
}

const NOW = new Date('2026-10-10T10:00:00.000Z'); // 17:00 VN: ca đã kết thúc

beforeEach(() => {
  (time.dayContextForDate as jest.Mock).mockResolvedValue({ shift: { id: 's1', window } });
  (time.recalculateAttendance as jest.Mock).mockClear();
  (resolve.resolveRuleDays as jest.Mock).mockClear();
});

describe('generateAutoAttendance', () => {
  it('sinh vào đúng giờ bắt đầu ca và ra đúng giờ kết thúc ca, rồi tính lại chấm công ngày', async () => {
    const { db, inserts } = fakeDb();
    await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toEqual(
      expect.arrayContaining([E1, SAT, Date.parse(window.start), Date.parse(window.end), 'AUTO', `auto:${E1}:${SAT}:IN`, `auto:${E1}:${SAT}:OUT`]),
    );
    expect(time.recalculateAttendance).toHaveBeenCalledWith(db, 't', E1, SAT, 'Asia/Ho_Chi_Minh', 'AUTO');
  });

  it('sinh ngay khi ca chưa kết thúc, không chờ hết ca', async () => {
    const { db, inserts } = fakeDb();
    const early = new Date('2026-10-10T03:00:00.000Z'); // 10:00 VN, ca 07:30-11:30 đang diễn ra
    await expect(generateAutoAttendance(db, 't', SAT, SAT, early)).resolves.toEqual({ generated: 1 });
    expect(inserts).toHaveLength(1);
    const start = new Date('2026-10-10T00:05:00.000Z'); // 07:05 VN, trước giờ vào ca
    const beforeShift = fakeDb();
    await expect(generateAutoAttendance(beforeShift.db, 't', SAT, SAT, start)).resolves.toEqual({ generated: 1 });
  });

  it('vẫn sinh khi ngày đã có sự kiện chấm công khác (không còn kiểm tra sự kiện có sẵn)', async () => {
    const { db, inserts } = fakeDb({ events: 1 });
    await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
    expect(inserts).toHaveLength(1);
  });

  it('vẫn sinh khi ngày có đơn nghỉ/công tác đã duyệt (đơn chèn lên phần tự động khi tính công)', async () => {
    const { db, inserts } = fakeDb({ leave: 1 });
    await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
    expect(inserts).toHaveLength(1);
  });

  it('không sinh khi kỳ công đã khóa', async () => {
    for (const opts of [{ locked: true }]) {
      const { db, inserts } = fakeDb(opts);
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0, lockedDays: 1 });
      expect(inserts).toHaveLength(0);
    }
  });

  describe('bù cho nhân viên theo cấu hình riêng (khoảng đã qua quá 3 ngày của worker)', () => {
    const PERSONAL: PersonalRule[] = [{ employee_id: E1, weekdays: null, from_date: '2026-10-01', to_date: '2026-10-31' }];
    const workDaysQuery = (db: { query: jest.Mock }) =>
      db.query.mock.calls.find(([sql]) => String(sql).includes('FROM hrm_schema.employee_work_days'));

    it('chỉ xét nhân viên được chỉ định và bỏ qua cấu hình chung của đơn vị', async () => {
      const { db, inserts } = fakeDb({ settings: null, personal: PERSONAL });
      await expect(
        generateAutoAttendance(db, 't', '2026-10-01', '2026-10-31', NOW, { employeeIds: [E1], tenantSettings: false }),
      ).resolves.toEqual({ generated: 1 });
      expect(inserts).toHaveLength(1);
      // Khoảng bù kéo dài từ đầu tháng tới hôm nay (không bị giới hạn 3 ngày như worker), chỉ nhân viên này.
      expect(workDaysQuery(db as never)?.[1]).toEqual(['t', '2026-10-01', '2026-10-10', [E1]]);
    });

    it('không bù theo cấu hình riêng của người khác khi chỉ định một nhân viên', async () => {
      const other = '00000000-0000-4000-8000-0000000000e2';
      const { db, inserts } = fakeDb({
        settings: null,
        personal: [{ employee_id: other, weekdays: null, from_date: '2026-10-01', to_date: null }],
      });
      await expect(
        generateAutoAttendance(db, 't', '2026-10-01', '2026-10-31', NOW, { employeeIds: [E1], tenantSettings: false }),
      ).resolves.toEqual({ generated: 0 });
      expect(inserts).toHaveLength(0);
    });

    it('bỏ qua cấu hình chung của đơn vị dù đang bật', async () => {
      const { db, inserts } = fakeDb({ personal: [] });
      await expect(
        generateAutoAttendance(db, 't', SAT, SAT, NOW, { employeeIds: [E1], tenantSettings: false }),
      ).resolves.toEqual({ generated: 0 });
      expect(inserts).toHaveLength(0);
    });

    it('ngày thuộc kỳ công đã khóa không bù và được đếm để báo lại', async () => {
      const { db, inserts } = fakeDb({ settings: null, personal: PERSONAL, locked: true });
      await expect(
        generateAutoAttendance(db, 't', '2026-10-01', '2026-10-31', NOW, { employeeIds: [E1], tenantSettings: false }),
      ).resolves.toEqual({ generated: 0, lockedDays: 1 });
      expect(inserts).toHaveLength(0);
    });
  });

  it('chỉ sinh cho ngày làm việc có ca; ngày nghỉ, ngày trong tương lai và tenant chưa migrate thì bỏ qua', async () => {
    const off = fakeDb({ rows: [{ employee_id: E1, date: SAT, day_type: 'OFF' }] });
    await generateAutoAttendance(off.db, 't', SAT, SAT, NOW);
    expect(off.inserts).toHaveLength(0);
    const future = fakeDb();
    await expect(generateAutoAttendance(future.db, 't', '2026-10-12', '2026-10-12', NOW)).resolves.toEqual({ generated: 0 });
    const old = fakeDb({ migrated: false });
    await expect(generateAutoAttendance(old.db, 'unmigrated', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
    expect(old.inserts).toHaveLength(0);
  });

  it('chưa lưu cấu hình, đang tắt hoặc chưa chọn thứ nào thì không sinh gì', async () => {
    for (const settings of [null, { ...SATURDAY_ON, enabled: false }, { ...SATURDAY_ON, weekdays: [] }]) {
      const { db, inserts } = fakeDb({ settings });
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
      expect(inserts).toHaveLength(0);
    }
  });

  it('chỉ sinh cho đúng thứ đã chọn: ngày thứ Bảy không sinh khi cấu hình chỉ chọn thứ Hai', async () => {
    const { db, inserts } = fakeDb({ settings: { ...SATURDAY_ON, weekdays: [1] } });
    await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
    expect(inserts).toHaveLength(0);
  });

  describe('cấu hình theo nhân viên', () => {
    const OFF = { ...SATURDAY_ON, enabled: false };
    const rule = (over: Partial<PersonalRule> = {}): PersonalRule => ({
      employee_id: E1,
      weekdays: null,
      from_date: '2026-10-01',
      to_date: null,
      ...over,
    });

    it('vẫn sinh cho nhân viên được chọn khi cấu hình chung của đơn vị đang tắt', async () => {
      const { db, inserts } = fakeDb({ settings: OFF, personal: [rule()] });
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
      expect(inserts[0].params).toEqual(expect.arrayContaining([E1, SAT, 'AUTO']));
    });

    it('chỉ truy vấn lịch của nhân viên được chọn khi cấu hình chung tắt', async () => {
      const { db } = fakeDb({ settings: OFF, personal: [rule()] });
      await generateAutoAttendance(db, 't', SAT, SAT, NOW);
      const scoped = (db.query as jest.Mock).mock.calls.find(([sql]) => String(sql).includes('FROM hrm_schema.employee_work_days'));
      expect(scoped?.[1][3]).toEqual([E1]);
    });

    it('không sinh khi ngoài khoảng hiệu lực hoặc sai thứ đã chọn', async () => {
      for (const personal of [
        [rule({ from_date: '2026-10-11' })],
        [rule({ to_date: '2026-10-09' })],
        [rule({ weekdays: [1] })],
      ]) {
        const { db, inserts } = fakeDb({ settings: OFF, personal });
        await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
        expect(inserts).toHaveLength(0);
      }
    });

    it('đúng thứ đã chọn thì sinh; kỳ công đã khóa thì bỏ qua', async () => {
      const ok = fakeDb({ settings: OFF, personal: [rule({ weekdays: [6] })] });
      await expect(generateAutoAttendance(ok.db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
      const locked = fakeDb({ settings: OFF, personal: [rule()], locked: true });
      await expect(generateAutoAttendance(locked.db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0, lockedDays: 1 });
    });

    it('nhân viên vừa thuộc cấu hình chung vừa có cấu hình riêng chỉ sinh một lần', async () => {
      const { db, inserts } = fakeDb({ personal: [rule()] });
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
      expect(inserts).toHaveLength(1);
    });

    it('tenant chưa chạy migration 0066 thì chỉ theo cấu hình chung', async () => {
      const { db } = fakeDb({ personal: [rule()] });
      const original = (db.query as jest.Mock).getMockImplementation() as (sql: string, params?: unknown[]) => Promise<unknown>;
      (db.query as jest.Mock).mockImplementation(async (sql: string, params?: unknown[]) =>
        sql.includes("to_regclass('hrm_schema.auto_attendance_employees')")
          ? { rows: [{ ok: false }], rowCount: 1 }
          : original(sql, params),
      );
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 1 });
      const touched = (db.query as jest.Mock).mock.calls.some(([sql]) => String(sql).includes('FROM hrm_schema.auto_attendance_employees'));
      expect(touched).toBe(false);
    });
  });

  it('không sinh cho ngày trước ngày bật (bật không đổi dữ liệu đã qua)', async () => {
    const { db, inserts } = fakeDb({ settings: { ...SATURDAY_ON, enabled_from: '2026-10-11' } });
    await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
    expect(inserts).toHaveLength(0);
  });
});
