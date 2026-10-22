import type { EditorAction } from '@enterprise-platform/shared-brand-icon';
import { renderHook } from '@testing-library/react';
import { useGesture } from './use-gesture';

describe('useGesture', () => {
  it('chỉ gửi gestureStart một lần dù gọi nhiều lần, và gestureEnd một lần', () => {
    const dispatch = jest.fn<void, [EditorAction]>();
    const { result } = renderHook(() => useGesture(dispatch));
    result.current.start();
    result.current.start();
    result.current.end();
    result.current.end();
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['gestureStart', 'gestureEnd']);
  });

  it('gọi end khi chưa start thì không làm gì', () => {
    const dispatch = jest.fn();
    const { result } = renderHook(() => useGesture(dispatch));
    result.current.end();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('tự kết thúc khi thành phần bị gỡ giữa chừng', () => {
    const dispatch = jest.fn<void, [EditorAction]>();
    const { result, unmount } = renderHook(() => useGesture(dispatch));
    result.current.start();
    unmount();
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['gestureStart', 'gestureEnd']);
  });

  it('gỡ thành phần khi không có thao tác nào thì không gửi gì', () => {
    const dispatch = jest.fn();
    const { unmount } = renderHook(() => useGesture(dispatch));
    unmount();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
