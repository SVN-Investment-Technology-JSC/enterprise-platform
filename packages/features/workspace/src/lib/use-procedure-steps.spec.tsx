import { act, render } from '@testing-library/react';
import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';
import { publishRealtimeEvent, registerRealtimeSender } from '@enterprise-platform/shared-ui';
import { getWorkItemProcedureSteps } from './workspace-api';
import { useProcedureSteps } from './use-procedure-steps';

jest.mock('./workspace-api', () => ({
  getWorkItemProcedureSteps: jest.fn(),
  getStandaloneTaskProcedureSteps: jest.fn(),
}));

const load = getWorkItemProcedureSteps as jest.MockedFunction<typeof getWorkItemProcedureSteps>;
const steps = (status = 'running'): WorkItemProcedureSteps => ({
  linked: true,
  available: true,
  instanceId: 'i1',
  status,
  steps: [],
  events: [],
});

function Probe() {
  useProcedureSteps('work-item', 'w1');
  return null;
}

const changed = (instanceId: string) =>
  publishRealtimeEvent({
    id: 'e1',
    event: 'procedure.instance.changed',
    version: 1,
    tenantId: 't',
    userId: 'u2',
    sequence: 1,
    occurredAt: '2026-11-27T00:00:00.000Z',
    data: { instanceId, actorUserId: 'u2' },
  });

const settle = () => act(async () => undefined);

describe('useProcedureSteps', () => {
  const sender = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    load.mockReset();
    load.mockResolvedValue(steps());
    sender.mockReset();
    registerRealtimeSender(sender);
  });
  afterEach(() => {
    registerRealtimeSender(undefined);
    jest.useRealTimers();
  });

  it('vào phòng của hồ sơ và nạp lại khi có tín hiệu của đúng hồ sơ đó', async () => {
    const view = render(<Probe />);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith('procedure.subscribe', { instanceId: 'i1' });

    act(() => {
      changed('i2');
      changed('i1');
      changed('i1');
    });
    act(() => jest.advanceTimersByTime(400));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(sender).toHaveBeenCalledWith('procedure.unsubscribe', { instanceId: 'i1' });
  });

  it('quay lại tab thì nạp lại ngay khi hồ sơ còn chạy, một lần dù focus và visibilitychange cùng đến', async () => {
    render(<Probe />);
    await settle();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('hồ sơ đã xong thì không nạp lại khi quay lại tab', async () => {
    load.mockResolvedValue(steps('completed'));
    render(<Probe />);
    await settle();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
