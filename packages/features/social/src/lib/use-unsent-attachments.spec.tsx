/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { useUnsentAttachments } from './use-unsent-attachments';

function setup() {
  const discard = jest.fn((_id: string, _uploadId?: string) => Promise.resolve());
  const discardKeepalive = jest.fn((_id: string, _uploadId?: string) => undefined);
  const view = renderHook(() => useUnsentAttachments({ discard, discardKeepalive }));
  return { discard, discardKeepalive, ...view };
}

const fire = (type: 'beforeunload' | 'pagehide') => {
  const event = new Event(type, { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useUnsentAttachments', () => {
  it('không chặn rời trang khi chưa có tệp chưa gửi', () => {
    setup();
    expect(fire('beforeunload').defaultPrevented).toBe(false);
  });

  it('có tệp chưa gửi thì beforeunload hiện hộp xác nhận; hết tệp thì thôi', () => {
    const { result } = setup();
    result.current.track('a');
    const event = fire('beforeunload');
    expect(event.defaultPrevented).toBe(true);
    result.current.forget('a');
    expect(fire('beforeunload').defaultPrevented).toBe(false);
  });

  it('pagehide bỏ từng tệp bằng keepalive, mỗi id một lần, kèm uploadId của lần tải nhiều phần', () => {
    const { result, discardKeepalive, discard, unmount } = setup();
    result.current.track('a');
    result.current.track('b', 'up-1');
    fire('pagehide');
    fire('pagehide');
    expect(discardKeepalive).toHaveBeenCalledTimes(2);
    expect(discardKeepalive).toHaveBeenCalledWith('a', undefined);
    expect(discardKeepalive).toHaveBeenCalledWith('b', 'up-1');
    // Gỡ ô soạn sau pagehide không bỏ lại lần nữa.
    unmount();
    expect(discard).not.toHaveBeenCalled();
    expect(discardKeepalive).toHaveBeenCalledTimes(2);
  });

  it('gỡ ô soạn thì bỏ các tệp chưa gửi, bỏ qua lỗi', async () => {
    const discard = jest.fn(() => Promise.reject(new Error('mạng')));
    const { result, unmount } = renderHook(() => useUnsentAttachments({ discard, discardKeepalive: jest.fn() }));
    result.current.track('a', 'up-9');
    result.current.track('b');
    unmount();
    expect(discard).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledWith('a', 'up-9');
    await Promise.resolve();
    expect(fire('beforeunload').defaultPrevented).toBe(false);
  });

  it('gửi thành công (forget) rồi gỡ ô thì không bỏ các tệp đã gắn', () => {
    const { result, discard, discardKeepalive, unmount } = setup();
    result.current.track('a');
    result.current.track('b');
    result.current.forget(['a', 'b']);
    fire('pagehide');
    unmount();
    expect(discard).not.toHaveBeenCalled();
    expect(discardKeepalive).not.toHaveBeenCalled();
  });

  it('người dùng gỡ tệp thì bỏ ngay một lần; gỡ lại hay theo dõi muộn không bỏ thêm', () => {
    const { result, discard, unmount } = setup();
    result.current.track('a');
    result.current.discard('a');
    result.current.discard('a');
    result.current.track('a');
    unmount();
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('tệp tải xong muộn (chưa từng theo dõi) vẫn được bỏ đúng một lần', () => {
    const { result, discard } = setup();
    result.current.discard('late');
    result.current.discard('late');
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith('late', undefined);
  });

  it('hai ô soạn độc lập: ô này gỡ không bỏ tệp của ô kia', () => {
    const first = setup();
    const second = setup();
    first.result.current.track('a');
    second.result.current.track('b');
    first.unmount();
    expect(first.discard).toHaveBeenCalledWith('a', undefined);
    expect(second.discard).not.toHaveBeenCalled();
    second.result.current.forget('b');
    second.unmount();
    expect(second.discard).not.toHaveBeenCalled();
  });
});
