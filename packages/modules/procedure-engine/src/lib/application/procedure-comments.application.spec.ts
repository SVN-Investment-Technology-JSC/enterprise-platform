import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

const TENANT = 'tenant-chat';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-09T08:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `id-${this.value.toString().padStart(5, '0')}`;
  }
}

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: TENANT,
    userId,
    membershipId: userId,
    displayName: userId,
    canDesign: false,
    canPublish: false,
    canCreateInstances: true,
    isOverride: false,
    organizationUnitIds: [],
    positionIds: [],
    ...extra,
  };
}

const admin = person('admin', { canDesign: true, canPublish: true, isOverride: true });
const employee = person('nhan-vien');
const approver = person('truong-phong');
const outsider = person('nguoi-la');

const definition: CreateProcedureDefinitionRequest = {
  code: 'DE-NGHI',
  name: 'Đề nghị',
  kind: 'process',
  category: 'hr',
  steps: [
    {
      key: 'LAP',
      order: 1,
      name: 'Lập đề nghị',
      assignments: [{ role: 'S', subjectType: 'user', subjectId: employee.userId }],
    },
    {
      key: 'DUYET',
      order: 2,
      name: 'Phê duyệt',
      assignments: [{ role: 'A', subjectType: 'user', subjectId: approver.userId }],
    },
  ],
};

async function running() {
  const application = new ProcedureEngineApplication(
    new InMemoryProcedureStore(),
    new FixedClock(),
    new SequentialIds(),
  );
  const draft = await application.createDefinition(admin, definition);
  const published = await application.publishDefinition(admin, draft.id);
  const instance = await application.startInstance(employee, {
    definitionId: published.id,
    title: 'Đề nghị mua máy',
    idempotencyKey: 'start-1',
  });
  return { application, instance };
}

describe('Trao đổi trong hồ sơ — nhắc tên và làm mới', () => {
  it('lưu danh sách người được nhắc đã làm sạch (bỏ trùng, id lạ)', async () => {
    const { application, instance } = await running();
    const result = await application.postComment(employee, instance.id, {
      body: 'Nhờ anh duyệt',
      idempotencyKey: 'c1',
      mentions: [approver.userId, approver.userId, 'a b', "x'; DROP", ''],
    });
    expect(result.activity[0]).toMatchObject({ action: 'comment', mentions: [approver.userId] });
  });

  it('không lưu `mentions` rỗng khi mọi phần tử đều sai', async () => {
    const { application, instance } = await running();
    const result = await application.postComment(employee, instance.id, {
      body: 'Không nhắc ai',
      idempotencyKey: 'c2',
      mentions: ['a b', ''],
    });
    expect(result.activity[0].mentions).toBeUndefined();
  });

  it('getInstance: người tham gia nhận đúng hồ sơ kèm quyền; người ngoài nhận 404', async () => {
    const { application, instance } = await running();
    const seen = await application.getInstance(approver, instance.id);
    expect(seen.id).toBe(instance.id);
    expect(seen.authorization).toBeDefined();
    await expect(application.getInstance(outsider, instance.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(application.getInstance(employee, 'khong-ton-tai')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('getChatAccess: người tham gia được vào phòng, hồ sơ đang chạy thì được gửi tin', async () => {
    const { application, instance } = await running();
    await expect(application.getChatAccess(employee, instance.id)).resolves.toEqual({
      canComment: true,
    });
    await expect(application.getChatAccess(approver, instance.id)).resolves.toEqual({
      canComment: true,
    });
  });

  it('getChatAccess: người ngoài bị từ chối như hồ sơ không tồn tại (không lộ việc hồ sơ có tồn tại)', async () => {
    const { application, instance } = await running();
    await expect(application.getChatAccess(outsider, instance.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(application.getChatAccess(outsider, 'khong-ton-tai')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('getChatAccess: hồ sơ đã kết thúc vẫn cho đọc nhưng không cho gửi tin', async () => {
    const { application, instance } = await running();
    await application.applyAction(employee, instance.id, { action: 'complete', idempotencyKey: 'k1' });
    await application.applyAction(approver, instance.id, { action: 'approve', idempotencyKey: 'k2' });
    await expect(application.getChatAccess(employee, instance.id)).resolves.toEqual({
      canComment: false,
    });
  });
});
