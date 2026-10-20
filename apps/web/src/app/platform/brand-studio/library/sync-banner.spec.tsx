import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IconLibrary } from '../store';
import { BrandApiError } from '../store/brand-api';
import { SyncBanner } from './sync-banner';

function library(overrides: Partial<IconLibrary> = {}): IconLibrary {
  return {
    ready: true,
    docs: [],
    error: null,
    mode: 'server',
    modeReason: null,
    localOnlyCount: 0,
    loading: false,
    get: () => undefined,
    serverInfo: () => null,
    save: jest.fn(),
    saveMany: jest.fn(),
    remove: jest.fn(),
    removeMany: jest.fn(),
    duplicate: jest.fn(),
    importDocs: jest.fn(),
    resetPreset: jest.fn(),
    publish: jest.fn(),
    syncLocalToServer: jest.fn(async () => ({ pushed: 0, failed: 0 })),
    reloadFromServer: jest.fn(async () => undefined),
    ...overrides,
  };
}

const syncButton = () => screen.getByRole('button', { name: /Đồng bộ lên máy chủ/ });

describe('SyncBanner', () => {
  it('đang kiểm tra kết nối thì chưa hiện gì', () => {
    const { container } = render(<SyncBanner library={library({ mode: 'checking', ready: false })} />);

    expect(container.firstChild).toBeNull();
  });

  it('chế độ máy chủ: báo đã kết nối, không có nút đồng bộ khi không còn icon cục bộ', () => {
    render(<SyncBanner library={library()} />);

    expect(screen.getByText('Đã kết nối máy chủ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Đồng bộ lên máy chủ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('chế độ cục bộ: báo đang lưu tạm trong trình duyệt kèm lý do và nút thử lại', async () => {
    const reload = jest.fn(async () => undefined);
    render(<SyncBanner library={library({ mode: 'local', modeReason: 'Máy chủ chưa có API lưu icon.', reloadFromServer: reload })} />);

    expect(screen.getByText('Đang lưu tạm trong trình duyệt')).toBeTruthy();
    expect(screen.getByText('Máy chủ chưa có API lưu icon.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Đồng bộ lên máy chủ/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('thử lại vẫn lỗi thì không văng lỗi ra ngoài', async () => {
    const reload = jest.fn(async () => {
      throw new Error('vẫn chưa nối được');
    });
    render(<SyncBanner library={library({ mode: 'local', reloadFromServer: reload })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Thử lại' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('có icon chỉ ở trình duyệt thì hiện số lượng và nút đồng bộ kèm số', () => {
    render(<SyncBanner library={library({ localOnlyCount: 3 })} />);

    expect(screen.getByText('3 icon chỉ có trong trình duyệt')).toBeTruthy();
    expect(syncButton().textContent).toBe('Đồng bộ lên máy chủ (3)');
  });

  it('đồng bộ thành công báo số icon đã đẩy', async () => {
    const sync = jest.fn(async () => ({ pushed: 3, failed: 0 }));
    render(<SyncBanner library={library({ localOnlyCount: 3, syncLocalToServer: sync })} />);

    fireEvent.click(syncButton());

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Đã đồng bộ 3 icon.'));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('đồng bộ một phần báo rõ số icon lỗi bằng thông báo lỗi', async () => {
    const sync = jest.fn(async () => ({ pushed: 2, failed: 1 }));
    render(<SyncBanner library={library({ localOnlyCount: 3, syncLocalToServer: sync })} />);

    fireEvent.click(syncButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Đã đồng bộ 2 icon, 1 icon chưa đồng bộ được. Thử lại sau.'));
  });

  it('đồng bộ lỗi hoàn toàn (không có icon nào lên) báo số icon lỗi', async () => {
    const sync = jest.fn(async () => ({ pushed: 0, failed: 3 }));
    render(<SyncBanner library={library({ localOnlyCount: 3, syncLocalToServer: sync })} />);

    fireEvent.click(syncButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('3 icon chưa đồng bộ được. Thử lại sau.'));
  });

  it('đồng bộ ném lỗi thì hiện thông điệp của máy chủ', async () => {
    const sync = jest.fn(async () => {
      throw new BrandApiError({ statusCode: 403, code: 'FORBIDDEN', message: 'Chỉ quản trị Platform được dùng chức năng này.' });
    });
    render(<SyncBanner library={library({ localOnlyCount: 1, syncLocalToServer: sync })} />);

    fireEvent.click(syncButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chỉ quản trị Platform được dùng chức năng này.'));
  });

  it('trong lúc đồng bộ khoá nút để không bấm hai lần', async () => {
    let finish: (value: { pushed: number; failed: number }) => void = () => undefined;
    const sync = jest.fn(() => new Promise<{ pushed: number; failed: number }>((resolve) => (finish = resolve)));
    render(<SyncBanner library={library({ localOnlyCount: 2, syncLocalToServer: sync })} />);

    fireEvent.click(syncButton());

    await waitFor(() => expect((syncButton() as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText('Đang đồng bộ')).toBeTruthy();
    fireEvent.click(syncButton());
    expect(sync).toHaveBeenCalledTimes(1);

    finish({ pushed: 2, failed: 0 });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Đã đồng bộ 2 icon.'));
  });

  it('đang nạp thêm từ máy chủ thì có chỉ báo tải', () => {
    render(<SyncBanner library={library({ loading: true })} />);

    expect(screen.getByText('Đang tải')).toBeTruthy();
  });
});
