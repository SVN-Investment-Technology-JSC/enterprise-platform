import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmTaskApprovalController } from './hrm-task-approval.controller.js';
import { HrmTaskApprovalService } from '../application/hrm-task-approval.service.js';
import type { UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const mockTask: UniversalTaskDto = {
  taskId: 'hrm:leave:req-123',
  moduleKey: 'hrm',
  businessKind: 'leave',
  sourceId: 'req-123',
  title: 'Đơn xin nghỉ phép - Nguyễn Văn A',
  subtitle: 'Nghỉ phép năm · 2 ngày',
  status: 'PENDING',
  urgency: 'NORMAL',
  requester: {
    userId: 'user-subordinate',
    employeeId: 'emp-1',
    employeeCode: 'NV001',
    displayName: 'Nguyễn Văn A',
    departmentName: 'Phòng Kỹ thuật',
    positionName: 'Kỹ sư phần mềm',
  },
  blocks: [
    {
      id: 'summary-blk',
      kind: 'summary',
      title: 'Tóm tắt đơn',
      items: [
        { key: 'leave_type', label: 'Loại nghỉ', value: 'Nghỉ phép năm' },
        { key: 'duration', label: 'Số ngày', value: '2 ngày' },
      ],
    },
  ],
  availableActions: [
    { type: 'APPROVE', label: 'Phê duyệt', tone: 'PRIMARY', requiresReason: false },
    { type: 'REJECT', label: 'Từ chối', tone: 'DANGER', requiresReason: true },
  ],
  createdAt: '2026-10-26T08:00:00.000Z',
  updatedAt: '2026-10-26T08:00:00.000Z',
};

const req = { headers: {} } as Request;

function setupController() {
  const principal = {
    userId: 'user-manager',
    permissions: ['hrm.request.approve'],
    displayName: 'Trần Quản Lý',
    email: 'manager@example.com',
  };
  const ctx = {
    getContext: jest.fn(async () => ({
      tenantId: 't-pilot',
      principal,
      pool: {},
    })),
  };

  const taskService = {
    getPendingTasks: jest.fn(async () => ({
      items: [mockTask],
      total: 1,
      limit: 20,
      offset: 0,
    })),
    getTaskDetail: jest.fn(async () => mockTask),
    executeAction: jest.fn(async (_t: any, _a: any, _id: any, dto: any) => ({
      success: true,
      taskId: 'hrm:leave:req-123',
      action: dto.action,
      newStatus: dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      completedAt: new Date().toISOString(),
      message: dto.action === 'APPROVE' ? 'Phê duyệt đơn thành công' : 'Đã từ chối đơn',
    })),
  };

  const controller = new HrmTaskApprovalController(ctx as any, taskService as any);
  return { controller, ctx, taskService, principal };
}

describe('HrmTaskApprovalController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /v1/tasks/pending', () => {
    it('lấy danh sách đơn chờ duyệt và ánh xạ sang UniversalTaskDto', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.getPendingTasks(req, '10', '0');

      expect(taskService.getPendingTasks).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        { limit: 10, offset: 0 },
        principal,
      );
      expect(res.data).toHaveLength(1);
      expect(res.data[0].taskId).toBe('hrm:leave:req-123');
      expect(res.data[0].requester.displayName).toBe('Nguyễn Văn A');
      expect(res.total).toBe(1);
    });
  });

  describe('GET /v1/tasks/:kind/:id', () => {
    it('lấy chi tiết đơn theo loại và ID', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.getTaskDetail(req, 'leave', 'req-123');

      expect(taskService.getTaskDetail).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        'hrm:leave:req-123',
        principal,
      );
      expect(res.data.taskId).toBe('hrm:leave:req-123');
      expect(res.data.blocks.length).toBeGreaterThan(0);
    });

    it('lấy chi tiết đơn theo taskId đầy đủ', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.getTaskDetailByTaskId(req, 'hrm:leave:req-123');

      expect(taskService.getTaskDetail).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        'hrm:leave:req-123',
        principal,
      );
      expect(res.data.taskId).toBe('hrm:leave:req-123');
    });
  });

  describe('POST /v1/tasks/:kind/:id/actions and :taskId/actions', () => {
    it('phê duyệt đơn thành công không bắt buộc reason', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.executeTaskAction(req, 'leave', 'req-123', {
        action: 'APPROVE',
      });

      expect(taskService.executeAction).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        'hrm:leave:req-123',
        { action: 'APPROVE' },
        principal,
      );
      expect(res.data.success).toBe(true);
      expect(res.data.newStatus).toBe('APPROVED');
    });

    it('từ chối đơn thành công khi có lý do', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.executeTaskAction(req, 'leave', 'req-123', {
        action: 'REJECT',
        reason: 'Không đủ người trực thay thế',
      });

      expect(taskService.executeAction).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        'hrm:leave:req-123',
        { action: 'REJECT', reason: 'Không đủ người trực thay thế' },
        principal,
      );
      expect(res.data.success).toBe(true);
      expect(res.data.newStatus).toBe('REJECTED');
    });

    it('thực thi hành động theo taskId đầy đủ qua executeTaskActionByTaskId', async () => {
      const { controller, taskService, principal } = setupController();
      const res = await controller.executeTaskActionByTaskId(req, 'hrm:correction:req-456', {
        action: 'APPROVE',
      });

      expect(taskService.executeAction).toHaveBeenCalledWith(
        't-pilot',
        'user-manager',
        'hrm:correction:req-456',
        { action: 'APPROVE' },
        principal,
      );
      expect(res.data.success).toBe(true);
    });
  });
});

describe('HrmTaskApprovalService - Logic & Rules Enforcement', () => {
  it('từ chối bắt buộc phải có reason (ngay cả khi gọi service trực tiếp)', async () => {
    const ctx = {
      getPoolForTenant: jest.fn(async () => ({ query: jest.fn() })),
      loadActorPrincipal: jest.fn(async () => ({
        tenantId: 't-pilot',
        userId: 'user-manager',
        permissions: ['hrm.request.approve'],
      })),
    };
    const approvals = {
      assertCanDecide: jest.fn(),
    };
    const service = new HrmTaskApprovalService(ctx as any, approvals as any);

    await expect(
      service.executeAction('t-pilot', 'user-manager', 'hrm:leave:req-1', {
        action: 'REJECT',
        reason: '   ',
        idempotencyKey: 'idemp-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('bảo vệ chống tự phê duyệt (SELF_APPROVAL_FORBIDDEN)', async () => {
    const ctx = {
      getPoolForTenant: jest.fn(async () => ({ query: jest.fn() })),
      loadActorPrincipal: jest.fn(async () => ({
        tenantId: 't-pilot',
        userId: 'user-self',
        permissions: ['hrm.request.approve'],
      })),
    };
    const approvals = {
      assertCanDecide: jest.fn(async () => {
        throw new ForbiddenException({
          code: 'SELF_APPROVAL_FORBIDDEN',
          message: 'Không được tự duyệt đơn của chính mình',
        });
      }),
    };
    const service = new HrmTaskApprovalService(ctx as any, approvals as any);

    await expect(
      service.executeAction('t-pilot', 'user-self', 'hrm:leave:req-1', {
        action: 'APPROVE',
        idempotencyKey: 'idemp-2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('bảo vệ chống xung đột quy trình Procedure Engine (PROCEDURE_IN_PROGRESS)', async () => {
    const ctx = {
      getPoolForTenant: jest.fn(async () => ({ query: jest.fn() })),
      loadActorPrincipal: jest.fn(async () => ({
        tenantId: 't-pilot',
        userId: 'user-manager',
        permissions: ['hrm.request.approve'],
      })),
    };
    const approvals = {
      assertCanDecide: jest.fn(async () => {
        throw new ConflictException({
          code: 'PROCEDURE_IN_PROGRESS',
          message: 'Đơn đang được xử lý theo quy trình phê duyệt nhiều bước',
        });
      }),
    };
    const service = new HrmTaskApprovalService(ctx as any, approvals as any);

    await expect(
      service.executeAction('t-pilot', 'user-manager', 'hrm:leave:req-1', {
        action: 'APPROVE',
        idempotencyKey: 'idemp-3',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
