import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureInstance,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

/** Hồ sơ người dùng tự mở phải gắn dự án (luật bắt buộc chọn dự án). */
const TEST_WORKSPACE_LINK = { projectId: '0a0a0a0a-0000-4000-8000-00000000d001', projectCode: 'DA-TEST' };

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-11-27T08:00:00.000Z');
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
    tenantId: 'tenant-step-part',
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
const requester = person('nguoi-tao');
const checker = person('ke-toan'); // R của bước 2
const chief = person('ke-toan-truong'); // A của bước 2
const watcher = person('theo-doi'); // I của bước 2
const manager = person('ql-truc-tiep'); // A của bước 3

const assign = (role: ProcedureRaciRole, userId: string) => ({
  role,
  subjectType: 'user' as const,
  subjectId: userId,
});
const step = (key: string, order: number, name: string, assignments: CreateProcedureStepInput['assignments']) => ({
  key,
  order,
  name,
  assignments,
});

/** Tạo đơn → Kế toán kiểm tra (R) rồi Kế toán trưởng duyệt (A), có người theo dõi (I) → Quản lý duyệt. */
const DEFINITION: CreateProcedureDefinitionRequest = {
  code: 'THANH-TOAN',
  name: 'Thanh toán',
  kind: 'process',
  category: 'finance',
  steps: [
    step('TAO', 1, 'Tạo đơn', [assign('S', requester.userId)]),
    step('KT', 2, 'Kế toán kiểm tra, Kế toán trưởng duyệt', [
      assign('R', checker.userId),
      assign('A', chief.userId),
      assign('I', watcher.userId),
    ]),
    step('QL', 3, 'QL trực tiếp duyệt', [assign('A', manager.userId)]),
  ],
};

async function setup() {
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(store, new FixedClock(), new SequentialIds());
  const draft = await application.createDefinition(designer, DEFINITION);
  const definition = await application.publishDefinition(designer, draft.id);
  const started = await application.startInstance(requester, {
    workspaceLink: TEST_WORKSPACE_LINK,
    definitionId: definition.id,
    title: 'Thanh toán chi phí đi lại',
    idempotencyKey: 'start',
  });
  let counter = 0;
  const act = (actor: ProcedureActor, action: 'complete' | 'approve' | 'withdraw') =>
    application.applyAction(actor, started.id, { action, idempotencyKey: `k-${(counter += 1)}` });
  const view = (actor: ProcedureActor) => application.getInstance(actor, started.id);
  const part = async (actor: ProcedureActor) => (await view(actor)).authorization?.currentStepPart;
  return { application, act, view, part };
}

const stepId = (instance: ProcedureInstance, key: string) => instance.steps.find((item) => item.key === key)?.id;

describe('Phần của tôi ở bước hiện tại (danh sách "Hồ sơ cần bạn xử lý")', () => {
  it('mọi người làm cùng bước đều có phần: người tới lượt, người sắp tới lượt; vai I và người nộp thì không', async () => {
    const { act, view, part } = await setup();
    // Bước nộp đơn: vai S không tính (người nộp vẫn thấy hồ sơ qua quyền thao tác `availableActions`).
    expect(await part(requester)).toBeUndefined();
    expect(await part(checker)).toBeUndefined();

    await act(requester, 'complete');
    expect(await part(checker)).toBe('act');
    expect(await part(chief)).toBe('upcoming');
    // Người nộp (vai S ở bước đầu) và người chỉ theo dõi (vai I) không có phần việc ở bước này.
    expect(await part(requester)).toBeUndefined();
    expect(await part(watcher)).toBeUndefined();
    expect(await part(manager)).toBeUndefined();
    // Sắp tới lượt chỉ để hiển thị: chưa được thao tác gì.
    expect((await view(chief)).authorization?.availableActions).toEqual([]);
  });

  it('người R làm xong vẫn thấy hồ sơ (đã xong phần mình) tới khi người A duyệt xong bước', async () => {
    const { act, view, part } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    expect(await part(checker)).toBe('done');
    expect(await part(chief)).toBe('act');
    // Không được thao tác thêm: quyền vẫn theo pha hiện tại.
    expect((await view(checker)).authorization?.availableActions).toEqual([]);

    await act(chief, 'approve');
    // Bước đã xong, hồ sơ sang bước của quản lý: hai người của bước cũ không còn phần ở bước hiện tại.
    expect(await part(checker)).toBeUndefined();
    expect(await part(chief)).toBeUndefined();
    expect(await part(manager)).toBe('act');
  });

  it('hồ sơ kết thúc thì không ai còn phần việc', async () => {
    const { act, part } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    await act(chief, 'approve');
    await act(manager, 'approve');
    expect(await part(manager)).toBeUndefined();
  });
});

describe('Hoàn duyệt trỏ đúng bước sẽ mở lại', () => {
  it('duyệt xong cả bước: withdrawStepId là bước vừa xong, không phải bước hiện tại', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    const approved = await act(chief, 'approve');
    const mine = (await view(chief)).authorization;
    expect(mine?.canWithdraw).toBe(true);
    expect(mine?.withdrawStepId).toBe(stepId(approved, 'KT'));
    expect(mine?.withdrawStepId).not.toBe(approved.currentStepId);
    // Ở bước hiện tại người này không giữ vai nào.
    expect(mine?.myRoles).toEqual([]);
  });

  it('xong một pha trong bước: withdrawStepId là chính bước hiện tại', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    const checked = await act(checker, 'complete');
    const mine = (await view(checker)).authorization;
    expect(mine?.withdrawStepId).toBe(checked.currentStepId);
  });

  it('không hoàn duyệt được thì không có withdrawStepId', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    expect((await view(checker)).authorization?.withdrawStepId).toBeUndefined();
  });
});
