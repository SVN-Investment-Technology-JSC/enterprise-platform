import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmTimeSettingsController } from './hrm-time-settings.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {
    getContext() {
      return Promise.resolve({
        pool: (this as any).pool,
        tenantId: '00000000-0000-0000-0000-000000000001',
        principal: { userId: '00000000-0000-0000-0000-000000000002' },
      });
    }
  },
}));

jest.mock('../infrastructure/hrm-transaction.js', () => ({
  hrmTransaction: jest.fn().mockImplementation((pool, fn) => fn(pool)),
}));

jest.mock('../infrastructure/hrm-lifecycle.js', () => ({
  lifecycleAudit: jest.fn().mockResolvedValue(undefined),
  assertLifecycleVersion: jest.fn().mockResolvedValue(undefined),
}));

describe('HrmTimeSettingsController - Attendance Site Assignments API', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const siteId = '00000000-0000-0000-0000-000000000010';
  const unitId = '00000000-0000-0000-0000-000000000020';
  const employeeId = '00000000-0000-0000-0000-000000000030';
  const req = { headers: {} } as Request;

  let controller: HrmTimeSettingsController;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    const ctx = new (jest.requireMock('../infrastructure/hrm-context.service.js').HrmContextService)();
    ctx.pool = mockPool;
    controller = new HrmTimeSettingsController(ctx as any);
  });

  describe('GET time-settings', () => {
    it('trả về danh sách địa điểm kèm trường assignments đã map tên', async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes('work_calendar') && !sql.includes('count')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('attendance_sites WHERE')) {
          return Promise.resolve({
            rows: [
              { id: siteId, name: 'VP Đà Nẵng', active: true },
              { id: 'site-2', name: 'VP Hà Nội', active: true },
            ],
          });
        }
        if (sql.includes('policy_versions')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('attendance_site_assignments')) {
          return Promise.resolve({
            rows: [
              {
                id: 'assign-1',
                site_id: siteId,
                scope_type: 'UNIT',
                scope_id: unitId,
                scope_name: 'Phòng Kỹ thuật',
              },
            ],
          });
        }
        if (sql.includes('count(*)::int AS n')) {
          return Promise.resolve({ rows: [{ n: 10 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await controller.get(req);
      expect(res.data).toBeDefined();
      expect(res.data.sites).toHaveLength(2);
      
      const site1 = res.data.sites.find((s: any) => s.id === siteId);
      expect(site1.assignments).toHaveLength(1);
      expect(site1.assignments[0].scope_name).toBe('Phòng Kỹ thuật');

      const site2 = res.data.sites.find((s: any) => s.id === 'site-2');
      expect(site2.assignments).toHaveLength(0);
    });
  });

  describe('PUT sites/:id/assignments', () => {
    it('ném lỗi NotFoundException khi không tìm thấy địa điểm', async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM hrm_schema.attendance_sites')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        controller.updateSiteAssignments(req, siteId, { assignments: [] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném lỗi BadRequestException khi loại phạm vi scopeType không hợp lệ', async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM hrm_schema.attendance_sites')) {
          return Promise.resolve({ rows: [{ id: siteId, name: 'VP Đà Nẵng' }] });
        }
        if (sql.includes('DELETE FROM hrm_schema.attendance_site_assignments')) {
          return Promise.resolve({ rowCount: 0 });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        controller.updateSiteAssignments(req, siteId, {
          assignments: [{ scopeType: 'INVALID_SCOPE' as any, scopeId: unitId }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('xóa phân công cũ và thêm mới các phân công hợp lệ theo COMPANY, UNIT, EMPLOYEE', async () => {
      const executedSqls: string[] = [];
      mockPool.query.mockImplementation((sql: string, params: any[]) => {
        executedSqls.push(sql);
        if (sql.includes('SELECT * FROM hrm_schema.attendance_sites')) {
          return Promise.resolve({ rows: [{ id: siteId, name: 'VP Đà Nẵng' }] });
        }
        if (sql.includes('DELETE FROM hrm_schema.attendance_site_assignments')) {
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('INSERT INTO hrm_schema.attendance_site_assignments')) {
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('SELECT a.*')) {
          return Promise.resolve({
            rows: [
              {
                id: 'new-assign-1',
                site_id: siteId,
                scope_type: 'UNIT',
                scope_id: unitId,
                scope_name: 'Phòng Kỹ thuật',
              },
              {
                id: 'new-assign-2',
                site_id: siteId,
                scope_type: 'EMPLOYEE',
                scope_id: employeeId,
                scope_name: 'Nguyễn Văn A',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const body = {
        assignments: [
          { scopeType: 'UNIT' as const, scopeId: unitId },
          { scopeType: 'EMPLOYEE' as const, scopeId: employeeId },
        ],
      };

      const result = await controller.updateSiteAssignments(req, siteId, body as any);
      expect(result.data.siteId).toBe(siteId);
      expect(result.data.assignments).toHaveLength(2);
      expect(result.data.assignments[0].scope_name).toBe('Phòng Kỹ thuật');
      expect(result.data.assignments[1].scope_name).toBe('Nguyễn Văn A');

      expect(executedSqls.some((s) => s.includes('DELETE FROM hrm_schema.attendance_site_assignments'))).toBe(true);
      expect(executedSqls.some((s) => s.includes('INSERT INTO hrm_schema.attendance_site_assignments'))).toBe(true);
    });
  });
});
