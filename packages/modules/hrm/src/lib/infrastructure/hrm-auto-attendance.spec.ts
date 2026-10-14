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
  // Giữ cách tra của bản thật: đếm cột qua information_schema trên chính db giả.
  autoAttendanceReady: jest.fn(async (db: { query: (sql: string) => Promise<{ rows: { n: number }[] }> }) => {
    const r = await db.query('information_schema.columns');
    return r.rows[0]?.n === 2;
  }),
}));

const E1 = '00000000-0000-4000-8000-0000000000e1';
// Thứ Bảy 10/10/2026, ca 07:30-11:30 giờ Việt Nam (UTC+7).
const SAT = '2026-10-10';
const window = { start: '2026-10-10T00:30:00.000Z', end: '2026-10-10T04:30:00.000Z' };

function fakeDb(opts: { events?: number; leave?: number; locked?: boolean; rows?: object[]; migrated?: boolean } = {}) {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('information_schema.columns')) return { rows: [{ n: opts.migrated === false ? 0 : 2 }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.employee_work_days'))
      return {
        rows: opts.rows ?? [{ employee_id: E1, date: SAT, day_type: 'SHIFT', auto_attendance: true }],
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

  it('không sinh khi ca chưa kết thúc', async () => {
    const { db, inserts } = fakeDb();
    const early = new Date('2026-10-10T03:00:00.000Z'); // 10:00 VN
    await expect(generateAutoAttendance(db, 't', SAT, SAT, early)).resolves.toEqual({ generated: 0 });
    expect(inserts).toHaveLength(0);
  });

  it('không ghi đè khi đã có chấm công thật, có đơn nghỉ/công tác hoặc kỳ công đã khóa', async () => {
    for (const opts of [{ events: 1 }, { leave: 1 }, { locked: true }]) {
      const { db, inserts } = fakeDb(opts);
      await expect(generateAutoAttendance(db, 't', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
      expect(inserts).toHaveLength(0);
    }
  });

  it('bỏ qua ngày chưa bật cờ, ngày nghỉ, ngày trong tương lai và tenant chưa migrate', async () => {
    for (const rows of [
      [{ employee_id: E1, date: SAT, day_type: 'SHIFT', auto_attendance: false }],
      [{ employee_id: E1, date: SAT, day_type: 'OFF', auto_attendance: true }],
    ]) {
      const { db, inserts } = fakeDb({ rows });
      await generateAutoAttendance(db, 't', SAT, SAT, NOW);
      expect(inserts).toHaveLength(0);
    }
    const future = fakeDb();
    await expect(generateAutoAttendance(future.db, 't', '2026-10-12', '2026-10-12', NOW)).resolves.toEqual({ generated: 0 });
    const old = fakeDb({ migrated: false });
    await expect(generateAutoAttendance(old.db, 'unmigrated', SAT, SAT, NOW)).resolves.toEqual({ generated: 0 });
    expect(old.inserts).toHaveLength(0);
  });
});
