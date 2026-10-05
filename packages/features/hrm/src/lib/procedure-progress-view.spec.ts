import {
  approvalErrorMessage,
  procedureActionBody,
  procedureFieldsOf,
  procedureSyncNotice,
  shouldPollProcedureProgress,
  waitingApproverLabel,
} from './procedure-progress-view';

describe('procedure-progress-view', () => {
  it('chỉ làm mới khi drawer mở, đơn còn chạy và tab hiển thị', () => {
    const base = {
      open: true,
      hasInstance: true,
      status: 'running',
      hidden: false,
    };
    expect(shouldPollProcedureProgress(base)).toBe(true);
    expect(shouldPollProcedureProgress({ ...base, open: false })).toBe(false);
    expect(shouldPollProcedureProgress({ ...base, hidden: true })).toBe(false);
    expect(shouldPollProcedureProgress({ ...base, hasInstance: false })).toBe(
      false,
    );
    for (const status of ['completed', 'rejected', 'cancelled'])
      expect(shouldPollProcedureProgress({ ...base, status })).toBe(false);
  });

  it('báo trạng thái khởi tạo và đồng bộ lỗi kèm lỗi rút gọn', () => {
    expect(procedureSyncNotice('START_PENDING')?.title).toBe(
      'Đang khởi tạo quy trình',
    );
    const failed = procedureSyncNotice('FAILED', 'x'.repeat(500));
    expect(failed?.title).toBe('Đồng bộ lỗi - đang thử lại');
    expect(failed?.detail?.length).toBeLessThanOrEqual(160);
    expect(procedureSyncNotice('RUNNING')).toBeNull();
    expect(procedureSyncNotice('APPLIED')).toBeNull();
  });

  it('dựng nhãn người đang chờ duyệt', () => {
    expect(
      waitingApproverLabel({
        assigneeName: 'Nguyễn An',
        stepName: 'Quản lý duyệt',
      }),
    ).toBe('Đang chờ Nguyễn An duyệt - Quản lý duyệt');
    expect(waitingApproverLabel({ stepName: 'Giám đốc' })).toBe(
      'Đang chờ duyệt - Giám đốc',
    );
    expect(waitingApproverLabel({})).toBeNull();
  });

  it('đọc trường quy trình từ dòng đơn', () => {
    expect(
      procedureFieldsOf({
        procedureInstanceId: 'i1',
        currentStepName: 'B',
        currentAssigneeName: 'A',
      }),
    ).toMatchObject({
      instanceId: 'i1',
      currentStepName: 'B',
      currentAssigneeName: 'A',
    });
    expect(procedureFieldsOf(undefined).instanceId).toBeUndefined();
  });

  it('thân yêu cầu thao tác bỏ ý kiến rỗng', () => {
    expect(
      procedureActionBody('APPROVE', { comment: '  ', idempotencyKey: 'k' }),
    ).toEqual({ action: 'APPROVE', idempotencyKey: 'k' });
    expect(
      procedureActionBody('REJECT', {
        comment: ' sai ',
        idempotencyKey: 'k',
        revision: 2,
      }),
    ).toEqual({
      action: 'REJECT',
      comment: 'sai',
      revision: 2,
      idempotencyKey: 'k',
    });
  });

  it('thông báo tiếng Việt cho mã lỗi duyệt và lỗi 403/409 từ PE', () => {
    for (const code of [
      'SELF_APPROVAL_FORBIDDEN',
      'APPROVAL_OUT_OF_SCOPE',
      'PROCEDURE_IN_PROGRESS',
      'ORG_CONTEXT_UNAVAILABLE',
    ])
      expect(approvalErrorMessage({ status: 403, code, message: 'raw' })).not.toBe(
        'raw',
      );
    expect(
      approvalErrorMessage({ status: 403, message: 'Forbidden' }, 'procedure'),
    ).toMatch(/không phải người được giao/);
    expect(
      approvalErrorMessage({ status: 409, message: 'x' }, 'procedure'),
    ).toMatch(/đã được xử lý/);
    expect(
      approvalErrorMessage({ status: 500, message: 'Lỗi máy chủ' }, 'procedure'),
    ).toBe('Lỗi máy chủ');
  });
});
