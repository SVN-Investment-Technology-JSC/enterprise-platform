/**
 * @jest-environment jsdom
 */
import { CRM_NO_CAPABILITIES, type CrmCapabilities, type QuoteTemplate } from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QuoteFormSettings } from './quote-form-settings';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../components/crm-ui', () => ({ CrmDialog: () => null, Field: ({ children }: { children: unknown }) => children }));
jest.mock('@enterprise-platform/shared-ui', () => ({ SearchableSelect: () => null, toast: { success: jest.fn(), error: jest.fn() } }));

let mockCapabilities: CrmCapabilities = CRM_NO_CAPABILITIES;
jest.mock('../crm-context', () => ({ useCrm: () => ({ capabilities: mockCapabilities }) }));

const mockDesigner = jest.fn();
jest.mock('../quote-layout/layout-designer', () => ({
  LayoutDesigner: (props: { template: QuoteTemplate; onClose: () => void; onSaved: () => void }) => {
    mockDesigner(props);
    return (
      <div role="dialog" aria-label={`Thiết kế ${props.template.name}`}>
        <button type="button" onClick={props.onSaved}>
          giả lập lưu
        </button>
        <button type="button" onClick={props.onClose}>
          giả lập đóng
        </button>
      </div>
    );
  },
}));

const mockTemplates = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listQuoteTemplates: () => mockTemplates(),
  listQuoteTypes: () => Promise.resolve([]),
  listQuoteCustomFields: () => Promise.resolve([]),
  loadQuoteCodeSettings: () => new Promise(() => undefined),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  } as never;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as never;
});

const template = (patch: Partial<QuoteTemplate>): QuoteTemplate => ({
  id: 't1',
  name: 'Báo giá thiết bị',
  discountMode: 'LINE',
  taxMode: 'LINE',
  description: null,
  active: true,
  isDefault: false,
  sortOrder: 1,
  hasLayout: false,
  ...patch,
});

const rows = [template({ id: 't1', name: 'Báo giá thiết bị', hasLayout: true }), template({ id: 't2', name: 'Báo giá dịch vụ', hasLayout: false, active: false })];

async function renderTemplates() {
  render(<QuoteFormSettings />);
  const section = await screen.findByRole('region', { name: 'Mẫu báo giá' });
  await within(section).findByText('Báo giá thiết bị');
  return section;
}

describe('QuoteFormSettings: bố cục mẫu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTemplates.mockResolvedValue(rows);
  });

  it('TC-DS-01, TC-DS-17: cột "Bố cục" ghi "Đã thiết kế" hoặc "Mặc định"', async () => {
    mockCapabilities = { ...CRM_NO_CAPABILITIES, canManage: true };
    const section = await renderTemplates();
    expect(within(section).getByRole('columnheader', { name: 'Bố cục' })).toBeTruthy();
    const designed = within(section).getByText('Báo giá thiết bị').closest('tr') as HTMLElement;
    const plain = within(section).getByText('Báo giá dịch vụ').closest('tr') as HTMLElement;
    expect(within(designed).getByText('Đã thiết kế')).toBeTruthy();
    expect(within(plain).getByText('Mặc định')).toBeTruthy();
  });

  it('TC-P3PERM-03: không có crm.manage thì không có nút "Thiết kế bố cục"', async () => {
    mockCapabilities = { ...CRM_NO_CAPABILITIES, canWriteOpportunity: true };
    const section = await renderTemplates();
    expect(within(section).queryByRole('button', { name: 'Thiết kế bố cục' })).toBeNull();
  });

  it('có crm.manage (hoặc quản trị tenant): mỗi dòng có nút mở trình thiết kế; lưu thì tải lại danh sách mẫu', async () => {
    mockCapabilities = { ...CRM_NO_CAPABILITIES, isTenantAdmin: true };
    const section = await renderTemplates();
    const buttons = within(section).getAllByRole('button', { name: 'Thiết kế bố cục' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(mockDesigner).toHaveBeenLastCalledWith(expect.objectContaining({ template: expect.objectContaining({ id: 't2' }) }));
    expect(mockTemplates).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'giả lập lưu' }));
    });
    expect(mockTemplates).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'giả lập đóng' }));
    expect(screen.queryByRole('dialog', { name: 'Thiết kế Báo giá dịch vụ' })).toBeNull();
  });
});
