/** @jest-environment jsdom */
import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createUploadAbortedError } from '../attachment-upload';
import { attachmentErrorMessage, discardAttachment, uploadAttachment } from '../social-api';
import { CommentInput } from './comment-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../social-api', () => ({
  ...jest.requireActual('../social-api'),
  uploadAttachment: jest.fn(),
  discardAttachment: jest.fn(() => Promise.resolve()),
  discardAttachmentKeepalive: jest.fn(),
  attachmentStatusApi: { status: jest.fn(() => Promise.resolve([])) },
}));
jest.mock('../comment-media', () => ({
  ...jest.requireActual('../comment-media'),
  probeVideo: jest.fn(() => Promise.resolve({ ok: false, reason: 'test' })),
}));

interface PendingUpload {
  readonly signal?: AbortSignal;
  readonly resolve: (attachment: SocialAttachment) => void;
  readonly options: {
    onInitiated?: (ticket: { attachmentId: string; uploadId?: string }) => void;
    onProgress?: (fraction: number) => void;
  };
}

const uploads: PendingUpload[] = [];

const attachment = (id: string, processingStatus: SocialAttachment['processingStatus']): SocialAttachment => ({
  id,
  fileName: `${id}.mp4`,
  contentType: 'video/mp4',
  sizeBytes: 1000,
  isImage: false,
  isVideo: true,
  processingStatus,
});

beforeEach(() => {
  // jsdom chưa cài đặt URL.createObjectURL.
  URL.createObjectURL = jest.fn(() => 'blob:test');
  URL.revokeObjectURL = jest.fn();
  uploads.length = 0;
  (discardAttachment as jest.Mock).mockClear();
  (uploadAttachment as jest.Mock).mockImplementation(
    (_file: File, _purpose: string, options: PendingUpload['options'] & { signal?: AbortSignal }) =>
      new Promise<SocialAttachment>((resolve, reject) => {
        uploads.push({ signal: options.signal, resolve, options });
        options.signal?.addEventListener('abort', () => reject(createUploadAbortedError()));
      }),
  );
});
afterEach(cleanup);

const flush = () => act(async () => undefined);

function setup() {
  const onSubmit = jest.fn(() => Promise.resolve());
  const view = render(<CommentInput placeholder="Viết bình luận" submitLabel="Gửi" onSubmit={onSubmit} />);
  return { onSubmit, ...view };
}

const sendButton = () => screen.getByRole('button', { name: 'Gửi' }) as HTMLButtonElement;
const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Viết bình luận'), { target: { value: text, selectionStart: text.length } });

async function addVideo(container: HTMLElement, name: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(1000)], name, { type: 'video/mp4' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
  await flush();
}

/** Video đã tải xong với trạng thái `status`; trả chỉ số lần tải. */
async function uploadVideo(container: HTMLElement, id: string, status: SocialAttachment['processingStatus']) {
  await addVideo(container, `${id}.mp4`);
  const index = uploads.length - 1;
  act(() => uploads[index].options.onInitiated?.({ attachmentId: id, uploadId: `up-${id}` }));
  await act(async () => uploads[index].resolve(attachment(id, status)));
  return index;
}

describe('CommentInput: video chưa xong khi bấm Gửi', () => {
  it('video đang xử lý: hiện cảnh báo; Chờ video xong thì không gửi', async () => {
    const { container, onSubmit } = setup();
    await uploadVideo(container, 'v1', 'processing');
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    expect(screen.getByRole('dialog', { name: 'Video chưa xử lý xong' })).toBeTruthy();
    expect(screen.getByText(/Video đang được xử lý\. Bạn vẫn có thể gửi ngay/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chờ video xong' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Vẫn gửi với video đang xử lý: gửi kèm id video, tracker không discard khi gỡ ô', async () => {
    const { container, onSubmit, unmount } = setup();
    await uploadVideo(container, 'v1', 'queued');
    fireEvent.click(sendButton());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Vẫn gửi' }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('', [], ['v1']);
    unmount();
    expect(discardAttachment).not.toHaveBeenCalled();
  });

  it('video đang tải lên: cảnh báo kèm phần trăm; Vẫn gửi huỷ lần tải rồi gửi không kèm video', async () => {
    const { container, onSubmit, unmount } = setup();
    type('xin chào');
    await addVideo(container, 'dang-tai.mp4');
    act(() => uploads[0].options.onInitiated?.({ attachmentId: 'v-up', uploadId: 'u1' }));
    act(() => uploads[0].options.onProgress?.(0.4));
    fireEvent.click(sendButton());
    expect(screen.getByText('Video đang tải lên (40%). Nếu gửi ngay, bình luận sẽ được gửi không kèm video này.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Vẫn gửi' }));
    });
    expect(uploads[0].signal?.aborted).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith('xin chào', [], []);
    unmount();
    // Lần tải đã huỷ tự dọn phía server; không discard thêm lần nào.
    expect(discardAttachment).not.toHaveBeenCalled();
  });

  it('chỉ có video đang tải, không chữ: nút chính bị vô hiệu kèm giải thích', async () => {
    const { container, onSubmit } = setup();
    await addVideo(container, 'dang-tai.mp4');
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    expect((screen.getByRole('button', { name: 'Vẫn gửi' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Không còn nội dung để đăng nếu bỏ video đang tải.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('video đã sẵn sàng: gửi thẳng, không hiện hộp; lần sau cũng không hiện', async () => {
    const { container, onSubmit } = setup();
    await uploadVideo(container, 'v1', 'ready');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith('', [], ['v1']);
    type('tiếp');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('video xử lý lỗi: nút Gửi bị vô hiệu', async () => {
    const { container } = setup();
    type('có chữ');
    await uploadVideo(container, 'v1', 'failed');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().title).toBe('Hãy gỡ video lỗi trước khi gửi.');
  });

  it('tooltip nút Gửi đổi sang giọng mới khi đang xử lý video', async () => {
    const { container } = setup();
    await uploadVideo(container, 'v1', 'processing');
    expect(sendButton().title).toBe('Video đang xử lý; bạn vẫn có thể gửi, video sẽ hiện khi xử lý xong.');
  });
});

describe('attachmentErrorMessage', () => {
  it('có lời nhắn cho SOCIAL_VIDEO_FAILED và không còn SOCIAL_VIDEO_NOT_READY', () => {
    expect(attachmentErrorMessage({ code: 'SOCIAL_VIDEO_FAILED' }, 'x')).toBe(
      'Video xử lý lỗi, chưa thể đăng. Hãy gỡ video rồi thử lại.',
    );
    expect(attachmentErrorMessage({ code: 'SOCIAL_VIDEO_NOT_READY' }, 'dự phòng')).toBe('dự phòng');
    expect(attachmentErrorMessage({ code: 'SOCIAL_VIDEO_FAILED', message: 'Từ server' }, 'x')).toBe('Từ server');
  });
});
