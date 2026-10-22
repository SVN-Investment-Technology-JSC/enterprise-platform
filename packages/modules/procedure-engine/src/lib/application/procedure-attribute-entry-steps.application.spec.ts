import type {
  CreateProcedureDefinitionRequest,
  ProcedureAttributeDefinition,
  ProcedureInstance,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-22T08:00:00.000Z');
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
    tenantId: 'tenant-entry',
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

const designer = person('designer', { canDesign: true, canPublish: true, isOverride: true });
const staff = person('nv');
const manager = person('ql');
const accountant = person('kt');

function assign(role: ProcedureRaciRole, userId: string) {
  return { role, subjectType: 'user' as const, subjectId: userId };
}

function paymentInput(attributes: ProcedureAttributeDefinition[]): CreateProcedureDefinitionRequest {
  return {
    code: 'DE-NGHI-TT',
    name: 'Đề nghị thanh toán',
    kind: 'process',
    category: 'finance',
    steps: [
      { key: 'LAP', order: 1, name: 'Lập đề nghị', assignments: [assign('S', staff.userId)] },
      { key: 'DUYET', order: 2, name: 'Quản lý duyệt', assignments: [assign('A', manager.userId)] },
      { key: 'CHI', order: 3, name: 'Chi tiền', assignments: [assign('R', accountant.userId)] },
    ],
    attributes,
  };
}

const amount: ProcedureAttributeDefinition = {
  id: '',
  code: 'so_tien',
  name: 'Số tiền',
  type: 'money',
  required: true,
  entryStepKeys: ['LAP'],
};
const approvalNote: ProcedureAttributeDefinition = {
  id: '',
  code: 'y_kien_duyet',
  name: 'Ý kiến duyệt',
  type: 'text',
  required: true,
  entryStepKeys: ['duyet '],
};
const reference: ProcedureAttributeDefinition = { id: '', code: 'tham_chieu', name: 'Tham chiếu', type: 'text', required: false };

function setup() {
  const application = new ProcedureEngineApplication(new InMemoryProcedureStore(), new FixedClock(), new SequentialIds());
  return { application };
}

async function publish(application: ProcedureEngineApplication) {
  const draft = await application.createDefinition(designer, paymentInput([amount, approvalNote, reference]));
  return application.publishDefinition(designer, draft.id);
}

const editable = (instance: ProcedureInstance) => [...(instance.authorization?.editableAttributeKeys ?? [])].sort();

describe('Thuộc tính quy trình nhập ở bước được chọn', () => {
  it('chuẩn hoá mã bước nhập và bỏ mã của bước không tồn tại', async () => {
    const { application } = setup();
    const draft = await application.createDefinition(
      designer,
      paymentInput([{ ...approvalNote, entryStepKeys: ['duyet ', 'KHONG_CO', 'DUYET'] }, reference]),
    );
    expect(draft.attributes?.find((item) => item.code === 'y_kien_duyet')?.entryStepKeys).toEqual(['DUYET']);
    expect(draft.attributes?.find((item) => item.code === 'tham_chieu')?.entryStepKeys).toBeUndefined();
  });

  it('mỗi bước chỉ mở ô của thuộc tính chọn bước đó, thuộc tính không chọn bước thì mở ở mọi bước', async () => {
    const { application } = setup();
    const definition = await publish(application);
    const started = await application.startInstance(staff, {
      definitionId: definition.id,
      title: 'Mua văn phòng phẩm',
      idempotencyKey: 'start-1',
    });
    const atSubmit = (await application.getWorkspace(staff)).instances.find((item) => item.id === started.id);
    expect(editable(atSubmit as ProcedureInstance)).toEqual(['process:so_tien', 'process:tham_chieu']);

    await expect(
      application.applyAction(staff, started.id, {
        action: 'complete',
        idempotencyKey: 'submit-wrong',
        attributeValues: {
          'process:so_tien': { type: 'money', value: 1_000_000 },
          'process:y_kien_duyet': { type: 'text', value: 'Tự duyệt' },
        },
      }),
    ).rejects.toThrow(/không được nhập “Ý kiến duyệt”/);

    await application.applyAction(staff, started.id, {
      action: 'complete',
      idempotencyKey: 'submit-1',
      attributeValues: { 'process:so_tien': { type: 'money', value: 1_000_000 } },
    });
    const atApproval = (await application.getWorkspace(manager)).instances.find((item) => item.id === started.id);
    expect(editable(atApproval as ProcedureInstance)).toEqual(['process:tham_chieu', 'process:y_kien_duyet']);
  });

  it('thuộc tính bắt buộc kiểm khi rời bước nhập của nó, không kiểm ở bước đầu', async () => {
    const { application } = setup();
    const definition = await publish(application);
    const started = await application.startInstance(staff, {
      definitionId: definition.id,
      title: 'Mua máy in',
      idempotencyKey: 'start-2',
    });
    await application.applyAction(staff, started.id, {
      action: 'complete',
      idempotencyKey: 'submit-2',
      attributeValues: { 'process:so_tien': { type: 'money', value: 5_000_000 } },
    });

    await expect(
      application.applyAction(manager, started.id, { action: 'approve', idempotencyKey: 'approve-missing' }),
    ).rejects.toThrow(/Cần nhập “Ý kiến duyệt”/);

    const approved = await application.applyAction(manager, started.id, {
      action: 'approve',
      idempotencyKey: 'approve-2',
      attributeValues: { 'process:y_kien_duyet': { type: 'text', value: 'Đồng ý chi' } },
    });
    expect(approved.steps.find((step) => step.key === 'DUYET')?.status).toBe('completed');
  });

  it('điểm rẽ nhánh không được dùng thuộc tính chỉ nhập ở bước phía sau', async () => {
    const { application } = setup();
    const input = paymentInput([amount, approvalNote]);
    input.gateways = [
      {
        id: '',
        key: 'G_Y_KIEN',
        name: 'Theo ý kiến duyệt',
        type: 'exclusive',
        afterStepId: 'LAP',
        branches: [
          {
            id: '',
            key: 'CO_Y_KIEN',
            label: 'Có ý kiến',
            isDefault: false,
            condition: {
              combinator: 'and',
              rules: [{ id: '', attribute: { scope: 'process', code: 'y_kien_duyet' }, operator: 'not_empty' }],
            },
            stepIds: ['DUYET'],
          },
          { id: '', key: 'KHAC', label: 'Ngược lại', isDefault: true, stepIds: [] },
        ],
      },
    ];
    const draft = await application.createDefinition(designer, input);
    await expect(application.publishDefinition(designer, draft.id)).rejects.toThrow(
      /không bước nhập nào của thuộc tính này chắc chắn đã đi qua/,
    );
  });

  it('không nhận lúc mở hồ sơ giá trị của thuộc tính không nhập ở bước đầu', async () => {
    const { application } = setup();
    const definition = await publish(application);
    await expect(
      application.startInstance(staff, {
        definitionId: definition.id,
        title: 'Mở kèm ý kiến duyệt',
        idempotencyKey: 'start-3',
        processAttributeValues: { y_kien_duyet: { type: 'text', value: 'Đồng ý' } },
      }),
    ).rejects.toThrow(/không nhập ở bước đầu/);
  });
});
