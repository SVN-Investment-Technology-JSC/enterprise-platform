/** @jest-environment jsdom */
import type { SocialPost } from '@enterprise-platform/contracts-social';
import { toast } from '@enterprise-platform/shared-ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createBookmarkFolder,
  loadBookmarkFolders,
  setBookmark,
} from '../../social-posts-api';
import { BookmarkDialog } from './bookmark-dialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@enterprise-platform/shared-ui', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../social-posts-api', () => ({
  loadBookmarkFolders: jest.fn(),
  createBookmarkFolder: jest.fn(),
  setBookmark: jest.fn(),
}));

beforeAll(() => {
  const noop = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= noop;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= noop;
});

const loadFolders = loadBookmarkFolders as jest.Mock;
const createFolder = createBookmarkFolder as jest.Mock;
const setMark = setBookmark as jest.Mock;

const post = (extra: Partial<SocialPost> = {}) => ({ id: 'p1', ...extra }) as SocialPost;

const FOLDERS = {
  items: [
    { id: 'f1', name: 'Quy trình', count: 3 },
    { id: 'f2', name: 'Đào tạo', count: 1 },
  ],
  unfiledCount: 2,
  total: 6,
};

beforeEach(() => {
  jest.clearAllMocks();
  loadFolders.mockResolvedValue(FOLDERS);
});

async function renderDialog(p: SocialPost = post(), onDone = jest.fn(), onClose = jest.fn()) {
  await act(async () => {
    render(<BookmarkDialog post={p} onDone={onDone} onClose={onClose} />);
  });
  return { onDone, onClose };
}

const openSelect = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Thư mục' }));
  });
};

describe('BookmarkDialog', () => {
  it('mặc định chọn "Chưa phân loại" và không có nút Bỏ lưu khi bài chưa lưu', async () => {
    await renderDialog();
    expect(screen.getByRole('combobox', { name: 'Thư mục' }).textContent).toContain('Chưa phân loại');
    expect(screen.queryByRole('button', { name: 'Bỏ lưu' })).toBeNull();
  });

  it('mặc định chọn thư mục hiện tại của bài', async () => {
    await renderDialog(post({ bookmarked: true, bookmarkFolderId: 'f2' }));
    expect(screen.getByRole('combobox', { name: 'Thư mục' }).textContent).toContain('Đào tạo');
    expect(screen.getByRole('button', { name: 'Bỏ lưu' })).toBeTruthy();
  });

  it('liệt kê thư mục kèm số bài, có ô tìm và chọn được', async () => {
    const { onDone } = await renderDialog();
    setMark.mockResolvedValue({ bookmarked: true, folderId: 'f1' });
    await openSelect();
    expect(screen.getByText('Quy trình')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Quy trình/ }).textContent).toContain('3');

    fireEvent.change(screen.getByLabelText('Tìm thư mục'), { target: { value: 'dao tao' } });
    expect(screen.queryByRole('option', { name: /Quy trình/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Đào tạo/ }).querySelector('button') as HTMLButtonElement);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(setMark).toHaveBeenCalledWith('p1', true, 'f2');
    expect(toast.success).toHaveBeenCalledWith('Đã lưu vào thư mục "Đào tạo"');
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ bookmarked: true }));
  });

  it('chưa phân loại: gọi setBookmark với null và toast chung', async () => {
    setMark.mockResolvedValue({ bookmarked: true });
    await renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(setMark).toHaveBeenCalledWith('p1', true, null);
    expect(toast.success).toHaveBeenCalledWith('Đã lưu bài viết');
  });

  it('thêm nhanh thư mục gọi createBookmarkFolder và tự chọn thư mục mới', async () => {
    createFolder.mockResolvedValue({ id: 'f3', name: 'Mới', count: 0 });
    setMark.mockResolvedValue({ bookmarked: true, folderId: 'f3' });
    await renderDialog();
    await openSelect();
    fireEvent.change(screen.getByLabelText('Tên thư mục mới'), { target: { value: '  Mới ' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Tên thư mục mới'), { key: 'Enter' });
    });
    expect(createFolder).toHaveBeenCalledWith('Mới');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Thư mục' }).textContent).toContain('Mới'),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(setMark).toHaveBeenCalledWith('p1', true, 'f3');
  });

  it('chưa có thư mục: hiện gợi ý tạo nhanh và nút Thêm thư mục', async () => {
    loadFolders.mockResolvedValue({ items: [], unfiledCount: 0, total: 0 });
    createFolder.mockResolvedValue({ id: 'n1', name: 'A', count: 0 });
    await renderDialog();
    await openSelect();
    expect(screen.getByText('Chưa có thư mục. Nhập tên để tạo nhanh.')).toBeTruthy();
    const add = screen.getByRole('button', { name: /Thêm thư mục/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Tên thư mục mới'), { target: { value: 'A' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Thêm thư mục/ }));
    });
    expect(createFolder).toHaveBeenCalledWith('A');
  });

  it('Bỏ lưu gọi setBookmark(false) và toast', async () => {
    setMark.mockResolvedValue({ bookmarked: false });
    const { onDone } = await renderDialog(post({ bookmarked: true, bookmarkFolderId: 'f1' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bỏ lưu' }));
    });
    expect(setMark).toHaveBeenCalledWith('p1', false);
    expect(toast).toHaveBeenCalledWith('Đã bỏ lưu bài viết');
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ bookmarked: false }));
  });

  it('Huỷ đóng hộp thoại, không gọi API lưu', async () => {
    const { onClose } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onClose).toHaveBeenCalled();
    expect(setMark).not.toHaveBeenCalled();
  });

  it('lỗi lưu hiện trong hộp thoại', async () => {
    setMark.mockRejectedValue(new Error('x'));
    const { onDone } = await renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
