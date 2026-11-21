import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureInventoryEvents } from './inventory-issue-events.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

const TENANT = 'tenant-material-orders';

const admin: ProcedureActor = {
  tenantId: TENANT,
  userId: 'admin',
  displayName: 'Quản trị',
  membershipId: 'm-admin',
  canDesign: true,
  canPublish: true,
  canCreateInstances: true,
  isOverride: true,
  organizationUnitIds: [],
  positionIds: [],
};

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-VT',
    name: 'Xin vật tư',
    kind: 'process',
    category: 'technical',
    steps: [
      { key: 'SUBMIT', order: 1, name: 'Trình', assignments: [{ role: 'S', subjectType: 'user', subjectId: 'tech' }] },
      { key: 'APPROVE', order: 2, name: 'Duyệt', assignments: [{ role: 'A', subjectType: 'user', subjectId: 'boss' }] },
    ],
  };
}

/**
 * Hồ sơ cha đã xin vật tư: một đơn xuất kho (hồ sơ con PR-CON đã duyệt xong), một
 * đơn mua sắm, một đơn xuất kho mà hồ sơ con đã bị xoá. Dựng thẳng trong state như
 * `requestSubtaskMaterials` ghi, để không phụ thuộc đọc tồn của Kho.
 */
async function setup() {
  let id = 0;
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-11-21T08:00:00.000Z') },
    // Mã hồ sơ lấy 6 ký tự đầu của id: đặt số đếm lên đầu để mỗi hồ sơ một mã.
    { next: () => `${(id += 1).toString().padStart(6, '0')}-id` },
  );
  const draft = await application.createDefinition(admin, definitionInput());
  const published = await application.publishDefinition(admin, draft.id);
  const start = (key: string, title: string) =>
    application.createInstance(TENANT, { definitionId: published.id, title, idempotencyKey: key, initiatedBy: 'tech' });
  const parent = await start('parent', 'Sửa trạm biến áp');
  const child = await start('child', 'Xin xuất kho cho trạm');
  const purchase = await start('purchase', 'Xin mua');
  const gone = await start('gone', 'Đơn đã xoá');
  await store.transaction(TENANT, (state) => {
    const find = (instanceId: string) => state.instances.find((item) => item.id === instanceId);
    const parentInstance = find(parent.id);
    if (!parentInstance) throw new Error('missing parent');
    parentInstance.assetCode = 'TBA-01';
    for (const linked of [child.id, purchase.id, gone.id]) {
      const instance = find(linked);
      if (!instance) throw new Error('missing child');
      instance.sourceType = 'auto_from_parent';
      instance.sourceId = parent.id;
    }
    const childInstance = find(child.id);
    if (childInstance) childInstance.status = 'completed';
    const goneInstance = find(gone.id);
    if (goneInstance) goneInstance.deletion = { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'admin', reason: 'thử' } as never;
    parentInstance.materialOrders = [
      {
        code: find(child.id)?.code ?? '',
        kind: 'issue',
        createdAt: '2026-11-21T01:00:00.000Z',
        lines: [{ materialCode: 'VT-01', quantity: 2, materialName: 'Cáp', unit: 'm' }],
      },
      { code: find(purchase.id)?.code ?? '', kind: 'purchase', createdAt: '2026-11-21T02:00:00.000Z', lines: [] },
      { code: find(gone.id)?.code ?? '', kind: 'issue', createdAt: '2026-11-21T03:00:00.000Z', lines: [] },
    ];
  });
  return { application, store, parent, child, gone };
}

describe('Đơn vật tư xuất kho cho Kho (thủ kho xử lý toàn bộ yêu cầu)', () => {
  it('liệt kê mọi đơn xuất kho kèm trạng thái hồ sơ con, bỏ đơn mua sắm; hồ sơ con đã xoá thì không có id', async () => {
    const { application, parent, child, gone } = await setup();
    const items = await application.listIssueMaterialOrdersForService(TENANT);

    expect(items.map((item) => item.orderCode)).toEqual([gone.code, child.code]);
    expect(items[1]).toEqual({
      orderCode: child.code,
      createdAt: '2026-11-21T01:00:00.000Z',
      lines: [{ materialCode: 'VT-01', quantity: 2, materialName: 'Cáp', unit: 'm' }],
      instanceId: child.id,
      instanceTitle: 'Xin xuất kho cho trạm',
      instanceStatus: 'completed',
      parentInstanceId: parent.id,
      parentCode: parent.code,
      parentTitle: 'Sửa trạm biến áp',
      assetCode: 'TBA-01',
    });
    expect(items[0].instanceId).toBeUndefined();
  });
});

describe('Kho ghi sổ chứng từ cấp vật tư (inventory.stock.issued)', () => {
  const issued = (sourceId: string | null, patch: Record<string, unknown> = {}) => ({
    documentId: 'doc-1',
    documentCode: 'PX-0001',
    docType: 'ISSUE_PROJECT',
    sourceType: 'procedure_instance',
    sourceId,
    warehouseCode: 'KHO-1',
    reversesDocumentId: null,
    actorUserId: 'keeper',
    lines: [{ materialCode: 'VT-01', quantity: 2 }],
    ...patch,
  });

  it('ghi lời báo đã cấp vào hồ sơ yêu cầu (đã kết thúc) và hồ sơ cha; nhận trùng không ghi thêm', async () => {
    const { application, store, parent, child } = await setup();
    const events = new ProcedureInventoryEvents(application);

    await events.handle(TENANT, 'inventory.stock.issued', issued(child.id));
    await events.handle(TENANT, 'inventory.stock.issued', issued(child.id));

    const state = await store.read(TENANT);
    for (const instanceId of [child.id, parent.id]) {
      const notes = state.instances
        .find((item) => item.id === instanceId)
        ?.activity.filter((entry) => entry.summary.startsWith('Kho đã cấp vật tư'));
      expect(notes).toHaveLength(1);
      expect(notes?.[0]).toMatchObject({
        action: 'comment',
        actorId: 'keeper',
        actorName: 'Kho',
        summary: `Kho đã cấp vật tư theo yêu cầu ${child.code}: chứng từ PX-0001, kho KHO-1 (VT-01 2).`,
      });
    }
  });

  it('bỏ qua chứng từ không trỏ tới hồ sơ Quy trình, chứng từ đảo, loại sự kiện khác, hồ sơ không có', async () => {
    const { application, store, child } = await setup();
    const events = new ProcedureInventoryEvents(application);
    const before = JSON.stringify(await store.read(TENANT));

    await events.handle(TENANT, 'inventory.stock.issued', issued(child.id, { sourceType: 'crm_delivery' }));
    await events.handle(TENANT, 'inventory.stock.issued', issued(child.id, { reversesDocumentId: 'doc-0' }));
    await events.handle(TENANT, 'inventory.stock.returned', issued(child.id));
    await events.handle(TENANT, 'inventory.stock.issued', issued('khong-co'));
    await events.handle(TENANT, 'inventory.stock.issued', { sourceId: child.id });

    expect(JSON.stringify(await store.read(TENANT))).toBe(before);
  });
});
