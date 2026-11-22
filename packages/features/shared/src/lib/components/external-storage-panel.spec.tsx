import type { SharedExternalStorageSettings } from '@enterprise-platform/contracts-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../shared-api';
import { ExternalStoragePanel } from './external-storage-panel';

jest.mock('../shared-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message ?? fallback,
  loadExternalStorage: jest.fn(),
  saveExternalStorage: jest.fn(),
  testExternalStorage: jest.fn(),
  transferToExternalStorage: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

function settings(patch: Partial<SharedExternalStorageSettings> = {}): SharedExternalStorageSettings {
  return {
    available: true,
    editable: true,
    configured: true,
    enabled: true,
    label: 'NAS văn phòng',
    accessMode: 'proxy',
    endpoint: 'http://100.101.2.3:9000',
    publicEndpoint: '',
    region: 'us-east-1',
    bucket: 'erp-documents',
    pathStyle: true,
    accessKeyId: 'erp-key',
    hasSecret: true,
    version: 2,
    usage: { platform: { files: 3, bytes: 3000 }, external: { files: 5, bytes: 9000 } },
    ...patch,
  };
}

describe('ExternalStoragePanel', () => {
  beforeEach(() => jest.resetAllMocks());

  it('hiện cấu hình đã lưu, không hiện secret; lưu gửi đúng phiên bản và để trống secret thì giữ secret cũ', async () => {
    mocked.loadExternalStorage.mockResolvedValue(settings());
    mocked.saveExternalStorage.mockResolvedValue(settings({ version: 3 }));
    render(<ExternalStoragePanel />);
    expect(await screen.findByDisplayValue('http://100.101.2.3:9000')).toBeTruthy();
    expect(screen.getByText('Đang bật')).toBeTruthy();
    expect(screen.getByPlaceholderText('Đã lưu; để trống nếu giữ nguyên')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('NAS văn phòng'), { target: { value: 'NAS mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(mocked.saveExternalStorage).toHaveBeenCalled());
    expect(mocked.saveExternalStorage.mock.calls[0]![0]).toMatchObject({
      label: 'NAS mới',
      accessMode: 'proxy',
      bucket: 'erp-documents',
      secretAccessKey: undefined,
      version: 2,
    });
  });

  it('thử kết nối hiện kết quả của máy chủ', async () => {
    mocked.loadExternalStorage.mockResolvedValue(settings());
    mocked.testExternalStorage.mockResolvedValue({ ok: false, message: 'Kho từ chối kết nối: sai cổng, hoặc dịch vụ kho chưa chạy.' });
    render(<ExternalStoragePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử kết nối' }));
    expect(await screen.findByText(/Kho từ chối kết nối/)).toBeTruthy();
  });

  it('quản trị kho không phải quản trị tenant chỉ xem, không có nút lưu', async () => {
    mocked.loadExternalStorage.mockResolvedValue(settings({ editable: false }));
    render(<ExternalStoragePanel />);
    expect(await screen.findByText('Chỉ quản trị tenant được thay đổi kho lưu trữ của công ty.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu cấu hình' })).toBeNull();
    expect((screen.getByDisplayValue('erp-documents') as HTMLInputElement).disabled).toBe(true);
  });

  it('máy chủ chưa có khoá gốc thì báo cho quản trị nền tảng', async () => {
    mocked.loadExternalStorage.mockResolvedValue(settings({ available: false, configured: false, enabled: false }));
    render(<ExternalStoragePanel />);
    expect(await screen.findByText(/SHARED_STORAGE_SECRET_KEY/)).toBeTruthy();
    expect(screen.getByText('Chưa cấu hình')).toBeTruthy();
  });

  it('chuyển tệp gọi lặp tới khi hết tệp', async () => {
    mocked.loadExternalStorage.mockResolvedValue(settings());
    mocked.transferToExternalStorage
      .mockResolvedValueOnce({ moved: 2, failed: 0, remaining: 1, errors: [] })
      .mockResolvedValueOnce({ moved: 1, failed: 0, remaining: 0, errors: [] });
    render(<ExternalStoragePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển sang kho ngoài' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển' }));
    await waitFor(() => expect(mocked.transferToExternalStorage).toHaveBeenCalledTimes(2));
    expect(mocked.transferToExternalStorage).toHaveBeenCalledWith({ limit: 10, removePlatformCopy: false });
  });
});
