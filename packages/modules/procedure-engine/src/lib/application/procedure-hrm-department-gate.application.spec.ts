import type {
  CreateProcedureDefinitionRequest,
  ProcedureGatewayDefinition,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

/**
 * FIX-E-05: thuộc tính cấp quy trình do HRM cấp từ ngữ cảnh nhân viên (phòng ban) phải điều khiển cổng
 * điều kiện ở bước S. HRM gửi khóa `process:<mã>`; ở đây mô phỏng đúng khóa/giá trị đó.
 */
const TENANT = 'tenant-dept';
class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-05T08:00:00.000Z');
  }
}
class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `id-${this.value.toString().padStart(5, '0')}`;
  }
}
const designer: ProcedureActor = {
  tenantId: TENANT,
  userId: 'designer',
  membershipId: 'designer',
  displayName: 'designer',
  canDesign: true,
  canPublish: true,
  canCreateInstances: true,
  isOverride: true,
  organizationUnitIds: [],
  positionIds: [],
};
const user = (role: 'S' | 'A', userId: string, label?: string) => ({
  role,
  subjectType: 'user' as const,
  subjectId: userId,
  subjectLabel: label,
});

function definition(): CreateProcedureDefinitionRequest {
  const gateway: ProcedureGatewayDefinition = {
    id: '',
    key: 'G_PHONG_BAN',
    name: 'Theo phòng ban',
    type: 'exclusive',
    afterStepId: 'NOP_DON',
    branches: [
      {
        id: '',
        key: 'KE_TOAN',
        label: 'Phòng Kế toán',
        isDefault: false,
        condition: {
          combinator: 'and',
          rules: [{ id: '', attribute: { scope: 'process', code: 'phong_ban' }, operator: 'is', value: 'KE_TOAN' }],
        },
        stepIds: ['DUYET_KT'],
      },
      { id: '', key: 'KHAC', label: 'Phòng khác', isDefault: true, stepIds: ['DUYET_CHUNG'] },
    ],
  };
  return {
    code: 'DON-PB',
    name: 'Đơn theo phòng ban',
    kind: 'process',
    category: 'hr',
    attributes: [
      {
        id: '',
        code: 'phong_ban',
        name: 'Phòng ban',
        type: 'select',
        required: false,
        options: [
          { code: 'KE_TOAN', label: 'Kế toán' },
          { code: 'KINH_DOANH', label: 'Kinh doanh' },
        ],
      },
    ],
    steps: [
      { key: 'NOP_DON', order: 1, name: 'Nộp đơn', assignments: [user('S', 'nhan-vien')] },
      { key: 'DUYET_KT', order: 2, name: 'Kế toán trưởng duyệt', assignments: [user('A', 'ke-toan-truong', 'Kế toán trưởng')] },
      { key: 'DUYET_CHUNG', order: 3, name: 'Trưởng phòng duyệt', assignments: [user('A', 'truong-phong', 'Trưởng phòng')] },
    ],
    gateways: [gateway],
  };
}

describe('FIX-E-05 - cổng điều kiện theo phòng ban do HRM cấp', () => {
  async function start(department: string) {
    const store = new InMemoryProcedureStore();
    const application = new ProcedureEngineApplication(store, new FixedClock(), new SequentialIds());
    const published = await application.publishDefinition(
      designer,
      (await application.createDefinition(designer, definition())).id,
    );
    const created = await application.createInstance(TENANT, {
      definitionId: published.id,
      title: 'Đơn nghỉ phép',
      sourceType: 'hrm_request',
      sourceId: `req-${department}`,
      initiatedBy: 'nhan-vien',
      initiatedByName: 'Nhân viên',
      idempotencyKey: `req-${department}`,
      expectedDefinitionSnapshot: published,
      attributeValues: { 'process:phong_ban': { type: 'select', value: department } },
      autoCompleteInitiatorStep: true,
    });
    const instance = (await store.read(TENANT)).instances.find((item) => item.id === created.id) as ProcedureInstance;
    return { created, instance };
  }

  it('nhân viên phòng Kế toán đi nhánh Kế toán', async () => {
    const { created } = await start('KE_TOAN');
    expect(created.currentStepName).toBe('Kế toán trưởng duyệt');
  });

  it('nhân viên phòng khác đi nhánh mặc định', async () => {
    const { created, instance } = await start('KINH_DOANH');
    expect(created.currentStepName).toBe('Trưởng phòng duyệt');
    expect(instance.steps.find((item) => item.key === 'DUYET_KT')?.status).toBe('skipped');
  });
});

describe('FIX-E-05 - canAct trong tiến độ nội bộ', () => {
  it('trả canAct theo người được giao bước hiện tại; không truyền actorUserId thì không có canAct', async () => {
    const store = new InMemoryProcedureStore();
    const resolver = {
      resolve: async (_tenant: string, userId: string): Promise<ProcedureActor | null> =>
        userId === 'khong-ro' ? null : { ...designer, userId, membershipId: userId, canDesign: false, canPublish: false, isOverride: false },
    };
    const application = new ProcedureEngineApplication(
      store,
      new FixedClock(),
      new SequentialIds(),
      undefined,
      undefined,
      undefined,
      resolver,
    );
    const published = await application.publishDefinition(
      designer,
      (await application.createDefinition(designer, definition())).id,
    );
    const created = await application.createInstance(TENANT, {
      definitionId: published.id,
      title: 'Đơn',
      sourceType: 'hrm_request',
      sourceId: 'req-can-act',
      initiatedBy: 'nhan-vien',
      initiatedByName: 'Nhân viên',
      idempotencyKey: 'req-can-act',
      expectedDefinitionSnapshot: published,
      attributeValues: { 'process:phong_ban': { type: 'select', value: 'KINH_DOANH' } },
      autoCompleteInitiatorStep: true,
    });
    const asManager = await application.getInstanceProgressForService(TENANT, created.id, 'truong-phong');
    const asOther = await application.getInstanceProgressForService(TENANT, created.id, 'nguoi-khac');
    const asUnknown = await application.getInstanceProgressForService(TENANT, created.id, 'khong-ro');
    const anonymous = await application.getInstanceProgressForService(TENANT, created.id);
    expect(asManager.canAct).toBe(true);
    expect(asOther.canAct).toBe(false);
    expect(asUnknown.canAct).toBe(false);
    expect(anonymous.canAct).toBeUndefined();
  });
});
