import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  loadAttendanceMonitor,
  loadTeamEmployeeIds,
} from '../infrastructure/hrm-attendance-monitor';
import { HrmAttendanceMonitorController } from './hrm-attendance-monitor.controller';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
jest.mock('../infrastructure/hrm-attendance-monitor', () => ({
  loadTeamEmployeeIds: jest.fn(async () => ['team-1', 'team-2']),
  loadAttendanceMonitor: jest.fn(async (_db: unknown, _t: string, input: { scope: string }) => ({
    date: '2026-10-13',
    scope: input.scope,
    rows: [],
  })),
}));

const req = { headers: {} } as Request;

function setup(permissions: string[]) {
  const pool = { query: jest.fn() };
  const principal = { userId: 'user-1', permissions };
  const context = { pool, tenantId: 't1', principal };
  const ctx = {
    getContext: jest.fn(async () => context),
    has: jest.fn((c: { principal: { permissions: string[] } }, p: string) => c.principal.permissions.includes(p)),
    resolveEmployee: jest.fn(async () => ({ employeeId: 'me', fullName: 'Tôi' })),
  };
  return { controller: new HrmAttendanceMonitorController(ctx as never), ctx };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /attendance-monitor: phạm vi do server quyết định', () => {
  it('có quyền xem chấm công hoặc bảng công: toàn công ty, không lọc nhân viên', async () => {
    for (const permission of ['hrm.attendance.read', 'hrm.timesheet.read']) {
      const { controller } = setup([permission]);
      const result = await controller.monitor(req, '2026-10-13');
      expect(result.data.scope).toBe('ALL');
    }
    expect(loadAttendanceMonitor).toHaveBeenLastCalledWith(expect.anything(), 't1', {
      date: '2026-10-13',
      employeeIds: null,
      scope: 'ALL',
    });
    expect(loadTeamEmployeeIds).not.toHaveBeenCalled();
  });

  it('người quản lý (có quyền duyệt) chỉ thấy cấp dưới theo sơ đồ tổ chức', async () => {
    const { controller } = setup(['hrm.request.approve']);
    const result = await controller.monitor(req, '2026-10-13');
    expect(result.data.scope).toBe('TEAM');
    expect(loadTeamEmployeeIds).toHaveBeenCalledWith(expect.anything(), 't1', 'me');
    expect(loadAttendanceMonitor).toHaveBeenCalledWith(expect.anything(), 't1', {
      date: '2026-10-13',
      employeeIds: ['team-1', 'team-2'],
      scope: 'TEAM',
    });
  });

  it('nhân viên thường không có quyền: 403, không đọc dữ liệu', async () => {
    const { controller } = setup(['hrm.self.read']);
    await expect(controller.monitor(req, '2026-10-13')).rejects.toBeInstanceOf(ForbiddenException);
    expect(loadAttendanceMonitor).not.toHaveBeenCalled();
  });

  it('ngày không hợp lệ bị từ chối; không truyền ngày thì lấy hôm nay', async () => {
    const { controller } = setup(['hrm.attendance.read']);
    await expect(controller.monitor(req, '13/10/2026')).rejects.toBeInstanceOf(BadRequestException);
    await controller.monitor(req);
    const input = (loadAttendanceMonitor as jest.Mock).mock.calls.at(-1)?.[2] as { date: string };
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
