import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HrmTaskApprovalService } from './hrm-task-approval.service.js';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

describe('HrmTaskApprovalService', () => {
  let service: HrmTaskApprovalService;
  let mockCtx: any;
  let mockApprovals: any;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    mockCtx = {
      getPoolForTenant: jest.fn(async () => mockPool),
      loadActorPrincipal: jest.fn(async () => ({
        tenantId: 'tenant-1',
        userId: 'user-manager',
        displayName: 'Quản Lý',
        email: 'manager@example.com',
        permissions: ['hrm.request.approve'],
      })),
    };
    mockApprovals = {
      listFilter: jest.fn(async () => ({
        sql: '1=1',
        params: [],
      })),
      assertCanDecide: jest.fn(async () => undefined),
    };
    service = new HrmTaskApprovalService(mockCtx, mockApprovals);
  });

  describe('getPendingTasks', () => {
    it('lấy danh sách đơn từ các loại và map đúng sang UniversalTaskDto', async () => {
      // Giả lập trả về 1 đơn nghỉ phép và 1 đơn OT
      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('hrm_schema.leave_requests')) {
          return {
            rows: [
              {
                id: 'leave-1',
                employee_id: 'emp-1',
                from_date: '2026-10-27',
                to_date: '2026-10-28',
                duration: '2.00',
                reason: 'Nghỉ phép',
                status: 'PENDING',
                created_at: new Date('2026-10-24T08:00:00Z'),
                leave_type_name: 'Phép năm',
                full_name: 'Trần Quốc Vương',
                employee_code: 'SVN-034',
                department_name: 'Phòng Thí nghiệm',
                position_name: 'Nhân viên thí nghiệm',
                user_id: 'user-vuong',
                work_email: 'vuong@savina.local',
                link_instance_id: null,
              },
            ],
          };
        }
        if (sql.includes('hrm_schema.ot_requests')) {
          return {
            rows: [
              {
                id: 'ot-1',
                employee_id: 'emp-2',
                work_date: '2026-10-28',
                start_time: '17:30',
                end_time: '20:30',
                planned_minutes: 180,
                reason: 'Dự án gấp',
                status: 'PENDING',
                created_at: new Date('2026-10-23T07:00:00Z'),
                paid: true,
                full_name: 'Bùi Công Quyền',
                employee_code: 'SVN-001',
                department_name: 'Phòng Thí nghiệm',
                position_name: 'Nhân viên thí nghiệm',
                user_id: 'user-quyen',
                work_email: 'quyen@savina.local',
                link_instance_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await service.getPendingTasks('tenant-1', 'user-manager', { limit: 10, offset: 0 });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].taskId).toBe('hrm:leave:leave-1');
      expect(result.items[0].requester.fullName).toBe('Trần Quốc Vương');
      expect(result.items[0].approvalMode).toBe('LOCAL');
      expect(result.items[1].taskId).toBe('hrm:ot:ot-1');
      expect(result.items[1].requester.fullName).toBe('Bùi Công Quyền');
    });

    it('không bị sập toàn bộ nếu một bảng đơn bị lỗi', async () => {
      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('hrm_schema.leave_requests')) {
          throw new Error('Database temporary error');
        }
        if (sql.includes('hrm_schema.ot_requests')) {
          return {
            rows: [
              {
                id: 'ot-1',
                employee_id: 'emp-2',
                work_date: '2026-10-28',
                start_time: '17:30',
                end_time: '20:30',
                planned_minutes: 180,
                reason: 'Dự án gấp',
                status: 'PENDING',
                created_at: new Date('2026-10-23T07:00:00Z'),
                paid: true,
                full_name: 'Bùi Công Quyền',
                employee_code: 'SVN-001',
                department_name: 'Phòng Thí nghiệm',
                position_name: 'Nhân viên thí nghiệm',
                user_id: 'user-quyen',
                work_email: 'quyen@savina.local',
                link_instance_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await service.getPendingTasks('tenant-1', 'user-manager');

      expect(result.total).toBe(1);
      expect(result.items[0].taskId).toBe('hrm:ot:ot-1');
    });
  });

  describe('getTaskDetail', () => {
    it('trả về chi tiết đơn và blocks khi tìm thấy', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'leave-1',
            employee_id: 'emp-1',
            from_date: '2026-10-27',
            to_date: '2026-10-28',
            duration: '2.00',
            reason: 'Nghỉ phép',
            status: 'PENDING',
            created_at: new Date('2026-10-24T08:00:00Z'),
            leave_type_name: 'Phép năm',
            full_name: 'Trần Quốc Vương',
            employee_code: 'SVN-034',
            department_name: 'Phòng Thí nghiệm',
            position_name: 'Nhân viên thí nghiệm',
            user_id: 'user-vuong',
            work_email: 'vuong@savina.local',
            link_instance_id: null,
          },
        ],
      });

      const task = await service.getTaskDetail('tenant-1', 'user-manager', 'hrm:leave:leave-1');

      expect(task.taskId).toBe('hrm:leave:leave-1');
      expect(task.title).toContain('Trần Quốc Vương');
      expect(task.blocks.summary?.items).toBeDefined();
      expect(task.blocks.attributes?.items).toBeDefined();
      expect(task.blocks.timeline?.steps).toBeDefined();
    });

    it('format đúng giờ đề nghị và giờ đã chấm cho đơn giải trình công (Asia/Ho_Chi_Minh)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'corr-1',
            employee_id: 'emp-1',
            request_date: '2026-10-27',
            old_check_in_at: new Date('2026-10-27T01:05:00Z'), // 08:05 VN
            old_check_out_at: null,
            new_check_in_at: new Date('2026-10-27T01:30:00Z'), // 08:30 VN
            new_check_out_at: new Date('2026-10-27T10:30:00Z'), // 17:30 VN
            reason: 'Quên bấm vân tay lúc ra ca',
            status: 'PENDING',
            created_at: new Date('2026-10-27T02:00:00Z'),
            full_name: 'Trần Quốc Vương',
            employee_code: 'SVN-034',
            department_name: 'Phòng Thí nghiệm',
            position_name: 'Nhân viên thí nghiệm',
            user_id: 'user-vuong',
            work_email: 'vuong@savina.local',
            link_instance_id: null,
          },
        ],
      });

      const task = await service.getTaskDetail('tenant-1', 'user-manager', 'hrm:correction:corr-1');

      expect(task.taskId).toBe('hrm:correction:corr-1');
      expect(task.entityType).toBe('ATTENDANCE_CORRECTION_REQUEST');

      const summaryItems = task.blocks.summary?.items || [];
      const inItem = summaryItems.find((i) => i.label === 'Giờ vào đề nghị');
      const outItem = summaryItems.find((i) => i.label === 'Giờ ra đề nghị');
      const dateItem = summaryItems.find((i) => i.label === 'Ngày cần giải trình');

      expect(inItem?.value).toBe('08:30');
      expect(outItem?.value).toBe('17:30');
      expect(dateItem?.value).toBe('27/10/2026');

      const attrItems = task.blocks.attributes?.items || [];
      const oldPunchItem = attrItems.find((i) => i.key === 'currentPunches');
      expect(oldPunchItem?.value).toBe('Vào: 08:05 · Ra: —');
    });

    it('trả về availableActions rỗng và trạng thái APPROVED khi đơn đã được duyệt trước đó', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'leave-app-1',
            employee_id: 'emp-1',
            from_date: '2026-10-27',
            to_date: '2026-10-28',
            duration: '2.00',
            reason: 'Nghỉ phép',
            status: 'APPROVED',
            approved_at: new Date('2026-10-25T10:00:00Z'),
            created_at: new Date('2026-10-24T08:00:00Z'),
            leave_type_name: 'Phép năm',
            full_name: 'Trần Quốc Vương',
            employee_code: 'SVN-034',
            department_name: 'Phòng Thí nghiệm',
            position_name: 'Nhân viên thí nghiệm',
            user_id: 'user-vuong',
            work_email: 'vuong@savina.local',
            link_instance_id: null,
          },
        ],
      });

      const task = await service.getTaskDetail('tenant-1', 'user-manager', 'hrm:leave:leave-app-1');

      expect(task.status).toBe('APPROVED');
      expect(task.availableActions).toEqual([]);
      expect(task.blocks.timeline?.steps[1].status).toBe('COMPLETED');
    });

    it('ném NotFoundException nếu không tìm thấy đơn', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.getTaskDetail('tenant-1', 'user-manager', 'hrm:leave:non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeAction', () => {
    it('từ chối hành động nếu thiếu idempotencyKey', async () => {
      await expect(
        service.executeAction('tenant-1', 'user-manager', 'hrm:leave:leave-1', {
          action: 'APPROVE',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
