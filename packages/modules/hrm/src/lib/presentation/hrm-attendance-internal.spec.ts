import 'reflect-metadata';
import type { Request } from 'express';
import { HRM_PUBLIC_ROUTE } from '../infrastructure/hrm-access.guard.js';
import type { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmAttendanceController } from './hrm-attendance.controller.js';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

jest.mock('../infrastructure/hrm-attendance-ingest.js', () => ({
  ingestEvent: jest.fn(async () => ({
    id: '00000000-0000-4000-8000-000000000010',
    tenant_id: 'tenant-1',
    employee_id: '00000000-0000-4000-8000-000000000020',
    work_date: '2026-11-12',
    check_in_at: '2026-11-12T08:00:00Z',
    check_out_at: null,
    status: 'PRESENT',
    source: 'BIOMETRIC_DEVICE',
    notes: null,
    created_at: '2026-11-12T08:00:00Z',
    updated_at: '2026-11-12T08:00:00Z',
  })),
}));

describe('HrmAttendanceController internal ingest', () => {
  it('marks internal/attendance/ingest as @HrmPublicRoute and uses serviceContext', async () => {
    const isPublic = Reflect.getMetadata(
      HRM_PUBLIC_ROUTE,
      HrmAttendanceController.prototype.ingestAttendance,
    );
    expect(isPublic).toBe(true);

    const serviceContext = jest.fn(async () => ({ pool: {}, tenantId: 'tenant-1' }));
    const getContext = jest.fn();
    const ctx = { serviceContext, getContext } as unknown as HrmContextService;
    const controller = new HrmAttendanceController(ctx, {} as never);

    const req = { headers: { 'x-request-id': 'req-1' } } as unknown as Request;
    const res = await controller.ingestAttendance(req, {
      employeeId: '00000000-0000-4000-8000-000000000020',
      kind: 'IN',
      occurredAt: '2026-11-12T08:00:00Z',
      source: 'BIOMETRIC_DEVICE',
      externalEventId: 'ext-1',
    });

    expect(serviceContext).toHaveBeenCalledWith(req);
    expect(getContext).not.toHaveBeenCalled();
    expect(res.meta.requestId).toBe('req-1');
  });
});
