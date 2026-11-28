import type { ProcedureInstance, ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { buildFinanceVoucherRequestedPayload } from './procedure-finance-step.js';

const PROJECT = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const ITEM = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const SOURCE_ITEM = 'aaaaaaaa-5b6a-4789-8a9b-0c1d2e3f4a5b';

const step = {
  id: 'step-1',
  key: 'TAICHINH',
  name: 'Kế toán chi tiền',
  order: 3,
  assignments: [],
  attributes: [],
  integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' },
  startedAt: '2026-11-15T00:00:00.000Z',
} as unknown as ProcedureInstanceStep;

const instanceOf = (over: Record<string, unknown>): ProcedureInstance =>
  ({
    id: 'i1',
    code: 'PR-1',
    title: 'Chi vật tư dự án',
    definitionId: 'd1',
    definitionName: 'Chi phí dự án',
    initiatedBy: 'u1',
    startedAt: '2026-11-15T00:00:00.000Z',
    activity: [],
    steps: [step],
    attributeValues: {},
    attributes: [],
    ...over,
  }) as unknown as ProcedureInstance;

describe('buildFinanceVoucherRequestedPayload — dự án và công việc gửi sang Tài chính', () => {
  it('hồ sơ mở thủ công kèm dự án, Workspace đã tạo xong công việc: phiếu hạch toán cho công việc đó', () => {
    const payload = buildFinanceVoucherRequestedPayload(
      instanceOf({ sourceType: 'manual', workspaceLink: { projectId: PROJECT, status: 'linked', workItemId: ITEM } }),
      step,
    );
    expect(payload.projectId).toBe(PROJECT);
    expect(payload.workItemId).toBe(ITEM);
  });

  it('công việc chưa tạo xong (đang chờ): chỉ có dự án, không đoán công việc', () => {
    const payload = buildFinanceVoucherRequestedPayload(
      instanceOf({ sourceType: 'manual', workspaceLink: { projectId: PROJECT, status: 'pending' } }),
      step,
    );
    expect(payload.projectId).toBe(PROJECT);
    expect(payload.workItemId).toBeUndefined();
  });

  it('liên kết bị từ chối: không gửi công việc', () => {
    const payload = buildFinanceVoucherRequestedPayload(
      instanceOf({ sourceType: 'manual', workspaceLink: { projectId: PROJECT, status: 'rejected', workItemId: ITEM } }),
      step,
    );
    expect(payload.workItemId).toBeUndefined();
  });

  it('hồ sơ sinh từ công việc Workspace: dùng công việc nguồn như trước', () => {
    const payload = buildFinanceVoucherRequestedPayload(
      instanceOf({ sourceType: 'workspace_work_item', sourceId: SOURCE_ITEM }),
      step,
    );
    expect(payload.workItemId).toBe(SOURCE_ITEM);
  });

  it('hồ sơ sinh từ công việc Workspace đã đổi dự án / công việc: dùng công việc mới, công việc nguồn đã xoá', () => {
    const payload = buildFinanceVoucherRequestedPayload(
      instanceOf({
        sourceType: 'workspace_work_item',
        sourceId: SOURCE_ITEM,
        workspaceLink: { projectId: PROJECT, status: 'linked', workItemId: ITEM },
      }),
      step,
    );
    expect(payload.workItemId).toBe(ITEM);
  });

  it('hồ sơ không gắn dự án: không gửi dự án hay công việc', () => {
    const payload = buildFinanceVoucherRequestedPayload(instanceOf({ sourceType: 'manual' }), step);
    expect(payload.projectId).toBeUndefined();
    expect(payload.workItemId).toBeUndefined();
  });
});
