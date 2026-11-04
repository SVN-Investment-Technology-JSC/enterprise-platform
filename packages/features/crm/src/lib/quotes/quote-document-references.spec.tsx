/**
 * @jest-environment jsdom
 */
import type { QuoteDocumentCandidate, QuoteDocumentReference } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuoteDocumentReferences } from './quote-document-references';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../components/crm-ui', () => ({
  CrmDialog: ({ title, error, children }: { title: string; error?: string; children: unknown }) => (
    <div role="dialog" aria-label={title}>{children as never}{error ? <p>{error}</p> : null}</div>
  ),
  Field: ({ label, children }: { label: string; children: unknown }) => <div data-label={label}>{children as never}</div>,
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  Popconfirm: ({ children, onConfirm }: { children: { props: { onClick?: () => void } } & object; onConfirm: () => void }) => (
    <span onClick={() => onConfirm()}>{children as never}</span>
  ),
  SearchableSelect: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
    <div>{options.map((o) => <button key={o.value} type="button" onClick={() => onChange(o.value)}>{`nguồn ${o.label}`}</button>)}</div>
  ),
  toast: { success: jest.fn(), error: jest.fn() },
}));
const mockApi = {
  listQuoteDocumentCandidates: jest.fn(),
  listQuoteDocumentReferences: jest.fn(),
  addQuoteDocumentReference: jest.fn(),
  removeQuoteDocumentReference: jest.fn(),
  getQuoteDocumentReferenceDownload: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listQuoteDocumentCandidates: (...a: unknown[]) => mockApi.listQuoteDocumentCandidates(...a),
  listQuoteDocumentReferences: (...a: unknown[]) => mockApi.listQuoteDocumentReferences(...a),
  addQuoteDocumentReference: (...a: unknown[]) => mockApi.addQuoteDocumentReference(...a),
  removeQuoteDocumentReference: (...a: unknown[]) => mockApi.removeQuoteDocumentReference(...a),
  getQuoteDocumentReferenceDownload: (...a: unknown[]) => mockApi.getQuoteDocumentReferenceDownload(...a),
}));

const document = (id: string) => ({ id, name: `Tài liệu ${id}`, sizeBytes: 2048 }) as never;
const source = { entityType: 'customer' as const, entityId: 'c1', label: 'Công ty A' };
const candidate = (id: string, attached = false): QuoteDocumentCandidate => ({ document: document(id), source, attached });
const reference = (id: string): QuoteDocumentReference => ({ id: `r-${id}`, document: document(id), source, createdAt: '', createdBy: 'u1' });

describe('QuoteDocumentReferences', () => {
  beforeEach(() => jest.clearAllMocks());

  it('không có quyền ghi tài liệu: ẩn nút chọn và gỡ, vẫn tải được', async () => {
    mockApi.listQuoteDocumentReferences.mockResolvedValue([reference('d1')]);
    render(<QuoteDocumentReferences quoteId="q1" canWrite={false} />);
    expect(await screen.findByText('Tài liệu d1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chọn từ tài liệu có sẵn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gỡ' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tải xuống' })).toBeTruthy();
  });

  it('tải xuống lấy ticket theo tham chiếu rồi mở URL', async () => {
    mockApi.listQuoteDocumentReferences.mockResolvedValue([reference('d1')]);
    mockApi.getQuoteDocumentReferenceDownload.mockResolvedValue({ downloadUrl: 'https://files.example/x' });
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    render(<QuoteDocumentReferences quoteId="q1" canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tải xuống' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://files.example/x', '_blank', 'noopener'));
    expect(mockApi.getQuoteDocumentReferenceDownload).toHaveBeenCalledWith('q1', 'r-d1');
    open.mockRestore();
  });

  it('gỡ tham chiếu gọi DELETE theo id tham chiếu', async () => {
    mockApi.listQuoteDocumentReferences.mockResolvedValue([reference('d1')]);
    mockApi.removeQuoteDocumentReference.mockResolvedValue([]);
    render(<QuoteDocumentReferences quoteId="q1" canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ' }));
    await waitFor(() => expect(mockApi.removeQuoteDocumentReference).toHaveBeenCalledWith('q1', 'r-d1'));
    expect(await screen.findByText('Chưa có tài liệu có sẵn nào được đính kèm.')).toBeTruthy();
  });

  it('hộp thoại: lọc theo nguồn, đính kèm ứng viên, đánh dấu đã đính kèm', async () => {
    mockApi.listQuoteDocumentReferences.mockResolvedValue([]);
    mockApi.listQuoteDocumentCandidates.mockResolvedValue([candidate('d1'), candidate('d2', true)]);
    mockApi.addQuoteDocumentReference.mockResolvedValue([reference('d1')]);
    render(<QuoteDocumentReferences quoteId="q1" canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn từ tài liệu có sẵn' }));
    expect(await screen.findByText('Tài liệu d2')).toBeTruthy();
    expect(screen.getAllByText('Đã đính kèm')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'nguồn Dự án' }));
    await waitFor(() => expect(mockApi.listQuoteDocumentCandidates).toHaveBeenLastCalledWith('q1', { sourceType: 'opportunity', search: undefined }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đính kèm' }));
    await waitFor(() => expect(mockApi.addQuoteDocumentReference).toHaveBeenCalledWith('q1', { documentId: 'd1' }));
  });

  it('hộp thoại hiện lỗi tiếng Việt của server khi đính kèm thất bại', async () => {
    mockApi.listQuoteDocumentReferences.mockResolvedValue([]);
    mockApi.listQuoteDocumentCandidates.mockResolvedValue([candidate('d1')]);
    mockApi.addQuoteDocumentReference.mockRejectedValue({ message: 'Báo giá đã đủ số tài liệu tối đa.' });
    render(<QuoteDocumentReferences quoteId="q1" canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn từ tài liệu có sẵn' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đính kèm' }));
    expect(await screen.findByText('Báo giá đã đủ số tài liệu tối đa.')).toBeTruthy();
  });
});
