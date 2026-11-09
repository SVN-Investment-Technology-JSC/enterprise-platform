/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  type CrmCapabilities,
  type SalesOrganization,
  type SalesOrganizationSummary,
} from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { resolveCrmView, visibleCrmPages } from '../crm-nav.model';
import { CrmSettingsPage } from './crm-settings';
import { SalesOrganizationSettings } from './sales-organization-settings';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./sales-organization-settings.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  toast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
  },
  SearchableSelect: () => null,
  Popconfirm: ({ children, title, description, onConfirm }: { children: ReactNode; title: string; description?: string; onConfirm: () => unknown }) => (
    <span>
      {children}
      <button type="button" title={description} onClick={() => void onConfirm()}>{`xác nhận ${title}`}</button>
    </span>
  ),
}));

jest.mock('../components/crm-ui', () => ({
  CrmDialog: ({ title, error, children, onClose, onSubmit }: { title: string; error?: string; children: ReactNode; onClose: () => void; onSubmit: () => void }) => (
    <div role="dialog" aria-label={title}>
      {error ? <p role="status">{error}</p> : null}
      {children}
      <button type="button" onClick={onClose}>
        Huỷ
      </button>
      <button type="button" onClick={onSubmit}>
        Lưu
      </button>
    </div>
  ),
  Field: ({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) => (
    <label data-field={label} data-required={required ? 'true' : 'false'}>
      <span>{label}</span>
      {children}
      {error ? <span data-field-error={label}>{error}</span> : null}
    </label>
  ),
}));

jest.mock('antd', () => ({
  Table: ({
    columns,
    dataSource,
    rowKey,
    locale,
  }: {
    columns: { key?: string; title?: string; dataIndex?: string; render?: (value: unknown, row: unknown, index: number) => unknown }[];
    dataSource: Record<string, unknown>[];
    rowKey: string;
    locale?: { emptyText?: string };
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={column.key ?? column.dataIndex ?? index}>{column.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataSource.length ? (
          dataSource.map((row, index) => (
            <tr key={String(row[rowKey])} data-row-key={String(row[rowKey])}>
              {columns.map((column, cell) => (
                <td key={column.key ?? column.dataIndex ?? cell}>
                  {(column.render ? column.render(column.dataIndex ? row[column.dataIndex] : undefined, row, index) : row[column.dataIndex ?? '']) as never}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td>{locale?.emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  ),
}));

const mockApi = {
  listSalesOrganizations: jest.fn(),
  getSalesOrganization: jest.fn(),
  createSalesOrganization: jest.fn(),
  updateSalesOrganization: jest.fn(),
  deleteSalesOrganization: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  ...Object.fromEntries(
    ['listSalesOrganizations', 'getSalesOrganization', 'createSalesOrganization', 'updateSalesOrganization', 'deleteSalesOrganization'].map(
      (name) => [name, (...args: unknown[]) => mockApi[name as keyof typeof mockApi](...args)],
    ),
  ),
}));

const mockReadImage = jest.fn();
jest.mock('../quote-layout/layout-image', () => ({ readLayoutImage: (...args: unknown[]) => mockReadImage(...args) }));

const mockClearCache = jest.fn();
jest.mock('../quotes/use-sales-organizations', () => ({ clearSalesOrganizationCache: () => mockClearCache() }));

let mockCapabilities: CrmCapabilities = CRM_NO_CAPABILITIES;
jest.mock('../crm-context', () => ({ useCrm: () => ({ capabilities: mockCapabilities }) }));

// Các thẻ khác của Cấu hình có API riêng: thay bằng khung rỗng.
jest.mock('./quote-form-settings', () => ({ QuoteFormSettings: () => null }));
jest.mock('./pipeline-settings', () => ({ PipelineSettings: () => null }));
jest.mock('./promotion-settings', () => ({ PromotionSettings: () => null }));
jest.mock('./approval-settings', () => ({ ApprovalSettingsPage: () => null }));
jest.mock('./document-type-settings', () => ({ DocumentTypeSettings: () => null }));
jest.mock('../pricing/discount-policies-page', () => ({ DiscountPoliciesPage: () => null }));
jest.mock('../pricing/price-lists-page', () => ({ PriceListsPage: () => null }));
jest.mock('../pricing/quote-preview-panel', () => ({ QuotePreviewPanel: () => null }));

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGOQkzsBRwzIHABkaggh4UPC6AAAAABJRU5ErkJggg==';
const MANAGER: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canManage: true };

function summary(patch: Partial<SalesOrganizationSummary> = {}): SalesOrganizationSummary {
  return {
    id: 'org-a',
    code: 'A',
    name: 'Công ty A',
    shortName: null,
    address: '1 Láng Hạ, Hà Nội',
    taxCode: '0101234567',
    phone: '0241111111',
    email: 'a@a.vn',
    website: null,
    bankAccount: null,
    bankName: null,
    representative: null,
    representativeTitle: null,
    hasLogo: true,
    isDefault: true,
    active: true,
    sortOrder: 0,
    inUse: true,
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...patch,
  };
}
const detail = (patch: Partial<SalesOrganization> = {}): SalesOrganization => ({ ...summary(), logo: LOGO, ...patch });

const ORG_A = summary();
const ORG_B = summary({ id: 'org-b', code: null, name: 'Công ty B', taxCode: '0109999999', phone: '0282222222', isDefault: false, hasLogo: false, inUse: false });

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities = MANAGER;
  mockApi.listSalesOrganizations.mockResolvedValue([ORG_A, ORG_B]);
  mockApi.getSalesOrganization.mockImplementation((id: string) =>
    Promise.resolve(id === 'org-a' ? detail() : { ...ORG_B, logo: null }),
  );
  mockApi.updateSalesOrganization.mockResolvedValue(detail());
  mockApi.createSalesOrganization.mockResolvedValue(detail({ id: 'org-c' }));
});

async function renderSettings() {
  render(<SalesOrganizationSettings />);
  const section = await screen.findByRole('region', { name: 'Tổ chức báo giá' });
  await within(section).findByText('Công ty A');
  return section;
}
const rowOf = (section: HTMLElement, name: string) => within(section).getByText(name).closest('tr') as HTMLElement;
const input = (dialog: HTMLElement, label: string) => dialog.querySelector(`[data-field="${label}"] input`) as HTMLInputElement;
const fieldError = (dialog: HTMLElement, label: string) => dialog.querySelector(`[data-field-error="${label}"]`)?.textContent;

function fill(dialog: HTMLElement, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) fireEvent.change(input(dialog, label), { target: { value } });
}

describe('SalesOrganizationSettings (P3C6-05)', () => {
  it('thẻ "Tổ chức báo giá" có trong Cấu hình, mở ra bảng tổ chức', async () => {
    const onTab = jest.fn();
    render(<CrmSettingsPage tab="sales-organizations" onTab={onTab} />);
    const tab = screen.getByRole('tab', { name: 'Tổ chức báo giá' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('region', { name: 'Tổ chức báo giá' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Mẫu và loại báo giá' }));
    fireEvent.click(tab);
    expect(onTab).toHaveBeenLastCalledWith('sales-organizations');
  });

  it('bảng: tên, MST, điện thoại, nhãn Mặc định, trạng thái; nút Sửa, Đặt mặc định, Tắt, Xoá', async () => {
    const section = await renderSettings();
    expect(mockApi.listSalesOrganizations).toHaveBeenCalledWith(true);
    for (const header of ['Tên', 'MST', 'Điện thoại', 'Trạng thái']) expect(within(section).getByRole('columnheader', { name: header })).toBeTruthy();
    const a = rowOf(section, 'Công ty A');
    expect(within(a).getByText('Mặc định')).toBeTruthy();
    expect(within(a).getByText('0101234567')).toBeTruthy();
    expect(within(a).getByText('Đang dùng')).toBeTruthy();
    expect(within(a).queryByRole('button', { name: 'Đặt mặc định' })).toBeNull();
    const b = rowOf(section, 'Công ty B');
    expect(within(b).queryByText('Mặc định')).toBeNull();
    for (const name of ['Sửa', 'Đặt mặc định', 'Tắt', 'Xoá']) expect(within(b).getByRole('button', { name })).toBeTruthy();
  });

  it('TC-ORG-13: thêm tổ chức thiếu MST báo lỗi tại ô, không gọi API; các ô bắt buộc có dấu *', async () => {
    const section = await renderSettings();
    fireEvent.click(within(section).getByRole('button', { name: /Thêm tổ chức/ }));
    const dialog = screen.getByRole('dialog', { name: 'Thêm tổ chức báo giá' });
    for (const label of ['Tên công ty', 'Địa chỉ', 'Mã số thuế', 'Điện thoại', 'Email']) {
      expect(dialog.querySelector(`[data-field="${label}"]`)?.getAttribute('data-required')).toBe('true');
    }
    for (const label of ['Mã', 'Tên viết tắt', 'Website', 'Số tài khoản', 'Ngân hàng', 'Người đại diện', 'Chức vụ']) {
      expect(dialog.querySelector(`[data-field="${label}"]`)?.getAttribute('data-required')).toBe('false');
    }
    fill(dialog, { 'Tên công ty': 'Công ty C', 'Địa chỉ': '3 Kim Mã', 'Điện thoại': '0243333333', Email: 'c@c.vn' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(fieldError(dialog, 'Mã số thuế')).toBe('Vui lòng nhập mã số thuế.');
    expect(within(dialog).getByRole('status').textContent).toBe('Vui lòng nhập mã số thuế.');
    expect(mockApi.createSalesOrganization).not.toHaveBeenCalled();

    fill(dialog, { 'Mã số thuế': '12345' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(fieldError(dialog, 'Mã số thuế')).toMatch(/10 chữ số/);
    expect(mockApi.createSalesOrganization).not.toHaveBeenCalled();
  });

  it('TC-ORG-13: thêm đủ trường có logo thì gọi API, toast, tải lại bảng và xoá cache của màn báo giá', async () => {
    mockReadImage.mockResolvedValue({ ok: true, dataUrl: LOGO });
    const section = await renderSettings();
    fireEvent.click(within(section).getByRole('button', { name: /Thêm tổ chức/ }));
    const dialog = screen.getByRole('dialog', { name: 'Thêm tổ chức báo giá' });
    fill(dialog, {
      'Tên công ty': ' Công ty C ',
      'Địa chỉ': '3 Kim Mã',
      'Mã số thuế': '0103333333-001',
      'Điện thoại': '0243333333',
      Email: 'c@c.vn',
      'Người đại diện': 'Lê Văn C',
    });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await act(async () => {
      fireEvent.change(within(dialog).getByTestId('organization-logo-input'), { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
    });
    expect(within(dialog).getByRole('img', { name: 'Logo tổ chức' }).getAttribute('src')).toBe(LOGO);
    mockApi.listSalesOrganizations.mockResolvedValue([ORG_A, ORG_B, summary({ id: 'org-c', name: 'Công ty C', isDefault: false })]);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    });
    expect(mockApi.createSalesOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Công ty C',
        taxCode: '0103333333-001',
        representative: 'Lê Văn C',
        shortName: null,
        logo: LOGO,
        isDefault: true,
        active: true,
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Đã thêm tổ chức báo giá.');
    expect(mockClearCache).toHaveBeenCalled();
    expect(await within(section).findByText('Công ty C')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('logo sai loại báo lỗi tiếng Việt; Sửa đọc logo đã lưu, Bỏ logo thì gửi logo null', async () => {
    mockReadImage.mockResolvedValue({ ok: false, message: 'Chỉ nhận ảnh PNG hoặc JPEG.' });
    const section = await renderSettings();
    fireEvent.click(within(rowOf(section, 'Công ty A')).getByRole('button', { name: 'Sửa' }));
    const dialog = await waitFor(() => {
      const found = screen.getByRole('dialog', { name: 'Sửa tổ chức báo giá' });
      expect(input(found, 'Tên công ty').value).toBe('Công ty A');
      return found;
    });
    expect(within(dialog).getByRole('img', { name: 'Logo tổ chức' }).getAttribute('src')).toBe(LOGO);
    await act(async () => {
      fireEvent.change(within(dialog).getByTestId('organization-logo-input'), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    });
    expect(within(dialog).getByRole('alert').textContent).toBe('Chỉ nhận ảnh PNG hoặc JPEG.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ logo' }));
    expect(within(dialog).queryByRole('img')).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    });
    expect(mockApi.updateSalesOrganization).toHaveBeenCalledWith('org-a', expect.objectContaining({ name: 'Công ty A', logo: null, isDefault: true }));
  });

  it('lỗi từ server: fieldErrors hiện tại ô; 409 trùng tên hiện nguyên lời server', async () => {
    const section = await renderSettings();
    fireEvent.click(within(section).getByRole('button', { name: /Thêm tổ chức/ }));
    const dialog = screen.getByRole('dialog', { name: 'Thêm tổ chức báo giá' });
    fill(dialog, { 'Tên công ty': 'Công ty A', 'Địa chỉ': 'x', 'Mã số thuế': '0101234567', 'Điện thoại': '1', Email: 'a@a.vn' });
    mockApi.createSalesOrganization.mockRejectedValueOnce({
      statusCode: 400,
      code: 'SALES_ORGANIZATION_INVALID',
      message: 'Địa chỉ không hợp lệ.',
      fieldErrors: [{ field: 'address', message: 'Địa chỉ không hợp lệ.' }],
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    });
    expect(fieldError(dialog, 'Địa chỉ')).toBe('Địa chỉ không hợp lệ.');
    mockApi.createSalesOrganization.mockRejectedValueOnce({ statusCode: 409, code: 'SALES_ORGANIZATION_NAME_EXISTS', message: 'Tên tổ chức "Công ty A" đã có.' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    });
    expect(within(dialog).getByRole('status').textContent).toBe('Tên tổ chức "Công ty A" đã có.');
    expect(fieldError(dialog, 'Địa chỉ')).toBeUndefined();
  });

  it('TC-ORG-13: Đặt mặc định và Tắt gửi đủ trường (giữ logo đã lưu), tải lại bảng', async () => {
    const section = await renderSettings();
    mockApi.listSalesOrganizations.mockResolvedValue([summary({ isDefault: false }), { ...ORG_B, isDefault: true }]);
    await act(async () => {
      fireEvent.click(within(rowOf(section, 'Công ty B')).getByRole('button', { name: 'Đặt mặc định' }));
    });
    expect(mockApi.updateSalesOrganization).toHaveBeenLastCalledWith('org-b', expect.objectContaining({ name: 'Công ty B', isDefault: true, active: true, logo: null }));
    expect(mockToast.success).toHaveBeenLastCalledWith('Đã đặt tổ chức mặc định.');
    await waitFor(() => expect(within(rowOf(section, 'Công ty B')).getByText('Mặc định')).toBeTruthy());

    mockApi.listSalesOrganizations.mockResolvedValue([summary({ isDefault: false, active: false }), { ...ORG_B, isDefault: true }]);
    await act(async () => {
      fireEvent.click(within(rowOf(section, 'Công ty A')).getByRole('button', { name: 'Tắt' }));
    });
    expect(mockApi.updateSalesOrganization).toHaveBeenLastCalledWith('org-a', expect.objectContaining({ active: false, logo: LOGO }));
    await waitFor(() => expect(within(rowOf(section, 'Công ty A')).getByText('Đã tắt')).toBeTruthy());
    expect(within(rowOf(section, 'Công ty A')).getByRole('button', { name: 'Bật' })).toBeTruthy();
    expect(mockClearCache).toHaveBeenCalledTimes(2);
  });

  it('TC-ORG-13: xoá tổ chức đã có báo giá: hỏi xác nhận, server 409 thì báo lời tiếng Việt, bảng giữ nguyên', async () => {
    const section = await renderSettings();
    const confirm = within(rowOf(section, 'Công ty A')).getByRole('button', { name: 'xác nhận Xoá tổ chức báo giá?' });
    expect(confirm.getAttribute('title')).toBe('Tổ chức đã có báo giá, chỉ tắt được.');
    mockApi.deleteSalesOrganization.mockRejectedValueOnce({ statusCode: 409, code: 'SALES_ORGANIZATION_IN_USE', message: 'Tổ chức đã có báo giá, chỉ tắt được.' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mockApi.deleteSalesOrganization).toHaveBeenCalledWith('org-a');
    expect(mockToast.error).toHaveBeenCalledWith('Tổ chức đã có báo giá, chỉ tắt được.');
    expect(within(section).getByText('Công ty A')).toBeTruthy();

    mockApi.deleteSalesOrganization.mockResolvedValueOnce(undefined);
    mockApi.listSalesOrganizations.mockResolvedValue([ORG_A]);
    await act(async () => {
      fireEvent.click(within(rowOf(section, 'Công ty B')).getByRole('button', { name: 'xác nhận Xoá tổ chức báo giá?' }));
    });
    expect(mockToast.success).toHaveBeenCalledWith('Đã xoá tổ chức báo giá.');
    await waitFor(() => expect(within(section).queryByText('Công ty B')).toBeNull());
  });
});

describe('TC-ORG-14: người không có crm.manage', () => {
  it('không thấy trang Cấu hình (nên không có thẻ Tổ chức báo giá); mở link cũ thì về trang khác', () => {
    const seller: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canWriteQuote: true, canWriteOpportunity: true };
    expect(visibleCrmPages(seller).map((page) => page.id)).not.toContain('settings');
    expect(resolveCrmView('settings', seller)).not.toBe('settings');
    expect(visibleCrmPages(MANAGER).map((page) => page.id)).toContain('settings');
  });

  it('nếu vẫn dựng thẻ thì chỉ xem: không có Thêm, Sửa, Đặt mặc định, Tắt, Xoá', async () => {
    mockCapabilities = { ...CRM_NO_CAPABILITIES, canWriteQuote: true };
    const section = await renderSettings();
    expect(within(section).queryByRole('button', { name: /Thêm tổ chức/ })).toBeNull();
    for (const name of ['Sửa', 'Đặt mặc định', 'Tắt', 'Xoá']) expect(within(section).queryByRole('button', { name })).toBeNull();
  });
});
