import { act, render } from '@testing-library/react';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import {
  getRealtimeStatus,
  publishRealtimeEvent,
  publishRealtimeStatus,
  registerRealtimeSender,
  sendRealtime,
  subscribeRealtime,
  useRealtimeEvent,
  useRealtimeStatus,
} from './realtime-bus';

const envelope = (event: RealtimeEventEnvelope['event']): RealtimeEventEnvelope => ({
  id: 'e1',
  event,
  version: 1,
  tenantId: 't',
  userId: 'u',
  sequence: 1,
  occurredAt: '2026-10-01T00:00:00.000Z',
  data: {},
});

describe('realtime-bus', () => {
  it('delivers to every subscriber and stops after unsubscribe', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = subscribeRealtime(a);
    const offB = subscribeRealtime(b);
    publishRealtimeEvent(envelope('workspace.chat.changed'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    publishRealtimeEvent(envelope('workspace.chat.changed'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('keeps delivering when one subscriber throws', () => {
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    const offBad = subscribeRealtime(bad);
    const offGood = subscribeRealtime(good);
    expect(() => publishRealtimeEvent(envelope('workspace.chat.changed'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it('useRealtimeEvent filters by event name, reports status, and cleans up on unmount', () => {
    const onEvent = jest.fn();
    const onStatus = jest.fn();
    function Probe() {
      useRealtimeEvent('workspace.chat.changed', onEvent, onStatus);
      return null;
    }
    const view = render(<Probe />);

    act(() => {
      publishRealtimeEvent(envelope('notification.created'));
      publishRealtimeEvent(envelope('workspace.chat.changed'));
      publishRealtimeStatus(true);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(true);

    view.unmount();
    act(() => {
      publishRealtimeEvent(envelope('workspace.chat.changed'));
      publishRealtimeStatus(false);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('useRealtimeStatus reflects the connection state and re-renders on change', () => {
    function Badge() {
      const status = useRealtimeStatus();
      return <span data-testid="badge">{String(status)}</span>;
    }
    const view = render(<Badge />);
    // Trạng thái là module-level: có thể còn từ test trước, nên đặt rõ trước khi kiểm.
    act(() => publishRealtimeStatus(true));
    expect(view.getByTestId('badge').textContent).toBe('true');
    act(() => publishRealtimeStatus(false));
    expect(view.getByTestId('badge').textContent).toBe('false');
    expect(getRealtimeStatus()).toBe(false);
  });

  it('sendRealtime reports false without a socket, delivers with one, and survives a throwing sender', () => {
    registerRealtimeSender(undefined);
    expect(sendRealtime('chat.typing', { typing: true })).toBe(false);

    const sender = jest.fn();
    registerRealtimeSender(sender);
    expect(sendRealtime('chat.typing', { typing: true })).toBe(true);
    expect(sender).toHaveBeenCalledWith('chat.typing', { typing: true });

    registerRealtimeSender(() => {
      throw new Error('socket closed');
    });
    expect(sendRealtime('chat.typing', {})).toBe(false);
    registerRealtimeSender(undefined);
  });

  it('always calls the latest handler without resubscribing', () => {
    const first = jest.fn();
    const second = jest.fn();
    function Probe({ handler }: { handler: () => void }) {
      useRealtimeEvent('workspace.chat.changed', handler);
      return null;
    }
    const view = render(<Probe handler={first} />);
    view.rerender(<Probe handler={second} />);
    act(() => publishRealtimeEvent(envelope('workspace.chat.changed')));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
