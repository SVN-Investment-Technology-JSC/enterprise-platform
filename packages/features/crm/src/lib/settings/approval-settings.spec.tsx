/**
 * @jest-environment jsdom
 */
import { APPROVAL_KINDS, type ApprovalBinding } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { APPROVAL_KIND_HINTS, ApprovalSettingsPage } from './approval-settings';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) => (
    <div data-select-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>{`chọn ${option.label}`}</button>
      ))}
    </div>
  ),
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockApi = {
  listApprovalBindings: jest.fn(),
  listProcedureOptions: jest.fn(),
  saveApprovalBinding: jest.fn(),
  loadQuoteApprovalSettings: jest.fn(),
  loadBusinessPlanSettings: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  listApprovalBindings: (...args: unknown[]) => mockApi.listApprovalBindings(...args),
  listProcedureOptions: (...args: unknown[]) => mockApi.listProcedureOptions(...args),
  saveApprovalBinding: (...args: unknown[]) => mockApi.saveApprovalBinding(...args),
  loadQuoteApprovalSettings: (...args: unknown[]) => mockApi.loadQuoteApprovalSettings(...args),
  loadBusinessPlanSettings: (...args: unknown[]) => mockApi.loadBusinessPlanSettings(...args),
  saveQuoteApprovalSettings: jest.fn(),
  saveBusinessPlanSettings: jest.fn(),
}));

// Chỉ kiểm phần Cách duyệt: người dùng không có crm.manage nên hai khối ngưỡng không tải.
jest.mock('../crm-context', () => ({
  ...jest.requireActual('../crm-context'),
  useCrm: () => ({ capabilities: jest.requireActual('@enterprise-platform/contracts-crm').CRM_NO_CAPABILITIES, people: [] }),
}));

const binding = (kind: ApprovalBinding['kind'], patch: Partial<ApprovalBinding> = {}): ApprovalBinding => ({
  kind,
  mode: 'DIRECT',
  procedureDefinitionId: null,
  procedureDefinitionName: null,
  updatedAt: null,
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.listApprovalBindings.mockResolvedValue(APPROVAL_KINDS.map((kind) => binding(kind)));
  mockApi.listProcedureOptions.mockResolvedValue([{ id: 'pd1', code: 'QT-DBG', name: 'Duyệt báo giá' }]);
  mockApi.loadQuoteApprovalSettings.mockReturnValue(new Promise(() => undefined));
  mockApi.loadBusinessPlanSettings.mockReturnValue(new Promise(() => undefined));
});

describe('Cấu hình loại PAKD ở tab Duyệt báo giá (TC-TSK-06, D3-30)', () => {
  it('có mục Phương án kinh doanh trình riêng kèm chú thích, mặc định Trực tiếp; đặt qua Quy trình "Duyệt báo giá" rồi lưu', async () => {
    const saved = APPROVAL_KINDS.map((kind) =>
      kind === 'BUSINESS_PLAN' ? binding(kind, { mode: 'PROCEDURE', procedureDefinitionId: 'pd1', procedureDefinitionName: 'Duyệt báo giá' }) : binding(kind),
    );
    mockApi.saveApprovalBinding.mockResolvedValue(saved);
    render(<ApprovalSettingsPage />);

    const heading = await screen.findByRole('heading', { name: 'Phương án kinh doanh trình riêng' });
    const form = heading.closest('form') as HTMLFormElement;
    expect(form.textContent).toContain(APPROVAL_KIND_HINTS.BUSINESS_PLAN);
    expect(APPROVAL_KIND_HINTS.BUSINESS_PLAN).toBe('Chỉ áp dụng cho PAKD trình riêng; PAKD đi kèm báo giá theo kết quả duyệt báo giá.');
    expect(form.querySelector('[data-select-value]')?.getAttribute('data-select-value')).toBe('DIRECT');
    // Các loại khác không có chú thích này.
    const quoteForm = screen.getByRole('heading', { name: 'Báo giá vượt ngưỡng' }).closest('form') as HTMLFormElement;
    expect(quoteForm.textContent).not.toContain('PAKD trình riêng');

    // Nút lựa chọn nằm trong `label` của Field nên tên truy cập gồm cả nhãn: tìm theo chữ.
    fireEvent.click(within(form).getByText('chọn Duyệt qua Quy trình'));
    fireEvent.click(await within(form).findByText('chọn Duyệt báo giá'));
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mockApi.saveApprovalBinding).toHaveBeenCalledWith('BUSINESS_PLAN', { mode: 'PROCEDURE', procedureDefinitionId: 'pd1' }),
    );
  });
});
