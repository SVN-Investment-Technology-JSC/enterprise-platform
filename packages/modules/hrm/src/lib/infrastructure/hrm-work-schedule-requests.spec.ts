import type { ExistingDay } from '../domain/work-schedule';
import {
  approvedConflicts,
  findRequestConflicts,
  requestConflictException,
} from './hrm-work-schedule-requests';

jest.mock('./hrm-work-schedule-resolve', () => ({
  resolveRuleDays: jest.fn(async () => []),
}));
import { resolveRuleDays } from './hrm-work-schedule-resolve';

const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });

function db(leaves: unknown[] = [], trips: unknown[] = []) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('leave_request_days')) return rows(leaves);
      if (sql.includes('business_trip_requests')) return rows(trips);
      return rows([]);
    }),
  } as never;
}
const leave = (employee: string, date: string, status = 'APPROVED') => ({ id: `l-${employee}-${date}`, employee_id: employee, status, date });
const day = (employeeId: string, date: string, dayType: 'SHIFT' | 'OFF' | 'HOLIDAY', shiftId: string | null): ExistingDay => ({
  id: `${employeeId}-${date}`,
  employeeId,
  date,
  dayType,
  shiftId,
  source: 'MANUAL',
});

beforeEach(() => (resolveRuleDays as jest.Mock).mockResolvedValue([]));

describe('findRequestConflicts: phân ca không được làm lệch đơn nghỉ và công tác', () => {
  it('không có đơn nào trong khoảng: không có xung đột và không so ca', async () => {
    const result = await findRequestConflicts(db(), 't', [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'OFF', shiftId: null } }], []);
    expect(result).toEqual([]);
    expect(resolveRuleDays).not.toHaveBeenCalled();
  });

  it('chuyển ngày có đơn nghỉ thành OFF là xung đột; giữ nguyên ca thì không', async () => {
    const existing = [day(E1, '2026-10-12', 'SHIFT', 's1')];
    const withLeave = db([leave(E1, '2026-10-12')]);
    const off = await findRequestConflicts(withLeave, 't', [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'OFF', shiftId: null } }], existing);
    expect(off).toEqual([{ employeeId: E1, date: '2026-10-12', kind: 'LEAVE', requestId: `l-${E1}-2026-10-12`, status: 'APPROVED' }]);
    const same = await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'SHIFT', shiftId: 's1' } }], existing);
    expect(same).toEqual([]);
  });

  it('đổi sang ca khác trên ngày có đơn công tác là xung đột', async () => {
    const existing = [day(E1, '2026-10-12', 'SHIFT', 's1')];
    const result = await findRequestConflicts(
      db([], [{ id: 'trip-1', employee_id: E1, status: 'APPROVED', date: '2026-10-12' }]),
      't',
      [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'SHIFT', shiftId: 's2' } }],
      existing,
    );
    expect(result).toMatchObject([{ kind: 'TRIP', requestId: 'trip-1', status: 'APPROVED' }]);
  });

  it('ngày không bị tác động bởi thay đổi thì bỏ qua đơn của ngày đó và của người khác', async () => {
    const result = await findRequestConflicts(
      db([leave(E1, '2026-10-13'), leave(E2, '2026-10-12')]),
      't',
      [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'OFF', shiftId: null } }],
      [day(E1, '2026-10-12', 'SHIFT', 's1')],
    );
    expect(result).toEqual([]);
  });

  it('ca thường lệ đến từ lịch định kỳ: so với lịch định kỳ khi chưa có dòng từng ngày', async () => {
    (resolveRuleDays as jest.Mock).mockResolvedValue([
      { employeeId: E1, date: '2026-10-12', dayType: 'SHIFT', shiftId: 's1', ruleId: 'r', scopeType: 'COMPANY' },
    ]);
    const change = { employeeId: E1, date: '2026-10-12' };
    const sameShift = await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', [{ ...change, after: { dayType: 'SHIFT', shiftId: 's1' } }], []);
    expect(sameShift).toEqual([]);
    const otherShift = await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', [{ ...change, after: { dayType: 'SHIFT', shiftId: 's9' } }], []);
    expect(otherShift).toHaveLength(1);
  });

  it('huỷ lịch từng ngày (after = null) quay về lịch định kỳ: cùng ca thì không xung đột, định kỳ OFF thì xung đột', async () => {
    const existing = [day(E1, '2026-10-12', 'SHIFT', 's1')];
    (resolveRuleDays as jest.Mock).mockResolvedValue([
      { employeeId: E1, date: '2026-10-12', dayType: 'SHIFT', shiftId: 's1', ruleId: 'r', scopeType: 'COMPANY' },
    ]);
    const change = [{ employeeId: E1, date: '2026-10-12', after: null }];
    expect(await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', change, existing)).toEqual([]);
    (resolveRuleDays as jest.Mock).mockResolvedValue([
      { employeeId: E1, date: '2026-10-12', dayType: 'OFF', shiftId: null, ruleId: 'r', scopeType: 'COMPANY' },
    ]);
    expect(await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', change, existing)).toHaveLength(1);
    // Không còn lịch nào (không có lịch định kỳ): ngày mất ca.
    (resolveRuleDays as jest.Mock).mockResolvedValue([]);
    expect(await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', change, existing)).toHaveLength(1);
  });

  it('ngày lễ không ghi ca giữ ca cũ: không coi là đổi ca; ngày lễ thay ngày làm việc là xung đột loại ngày', async () => {
    const existing = [day(E1, '2026-10-12', 'SHIFT', 's1')];
    const holiday = [{ employeeId: E1, date: '2026-10-12', after: { dayType: 'HOLIDAY' as const, shiftId: null } }];
    // Loại ngày đổi từ SHIFT sang HOLIDAY: đơn nghỉ trùng phải được xử lý trước.
    expect(await findRequestConflicts(db([leave(E1, '2026-10-12')]), 't', holiday, existing)).toHaveLength(1);
  });

  it('đơn đang chờ chỉ cảnh báo, không chặn; 409 chỉ liệt kê đơn đã duyệt', async () => {
    const list = await findRequestConflicts(
      db([leave(E1, '2026-10-12', 'PENDING'), leave(E1, '2026-10-13', 'APPROVED')]),
      't',
      [
        { employeeId: E1, date: '2026-10-12', after: { dayType: 'OFF', shiftId: null } },
        { employeeId: E1, date: '2026-10-13', after: { dayType: 'OFF', shiftId: null } },
      ],
      [day(E1, '2026-10-12', 'SHIFT', 's1'), day(E1, '2026-10-13', 'SHIFT', 's1')],
    );
    expect(list.map((c) => c.status).sort()).toEqual(['APPROVED', 'PENDING']);
    expect(approvedConflicts(list)).toHaveLength(1);
    const error = requestConflictException(list);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_SCHEDULE_REQUEST_CONFLICT', requestConflictTotal: 1 });
  });
});
