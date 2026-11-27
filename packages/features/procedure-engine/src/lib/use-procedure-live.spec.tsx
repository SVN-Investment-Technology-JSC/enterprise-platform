/** @jest-environment jsdom */
import { act, render } from '@testing-library/react';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  publishRealtimeEvent,
  publishRealtimeStatus,
  registerRealtimeSender,
  type RealtimeEventEnvelope,
} from '@enterprise-platform/shared-ui';
import {
  PROCEDURE_LIVE_DEBOUNCE_MS,
  PROCEDURE_LIVE_POLL_MS,
  mergeInstances,
  useProcedureLive,
  type ProcedureLiveOptions,
} from './use-procedure-live';

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const signal = (instanceId: string, event: RealtimeEventEnvelope['event'] = 'procedure.instance.changed') =>
  publishRealtimeEvent({
    id: `e-${instanceId}`,
    event,
    version: 1,
    tenantId: 't',
    userId: 'u2',
    sequence: 1,
    occurredAt: '2026-11-27T00:00:00.000Z',
    data: { instanceId, actorUserId: 'u2' },
  });

const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

function Probe(props: ProcedureLiveOptions) {
  useProcedureLive(props);
  return null;
}

const sender = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  visibility = 'visible';
  sender.mockReset();
  registerRealtimeSender(sender);
});

afterEach(() => {
  registerRealtimeSender(undefined);
  jest.useRealTimers();
});

const mount = (props: Partial<ProcedureLiveOptions> = {}) => {
  const onSignal = jest.fn();
  const onPoll = jest.fn();
  const view = render(<Probe roomInstanceId="i1" onSignal={onSignal} onPoll={onPoll} {...props} />);
  return { onSignal, onPoll, view };
};

/** Cho các Promise trong hook (gọi `onSignal`/`onPoll` qua microtask) chạy xong. */
const flush = () => act(async () => undefined);

describe('useProcedureLive', () => {
  it('vào phòng của hồ sơ khi mở, rời phòng khi đóng', () => {
    const { view } = mount();
    expect(sender).toHaveBeenCalledWith('procedure.subscribe', { instanceId: 'i1' });
    view.unmount();
    expect(sender).toHaveBeenCalledWith('procedure.unsubscribe', { instanceId: 'i1' });
  });

  it('gom tín hiệu dồn dập của hồ sơ đang mở thành một lần tải; bỏ hồ sơ khác và sự kiện khác', async () => {
    const { onSignal } = mount();
    act(() => {
      signal('i1');
      signal('i1');
      signal('i2');
      signal('i1', 'procedure.comment.changed');
    });
    expect(onSignal).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_DEBOUNCE_MS));
    await flush();
    expect(onSignal.mock.calls).toEqual([['i1']]);
  });

  it('màn có danh sách: tín hiệu của mọi hồ sơ trong danh sách đều làm mới đúng hồ sơ đó', async () => {
    const listed = new Set(['i1', 'i2']);
    const { onSignal } = mount({ roomInstanceId: undefined, watches: (id) => listed.has(id) });
    expect(sender).not.toHaveBeenCalled();
    act(() => {
      signal('i2');
      signal('i3');
    });
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_DEBOUNCE_MS));
    await flush();
    expect(onSignal.mock.calls).toEqual([['i2']]);
  });

  it('hỏi lại theo nhịp khi tab đang hiện, không hỏi khi tab ở nền hay đang bận', async () => {
    const { onPoll, view, onSignal } = mount();
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    view.rerender(<Probe roomInstanceId="i1" onSignal={onSignal} onPoll={onPoll} paused />);
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    act(() => signal('i1'));
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_DEBOUNCE_MS));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('quay lại tab: tải một lần dù focus và visibilitychange cùng đến; tín hiệu lúc ở nền được bao luôn', async () => {
    const { onPoll, onSignal } = mount();
    act(() => jest.advanceTimersByTime(5_000));
    visibility = 'hidden';
    act(() => signal('i1'));
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_DEBOUNCE_MS));
    expect(onSignal).not.toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_DEBOUNCE_MS));
    await flush();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('realtime nối lại: hỏi lại vì có thể đã lỡ tín hiệu', async () => {
    const { onPoll } = mount();
    act(() => jest.advanceTimersByTime(5_000));
    act(() => publishRealtimeStatus(true));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it('không chồng lần hỏi lại khi lần trước chưa xong', async () => {
    let finish: () => void = () => undefined;
    const onPoll = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    mount({ onPoll });
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    await flush();
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS));
    await flush();
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it('đóng rồi thì không gọi gì nữa', async () => {
    const { onPoll, onSignal, view } = mount();
    act(() => signal('i1'));
    view.unmount();
    act(() => jest.advanceTimersByTime(PROCEDURE_LIVE_POLL_MS * 2));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onPoll).not.toHaveBeenCalled();
    expect(onSignal).not.toHaveBeenCalled();
  });
});

describe('mergeInstances', () => {
  const item = (id: string, status = 'running') =>
    ({ id, status, steps: [], activity: [] }) as unknown as ProcedureInstance;

  it('không đổi gì thì trả lại chính mảng cũ', () => {
    const current = [item('i1'), item('i2')];
    expect(mergeInstances(current, [item('i1'), item('i2')])).toBe(current);
  });

  it('giữ object của hồ sơ không đổi, thay hồ sơ đã đổi, theo thứ tự và tập hồ sơ mới', () => {
    const current = [item('i1'), item('i2')];
    const merged = mergeInstances(current, [item('i3'), item('i1'), item('i2', 'completed')]);
    expect(merged.map((instance) => instance.id)).toEqual(['i3', 'i1', 'i2']);
    expect(merged[1]).toBe(current[0]);
    expect(merged[2]).not.toBe(current[1]);
    expect(merged[2].status).toBe('completed');
  });
});
