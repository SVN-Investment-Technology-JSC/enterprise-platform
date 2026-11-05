import {
  ProcedureTaskApprovalService,
  mapProcedureInstanceToTaskDto,
} from './procedure-task-approval.service.js';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';

describe('ProcedureTaskApprovalService', () => {
  let service: ProcedureTaskApprovalService;
  let mockApp: jest.Mocked<ProcedureEngineApplication>;

  const mockActor: ProcedureActor = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    membershipId: 'mem-1',
    displayName: 'Nguyễn Văn A',
    canDesign: false,
    canPublish: false,
    canCreateInstances: true,
    isOverride: false,
    organizationUnitIds: [],
    positionIds: [],
  };

  const sampleInstance: ProcedureInstance = {
    id: 'ins-123',
    code: 'HS-2026-001',
    title: 'Hồ sơ đề xuất mua sắm thiết bị',
    definitionId: 'def-1',
    definitionCode: 'MS-TB',
    definitionName: 'Mua sắm thiết bị',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 'step-1',
    initiatedBy: 'user-2',
    startedAt: '2026-10-27T10:00:00.000Z',
    steps: [
      {
        id: 'step-1',
        key: 'step-1',
        order: 1,
        name: 'Trưởng phòng duyệt',
        status: 'active',
        currentRoleStage: 'A',
        definitionStepId: 'def-step-1',
        assignments: [],
      },
    ],
    activity: [],
    authorization: {
      myRoles: ['A'],
      currentRoleStage: 'A',
      availableActions: ['approve', 'reject', 'return'],
      canManageSubtasks: false,
      isOverride: false,
    },
  };

  beforeEach(() => {
    mockApp = {
      getWorkspace: jest.fn(),
      getInstance: jest.fn(),
      applyAction: jest.fn(),
    } as unknown as jest.Mocked<ProcedureEngineApplication>;

    service = new ProcedureTaskApprovalService(mockApp);
  });

  describe('mapProcedureInstanceToTaskDto & resolveStatusAndActions', () => {
    it('ánh xạ đúng hồ sơ đang chờ xử lý sang UniversalTaskDto', () => {
      const dto = mapProcedureInstanceToTaskDto(sampleInstance, 'tenant-1');
      expect(dto.taskId).toBe('procedure:ins-123');
      expect(dto.sourceModule).toBe('procedure');
      expect(dto.entityType).toBe('PROCEDURE_INSTANCE');
      expect(dto.title).toBe('Hồ sơ đề xuất mua sắm thiết bị');
      expect(dto.code).toBe('HS-2026-001');
      expect(dto.status).toBe('PENDING');
      expect(dto.availableActions).toEqual(['APPROVE', 'REJECT', 'RETURN']);
      expect(dto.blocks.summary.items).toContainEqual({
        label: 'Quy trình',
        value: 'Mua sắm thiết bị',
      });
      expect(dto.blocks.summary.items).toContainEqual({
        label: 'Bước hiện tại',
        value: 'Trưởng phòng duyệt',
      });
    });

    it('hồ sơ đã completed thì availableActions phải rỗng và status là APPROVED (chặn mở nút duyệt lại khi back)', () => {
      const completedInstance: ProcedureInstance = {
        ...sampleInstance,
        status: 'completed',
        authorization: {
          ...sampleInstance.authorization!,
          availableActions: ['approve'], // Dữ liệu cũ còn sót
        },
      };

      const dto = mapProcedureInstanceToTaskDto(completedInstance, 'tenant-1');
      expect(dto.status).toBe('APPROVED');
      expect(dto.availableActions).toEqual([]);
    });

    it('hồ sơ đã rejected/cancelled thì availableActions phải rỗng và status là REJECTED', () => {
      const rejectedInstance: ProcedureInstance = {
        ...sampleInstance,
        status: 'rejected',
      };

      const dto = mapProcedureInstanceToTaskDto(rejectedInstance, 'tenant-1');
      expect(dto.status).toBe('REJECTED');
      expect(dto.availableActions).toEqual([]);
    });

    it('hồ sơ đang chạy nhưng người xem không có thẩm quyền duyệt thì availableActions rỗng', () => {
      const viewerInstance: ProcedureInstance = {
        ...sampleInstance,
        authorization: {
          ...sampleInstance.authorization!,
          availableActions: ['comment'],
        },
      };

      const dto = mapProcedureInstanceToTaskDto(viewerInstance, 'tenant-1');
      expect(dto.status).toBe('APPROVED');
      expect(dto.availableActions).toEqual([]);
    });
  });

  describe('getPendingTasks', () => {
    it('lấy danh sách hồ sơ cần xử lý của người dùng hiện tại', async () => {
      mockApp.getWorkspace.mockResolvedValue({
        tenantId: 'tenant-1',
        actor: { id: mockActor.userId, name: mockActor.displayName },
        definitions: [],
        instances: [sampleInstance],
        permissions: {
          canManageDefinitions: false,
          canPublishDefinitions: false,
          canCreateInstances: true,
          canOverrideActions: false,
        },
      });

      const res = await service.getPendingTasks('tenant-1', 'user-1', { limit: 10 }, mockActor);
      expect(res.total).toBe(1);
      expect(res.items.length).toBe(1);
      expect(res.items[0].taskId).toBe('procedure:ins-123');
      expect(res.items[0].status).toBe('PENDING');
    });
  });

  describe('getTaskDetail', () => {
    it('phân giải taskId có tiền tố procedure: và nạp chi tiết từ application', async () => {
      mockApp.getInstance.mockResolvedValue(sampleInstance);

      const res = await service.getTaskDetail('tenant-1', 'user-1', 'procedure:ins-123', mockActor);
      expect(mockApp.getInstance).toHaveBeenCalledWith(mockActor, 'ins-123');
      expect(res.taskId).toBe('procedure:ins-123');
      expect(res.title).toBe(sampleInstance.title);
    });
  });

  describe('executeAction', () => {
    it('thực thi APPROVE thành công khi bước cho phép approve', async () => {
      mockApp.getInstance.mockResolvedValue(sampleInstance);
      mockApp.applyAction.mockResolvedValue({
        ...sampleInstance,
        status: 'completed',
      });

      const result = await service.executeAction(
        'tenant-1',
        'user-1',
        'procedure:ins-123',
        { action: 'APPROVE', reason: 'Đồng ý', idempotencyKey: 'key-1' },
        mockActor,
      );

      expect(mockApp.applyAction).toHaveBeenCalledWith(
        mockActor,
        'ins-123',
        expect.objectContaining({
          action: 'approve',
          comment: 'Đồng ý',
        }),
      );
      expect(result.newStatus).toBe('APPROVED');
    });

    it('thực thi APPROVE tự động chuyển thành complete nếu bước là vai E/R', async () => {
      const stepEInstance: ProcedureInstance = {
        ...sampleInstance,
        authorization: {
          ...sampleInstance.authorization!,
          availableActions: ['complete', 'comment'],
        },
      };
      mockApp.getInstance.mockResolvedValue(stepEInstance);
      mockApp.applyAction.mockResolvedValue(stepEInstance);

      const result = await service.executeAction(
        'tenant-1',
        'user-1',
        'procedure:ins-123',
        { action: 'APPROVE', idempotencyKey: 'key-2' },
        mockActor,
      );

      expect(mockApp.applyAction).toHaveBeenCalledWith(
        mockActor,
        'ins-123',
        expect.objectContaining({
          action: 'complete',
        }),
      );
      expect(result.newStatus).toBe('APPROVED');
    });

    it('từ chối REJECT nếu thiếu lý do', async () => {
      mockApp.getInstance.mockResolvedValue(sampleInstance);

      await expect(
        service.executeAction(
          'tenant-1',
          'user-1',
          'procedure:ins-123',
          { action: 'REJECT', idempotencyKey: 'key-3' },
          mockActor,
        ),
      ).rejects.toMatchObject({
        code: 'validation',
        message: expect.stringContaining('lý do từ chối'),
      });
    });

    it('thực thi REJECT thành công khi có lý do', async () => {
      mockApp.getInstance.mockResolvedValue(sampleInstance);
      mockApp.applyAction.mockResolvedValue({
        ...sampleInstance,
        status: 'rejected',
      });

      const result = await service.executeAction(
        'tenant-1',
        'user-1',
        'procedure:ins-123',
        { action: 'REJECT', reason: 'Không đủ ngân sách', idempotencyKey: 'key-4' },
        mockActor,
      );

      expect(mockApp.applyAction).toHaveBeenCalledWith(
        mockActor,
        'ins-123',
        expect.objectContaining({
          action: 'reject',
          comment: 'Không đủ ngân sách',
        }),
      );
      expect(result.newStatus).toBe('REJECTED');
    });

    it('thực thi RETURN thành công khi có lý do', async () => {
      mockApp.getInstance.mockResolvedValue(sampleInstance);
      mockApp.applyAction.mockResolvedValue(sampleInstance);

      const result = await service.executeAction(
        'tenant-1',
        'user-1',
        'procedure:ins-123',
        { action: 'RETURN', reason: 'Cần bổ sung báo giá', idempotencyKey: 'key-5' },
        mockActor,
      );

      expect(mockApp.applyAction).toHaveBeenCalledWith(
        mockActor,
        'ins-123',
        expect.objectContaining({
          action: 'return',
          comment: 'Cần bổ sung báo giá',
        }),
      );
      expect(result.newStatus).toBe('RETURNED');
    });

    it('chặn thao tác nếu hồ sơ không còn ở trạng thái running (Atomic Concurrency)', async () => {
      mockApp.getInstance.mockResolvedValue({
        ...sampleInstance,
        status: 'completed',
      });

      await expect(
        service.executeAction(
          'tenant-1',
          'user-1',
          'procedure:ins-123',
          { action: 'APPROVE', idempotencyKey: 'key-6' },
          mockActor,
        ),
      ).rejects.toMatchObject({
        code: 'conflict',
      });
    });
  });
});
