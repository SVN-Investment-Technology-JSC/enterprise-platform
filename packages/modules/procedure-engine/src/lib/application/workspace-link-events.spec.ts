import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  INSTANCE_REVERSAL_FAILED,
  STANDALONE_TASK_PROCEDURE_REQUESTED,
  STANDALONE_TASK_REVERSED,
  STANDALONE_TASK_START_REJECTED_EVENT,
  STARTED_FOR_STANDALONE_TASK_EVENT,
  workspaceLinkEvents,
} from '../domain/procedure-workspace-link.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';
import { PROCEDURE_WORKSPACE_EVENT_TYPES, ProcedureWorkspaceEvents } from './workspace-link-events.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';

const request = {
  taskId: TASK_ID,
  taskCode: 'GV012',
  title: 'Mua vật tư',
  definitionId: '22222222-2222-4222-8222-222222222222',
  requestedBy: '33333333-3333-4333-8333-333333333333',
  requestedByName: 'Người giao',
  requestedByIsTenantAdmin: false,
};

describe('Quy trình ↔ việc ngoài dự án', () => {
  it('lắng nghe sự kiện nhờ mở hồ sơ của việc ngoài dự án', () => {
    expect(PROCEDURE_WORKSPACE_EVENT_TYPES).toContain(STANDALONE_TASK_PROCEDURE_REQUESTED);
  });

  it('mở hồ sơ qua đúng ứng dụng Quy trình; không mở được thì báo lại Workspace', async () => {
    const emitted: { type: string; payload: Record<string, unknown> }[] = [];
    const procedures = {
      startForWorkspaceStandaloneTask: jest
        .fn()
        .mockResolvedValueOnce({ ok: true, instance: { id: 'i1' } })
        .mockResolvedValueOnce({ ok: false, reason: 'Thiếu vai S' }),
    } as unknown as ProcedureEngineApplication;
    const events = new ProcedureWorkspaceEvents(procedures, async (_tenant, input) => {
      emitted.push(input);
    });

    await events.handle('t1', STANDALONE_TASK_PROCEDURE_REQUESTED, request);
    expect(procedures.startForWorkspaceStandaloneTask).toHaveBeenCalledWith('t1', request);
    expect(emitted).toEqual([]);

    await events.handle('t1', STANDALONE_TASK_PROCEDURE_REQUESTED, request);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: STANDALONE_TASK_START_REJECTED_EVENT,
        payload: { taskId: TASK_ID, reason: 'Thiếu vai S' },
      }),
    ]);
  });

  it('hồ sơ mới mở cho việc ngoài dự án phát sự kiện "đã mở" kèm mã hồ sơ', () => {
    const instance = {
      id: 'i1',
      code: 'PR-001',
      title: 'GV012-Mua vật tư',
      status: 'running',
      sourceType: 'workspace_standalone_task',
      sourceId: TASK_ID,
    } as unknown as ProcedureInstance;
    expect(workspaceLinkEvents([], [instance])).toEqual([
      {
        type: STARTED_FOR_STANDALONE_TASK_EVENT,
        aggregateId: 'i1',
        payload: { taskId: TASK_ID, instanceId: 'i1', instanceCode: 'PR-001' },
      },
    ]);
    // Cùng hồ sơ ở lần ghi sau thì không phát lại.
    expect(workspaceLinkEvents([instance], [instance])).toEqual([]);
  });
});

describe('huỷ hiệu lực việc ngoài dự án', () => {
  const reversed = {
    taskId: TASK_ID,
    taskCode: 'GV012',
    instanceId: 'i1',
    reason: 'Khách huỷ',
    reversedBy: '33333333-3333-4333-8333-333333333333',
    reversedByName: 'Người giao',
  };

  it('lắng nghe sự kiện và huỷ hiệu lực hồ sơ theo', async () => {
    expect(PROCEDURE_WORKSPACE_EVENT_TYPES).toContain(STANDALONE_TASK_REVERSED);
    const procedures = { reverseForService: jest.fn().mockResolvedValue(undefined) } as unknown as ProcedureEngineApplication;
    const events = new ProcedureWorkspaceEvents(procedures, async () => undefined);
    await events.handle('t1', STANDALONE_TASK_REVERSED, reversed);
    expect(procedures.reverseForService).toHaveBeenCalledWith('t1', 'i1', expect.objectContaining({
      reason: 'Công việc GV012 bị huỷ hiệu lực: Khách huỷ',
      createAdjustment: false,
      reversedBy: reversed.reversedBy,
    }));
  });

  it('Quy trình chặn giữa chừng thì báo người yêu cầu đối soát', async () => {
    const emitted: { type: string }[] = [];
    const procedures = {
      reverseForService: jest.fn().mockRejectedValue(new ProcedureEngineError('validation', 'Đã sinh phiếu vật tư')),
    } as unknown as ProcedureEngineApplication;
    const events = new ProcedureWorkspaceEvents(procedures, async (_t, input) => {
      emitted.push(input);
    });
    await events.handle('t1', STANDALONE_TASK_REVERSED, reversed);
    expect(emitted).toEqual([expect.objectContaining({ type: INSTANCE_REVERSAL_FAILED })]);
  });
});
