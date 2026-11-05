import {
  TASK_ERRORS,
  validateTaskActionInput,
  assertActionAvailable,
  TaskValidationError,
  parseTaskId,
  resolveTaskApiEndpoint,
  type UniversalTaskDto,
} from '../index.js';

describe('Contracts Task Approval Specification', () => {
  describe('validateTaskActionInput', () => {
    it('cho phép phê duyệt (APPROVE) không cần lý do', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'APPROVE',
          idempotencyKey: 'idemp-12345',
        }),
      ).not.toThrow();
    });

    it('cho phép phê duyệt (APPROVE) có lý do tùy chọn', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'APPROVE',
          reason: 'Đã kiểm tra đủ điều kiện',
          idempotencyKey: 'idemp-12345',
        }),
      ).not.toThrow();
    });

    it('từ chối (REJECT) bắt buộc phải có lý do, quăng lỗi TASK_REASON_REQUIRED nếu để trống', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'REJECT',
          reason: '',
          idempotencyKey: 'idemp-12345',
        }),
      ).toThrow(TaskValidationError);

      try {
        validateTaskActionInput({
          action: 'REJECT',
          reason: '   ',
          idempotencyKey: 'idemp-12345',
        });
        fail('Lẽ ra phải quăng lỗi');
      } catch (e: unknown) {
        const err = e as TaskValidationError;
        expect(err.code).toBe(TASK_ERRORS.REASON_REQUIRED);
        expect(err.message).toContain('Vui lòng nhập lý do từ chối');
      }
    });

    it('yêu cầu sửa / trả lại (RETURN) bắt buộc phải có lý do', () => {
      try {
        validateTaskActionInput({
          action: 'RETURN',
          reason: undefined,
          idempotencyKey: 'idemp-12345',
        });
        fail('Lẽ ra phải quăng lỗi');
      } catch (e: unknown) {
        const err = e as TaskValidationError;
        expect(err.code).toBe(TASK_ERRORS.REASON_REQUIRED);
        expect(err.message).toContain('bổ sung / chỉnh sửa');
      }
    });

    it('từ chối (REJECT) hoặc trả lại (RETURN) hợp lệ khi có lý do rõ ràng', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'REJECT',
          reason: 'Trùng lịch công tác với đồng nghiệp',
          idempotencyKey: 'idemp-12345',
        }),
      ).not.toThrow();

      expect(() =>
        validateTaskActionInput({
          action: 'RETURN',
          reason: 'Thiếu hóa đơn VAT đính kèm',
          idempotencyKey: 'idemp-12345',
        }),
      ).not.toThrow();
    });

    it('quăng lỗi nếu thiếu idempotencyKey', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'APPROVE',
          idempotencyKey: '',
        }),
      ).toThrow(TaskValidationError);
    });

    it('quăng lỗi nếu hành động không nằm trong danh mục hợp lệ', () => {
      expect(() =>
        validateTaskActionInput({
          action: 'INVALID_ACT' as unknown as 'APPROVE',
          idempotencyKey: 'idemp-12345',
        }),
      ).toThrow(TaskValidationError);
    });
  });

  describe('assertActionAvailable', () => {
    const mockTask: Pick<UniversalTaskDto, 'availableActions'> = {
      availableActions: ['APPROVE', 'REJECT'],
    };

    it('chấp nhận nếu hành động có trong availableActions', () => {
      expect(() => assertActionAvailable(mockTask, 'APPROVE')).not.toThrow();
      expect(() => assertActionAvailable(mockTask, 'REJECT')).not.toThrow();
    });

    it('chặn và báo lỗi nếu hành động không được module hỗ trợ (ví dụ RETURN ở HRM)', () => {
      try {
        assertActionAvailable(mockTask, 'RETURN');
        fail('Lẽ ra phải quăng lỗi');
      } catch (e: unknown) {
        const err = e as TaskValidationError;
        expect(err.code).toBe(TASK_ERRORS.ACTION_NOT_AVAILABLE);
      }
    });
  });

  describe('parseTaskId & resolveTaskApiEndpoint', () => {
    it('phân tích chính xác cấu trúc taskId 3 thành phần (hrm:correction:uuid)', () => {
      const parsed = parseTaskId('hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939');
      expect(parsed).toEqual({
        module: 'hrm',
        kind: 'correction',
        entityId: '50458af3-5149-42f0-ab6f-6bd263dbd939',
        raw: 'hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939',
      });
    });

    it('giải mã chính xác khi taskId bị URL encode (%3A)', () => {
      const encoded = encodeURIComponent('hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939');
      const parsed = parseTaskId(encoded);
      expect(parsed.module).toBe('hrm');
      expect(parsed.kind).toBe('correction');
      expect(parsed.entityId).toBe('50458af3-5149-42f0-ab6f-6bd263dbd939');
    });

    it('phân giải đường dẫn endpoint API cho HRM', () => {
      const getUrl = resolveTaskApiEndpoint('hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939');
      expect(getUrl).toBe('/api/hrm/v1/tasks/correction/50458af3-5149-42f0-ab6f-6bd263dbd939');

      const actionUrl = resolveTaskApiEndpoint(
        'hrm:correction:50458af3-5149-42f0-ab6f-6bd263dbd939',
        '/actions',
      );
      expect(actionUrl).toBe(
        '/api/hrm/v1/tasks/correction/50458af3-5149-42f0-ab6f-6bd263dbd939/actions',
      );
    });

    it('phân giải đường dẫn cho Inventory và Procedure Engine', () => {
      expect(resolveTaskApiEndpoint('inventory:stock_transfer:tr-123', '/actions')).toBe(
        '/api/inventory/v1/tasks/stock_transfer/tr-123/actions',
      );
      expect(resolveTaskApiEndpoint('procedure:step-999')).toBe(
        '/api/procedure/v1/tasks/step-999',
      );
    });

    it('fallback về /api/tasks nếu taskId không chứa prefix phân hệ hợp lệ', () => {
      expect(resolveTaskApiEndpoint('plain-task', '/actions')).toBe('/api/tasks/plain-task/actions');
    });
  });
});
