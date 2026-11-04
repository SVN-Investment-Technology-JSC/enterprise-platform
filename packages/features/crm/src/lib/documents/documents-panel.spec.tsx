/**
 * @jest-environment jsdom
 */
import { CRM_NO_CAPABILITIES, type CrmCapabilities, type CrmDocument } from '@enterprise-platform/contracts-crm';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '../crm-api';
import { CrmDataProvider } from '../crm-context';
import { DocumentsPanel } from './documents-panel';

jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message || fallback,
  listDocuments: jest.fn(),
  listDocumentFolders: jest.fn().mockResolvedValue([]),
  listDocumentTypes: jest.fn().mockResolvedValue([]),
  listGroups: jest.fn().mockResolvedValue([]),
  listKinds: jest.fn().mockResolvedValue([]),
  listPeople: jest.fn().mockResolvedValue([]),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { success: jest.fn(), error: jest.fn() },
}));

// antd Table cần ResizeObserver, matchMedia và getComputedStyle có tham số thứ hai; jsdom thiếu cả hai.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  } as unknown as typeof ResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  const original = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) => original(element)) as typeof window.getComputedStyle;
});

const mocked = api as jest.Mocked<typeof api>;
const doc = (patch: Partial<CrmDocument> = {}): CrmDocument => ({
  id: 'd1',
  entityType: 'customer',
  entityId: 'c1',
  folderId: null,
  documentType: null,
  name: 'Hợp đồng khung',
  description: null,
  audience: 'internal',
  currentVersionNo: 1,
  fileName: 'hd.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  lockedByUserId: null,
  lockedAt: null,
  createdBy: 'u1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});

function renderPanel(capabilities: Partial<CrmCapabilities>) {
  render(
    <CrmDataProvider capabilities={{ ...CRM_NO_CAPABILITIES, ...capabilities }} currentUserId="u1">
      <DocumentsPanel entityType="customer" entityId="c1" />
    </CrmDataProvider>,
  );
}

describe('DocumentsPanel', () => {
  it('hiện trạng thái rỗng tiếng Việt và ẩn nút tải lên khi chỉ có quyền đọc', async () => {
    mocked.listDocuments.mockResolvedValue([]);
    renderPanel({});
    expect(await screen.findByText('Chưa có tài liệu nào.')).toBeTruthy();
    expect(screen.queryByText('Tải tài liệu lên')).toBeNull();
  });

  it('hiện nút tải lên khi có quyền ghi tài liệu', async () => {
    mocked.listDocuments.mockResolvedValue([]);
    renderPanel({ canWriteDocument: true });
    expect(await screen.findByText(/Chưa có tài liệu nào\. Bấm/)).toBeTruthy();
    expect(screen.getByText('Tải tài liệu lên')).toBeTruthy();
  });

  it('nút Xoá chỉ hiện khi có quyền xoá riêng', async () => {
    mocked.listDocuments.mockResolvedValue([doc()]);
    renderPanel({ canWriteDocument: true });
    await screen.findByText('Hợp đồng khung');
    expect(screen.queryByText('Xoá')).toBeNull();
    expect(screen.getByRole('button', { name: 'Khoá' })).toBeTruthy();
  });

  it('tài liệu bị khoá bởi người khác không có nút Khoá hay Xoá', async () => {
    mocked.listDocuments.mockResolvedValue([doc({ lockedByUserId: 'u2' })]);
    renderPanel({ canWriteDocument: true, canDeleteDocument: true });
    await screen.findByText('Hợp đồng khung');
    expect(screen.queryByText('Xoá')).toBeNull();
    expect(screen.getByText(/Đang khoá/)).toBeTruthy();
  });

  it('báo lỗi tiếng Việt khi tải danh sách thất bại', async () => {
    mocked.listDocuments.mockRejectedValue({ message: 'Bạn không có quyền xem tài liệu.' });
    renderPanel({});
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Bạn không có quyền xem tài liệu.'));
  });
});
