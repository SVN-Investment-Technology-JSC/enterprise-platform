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
    tenantId: 'tenant-withdraw',
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
const manager = person('ql-truc-tiep'); // A của bước 3
const director = person('lanh-dao'); // A của bước 4

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

/** Tạo đơn → Kế toán kiểm tra (R) rồi Kế toán trưởng duyệt (A) → Quản lý duyệt → Lãnh đạo duyệt (bước cuối). */
const DEFINITION: CreateProcedureDefinitionRequest = {
  code: 'THANH-TOAN',
  name: 'Thanh toán',
  kind: 'process',
  category: 'finance',
  steps: [
    step('TAO', 1, 'Tạo đơn', [assign('S', requester.userId)]),
    step('KT', 2, 'Kế toán kiểm tra, Kế toán trưởng duyệt', [assign('R', checker.userId), assign('A', chief.userId)]),
    step('QL', 3, 'QL trực tiếp duyệt', [assign('A', manager.userId)]),
    step('LD', 4, 'Lãnh đạo duyệt', [assign('A', director.userId)]),
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
  const act = (actor: ProcedureActor, action: 'complete' | 'approve' | 'withdraw' | 'return', comment?: string) =>
    application.applyAction(actor, started.id, { action, comment, idempotencyKey: `k-${(counter += 1)}` });
  const view = (actor: ProcedureActor) => application.getInstance(actor, started.id);
  return { application, started, act, view };
}

const currentKey = (instance: ProcedureInstance) =>
  instance.steps.find((item) => item.id === instance.currentStepId)?.key;
const status = (instance: ProcedureInstance, key: string) => instance.steps.find((item) => item.key === key)?.status;
const stage = (instance: ProcedureInstance, key: string) =>
  instance.steps.find((item) => item.key === key)?.currentRoleStage;

describe('Hoàn duyệt', () => {
  it('người vừa hoàn tất bước đầu rút lại được khi bước kế chưa ai xử lý', async () => {
    const { act, view } = await setup();
    const submitted = await act(requester, 'complete');
    expect(currentKey(submitted)).toBe('KT');
    expect((await view(requester)).authorization?.canWithdraw).toBe(true);
    expect((await view(requester)).authorization?.withdrawStepName).toBe('Tạo đơn');
    // Người khác, kể cả người đang giữ bước kế, không có quyền rút lại lần duyệt của người khác.
    expect((await view(checker)).authorization?.canWithdraw).toBeFalsy();
    expect((await view(chief)).authorization?.canWithdraw).toBeFalsy();

    const back = await act(requester, 'withdraw', 'Nhầm số tiền');
    expect(currentKey(back)).toBe('TAO');
    expect(status(back, 'TAO')).toBe('active');
    expect(status(back, 'KT')).toBe('pending');
    expect(back.activity[0]).toMatchObject({
      action: 'withdraw',
      actorId: requester.userId,
      comment: 'Nhầm số tiền',
      stepInstanceId: back.steps.find((item) => item.key === 'TAO')?.id,
    });
    // Rút xong thì không rút tiếp được, và người nộp làm lại được bình thường.
    expect((await view(requester)).authorization?.canWithdraw).toBeFalsy();
    await expect(act(requester, 'withdraw')).rejects.toThrow('Không hoàn duyệt được');
    const again = await act(requester, 'complete');
    expect(currentKey(again)).toBe('KT');
    expect(stage(again, 'KT')).toBe('R');
  });

  it('xong một pha mà pha sau cùng bước chưa ai làm thì lùi về đúng pha đó', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    const checked = await act(checker, 'complete');
    expect(currentKey(checked)).toBe('KT');
    expect(stage(checked, 'KT')).toBe('A');
    expect((await view(checker)).authorization?.canWithdraw).toBe(true);
    // Người nộp không còn là người vừa duyệt.
    expect((await view(requester)).authorization?.canWithdraw).toBeFalsy();

    const back = await act(checker, 'withdraw');
    expect(currentKey(back)).toBe('KT');
    expect(stage(back, 'KT')).toBe('R');
    expect(status(back, 'KT')).toBe('active');
    // Kế toán trưởng không còn việc chờ mình.
    expect((await view(chief)).authorization?.availableActions).toEqual([]);
  });

  it('duyệt xong cả bước thì rút lại được khi bước kế chưa ai xử lý, bước kế quay về chưa bắt đầu', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    const approved = await act(chief, 'approve');
    expect(currentKey(approved)).toBe('QL');
    expect(status(approved, 'KT')).toBe('completed');
    expect((await view(chief)).authorization?.canWithdraw).toBe(true);
    expect((await view(chief)).authorization?.withdrawStepName).toBe('Kế toán kiểm tra, Kế toán trưởng duyệt');

    const back = await act(chief, 'withdraw');
    expect(currentKey(back)).toBe('KT');
    // Bước chỉ có đúng pha duyệt cuối được mở lại; người duyệt xử lý lại được ngay.
    expect(stage(back, 'KT')).toBe('A');
    expect(status(back, 'KT')).toBe('ready');
    expect(status(back, 'QL')).toBe('pending');
    expect(back.progress?.completed).toBe(1);
    expect((await view(chief)).authorization?.availableActions).toContain('approve');
    expect((await view(manager)).authorization?.availableActions).toEqual([]);

    const redo = await act(chief, 'approve');
    expect(currentKey(redo)).toBe('QL');
    expect(redo.path?.filter((entry) => !entry.supersededAt).map((entry) => redo.steps.find((s) => s.id === entry.stepInstanceId)?.key)).toEqual(['TAO', 'KT', 'QL']);
  });

  it('bước kế đã có người xử lý thì không hoàn duyệt được nữa', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    await act(chief, 'approve');
    const next = await act(manager, 'approve');
    expect(currentKey(next)).toBe('LD');
    // Thao tác gần nhất là của người quản lý, không còn là của Kế toán trưởng.
    expect((await view(chief)).authorization?.canWithdraw).toBeFalsy();
    await expect(act(chief, 'withdraw')).rejects.toThrow('Không hoàn duyệt được');
    // Người quản lý vừa duyệt thì rút lại được.
    expect((await view(manager)).authorization?.canWithdraw).toBe(true);
  });

  it('bước kế đã trả hồ sơ lại thì không ai hoàn duyệt bước cũ', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    await act(chief, 'approve');
    await act(manager, 'return');
    expect((await view(chief)).authorization?.canWithdraw).toBeFalsy();
    expect((await view(manager)).authorization?.canWithdraw).toBeFalsy();
  });

  it('bước cuối duyệt xong, hồ sơ hoàn tất thì không hoàn duyệt được', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    await act(checker, 'complete');
    await act(chief, 'approve');
    await act(manager, 'approve');
    const done = await act(director, 'approve');
    expect(done.status).toBe('completed');
    expect((await view(director)).authorization?.canWithdraw).toBeFalsy();
    await expect(act(director, 'withdraw')).rejects.toThrow();
  });

  it('hồ sơ chờ người hoàn duyệt không bị tính là việc chờ người đó xử lý', async () => {
    const { act, view } = await setup();
    await act(requester, 'complete');
    const mine = await view(requester);
    expect(mine.authorization?.canWithdraw).toBe(true);
    expect(mine.authorization?.availableActions).toEqual([]);
  });
});
