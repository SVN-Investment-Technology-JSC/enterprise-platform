import 'reflect-metadata';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service';
import { calculateTimesheet } from '../infrastructure/hrm-timesheet-calculation';
import { adjustTimesheetLine } from '../infrastructure/hrm-timesheet-adjust';
import { lockTimesheetPeriod, reopenTimesheetPeriod } from '../infrastructure/hrm-timesheet-period';
import { HrmTimesheetBoardController, normalizeSearch } from './hrm-timesheet-board.controller';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
jest.mock('../infrastructure/hrm-timesheet-calculation', () => ({
  calculateTimesheet: jest.fn(async () => ({ count: 5, abnormal: 0 })),
}));
jest.mock('../infrastructure/hrm-timesheet-adjust', () => ({
  adjustTimesheetLine: jest.fn(async () => ({ rows: [{ id: 'line-1', paid_minutes: 240, workday_units: '0.5' }] })),
}));
jest.mock('../infrastructure/hrm-timesheet-period', () => ({
  lockTimesheetPeriod: jest.fn(async () => ({})),
  reopenTimesheetPeriod: jest.fn(async () => ({})),
}));

const req = { headers: {} } as Request;
const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const USER = 'user-1';
const PAST = '2020-01'; // đã kết thúc
const FUTURE = '2999-01'; // chưa tới

interface Fixture {
  periods: Record<string, unknown>[];
  pending: Partial<Record<'leaves' | 'ots' | 'trips' | 'shift_changes' | 'corrections', number>>;
  /** Nhân viên có hiệu lực trong tháng (employee_profiles) và các dòng chấm công (để có ngày bất thường). */
  employees: string[];
  events: Record<string, unknown>[];
  /** Dòng công đã tính của kỳ (timesheets). */
  lines: Record<string, unknown>[];
}

function setup(permissions: string[], fixture: Partial<Fixture> = {}) {
  const fx: Fixture = { periods: [], pending: {}, employees: [], events: [], lines: [], ...fixture };
  const calls: { sql: string; params: unknown[] }[] = [];
  const audits: string[] = [];
  const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO hrm_schema.audit_log')) {
      audits.push(params[2] as string);
      return rows([]);
    }
    if (sql.includes('INSERT INTO hrm_schema.timesheet_periods')) {
      const [, code, from, to] = params as string[];
      const created = { id: 'period-new', period_code: code, from_date: from, to_date: to, status: 'OPEN', requests_closed_at: null, calculated_at: null };
      fx.periods.push(created);
      return rows([created]);
    }
    if (sql.includes('FROM hrm_schema.timesheet_periods')) return rows(fx.periods);
    if (sql.includes('UPDATE hrm_schema.timesheet_periods SET requests_closed_at=now()')) {
      fx.periods[0].requests_closed_at = '2026-10-10T00:00:00.000Z';
      return rows([]);
    }
    if (sql.includes('UPDATE hrm_schema.timesheet_periods SET requests_closed_at=NULL')) {
      fx.periods[0].requests_closed_at = null;
      fx.periods[0].status = 'REOPENED';
      return rows([]);
    }
    if (sql.includes('SELECT id FROM hrm_schema.timesheets WHERE')) return rows(fx.lines);
    if (sql.includes('AS shift_changes')) return rows([{ leaves: 0, ots: 0, trips: 0, shift_changes: 0, corrections: 0, ...fx.pending }]);
    if (sql.includes('ORDER BY d.employee_code, d.employee_id')) {
      const list = (params[3] ? [params[3] as string] : fx.employees.length ? fx.employees : [ME, OTHER]).map((id) => ({ employee_id: id }));
      return rows(list);
    }
    if (sql.includes('FROM hrm_schema.employee_profiles')) return rows(fx.employees.map((id) => ({ employee_id: id })));
    if (sql.includes('to_regclass')) return rows([{ ready: true }]);
    if (sql.includes('FROM hrm_schema.employee_directory'))
      return rows(
        (params[1] as string[]).map((id) => ({ employee_id: id, employee_code: id.slice(-2), full_name: 'NV', department_name: null, position_name: null, join_date: '2019-01-01', inactive_from: null })),
      );
    if (sql.includes('WITH RECURSIVE'))
      return rows(
        (params[1] as string[]).flatMap((e) => [{ employee_id: e, date: '2020-01-02', day_type: 'SHIFT', shift_id: 'shift-1', rule_id: 'r', scope_type: 'COMPANY' }]),
      );
    if (sql.includes('FROM hrm_schema.attendance_events')) return rows(fx.events);
    if (sql.includes('FROM hrm_schema.shift_definitions'))
      return rows([{ id: 'shift-1', code: 'HC', name: 'HC', start_time: '08:00:00', end_time: '17:00:00', break_start_time: '12:00:00', break_end_time: '13:00:00', cross_midnight: false, break_minutes: 60, grace_late_minutes: 10, grace_early_minutes: 5 }]);
    return rows([]);
  });
  const client = { query, release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  const service = new HrmContextService({} as never, {} as never);
  jest.spyOn(service, 'getContext').mockImplementation(async (_req, required) => {
    if (required && required !== 'hrm.read' && required !== 'module.access' && !permissions.includes(required) && !permissions.includes('hrm.manage'))
      throw new ForbiddenException(`missing ${required}`);
    return { pool, tenantId: 'tenant', principal: { userId: USER, permissions } } as never;
  });
  jest.spyOn(service, 'resolveEmployee').mockResolvedValue({ employeeId: ME, fullName: 'Tôi' });
  return { controller: new HrmTimesheetBoardController(service), fx, calls, audits, query };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /timesheet-board: phạm vi do server quyết định', () => {
  it('có hrm.timesheet.read: xem mọi nhân viên, canViewAll = true', async () => {
    const { controller, calls } = setup(['hrm.timesheet.read']);
    const { data } = await controller.board(req, PAST);
    expect(data.canViewAll).toBe(true);
    expect(data.employees.map((e) => e.employeeId)).toEqual([ME, OTHER]);
    expect(data.calendar).toHaveLength(31);
    expect(data.month).toMatchObject({ month: PAST, from: '2020-01-01', to: '2020-01-31', state: 'OPEN', periodId: null });
    expect(data.meta).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(data.meta.counts?.ALL).toBe(2);
    const list = calls.find((c) => c.sql.includes('ORDER BY d.employee_code, d.employee_id'))!;
    expect(list.params[3]).toBeNull();
  });

  it('có quyền xem tất cả: lọc theo q (không dấu) và employee_id, page_size tối đa 200', async () => {
    const { controller, calls } = setup(['hrm.timesheet.read']);
    await controller.board(req, PAST, OTHER, 'Nguyễn Đức', '2', '999');
    const list = calls.find((c) => c.sql.includes('ORDER BY d.employee_code, d.employee_id'))!;
    expect(list.params[3]).toBe(OTHER);
    expect(list.params[4]).toBe('nguyen duc');
    // trang 2 của danh sách 1 người (employee_id) với page_size bị chặn ở 200: rỗng, nhưng tổng vẫn đúng
    const { data } = await controller.board(req, PAST, OTHER, 'Nguyễn Đức', '2', '999');
    expect(data.meta).toMatchObject({ page: 2, pageSize: 200, total: 1 });
    expect(data.employees).toEqual([]);
  });

  it('không có quyền xem: chỉ thấy chính mình, canViewAll = false, q bị bỏ qua', async () => {
    const { controller, calls } = setup(['hrm.self.read']);
    const { data } = await controller.board(req, PAST, undefined, 'người khác');
    expect(data.canViewAll).toBe(false);
    expect(data.employees.map((e) => e.employeeId)).toEqual([ME]);
    const list = calls.find((c) => c.sql.includes('ORDER BY d.employee_code, d.employee_id'))!;
    expect(list.params[3]).toBe(ME);
    expect(list.params[4]).toBeNull();
    // chính mình được phép xin rõ ràng
    await expect(controller.board(req, PAST, ME)).resolves.toBeDefined();
  });

  it('có quyền xem tất cả nhưng gửi self=1: chỉ trả chính mình, canViewAll = false, q bị bỏ qua', async () => {
    const { controller, calls } = setup(['hrm.timesheet.read', 'hrm.self.read']);
    const { data } = await controller.board(req, PAST, undefined, 'ai đó', undefined, undefined, '1');
    expect(data.canViewAll).toBe(false);
    expect(data.employees.map((e) => e.employeeId)).toEqual([ME]);
    const list = calls.find((c) => c.sql.includes('ORDER BY d.employee_code, d.employee_id'))!;
    expect(list.params[3]).toBe(ME);
    expect(list.params[4]).toBeNull();
    await expect(controller.board(req, PAST, OTHER, undefined, undefined, undefined, 'true')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.board(req, PAST, ME, undefined, undefined, undefined, 'true')).resolves.toBeDefined();
  });

  it('không có quyền xem mà xin nhân viên khác: 403, không chạm dữ liệu', async () => {
    const { controller, calls } = setup(['hrm.self.read']);
    await expect(controller.board(req, PAST, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.sql.includes('employee_directory'))).toBe(false);
  });

  it('bộ lọc nhanh áp trên toàn bộ nhân viên rồi mới phân trang; số đếm không đổi theo flag và cỡ trang', async () => {
    const { controller } = setup(['hrm.timesheet.read']);
    const all = (await controller.board(req, PAST)).data;
    const counts = all.meta.counts!;
    for (const flag of ['LATE_EARLY', 'ABNORMAL', 'ABSENT', 'PENDING'] as const) {
      const filtered = (await controller.board(req, PAST, undefined, undefined, undefined, undefined, undefined, flag)).data;
      expect(filtered.meta.total).toBe(counts[flag]);
      expect(filtered.employees).toHaveLength(counts[flag]);
      expect(filtered.meta.counts).toEqual(counts);
      // cỡ trang 1 không làm đổi tổng: mỗi trang chỉ cắt từ danh sách đã lọc
      const firstPage = (await controller.board(req, PAST, undefined, undefined, '1', '1', undefined, flag)).data;
      expect(firstPage.meta.total).toBe(counts[flag]);
      expect(firstPage.meta.counts).toEqual(counts);
      expect(firstPage.employees.length).toBe(Math.min(1, counts[flag]));
    }
    expect((await controller.board(req, PAST, undefined, undefined, undefined, undefined, undefined, 'ALL')).data.meta.total).toBe(2);
  });

  it('flag không hợp lệ: 400', async () => {
    const { controller } = setup(['hrm.timesheet.read']);
    await expect(controller.board(req, PAST, undefined, undefined, undefined, undefined, undefined, 'FOO')).rejects.toMatchObject({ status: 400 });
  });

  it('tham số sai: tháng, employee_id, page_size', async () => {
    const { controller } = setup(['hrm.timesheet.read']);
    await expect(controller.board(req, '2026-13')).rejects.toMatchObject({ status: 400 });
    await expect(controller.board(req, undefined)).rejects.toMatchObject({ status: 400 });
    await expect(controller.board(req, PAST, 'abc')).rejects.toMatchObject({ status: 400 });
    await expect(controller.board(req, PAST, undefined, undefined, '1', '0')).rejects.toMatchObject({ status: 400 });
  });

  it('tháng đã khóa: đọc từ timesheets của kỳ, trạng thái LOCKED', async () => {
    const { controller, calls } = setup(['hrm.timesheet.read'], {
      periods: [{ id: 'p1', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'LOCKED', locked_at: '2020-02-05T00:00:00.000Z', requests_closed_at: '2020-02-01T00:00:00.000Z', calculated_at: '2020-02-04T00:00:00.000Z' }],
    });
    const { data } = await controller.board(req, PAST);
    expect(data.month).toMatchObject({ state: 'LOCKED', periodId: 'p1', lockedAt: '2020-02-05T00:00:00.000Z' });
    expect(calls.some((c) => c.sql.includes('FROM hrm_schema.timesheets'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('FROM hrm_schema.attendance_events'))).toBe(false);
  });

  it('đã chốt đơn từ: trạng thái REQUESTS_CLOSED', async () => {
    const { controller } = setup(['hrm.timesheet.read'], {
      periods: [{ id: 'p1', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'OPEN', requests_closed_at: '2020-02-01T00:00:00.000Z' }],
    });
    expect((await controller.board(req, PAST)).data.month).toMatchObject({ state: 'REQUESTS_CLOSED', requestsClosedAt: '2020-02-01T00:00:00.000Z' });
  });
});

describe('normalizeSearch', () => {
  it('bỏ dấu tiếng Việt, chữ thường, thoát ký tự đại diện của LIKE', () => {
    expect(normalizeSearch('Đặng Thị Ngọc')).toBe('dang thi ngoc');
    expect(normalizeSearch('50%_x')).toBe('50\\%\\_x');
  });
});

describe('POST /timesheet-months/:month/close-requests', () => {
  it('quyền hrm.timesheet.calculate; thiếu quyền thì 403', async () => {
    const { controller } = setup(['hrm.timesheet.read']);
    await expect(controller.closeRequests(req, PAST)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tự tạo kỳ công tháng dương lịch (mã YYYY-MM) rồi chốt đơn từ, có audit', async () => {
    const { controller, calls, audits, fx } = setup(['hrm.timesheet.calculate']);
    const { data } = await controller.closeRequests(req, PAST);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.timesheet_periods'))!;
    expect(insert.params).toEqual(['tenant', PAST, '2020-01-01', '2020-01-31']);
    expect(fx.periods).toHaveLength(1);
    expect(audits).toContain('TIMESHEET_REQUESTS_CLOSED');
    expect(data.month.state).toBe('REQUESTS_CLOSED');
    expect(data.month.requestsClosedAt).not.toBeNull();
  });

  it('còn đơn chờ duyệt: 409 kèm danh sách blocker và số lượng, không ghi requests_closed_at', async () => {
    const { controller, calls, audits } = setup(['hrm.timesheet.calculate'], { pending: { leaves: 3, ots: 1 } });
    const error = await controller.closeRequests(req, PAST).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    const body = error.getResponse();
    expect(body.code).toBe('HRM_MONTH_CLOSE_BLOCKED');
    expect(body.blockers).toEqual([
      { code: 'PENDING_REQUESTS', message: 'Còn 3 đơn nghỉ chờ duyệt trong tháng 01/2020', count: 3 },
      { code: 'PENDING_REQUESTS', message: 'Còn 1 đơn làm thêm giờ chờ duyệt trong tháng 01/2020', count: 1 },
    ]);
    expect(calls.some((c) => c.sql.includes('requests_closed_at=now()'))).toBe(false);
    expect(audits).toEqual([]);
  });

  it('có kỳ công khác chồng lấn tháng: 409 tiếng Việt, không tạo kỳ trùng', async () => {
    const { controller, calls } = setup(['hrm.timesheet.calculate'], {
      periods: [{ id: 'old', period_code: 'KY-THU-1', from_date: '2020-01-10', to_date: '2020-02-09', status: 'OPEN' }],
    });
    const error = await controller.closeRequests(req, PAST).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().message).toContain('Tháng 01/2020 trùng với kỳ công KY-THU-1');
    expect(calls.some((c) => c.sql.includes('INSERT INTO hrm_schema.timesheet_periods'))).toBe(false);
  });

  it('tháng đã chốt công thì không chốt đơn từ nữa (409)', async () => {
    const { controller } = setup(['hrm.timesheet.calculate'], {
      periods: [{ id: 'p', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'LOCKED' }],
    });
    await expect(controller.closeRequests(req, PAST)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('POST /timesheet-months/:month/close (chốt công)', () => {
  const period = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    period_code: PAST,
    from_date: '2020-01-01',
    to_date: '2020-01-31',
    status: 'OPEN',
    requests_closed_at: '2020-02-01T00:00:00.000Z',
    ...over,
  });

  it('chưa chốt đơn từ và tháng chưa kết thúc: 409 liệt kê blocker', async () => {
    const { controller } = setup(['hrm.timesheet.calculate']);
    const error = await controller.close(req, FUTURE).catch((e) => e);
    const codes = error.getResponse().blockers.map((b: { code: string }) => b.code);
    expect(codes).toEqual(['MONTH_NOT_ENDED', 'REQUESTS_NOT_CLOSED']);
    expect(calculateTimesheet).not.toHaveBeenCalled();
    expect(lockTimesheetPeriod).not.toHaveBeenCalled();
  });

  it('còn ngày bất thường theo kết quả tính: 409 ABNORMAL_DAYS, không tính/khóa', async () => {
    const e = '00000000-0000-4000-8000-0000000000b1';
    const { controller } = setup(['hrm.timesheet.calculate'], {
      periods: [period()],
      employees: [e],
      events: [{ id: 'i', employee_id: e, work_date: '2020-01-02', event_kind: 'IN', occurred_at: '2020-01-02T01:00:00.000Z' }],
    });
    const error = await controller.close(req, PAST).catch((x) => x);
    const blockers = error.getResponse().blockers;
    expect(blockers[0]).toMatchObject({
      code: 'ABNORMAL_DAYS',
      message: 'Còn 1 ngày công bất thường (1 nhân viên) cần xử lý',
      count: 1,
      items: [{ employeeId: e, date: '2020-01-02', codes: ['MISSING_CHECK_OUT'] }],
    });
    // Các ngày còn lại của tháng chưa có ca: blocker riêng, có chi tiết từng ngày để phân ca.
    expect(blockers[1]).toMatchObject({ code: 'UNSCHEDULED_DAYS' });
    expect(blockers[1].count).toBeGreaterThan(0);
    expect(blockers[1].items[0]).toMatchObject({ employeeId: e, codes: ['NO_SHIFT'] });
    expect(calculateTimesheet).not.toHaveBeenCalled();
  });

  it('đủ điều kiện: tính lại rồi khóa bằng luật khóa sẵn có, có audit', async () => {
    const { controller, audits } = setup(['hrm.timesheet.calculate'], { periods: [period()] });
    await controller.close(req, PAST);
    expect(calculateTimesheet).toHaveBeenCalledWith(expect.anything(), 'tenant', 'p1');
    expect(lockTimesheetPeriod).toHaveBeenCalledWith(expect.anything(), 'tenant', 'p1', USER);
    expect(audits).toEqual(expect.arrayContaining(['TIMESHEET_CALCULATED', 'TIMESHEET_MONTH_CLOSED']));
  });

  it('sau khi tính còn dòng ABNORMAL (ví dụ ngày làm việc chưa có ca): 409, không khóa', async () => {
    (calculateTimesheet as jest.Mock).mockResolvedValueOnce({ count: 9, abnormal: 2 });
    const { controller } = setup(['hrm.timesheet.calculate'], { periods: [period()] });
    const error = await controller.close(req, PAST).catch((x) => x);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().blockers[0]).toMatchObject({ code: 'ABNORMAL_DAYS', count: 2 });
    expect(lockTimesheetPeriod).not.toHaveBeenCalled();
  });

  it('tháng đã chốt công: 409', async () => {
    const { controller } = setup(['hrm.timesheet.calculate'], { periods: [period({ status: 'LOCKED' })] });
    await expect(controller.close(req, PAST)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('POST /timesheet-months/:month/reopen', () => {
  const locked = { id: 'p1', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'LOCKED', requests_closed_at: '2020-02-01T00:00:00.000Z' };

  it('bắt buộc có lý do; quyền hrm.timesheet.reopen', async () => {
    const { controller } = setup(['hrm.timesheet.reopen'], { periods: [{ ...locked }] });
    await expect(controller.reopen(req, PAST, '')).rejects.toMatchObject({ status: 400 });
    const denied = setup(['hrm.timesheet.calculate'], { periods: [{ ...locked }] });
    await expect(denied.controller.reopen(req, PAST, 'Sai số liệu')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tháng đã chốt công: dùng reopen kỳ công sẵn có và bỏ chốt đơn từ, có audit', async () => {
    const { controller, audits, fx } = setup(['hrm.timesheet.reopen'], { periods: [{ ...locked }] });
    const { data } = await controller.reopen(req, PAST, 'Sai số liệu');
    expect(reopenTimesheetPeriod).toHaveBeenCalledWith(expect.anything(), 'tenant', 'p1', USER, 'Sai số liệu');
    expect(fx.periods[0].requests_closed_at).toBeNull();
    expect(audits).toContain('TIMESHEET_MONTH_REOPENED');
    expect(data.month.state).toBe('OPEN');
  });

  it('chỉ chốt đơn từ (chưa chốt công): chỉ bỏ chốt đơn từ, không gọi reopen kỳ công', async () => {
    const { controller } = setup(['hrm.timesheet.reopen'], { periods: [{ ...locked, status: 'OPEN' }] });
    await controller.reopen(req, PAST, 'Thêm đơn');
    expect(reopenTimesheetPeriod).not.toHaveBeenCalled();
  });

  it('tháng chưa chốt: 409; chưa có kỳ: 404', async () => {
    const open = setup(['hrm.timesheet.reopen'], { periods: [{ ...locked, status: 'OPEN', requests_closed_at: null }] });
    await expect(open.controller.reopen(req, PAST, 'x y')).rejects.toBeInstanceOf(ConflictException);
    const none = setup(['hrm.timesheet.reopen']);
    await expect(none.controller.reopen(req, PAST, 'x y')).rejects.toMatchObject({ status: 404 });
  });
});

describe('GET /timesheet-months/:month/close-state', () => {
  it('cần hrm.timesheet.read; trả blocker chốt đơn từ và chốt công', async () => {
    const denied = setup(['hrm.self.read']);
    await expect(denied.controller.closeState(req, PAST)).rejects.toBeInstanceOf(ForbiddenException);
    const { controller } = setup(['hrm.timesheet.read'], { pending: { trips: 2 } });
    const { data } = await controller.closeState(req, PAST);
    expect(data.month.state).toBe('OPEN');
    expect(data.blockersForRequests).toEqual([{ code: 'PENDING_REQUESTS', message: 'Còn 2 đơn công tác chờ duyệt trong tháng 01/2020', count: 2 }]);
    expect(data.blockersForLock.map((b) => b.code)).toEqual(['REQUESTS_NOT_CLOSED']);
  });

  it('tháng đã chốt công: ALREADY_LOCKED', async () => {
    const { controller } = setup(['hrm.timesheet.read'], {
      periods: [{ id: 'p', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'LOCKED' }],
    });
    const { data } = await controller.closeState(req, PAST);
    expect(data.month.state).toBe('LOCKED');
    expect(data.blockersForLock[0].code).toBe('ALREADY_LOCKED');
  });
});

describe('POST /timesheet-months/:month/calculate (tính công, chưa khóa)', () => {
  it('tạo kỳ công của tháng, tính công, ghi audit và trả kết quả cùng điều kiện chốt', async () => {
    const { controller, audits } = setup(['hrm.timesheet.calculate']);
    const { data } = await controller.calculate(req, PAST);
    expect(calculateTimesheet).toHaveBeenCalledWith(expect.anything(), 'tenant', 'period-new');
    expect(lockTimesheetPeriod).not.toHaveBeenCalled();
    expect(data.result).toEqual({ count: 5, abnormal: 0 });
    expect(data.month).toMatchObject({ month: PAST });
    expect(audits).toContain('TIMESHEET_CALCULATED');
  });

  it('tháng đã chốt công: 409; thiếu quyền: 403', async () => {
    const locked = { id: 'p1', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'LOCKED', requests_closed_at: null };
    await expect(
      setup(['hrm.timesheet.calculate'], { periods: [locked] }).controller.calculate(req, PAST),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(setup(['hrm.self.read']).controller.calculate(req, PAST)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('POST /timesheet-months/:month/adjust (điều chỉnh công một ngày)', () => {
  const open = { id: 'p1', period_code: PAST, from_date: '2020-01-01', to_date: '2020-01-31', status: 'OPEN', requests_closed_at: null };
  const body = { employeeId: ME, date: '2020-01-02', paidMinutes: 240, reason: 'Nghỉ chiều có đơn giấy' };

  it('điều chỉnh dòng công đã tính bằng căn cứ bắt buộc', async () => {
    const { controller } = setup(['hrm.timesheet.adjust'], { periods: [open], lines: [{ id: 'line-1' }] });
    const result = await controller.adjustDay(req, PAST, body);
    expect(adjustTimesheetLine).toHaveBeenCalledWith(expect.anything(), 'tenant', USER, 'line-1', {
      paidMinutes: 240,
      workdayUnits: undefined,
      reason: 'Nghỉ chiều có đơn giấy',
    });
    expect(result.data).toEqual({ id: 'line-1', paidMinutes: 240, workdayUnits: 0.5 });
  });

  it('chưa tính công (chưa có kỳ hoặc chưa có dòng): 409 hướng dẫn bấm Tính công', async () => {
    await expect(setup(['hrm.timesheet.adjust']).controller.adjustDay(req, PAST, body)).rejects.toThrow(/Tính công/);
    await expect(
      setup(['hrm.timesheet.adjust'], { periods: [open], lines: [] }).controller.adjustDay(req, PAST, body),
    ).rejects.toThrow(/Tính công/);
    expect(adjustTimesheetLine).not.toHaveBeenCalled();
  });

  it('tháng đã chốt, ngày ngoài tháng, thiếu số công: bị từ chối', async () => {
    const locked = { ...open, status: 'LOCKED' };
    await expect(
      setup(['hrm.timesheet.adjust'], { periods: [locked], lines: [{ id: 'l' }] }).controller.adjustDay(req, PAST, body),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(['hrm.timesheet.adjust'], { periods: [open] }).controller.adjustDay(req, PAST, { ...body, date: '2020-02-01' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setup(['hrm.timesheet.adjust'], { periods: [open] }).controller.adjustDay(req, PAST, { employeeId: ME, date: '2020-01-02', reason: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('không có hrm.timesheet.adjust: 403', async () => {
    await expect(setup(['hrm.timesheet.read']).controller.adjustDay(req, PAST, body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
