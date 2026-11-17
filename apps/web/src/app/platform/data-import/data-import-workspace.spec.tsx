import { authFetch } from '@enterprise-platform/shared-ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toast } from '@/components/ui/sonner';
import DataImportWorkspace from './data-import-workspace';

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  authFetch: jest.fn(),
}));

jest.mock('@/components/ui/sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

/** jsdom không có Response: dựng phản hồi giả đủ cho cách màn này đọc (status, ok, json). */
function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

const tenants = [
  {
    id: 'tenant-1',
    slug: 'savina',
    name: 'Savina',
    status: 'active',
    createdAt: '2026-09-05T00:00:00.000Z',
    admin: null,
    database: null,
    modules: [],
  },
] as const;

describe('DataImportWorkspace', () => {
  beforeEach(() => {
    jest.mocked(authFetch).mockReset();
    jest.mocked(toast.error).mockReset();
  });

  it('should render successfully', () => {
    const { getByText, getByRole } = render(
      <DataImportWorkspace tenants={tenants} />,
    );
    expect(getByText('Data Import')).toBeTruthy();
    expect(getByRole('option', { name: 'Savina (savina)' })).toBeTruthy();
  });

  // OPS006-06: gateway nginx trả 413 với thân HTML, giao diện phải báo tiếng Việt.
  it('báo "Tệp quá lớn" bằng tiếng Việt khi gateway trả 413 dạng HTML', async () => {
    jest.mocked(authFetch).mockResolvedValue(
      fakeResponse(413, '<html><head><title>413 Request Entity Too Large</title></head><body></body></html>'),
    );
    const { container } = render(<DataImportWorkspace tenants={tenants} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'du-lieu.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra trước khi import/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(jest.mocked(toast.error).mock.calls[0][0]).toMatch(/^Tệp quá lớn/);
  });

  it('báo "Tệp quá lớn" khi API trả 413 với thông điệp tiếng Anh', async () => {
    jest.mocked(authFetch).mockResolvedValue(
      fakeResponse(413, JSON.stringify({ statusCode: 413, message: 'File too large' })),
    );
    const { container } = render(<DataImportWorkspace tenants={tenants} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'du-lieu.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra trước khi import/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(jest.mocked(toast.error).mock.calls[0][0]).toMatch(/^Tệp quá lớn/);
    expect(jest.mocked(toast.error).mock.calls[0][0]).not.toMatch(/File too large/);
  });
});
