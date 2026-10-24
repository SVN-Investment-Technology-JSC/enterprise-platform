/** @jest-environment jsdom */
import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { act, renderHook } from '@testing-library/react';
import { nextStatusPollDelay, useAttachmentStatuses, type FetchAttachmentStatuses } from './use-attachment-statuses';

const video = (id: string, processingStatus: SocialAttachment['processingStatus']): SocialAttachment => ({
  id,
  fileName: `${id}.mp4`,
  contentType: 'video/mp4',
  sizeBytes: 1,
  isImage: false,
  isVideo: true,
  processingStatus,
});

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};

/** Cho các lời hứa đang chờ chạy xong sau khi tua đồng hồ. */
const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

describe('nextStatusPollDelay', () => {
  it('3 giây rồi lùi dần, tối đa 10 giây', () => {
    expect([0, 1, 2, 3, 4, 10].map(nextStatusPollDelay)).toEqual([3000, 4500, 6750, 10000, 10000, 10000]);
  });
});

describe('useAttachmentStatuses', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('hỏi sau 3 giây, lùi dần, rồi dừng khi video ready', async () => {
    const results = [[video('a', 'processing')], [video('a', 'processing')], [video('a', 'ready')]];
    const fetchStatuses = jest.fn<ReturnType<FetchAttachmentStatuses>, Parameters<FetchAttachmentStatuses>>(async () => results.shift() ?? []);
    const { result } = renderHook(() => useAttachmentStatuses(['a'], fetchStatuses));
    expect(fetchStatuses).not.toHaveBeenCalled();

    await advance(2999);
    expect(fetchStatuses).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchStatuses).toHaveBeenCalledTimes(1);
    expect(fetchStatuses).toHaveBeenLastCalledWith(['a']);
    expect(result.current.get('a')?.processingStatus).toBe('processing');

    // Lần sau cách 4,5 giây, không phải 3 giây.
    await advance(4499);
    expect(fetchStatuses).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchStatuses).toHaveBeenCalledTimes(2);

    await advance(6750);
    expect(fetchStatuses).toHaveBeenCalledTimes(3);
    expect(result.current.get('a')?.processingStatus).toBe('ready');

    await advance(60_000);
    expect(fetchStatuses).toHaveBeenCalledTimes(3);
  });

  it('dừng khi video failed và giữ lý do lỗi', async () => {
    const failed = { ...video('a', 'failed'), processingError: 'Không đọc được video.' };
    const fetchStatuses = jest.fn(async () => [failed]);
    const { result } = renderHook(() => useAttachmentStatuses(['a'], fetchStatuses));
    await advance(3000);
    await advance(60_000);
    expect(fetchStatuses).toHaveBeenCalledTimes(1);
    expect(result.current.get('a')?.processingError).toBe('Không đọc được video.');
  });

  it('chỉ hỏi các id chưa xong, tối đa 10 id mỗi lần', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `v${String(index).padStart(2, '0')}`);
    const fetchStatuses = jest.fn(async (batch: readonly string[]) => batch.map((id) => video(id, 'processing')));
    renderHook(() => useAttachmentStatuses(ids, fetchStatuses));
    await advance(3000);
    expect(fetchStatuses).toHaveBeenCalledTimes(2);
    expect(fetchStatuses.mock.calls.map(([batch]) => batch.length)).toEqual([10, 2]);
  });

  it('không có id nào thì không hỏi', async () => {
    const fetchStatuses = jest.fn(async () => []);
    renderHook(() => useAttachmentStatuses([], fetchStatuses));
    await advance(60_000);
    expect(fetchStatuses).not.toHaveBeenCalled();
  });

  it('tab ẩn thì tạm dừng, hiện lại thì hỏi ngay và tiếp tục', async () => {
    const fetchStatuses = jest.fn(async () => [video('a', 'processing')]);
    renderHook(() => useAttachmentStatuses(['a'], fetchStatuses));
    await advance(3000);
    expect(fetchStatuses).toHaveBeenCalledTimes(1);

    act(() => setHidden(true));
    await advance(60_000);
    expect(fetchStatuses).toHaveBeenCalledTimes(1);

    await act(async () => {
      setHidden(false);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchStatuses).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(fetchStatuses).toHaveBeenCalledTimes(3);
  });

  it('lỗi mạng thì bỏ qua và hỏi lại', async () => {
    const fetchStatuses = jest
      .fn<Promise<readonly SocialAttachment[]>, [readonly string[]]>()
      .mockRejectedValueOnce(new Error('mạng'))
      .mockResolvedValue([video('a', 'ready')]);
    const { result } = renderHook(() => useAttachmentStatuses(['a'], fetchStatuses));
    await advance(3000);
    expect(result.current.size).toBe(0);
    await advance(4500);
    expect(result.current.get('a')?.processingStatus).toBe('ready');
  });

  it('unmount thì dọn bộ hẹn giờ và không hỏi nữa', async () => {
    const fetchStatuses = jest.fn(async () => [video('a', 'processing')]);
    const { unmount } = renderHook(() => useAttachmentStatuses(['a'], fetchStatuses));
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchStatuses).not.toHaveBeenCalled();
  });
});
