import { DEFAULT_PALETTE } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { localStore } from '../store/local-store';
import { STANDARDS_DEBOUNCE_MS, remoteStore } from '../store/remote-store';
import { createFakeBrandServer, httpError, type FakeBrandServer } from '../store/testing/fake-brand-server';
import { StandardsPage } from './standards-page';

let mockServer: FakeBrandServer;

jest.mock('../store/brand-api', () => {
  const actual = jest.requireActual('../store/brand-api');
  const { BRAND_API_FUNCTIONS } = jest.requireActual('../store/testing/api-names') as { BRAND_API_FUNCTIONS: readonly string[] };
  const delegates = Object.fromEntries(
    BRAND_API_FUNCTIONS.map((name) => [name, (...args: unknown[]) => (mockServer.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)]),
  );
  return { ...actual, ...delegates };
});

const firstLabel = DEFAULT_PALETTE.tokens[0].label;
const puts = () => mockServer.calls.filter((call) => call === 'PUT standards');
const waitForSave = { timeout: STANDARDS_DEBOUNCE_MS * 4 };

function rename(value: string) {
  const input = screen.getByLabelText(`Tên màu ${firstLabel}`);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(() => {
  mockServer = createFakeBrandServer();
  remoteStore.resetForTest();
  window.localStorage.clear();
  localStore.reloadForTest();
  Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('StandardsPage: chế độ máy chủ', () => {
  it('chờ máy chủ trả lời rồi mới hiện bảng màu và quy chuẩn', async () => {
    render(<StandardsPage />);

    expect(screen.getByLabelText('Đang tải cài đặt')).toBeTruthy();
    expect(screen.queryAllByTestId('palette-row')).toHaveLength(0);

    await waitFor(() => expect(screen.queryAllByTestId('palette-row').length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('Đang tải cài đặt')).toBeNull();
  });

  it('chỉnh bảng màu thì gửi lên máy chủ một lần sau khi ngừng sửa', async () => {
    render(<StandardsPage />);
    await waitFor(() => expect(screen.queryAllByTestId('palette-row').length).toBeGreaterThan(0));

    rename('Xanh đã đổi tên');
    expect(puts()).toHaveLength(0);

    await waitFor(() => expect(mockServer.standards.version).toBe(1), waitForSave);
    expect(puts()).toHaveLength(1);
    expect(mockServer.standards.palette.tokens[0].label).toBe('Xanh đã đổi tên');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lưu lỗi thì hiện thông báo lỗi ngay trên trang và vẫn giữ giá trị vừa sửa', async () => {
    mockServer.failWith('PUT standards', httpError(503, 'Máy chủ bận.'));
    render(<StandardsPage />);
    await waitFor(() => expect(screen.queryAllByTestId('palette-row').length).toBeGreaterThan(0));

    rename('Chưa lưu được');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chưa lưu được bảng màu: Máy chủ bận.'), waitForSave);
    expect((screen.getByLabelText('Tên màu Chưa lưu được') as HTMLInputElement).value).toBe('Chưa lưu được');
    expect(mockServer.standards.version).toBe(0);
  });

  it('người khác đã lưu trước thì nạp lại bản mới và báo rõ, không ghi đè', async () => {
    render(<StandardsPage />);
    await waitFor(() => expect(screen.queryAllByTestId('palette-row').length).toBeGreaterThan(0));
    mockServer.standards = { ...mockServer.standards, version: 3, palette: { tokens: [{ key: 'tim', label: 'Tím của người khác', hex: '#7c3aed' }] } };

    rename('Của tôi');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Đã nạp bản mới nhất'), waitForSave);
    expect(mockServer.standards.version).toBe(3);
    expect(screen.getByLabelText('Tên màu Tím của người khác')).toBeTruthy();
  });

  it('hiện chỉ báo "Đang lưu" trong lúc gửi', async () => {
    let release: () => void = () => undefined;
    mockServer.onRequest('PUT standards', () => new Promise<void>((resolve) => (release = resolve)));
    render(<StandardsPage />);
    await waitFor(() => expect(screen.queryAllByTestId('palette-row').length).toBeGreaterThan(0));

    rename('Đang gửi');

    await waitFor(() => expect(screen.getByText('Đang lưu lên máy chủ')).toBeTruthy(), waitForSave);
    release();
    await waitFor(() => expect(screen.queryByText('Đang lưu lên máy chủ')).toBeNull());
  });
});
