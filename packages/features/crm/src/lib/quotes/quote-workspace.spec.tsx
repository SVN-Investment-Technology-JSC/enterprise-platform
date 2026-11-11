/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  defaultQuoteLayout,
  type CrmCapabilities,
  type CustomFieldDefinition,
  type QuoteDetail,
  type QuoteLayout,
  type QuoteTemplate,
  type QuoteVersion,
  type SalesOrganization,
  type SalesOrganizationSummary,
} from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type ReactNode } from 'react';
import { emptyQuoteLayoutData } from '../quote-layout/quote-layout.data';
import { fixtureCustomer, fixtureDetail, fixtureLine, fixtureSeller, fixtureSellerVersion, fixtureVersion } from '../quote-layout/quote-layout.fixtures';
import { clearTemplateLayoutCache } from '../quote-layout/use-template-layout';
import { clearSalesOrganizationCache } from './use-sales-organizations';
import {
  EMPTY_SELLER_STATE,
  MANUAL_ORGANIZATION,
  sameSeller,
  savedSeller,
  sellerErrors,
  sellerPatch,
  sellerStateFromOrganization,
  withSellerDraft,
} from './quote-seller.model';
import { QUOTE_READ_ONLY_NOTE, QuoteEditor, openPickerAfterLoad } from './quote-editor';
import { MISSING_SNAPSHOT_NOTE, QuotePreviewPane, previewLayoutChoice } from './quote-preview-pane';
import { GeneralFields, type GeneralState } from './quote-form-parts';
import {
  QuoteActionBar,
  QuoteWorkspace,
  blankQuoteDetail,
  draftedDetail,
  generalPatch,
  sameGeneral,
  savedGeneral,
} from './quote-workspace';
import { CreateQuoteDialog, NewQuoteScreen, QuotesPage, customerOptions, newQuoteHash } from './quotes-page';
import { fixtureTask, fixtureTaskList } from '../tasks/tasks.fixtures';

// --- Mô phỏng ------------------------------------------------------------------------------------------------------

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../pricing/pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./quote-workspace.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../quote-layout/quote-layout.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

jest.mock('antd', () => ({
  Table: ({
    columns,
    dataSource,
    rowKey,
    onRow,
    locale,
  }: {
    columns: { key?: string; dataIndex?: string; render?: (value: unknown, row: unknown, index: number) => unknown }[];
    dataSource: Record<string, unknown>[];
    rowKey: string;
    onRow?: (row: unknown, index: number) => Record<string, unknown>;
    locale?: { emptyText?: string };
  }) => (
    <table>
      <tbody>
        {dataSource.length ? (
          dataSource.map((row, index) => (
            <tr key={String(row[rowKey])} data-row-key={String(row[rowKey])} {...(onRow?.(row, index) ?? {})}>
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

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({
    options,
    value,
    placeholder,
    clearable,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    placeholder?: string;
    clearable?: boolean;
    onChange: (value: string) => void;
  }) => (
    <div data-select-value={value} data-placeholder={placeholder}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>{`chọn ${option.label}`}</button>
      ))}
      {clearable && value ? (
        <button type="button" onClick={() => onChange('')}>{`bỏ chọn ${placeholder ?? ''}`}</button>
      ) : null}
    </div>
  ),
  Popconfirm: ({ children }: { children: ReactNode }) => <>{children}</>,
  formatDateTime: (value: string) => value,
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));
jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({
  DatePickerInput: ({ value, onChange, 'aria-label': label }: { value?: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const mockExportMenu = jest.fn();
jest.mock('../quote-layout/export-menu', () => ({
  ExportMenu: (props: { fileName: string; disabled?: boolean }) => {
    mockExportMenu(props);
    return (
      <button type="button" disabled={props.disabled} data-file-name={props.fileName}>
        Xuất
      </button>
    );
  },
}));

// Các khối thu gọn có API riêng, đã có spec riêng: thay bằng khung rỗng.
jest.mock('./business-plan-panel', () => ({ BusinessPlanPanel: () => <div>PAKD</div> }));
jest.mock('./quote-promotions-panel', () => ({ QuotePromotionsPanel: () => <div>Khuyến mãi</div> }));
jest.mock('./quote-document-references', () => ({ QuoteDocumentReferences: () => <div>Tham chiếu tài liệu</div> }));
jest.mock('./quote-compare', () => ({ QuoteCompare: () => <div>So sánh</div> }));
jest.mock('../documents', () => ({ DocumentsPanel: () => <div>Tài liệu</div> }));
jest.mock('./quote-form-parts', () => ({
  ...jest.requireActual('./quote-form-parts'),
  FollowersPanel: () => <div>Người theo dõi</div>,
  LinksPanel: () => <div>Đối tượng liên quan</div>,
}));

const mockApi = {
  getQuote: jest.fn(),
  getCustomer: jest.fn(),
  getOpportunity: jest.fn(),
  updateQuoteVersion: jest.fn(),
  quoteAction: jest.fn(),
  addQuoteLines: jest.fn(),
  removeQuoteLine: jest.fn(),
  updateQuoteLine: jest.fn(),
  convertQuote: jest.fn(),
  searchCatalog: jest.fn(),
  listQuoteTemplates: jest.fn(),
  listQuoteTypes: jest.fn(),
  listQuoteCustomFields: jest.fn(),
  generateQuoteCode: jest.fn(),
  getQuoteTemplateLayout: jest.fn(),
  createQuote: jest.fn(),
  listCustomers: jest.fn(),
  listOpportunities: jest.fn(),
  listQuotes: jest.fn(),
  listSalesOrganizations: jest.fn(),
  getSalesOrganization: jest.fn(),
  getMyTasks: jest.fn(),
  deleteQuote: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  // Nhà máy mock chạy trước khi `mockApi` khởi tạo: chỉ tra hàm lúc gọi.
  ...Object.fromEntries(
    [
      'getQuote', 'getCustomer', 'getOpportunity', 'updateQuoteVersion', 'quoteAction', 'addQuoteLines', 'removeQuoteLine',
      'updateQuoteLine', 'convertQuote', 'searchCatalog', 'listQuoteTemplates', 'listQuoteTypes', 'listQuoteCustomFields',
      'generateQuoteCode', 'getQuoteTemplateLayout', 'createQuote', 'listCustomers', 'listOpportunities', 'listQuotes',
      'listSalesOrganizations', 'getSalesOrganization', 'getMyTasks', 'deleteQuote',
    ].map((name) => [name, (...args: unknown[]) => mockApi[name as keyof typeof mockApi](...args)]),
  ),
}));

const WRITER: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canRead: true, canWriteQuote: true } as CrmCapabilities;
const READER: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canRead: true } as CrmCapabilities;
let mockCrm = { capabilities: WRITER, people: [{ userId: 'u1', displayName: 'Nguyễn Văn An' }], currentUserId: 'u9' };
jest.mock('../crm-context', () => ({
  ...jest.requireActual('../crm-context'),
  useCrm: () => mockCrm,
}));

// --- Dữ liệu ---------------------------------------------------------------------------------------------------------

const titled = (text: string, extra: QuoteLayout['blocks'] = []): QuoteLayout => {
  const base = defaultQuoteLayout();
  return { ...base, blocks: [...base.blocks.map((block) => (block.type === 'title' ? { ...block, text } : block)), ...extra] };
};
const template = (id: string, patch: Partial<QuoteTemplate> = {}): QuoteTemplate => ({
  id,
  name: `Mẫu ${id}`,
  discountMode: 'LINE',
  taxMode: 'LINE',
  description: null,
  active: true,
  isDefault: false,
  sortOrder: 0,
  hasLayout: true,
  ...patch,
});
const TEMPLATES = [template('t1', { isDefault: true }), template('t2', { discountMode: 'ORDER', hasLayout: true }), template('t3', { hasLayout: false })];
const layoutFor = (id: string) => Promise.resolve({ layout: titled(`TIÊU ĐỀ ${id}`), updatedAt: null, updatedBy: null });

const sent = (patch: Partial<QuoteVersion> = {}) => fixtureVersion({ versionNo: 2, status: 'SENT', sentAt: '2026-11-02T00:00:00.000Z', ...patch });

function stubLookups(fields: CustomFieldDefinition[] = []) {
  mockApi.listQuoteTemplates.mockResolvedValue(TEMPLATES);
  mockApi.listQuoteTypes.mockResolvedValue([{ id: 'qt1', name: 'Thiết bị', description: null, active: true, isDefault: true, sortOrder: 0 }]);
  mockApi.listQuoteCustomFields.mockResolvedValue(fields);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearTemplateLayoutCache();
  clearSalesOrganizationCache();
  mockCrm = { capabilities: WRITER, people: [{ userId: 'u1', displayName: 'Nguyễn Văn An' }], currentUserId: 'u9' };
  stubLookups();
  mockApi.getQuoteTemplateLayout.mockImplementation(layoutFor);
  mockApi.getCustomer.mockResolvedValue(fixtureCustomer());
  mockApi.searchCatalog.mockResolvedValue([]);
  mockApi.listCustomers.mockResolvedValue({ items: [] });
  mockApi.listOpportunities.mockResolvedValue({ items: [] });
  mockApi.listSalesOrganizations.mockResolvedValue([]);
});

const title = () => document.querySelector('[data-block-type="title"]')?.textContent ?? '';

// --- Hàm thuần -------------------------------------------------------------------------------------------------------

describe('previewLayoutChoice (P3C4-03)', () => {
  const snapshot = titled('BẢN CHỤP');

  it.each(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const)('TC-QW-04, TC-QW-05: %s dùng bố cục hiện tại của mẫu', (status) => {
    expect(previewLayoutChoice(fixtureVersion({ status, layoutSnapshot: snapshot }))).toEqual({ snapshot: null, missingSnapshot: false });
  });

  it.each(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED'] as const)('TC-QW-05: %s có bản chụp thì dùng bản chụp', (status) => {
    expect(previewLayoutChoice(sent({ status, layoutSnapshot: snapshot }))).toEqual({ snapshot, missingSnapshot: false });
  });

  it('TC-QW-08: đã gửi mà không có bản chụp thì dùng mẫu hiện tại và ghi chú', () => {
    expect(previewLayoutChoice(sent({ layoutSnapshot: null }))).toEqual({ snapshot: null, missingSnapshot: true });
  });

  it('phiên bản thay thế chưa từng gửi: không ghi chú; báo giá mới: bố cục mẫu', () => {
    expect(previewLayoutChoice(fixtureVersion({ status: 'SUPERSEDED', sentAt: null }))).toEqual({ snapshot: null, missingSnapshot: false });
    expect(previewLayoutChoice(undefined)).toEqual({ snapshot: null, missingSnapshot: false });
  });
});

describe('thông tin chung đang sửa', () => {
  it('savedGeneral, sameGeneral, generalPatch ánh xạ như hộp thoại cập nhật thông tin', () => {
    const detail = fixtureDetail();
    const saved = savedGeneral(detail);
    expect(saved).toEqual({ code: 'BG2600001', name: 'Báo giá bơm', quoteDate: '2026-11-01', validUntil: '2026-12-01', templateId: 't1', typeId: 'qt1' });
    expect(sameGeneral(saved, { ...saved })).toBe(true);
    expect(sameGeneral(saved, { ...saved, name: 'Khác' })).toBe(false);
    expect(generalPatch(detail, { ...saved, name: ' Tên mới ', validUntil: '' })).toEqual({
      revision: 3,
      code: undefined,
      quoteName: 'Tên mới',
      quoteDate: '2026-11-01',
      templateId: 't1',
      quoteTypeId: 'qt1',
      validUntil: null,
    });
    expect(generalPatch(detail, { ...saved, code: 'BG-MOI' }).code).toBe('BG-MOI');
  });

  it('draftedDetail: thông tin đang nhập đè lên bản lưu, tiền giữ theo lần tính gần nhất', () => {
    const detail = fixtureDetail();
    const next = draftedDetail(detail, { ...savedGeneral(detail), code: 'BG-MOI', templateId: 't2' }, { templates: TEMPLATES, types: [] });
    expect(next.code).toBe('BG-MOI');
    expect(next.version.form.templateId).toBe('t2');
    expect(next.version.form.templateName).toBe('Mẫu t2');
    expect(next.version.form.discountMode).toBe('LINE');
    expect(next.version.totals).toBe(detail.version.totals);
  });

  it('blankQuoteDetail: báo giá chưa lưu không có dòng, tiền 0, bỏ trường tuỳ biến trống', () => {
    const detail = blankQuoteDetail({
      general: { code: '', name: 'Mới', quoteDate: '', validUntil: '2026-12-31', templateId: 't2', typeId: '' },
      note: ' Ghi chú ',
      customFields: { a: 'x', b: null },
      customer: { id: 'c1', code: 'KH01', name: 'Công ty A' },
      ownerUserId: 'u1',
      templates: TEMPLATES,
      types: [],
      today: '2026-11-06T00:00:00.000Z',
    });
    expect(detail.version.lines).toEqual([]);
    expect(detail.version.totals.totalAmount).toBe(0);
    expect(detail.version.form.discountMode).toBe('ORDER');
    expect(detail.version.form.customFields).toEqual({ a: 'x' });
    expect(detail.version.note).toBe('Ghi chú');
    expect(detail.customerName).toBe('Công ty A');
  });

  it('newQuoteHash: điền sẵn khách hoặc dự án', () => {
    expect(newQuoteHash()).toBe('new');
    expect(newQuoteHash({ customerId: 'c1' })).toBe('new?customerId=c1');
    expect(newQuoteHash({ opportunityId: 'o1', customerId: 'c1' })).toBe('new?opportunityId=o1');
  });

  it('TC-QW-29: lựa chọn khách có mã ở phần mô tả để gõ mã cũng tìm ra', () => {
    expect(customerOptions([{ id: 'c1', name: 'QA Công ty TNHH Khách hàng 01', code: 'QA-CRM-KH01' }])).toEqual([
      { value: 'c1', label: 'QA Công ty TNHH Khách hàng 01', description: 'QA-CRM-KH01' },
    ]);
  });
});

// --- Khung xem trước -----------------------------------------------------------------------------------------------

describe('QuotePreviewPane (P3C4-03, P3C4-07)', () => {
  const data = emptyQuoteLayoutData();

  it('TC-QW-05, TC-QW-31, TC-QW-32: đã gửi có bản chụp thì dựng và xuất đúng bản chụp, không tải mẫu', () => {
    const snapshot = titled('BẢN CHỤP LÚC GỬI');
    render(<QuotePreviewPane choice={previewLayoutChoice(sent({ layoutSnapshot: snapshot }))} templateId="t1" data={data} fileName="BG2600001_v2" />);
    expect(title()).toContain('BẢN CHỤP LÚC GỬI');
    expect(screen.getByText('Bản chụp lúc gửi khách')).toBeTruthy();
    expect(mockApi.getQuoteTemplateLayout).not.toHaveBeenCalled();
    expect(mockExportMenu).toHaveBeenLastCalledWith(expect.objectContaining({ layout: snapshot, fileName: 'BG2600001_v2', disabled: false }));
  });

  it('TC-QW-04, TC-QW-08: bố cục hiện tại của mẫu; đã gửi mà không có bản chụp thì có ghi chú', async () => {
    render(<QuotePreviewPane choice={previewLayoutChoice(sent())} templateId="t1" templateName="Mẫu t1" data={data} fileName="f" />);
    expect(screen.getByRole('status').textContent).toBe('Đang tải mẫu…');
    expect(screen.getByText('Xuất').hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    expect(screen.getByText(MISSING_SNAPSHOT_NOTE)).toBeTruthy();
    expect(screen.getByText('Mẫu: Mẫu t1')).toBeTruthy();
    expect(mockExportMenu).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ blocks: expect.any(Array) }), disabled: false }));
  });

  it('TC-QW-06: mẫu chưa có bố cục thì dựng bố cục mặc định, không lỗi', () => {
    render(<QuotePreviewPane choice={previewLayoutChoice(undefined)} templateId="t3" templateHasLayout={false} data={data} fileName="f" />);
    expect(title()).toContain('BÁO GIÁ');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockApi.getQuoteTemplateLayout).not.toHaveBeenCalled();
  });

  it('TC-QW-07: lỗi tải thì báo lỗi, vẫn dựng bố cục mặc định; Thử lại thì hiện bố cục đúng', async () => {
    mockApi.getQuoteTemplateLayout.mockRejectedValueOnce({ status: 500 });
    render(<QuotePreviewPane choice={previewLayoutChoice(undefined)} templateId="t1" data={data} fileName="f" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Không tải được mẫu. Thử lại.');
    expect(title()).toContain('BÁO GIÁ');
    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('TC-QW-09: đổi mẫu thì xem trước đổi theo bố cục mẫu mới', async () => {
    const { rerender } = render(<QuotePreviewPane choice={previewLayoutChoice(undefined)} templateId="t1" data={data} fileName="f" />);
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    rerender(<QuotePreviewPane choice={previewLayoutChoice(undefined)} templateId="t2" data={data} fileName="f" />);
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t2'));
  });
});

// --- Khung 2 cột và nút ----------------------------------------------------------------------------------------------

describe('QuoteWorkspace (P3C4-02)', () => {
  it('TC-QW-01: màn rộng có 2 cột và thanh nút dưới xem trước, không có tab', () => {
    render(<QuoteWorkspace left={<p>Nhập</p>} preview={<p>Xem</p>} actions={<button type="button">Lưu</button>} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('quote-workspace-left').hidden).toBe(false);
    expect(screen.getByTestId('quote-workspace-right').hidden).toBe(false);
    expect(within(screen.getByTestId('quote-workspace-right')).getByRole('toolbar').className).not.toContain('actionBarFixed');
  });

  it('TC-QW-02: màn hẹp có hai tab "Nhập liệu" và "Xem trước", nút ở thanh dưới cố định', () => {
    render(<QuoteWorkspace narrow left={<p>Nhập</p>} preview={<p>Xem</p>} actions={<button type="button">Lưu</button>} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Nhập liệu', 'Xem trước']);
    expect(screen.getByTestId('quote-workspace-right').hidden).toBe(true);
    expect(screen.getByRole('toolbar').className).toContain('actionBarFixed');
    fireEvent.click(screen.getByRole('tab', { name: 'Xem trước' }));
    expect(screen.getByTestId('quote-workspace-left').hidden).toBe(true);
    expect(screen.getByTestId('quote-workspace-right').hidden).toBe(false);
    expect(screen.getByText('Nhập')).toBeTruthy();
  });

  it('TC-QW-02: CSS không để `display` của cột đè thuộc tính `hidden` (jsdom không tính CSS nên kiểm luật trong file)', () => {
    const scss = readFileSync(join(__dirname, 'quote-workspace.module.scss'), 'utf8');
    expect(scss).toMatch(/\.left\[hidden\],\s*\.right\[hidden\]\s*\{\s*display:\s*none;/);
  });

  it('TC-QW-29: gõ ô khác trong lúc "Sinh lại" đang chờ mã: không mất phần vừa gõ', async () => {
    let resolveCode: (value: { code: string }) => void = () => undefined;
    mockApi.generateQuoteCode.mockReturnValueOnce(new Promise((resolve) => (resolveCode = resolve)));
    function Harness() {
      const [general, setGeneral] = useState<GeneralState>({ code: '', name: 'Tên cũ', quoteDate: '', validUntil: '', templateId: '', typeId: '' });
      return <GeneralFields value={general} onChange={setGeneral} templates={[]} types={[]} codeEditable generateCode />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Sinh lại' }));
    fireEvent.change(screen.getByDisplayValue('Tên cũ'), { target: { value: 'Tên mới' } });
    await act(async () => resolveCode({ code: 'BG2600999' }));
    expect((screen.getByLabelText('Mã báo giá') as HTMLInputElement).value).toBe('BG2600999');
    expect(screen.getByDisplayValue('Tên mới')).toBeTruthy();
  });

  it('người chỉ đọc: không có thanh nút', () => {
    render(<QuoteWorkspace left={<p>Nhập</p>} preview={<p>Xem</p>} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('tóm tắt trạng thái nằm đầu thanh nút dưới xem trước; người chỉ đọc vẫn thấy tóm tắt', () => {
    const { unmount } = render(<QuoteWorkspace left={<p>Nhập</p>} preview={<p>Xem</p>} actions={<button type="button">Lưu</button>} summary={<span>BG1 · Nháp · Phiên bản 2</span>} />);
    const bar = screen.getByRole('toolbar', { name: 'Thao tác báo giá' });
    expect(within(bar).getByRole('group', { name: 'Tình trạng báo giá' }).textContent).toBe('BG1 · Nháp · Phiên bản 2');
    expect(within(screen.getByTestId('quote-workspace-right')).getByText('BG1 · Nháp · Phiên bản 2')).toBeTruthy();
    unmount();
    render(<QuoteWorkspace left={<p>Nhập</p>} preview={<p>Xem</p>} summary={<span>BG1 · Đã gửi</span>} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByRole('group', { name: 'Tình trạng báo giá' }).textContent).toBe('BG1 · Đã gửi');
  });
});

describe('QuoteActionBar (P3C4-05)', () => {
  const props = () => ({
    dirty: false,
    busy: false,
    canSave: false,
    canSubmit: true,
    canSend: false,
    onCancel: jest.fn(),
    onSave: jest.fn(),
    onSubmit: jest.fn(),
    onSend: jest.fn(),
  });

  it('TC-QW-23: không có thay đổi thì Huỷ tắt; có thay đổi thì hỏi trước khi bỏ', () => {
    const base = props();
    const { rerender } = render(<QuoteActionBar {...base} />);
    expect((screen.getByRole('button', { name: 'Huỷ' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<QuoteActionBar {...base} dirty canSave />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    const dialog = screen.getByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ở lại' }));
    expect(base.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(base.onCancel).toHaveBeenCalledTimes(1);
  });

  it('TC-QW-21: nút bật tắt theo can*, đang bận thì tắt hết', () => {
    const base = props();
    const { rerender } = render(<QuoteActionBar {...base} />);
    const enabled = () => ['Huỷ', 'Lưu', 'Trình duyệt', 'Báo giá'].filter((name) => !(screen.getByRole('button', { name }) as HTMLButtonElement).disabled);
    expect(enabled()).toEqual(['Trình duyệt']);
    rerender(<QuoteActionBar {...base} canSubmit={false} canSend />);
    expect(enabled()).toEqual(['Báo giá']);
    rerender(<QuoteActionBar {...base} busy canSend dirty canSave />);
    expect(enabled()).toEqual([]);
  });
});

// --- Màn báo giá (tích hợp) ------------------------------------------------------------------------------------------

function renderEditor(detail: QuoteDetail) {
  mockApi.getQuote.mockResolvedValue(detail);
  return render(<QuoteEditor quoteId={detail.id} onBack={jest.fn()} onOpenCustomer={jest.fn()} onOpenOpportunity={jest.fn()} />);
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('QuoteEditor 2 cột (P3C4-02 đến P3C4-05)', () => {
  it('xoá báo giá: người phụ trách thấy nút, hỏi lại, xoá xong về danh sách; người khác không thấy nút', async () => {
    mockCrm = { ...mockCrm, currentUserId: 'u1' };
    mockApi.deleteQuote.mockResolvedValue(undefined);
    const single = fixtureDetail(fixtureVersion(), { versions: [{ versionNo: 1, status: 'DRAFT', totalAmount: 0, createdAt: '2026-11-01T00:00:00Z' }] as QuoteDetail['versions'] });
    mockApi.getQuote.mockResolvedValue(single);
    const onBack = jest.fn();
    const { unmount } = render(<QuoteEditor quoteId="q1" onBack={onBack} onOpenCustomer={jest.fn()} onOpenOpportunity={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá báo giá' }));
    const dialog = screen.getByRole('dialog', { name: /Xoá báo giá/ });
    expect(dialog.textContent).toContain('không khôi phục được');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xoá báo giá' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(mockApi.deleteQuote).toHaveBeenCalledWith('q1');
    unmount();
    mockCrm = { ...mockCrm, currentUserId: 'u9' };
    renderEditor(single);
    await screen.findByText('Thông tin chung');
    expect(screen.queryByRole('button', { name: 'Xoá báo giá' })).toBeNull();
  });

  it('TC-QW-01: trái có Thông tin chung, Dòng hàng, khối thu gọn; phải có Xem trước và 4 nút', async () => {
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    const left = screen.getByTestId('quote-workspace-left');
    expect(within(left).getByRole('region', { name: 'Dòng báo giá' })).toBeTruthy();
    expect(['Phương án kinh doanh (PAKD)', 'Khuyến mãi', 'Tài liệu', 'Liên quan', 'Lịch sử'].every((name) =>
      Array.from(left.querySelectorAll('summary')).some((summary) => summary.textContent === name),
    )).toBe(true);
    const right = screen.getByTestId('quote-workspace-right');
    expect(within(right).getByRole('region', { name: 'Xem trước báo giá' })).toBeTruthy();
    expect(within(right).getAllByRole('button').map((item) => item.textContent)).toEqual(expect.arrayContaining(['Huỷ', 'Lưu', 'Trình duyệt', 'Báo giá']));
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    expect(mockExportMenu).toHaveBeenLastCalledWith(expect.objectContaining({ fileName: 'BG2600001_v1' }));
    // Không lộ giá vốn, lợi nhuận trong xem trước.
    expect(within(right).queryByText(/Giá vốn|Lợi nhuận/)).toBeNull();
  });

  it('TC-QW-09: đổi mẫu chưa lưu thì xem trước đổi ngay; Lưu gửi mẫu mới', async () => {
    const saved = fixtureDetail(fixtureVersion({ revision: 4 }));
    mockApi.updateQuoteVersion.mockResolvedValue(saved);
    renderEditor(fixtureDetail());
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    // Ô chọn mẫu nằm ở đầu khung xem trước (cạnh Xuất), không còn ở cột trái.
    const preview = screen.getByRole('region', { name: 'Xem trước báo giá' });
    expect(within(screen.getByTestId('quote-workspace-left')).queryByRole('button', { name: 'chọn Mẫu t2' })).toBeNull();
    expect(within(preview).getByText('Mẫu')).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: 'chọn Mẫu t2' }));
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t2'));
    expect(mockApi.updateQuoteVersion).not.toHaveBeenCalled();
    fireEvent.click(button('Lưu'));
    await waitFor(() => expect(mockApi.updateQuoteVersion).toHaveBeenCalledWith('q1', 1, expect.objectContaining({ revision: 3, templateId: 't2' })));
    expect(mockToast.success).toHaveBeenCalledWith('Đã lưu báo giá.');
  });

  it('Cập nhật thông tin báo giá ngay trên trang: thu gọn mặc định, mở ra nhập ghi chú, phí vận chuyển; lưu bằng nút Lưu, không còn hộp thoại', async () => {
    const saved = fixtureDetail(fixtureVersion({ revision: 4 }));
    mockApi.updateQuoteVersion.mockResolvedValue(saved);
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    const block = screen.getByRole('region', { name: 'Cập nhật thông tin báo giá' });
    const toggle = within(block).getByRole('button', { name: /Cập nhật thông tin báo giá/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(block).queryByLabelText(/^Ghi chú/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(within(block).getByLabelText(/^Ghi chú/), { target: { value: 'Giao trong 10 ngày' } });
    fireEvent.change(within(block).getByLabelText(/^Phí vận chuyển thu khách/), { target: { value: '200000' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button('Lưu'));
    await waitFor(() =>
      expect(mockApi.updateQuoteVersion).toHaveBeenCalledWith(
        'q1',
        1,
        expect.objectContaining({ note: 'Giao trong 10 ngày', shipping: expect.objectContaining({ amount: 200000 }) }),
      ),
    );
    // Thu gọn lại được.
    fireEvent.click(toggle);
    expect(within(block).queryByLabelText(/^Ghi chú/)).toBeNull();
  });

  it('TC-QW-10: xem trước cập nhật sau khi ngừng gõ khoảng 300 ms', async () => {
    renderEditor(fixtureDetail());
    await waitFor(() => expect(title()).toContain('Số: BG2600001'));
    jest.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-M' } });
      fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-MOI' } });
      act(() => jest.advanceTimersByTime(200));
      expect(title()).toContain('Số: BG2600001');
      act(() => jest.advanceTimersByTime(150));
      expect(title()).toContain('Số: BG-MOI');
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-QW-19, TC-QW-23: Lưu chỉ bật khi có thay đổi; Huỷ hỏi rồi đưa form về giá trị đã lưu', async () => {
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    expect(button('Lưu').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-MOI' } });
    expect(button('Lưu').disabled).toBe(false);
    fireEvent.click(button('Huỷ'));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect((screen.getByLabelText('Mã báo giá') as HTMLInputElement).value).toBe('BG2600001');
    expect(button('Lưu').disabled).toBe(true);
  });

  it('TC-QW-20: Trình duyệt khi có thay đổi thì lưu trước rồi gửi duyệt với revision mới', async () => {
    const saved = fixtureDetail(fixtureVersion({ revision: 4 }));
    mockApi.updateQuoteVersion.mockResolvedValue(saved);
    mockApi.quoteAction.mockResolvedValue(fixtureDetail(fixtureVersion({ revision: 5, status: 'PENDING' })));
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-MOI' } });
    fireEvent.click(button('Trình duyệt'));
    await waitFor(() => expect(mockApi.quoteAction).toHaveBeenCalledWith('q1', 1, 'submit', { revision: 4 }));
    expect(mockApi.updateQuoteVersion.mock.invocationCallOrder[0]).toBeLessThan(mockApi.quoteAction.mock.invocationCallOrder[0]);
    expect(mockApi.updateQuoteVersion).toHaveBeenCalledWith('q1', 1, expect.objectContaining({ code: 'BG-MOI' }));
  });

  it('Trình duyệt khi không có thay đổi: gửi duyệt ngay, không lưu', async () => {
    mockApi.quoteAction.mockResolvedValue(fixtureDetail(fixtureVersion({ status: 'PENDING' })));
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    fireEvent.click(button('Trình duyệt'));
    await waitFor(() => expect(mockApi.quoteAction).toHaveBeenCalledWith('q1', 1, 'submit', { revision: 3 }));
    expect(mockApi.updateQuoteVersion).not.toHaveBeenCalled();
  });

  it('TC-QW-22: tự lưu lỗi thì dừng, không trình duyệt', async () => {
    mockApi.updateQuoteVersion.mockRejectedValue({ status: 409, message: 'Mã báo giá đã tồn tại.' });
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-TRUNG' } });
    fireEvent.click(button('Trình duyệt'));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockApi.quoteAction).not.toHaveBeenCalled();
  });

  it('TC-QW-22: trường tuỳ biến bắt buộc đang trống thì báo tên trường, không lưu, không trình duyệt', async () => {
    stubLookups([
      { id: 'f1', name: 'Điều khoản thanh toán', fieldType: 'TEXT', required: true, active: true, options: [], sortOrder: 0 } as unknown as CustomFieldDefinition,
    ]);
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    await waitFor(() => expect(mockApi.listQuoteCustomFields).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-MOI' } });
    fireEvent.click(button('Trình duyệt'));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('Điều khoản thanh toán')));
    expect(mockApi.updateQuoteVersion).not.toHaveBeenCalled();
    expect(mockApi.quoteAction).not.toHaveBeenCalled();
  });

  it('TC-P3PERM-08: không có quyền xem giá vốn thì cột trái không hiện giá vốn, lợi nhuận ước tính', async () => {
    const { unmount } = renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    expect(screen.getByText('Lợi nhuận ước tính')).toBeTruthy();
    unmount();

    renderEditor(fixtureDetail(fixtureVersion({ costHidden: true })));
    await screen.findByText('Thông tin chung');
    expect(screen.queryByText(/Giá vốn ước tính|Lợi nhuận ước tính/)).toBeNull();
  });

  it('TC-QW-18: hộp xem dòng chỉ đọc có một nút Đóng ở chân (cùng nút X), không có Huỷ', async () => {
    renderEditor(fixtureDetail(fixtureVersion({ status: 'PENDING' })));
    await screen.findByText('Thông tin chung');
    fireEvent.doubleClick(screen.getAllByRole('row', { name: /^Dòng 1:/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: /^Dòng 1:/ });
    expect(within(dialog).getAllByRole('button', { name: 'Đóng' })).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Huỷ' })).toBeNull();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Đóng' })[1]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Dòng 1:/ })).toBeNull());
  });

  it('TC-QW-21: Chờ duyệt thì Báo giá tắt; Đã duyệt thì gửi khách được', async () => {
    const pending = fixtureDetail(fixtureVersion({ status: 'PENDING' }));
    const { unmount } = renderEditor(pending);
    await screen.findByText('Thông tin chung');
    expect(button('Báo giá').disabled).toBe(true);
    expect(button('Trình duyệt').disabled).toBe(true);
    unmount();

    mockApi.quoteAction.mockResolvedValue(fixtureDetail(sent({ versionNo: 1 })));
    renderEditor(fixtureDetail(fixtureVersion({ status: 'APPROVED' })));
    await screen.findByText('Thông tin chung');
    expect(button('Báo giá').disabled).toBe(false);
    fireEvent.click(button('Báo giá'));
    await waitFor(() => expect(mockApi.quoteAction).toHaveBeenCalledWith('q1', 1, 'send', { revision: 3 }));
    expect(mockToast.success).toHaveBeenCalledWith('Đã đánh dấu gửi khách.');
  });

  it('TC-P3PERM-04: người chỉ đọc xem trước và xuất được, không thấy Lưu, Trình duyệt, Báo giá', async () => {
    mockCrm = { ...mockCrm, capabilities: READER };
    const snapshot = titled('BẢN CHỤP');
    renderEditor(fixtureDetail(sent({ versionNo: 1, layoutSnapshot: snapshot })));
    await screen.findByText('Thông tin chung');
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trình duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Báo giá' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm dòng hàng' })).toBeNull();
    expect(title()).toContain('BẢN CHỤP');
    expect(within(screen.getByRole('region', { name: 'Xem trước báo giá' })).queryByRole('button', { name: /^chọn Mẫu/ })).toBeNull();
    expect(button('Xuất').disabled).toBe(false);
    expect(mockExportMenu).toHaveBeenLastCalledWith(expect.objectContaining({ layout: snapshot, fileName: 'BG2600001_v1' }));
  });

  it('người chỉ đọc mở báo giá Nháp: có dòng báo chỉ có quyền xem; người lập thì không có', async () => {
    const { unmount } = renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    expect(screen.queryByText(QUOTE_READ_ONLY_NOTE)).toBeNull();
    unmount();

    mockCrm = { ...mockCrm, capabilities: READER };
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    expect(within(screen.getByTestId('quote-workspace-left')).getByRole('note').textContent).toContain(QUOTE_READ_ONLY_NOTE);
  });

  it('TC-QW-14: menu Chèn mở chọn mặt hàng và thêm với beforeLineNo của dòng đang chọn', async () => {
    const detail = fixtureDetail(fixtureVersion({ lines: [fixtureLine({ id: 'l1', lineNo: 1 }), fixtureLine({ id: 'l2', lineNo: 2, materialId: 'm2', materialCode: 'VT-02' })] }));
    mockApi.searchCatalog.mockResolvedValue([{ id: 'm9', code: 'VT-09', name: 'Van', unit: 'Cái', kind: 'STOCK', totalAvailable: 3, avgCost: null, salePrice: null }]);
    mockApi.addQuoteLines.mockResolvedValue(detail);
    renderEditor(detail);
    await screen.findByText('Thông tin chung');
    fireEvent.contextMenu(screen.getByRole('row', { name: /^Dòng 2:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chèn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chèn dòng trước dòng 2' });
    fireEvent.click(await within(dialog).findByText('VT-09'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm 1 dòng' }));
    await waitFor(() =>
      expect(mockApi.addQuoteLines).toHaveBeenCalledWith('q1', 1, expect.objectContaining({ revision: 3, beforeLineNo: 2, lines: [expect.objectContaining({ materialId: 'm9' })] })),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Đã chèn 1 dòng trước dòng 2.');
  });

  it('TC-QW-18: báo giá đã gửi bấm đúp mở dòng chỉ đọc', async () => {
    renderEditor(fixtureDetail(sent({ versionNo: 1 })));
    await screen.findByText('Thông tin chung');
    fireEvent.doubleClick(screen.getByRole('row', { name: /^Dòng 1:/ }));
    const dialog = screen.getByRole('dialog', { name: 'Dòng 1: VT-01' });
    expect((within(dialog).getAllByRole('textbox')[0] as HTMLInputElement).disabled).toBe(true);
  });

  it('TC-QW-09: nút Chiết khấu mở phần chiết khấu tổng đơn khi mẫu theo tổng đơn', async () => {
    const order = fixtureVersion();
    renderEditor(fixtureDetail({ ...order, form: { ...order.form, templateId: 't2', templateName: 'Mẫu t2', discountMode: 'ORDER' } }));
    await screen.findByText('Thông tin chung');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa % chiết khấu' }));
    // Mở khối thông tin báo giá ngay trên trang, có ô chiết khấu tổng đơn; không có hộp thoại, chưa lưu gì.
    const block = screen.getByRole('region', { name: 'Cập nhật thông tin báo giá' });
    expect(within(block).getByRole('button', { name: /Cập nhật thông tin báo giá/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(block).getByLabelText(/Chiết khấu tổng đơn \(%\)/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockApi.updateQuoteVersion).not.toHaveBeenCalled();
  });

  it('đổi sang mẫu chiết khấu tổng đơn chưa lưu: "Sửa % chiết khấu" bật, bấm thì mở ô chiết khấu tổng đơn ngay (chưa cần lưu)', async () => {
    const order = fixtureVersion({ revision: 4 });
    mockApi.updateQuoteVersion.mockResolvedValue(fixtureDetail({ ...order, form: { ...order.form, templateId: 't2', templateName: 'Mẫu t2', discountMode: 'ORDER' } }));
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    const discount = screen.getByRole('button', { name: 'Sửa % chiết khấu' }) as HTMLButtonElement;
    expect(discount.disabled).toBe(true);
    fireEvent.click(within(screen.getByRole('region', { name: 'Xem trước báo giá' })).getByRole('button', { name: 'chọn Mẫu t2' }));
    expect(discount.disabled).toBe(false);
    fireEvent.click(discount);
    const block = screen.getByRole('region', { name: 'Cập nhật thông tin báo giá' });
    const percent = within(block).getByLabelText(/Chiết khấu tổng đơn \(%\)/) as HTMLInputElement;
    expect(percent.disabled).toBe(false);
    fireEvent.change(percent, { target: { value: '5' } });
    fireEvent.click(button('Lưu'));
    await waitFor(() =>
      expect(mockApi.updateQuoteVersion).toHaveBeenCalledWith('q1', 1, expect.objectContaining({ templateId: 't2', orderDiscount: { percent: 5 } })),
    );
  });

  it('TC-QW-28: báo giá vừa lập bằng nút + thì mở chọn mặt hàng ngay khi tải xong', async () => {
    openPickerAfterLoad('q1', 'van');
    renderEditor(fixtureDetail());
    const dialog = await screen.findByRole('dialog', { name: 'Thêm dòng báo giá' });
    expect((within(dialog).getByRole('searchbox') as HTMLInputElement).value).toBe('van');
  });
});

// --- Màn lập mới ---------------------------------------------------------------------------------------------------

const CUSTOMER_ID = '11111111-2222-4333-8444-555555555555';

describe('NewQuoteScreen (P3C4-06)', () => {
  it('TC-QW-30: không có quyền lập thì báo và có nút về danh sách, không gọi createQuote', () => {
    mockCrm = { ...mockCrm, capabilities: READER };
    const onBack = jest.fn();
    render(<NewQuoteScreen onBack={onBack} onCreated={jest.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Bạn không có quyền lập báo giá.');
    fireEvent.click(screen.getByRole('button', { name: /Danh sách báo giá/ }));
    expect(onBack).toHaveBeenCalled();
    expect(mockApi.createQuote).not.toHaveBeenCalled();
  });

  it('TC-QW-24, TC-QW-26: chọn sẵn mẫu mặc định, xem trước hiện ngay, dòng hàng khoá', async () => {
    render(<NewQuoteScreen onBack={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.getByText('Lưu báo giá để thêm dòng hàng')).toBeTruthy();
    await waitFor(() => expect(mockApi.getQuoteTemplateLayout).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t1'));
    expect(button('Trình duyệt').disabled).toBe(true);
    expect(button('Báo giá').disabled).toBe(true);
    // Màn lập mới: chọn mẫu ở khung xem trước, đổi là xem trước đổi theo.
    const preview = screen.getByRole('region', { name: 'Xem trước báo giá' });
    expect(within(screen.getByTestId('quote-workspace-left')).queryByRole('button', { name: 'chọn Mẫu t2' })).toBeNull();
    fireEvent.click(within(preview).getByRole('button', { name: 'chọn Mẫu t2' }));
    await waitFor(() => expect(title()).toContain('TIÊU ĐỀ t2'));
  });

  it('TC-QW-25: customerId hợp lệ thì điền sẵn khách và xem trước có tên; id sai thì bỏ qua', async () => {
    mockApi.getCustomer.mockResolvedValue(fixtureCustomer({ id: CUSTOMER_ID, name: 'Công ty Mới' }));
    const { unmount } = render(<NewQuoteScreen customerId={CUSTOMER_ID} onBack={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(document.querySelector(`[data-select-value="${CUSTOMER_ID}"]`)).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('quote-workspace-right').textContent).toContain('Công ty Mới'));
    unmount();

    mockApi.getCustomer.mockClear();
    render(<NewQuoteScreen customerId="abc" onBack={jest.fn()} onCreated={jest.fn()} />);
    expect(mockApi.getCustomer).not.toHaveBeenCalled();
    expect(screen.getByText('Lập báo giá')).toBeTruthy();
  });

  it('TC-QW-29: thiếu khách thì báo ngay ở form, không gọi API', async () => {
    render(<NewQuoteScreen onBack={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(button('Lưu'));
    expect(screen.getByText('Vui lòng chọn dự án bán hàng hoặc khách hàng.')).toBeTruthy();
    expect(mockApi.createQuote).not.toHaveBeenCalled();
  });

  it('TC-QW-27, TC-QW-29: Lưu lập báo giá một lần dù bấm hai lần; lỗi server giữ dữ liệu', async () => {
    mockApi.listCustomers.mockResolvedValue({ items: [fixtureCustomer({ id: CUSTOMER_ID })] });
    let resolve: (value: unknown) => void = () => undefined;
    mockApi.createQuote.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const onCreated = jest.fn();
    render(<NewQuoteScreen onBack={jest.fn()} onCreated={onCreated} />);
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-01' } });
    await waitFor(() => expect(document.querySelector('[data-select-value="t1"]')).toBeTruthy());
    fireEvent.click(button('Lưu'));
    fireEvent.click(button('Lưu'));
    expect(mockApi.createQuote).toHaveBeenCalledTimes(1);
    expect(mockApi.createQuote).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMER_ID, code: 'BG-01', templateId: 't1', quoteTypeId: 'qt1' }));
    await act(async () => resolve({ id: 'q-new', code: 'BG-01' }));
    expect(onCreated).toHaveBeenCalledWith('q-new');

    mockApi.createQuote.mockRejectedValueOnce({ status: 409, code: 'QUOTE_CODE_EXISTS', message: 'Mã báo giá đã tồn tại.' });
    fireEvent.click(button('Lưu'));
    await screen.findByText('Mã báo giá đã tồn tại.');
    expect((screen.getByLabelText('Mã báo giá') as HTMLInputElement).value).toBe('BG-01');
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('TC-QW-28: bấm + khi chưa lưu thì lập báo giá rồi chuyển sang báo giá với chọn mặt hàng mở sẵn', async () => {
    mockApi.listCustomers.mockResolvedValue({ items: [fixtureCustomer({ id: CUSTOMER_ID })] });
    mockApi.createQuote.mockResolvedValue({ id: 'q1', code: 'BG2600001' });
    const onCreated = jest.fn();
    const { unmount } = render(<NewQuoteScreen onBack={jest.fn()} onCreated={onCreated} />);
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    fireEvent.click(button('Thêm dòng hàng'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('q1'));
    unmount();
    renderEditor(fixtureDetail());
    expect(await screen.findByRole('dialog', { name: 'Thêm dòng báo giá' })).toBeTruthy();
  });

  it('TC-QW-33: hộp thoại lập báo giá "Mở màn đầy đủ" chuyển sang màn lập mới, giữ dữ liệu đã nhập', async () => {
    mockApi.listCustomers.mockResolvedValue({ items: [fixtureCustomer({ id: CUSTOMER_ID })] });
    const onOpenFull = jest.fn();
    const onClose = jest.fn();
    const { unmount } = render(<CreateQuoteDialog onClose={onClose} onCreated={jest.fn()} onOpenFull={onOpenFull} />);
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    fireEvent.change(screen.getByLabelText('Mã báo giá'), { target: { value: 'BG-HOP-THOAI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở màn đầy đủ' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenFull).toHaveBeenCalledWith(`new?customerId=${CUSTOMER_ID}`);
    unmount();

    render(<NewQuoteScreen customerId={CUSTOMER_ID} onBack={jest.fn()} onCreated={jest.fn()} />);
    expect((screen.getByLabelText('Mã báo giá') as HTMLInputElement).value).toBe('BG-HOP-THOAI');
    expect(document.querySelector(`[data-select-value="${CUSTOMER_ID}"]`)).toBeTruthy();
  });

  it('TC-QW-33: hộp thoại vẫn lập báo giá như phase 2', async () => {
    mockApi.createQuote.mockResolvedValue({ id: 'q2', code: 'BG2600002' });
    const onCreated = jest.fn();
    render(<CreateQuoteDialog opportunityId="o1" onClose={jest.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lập báo giá' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('q2'));
    expect(mockApi.createQuote).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'o1', customerId: null }));
  });
});

// --- Tổ chức báo giá (P3C6-06) --------------------------------------------------------------------------------------

const LOGO_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGOQkzsBRwzIHABkaggh4UPC6AAAAABJRU5ErkJggg==';
const LOGO_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function organization(patch: Partial<SalesOrganization>): SalesOrganization {
  return {
    id: 'org-a',
    code: null,
    name: 'Công ty An Phát',
    shortName: null,
    address: '25 Trần Duy Hưng, Hà Nội',
    taxCode: '0101111111',
    phone: '024 3333 1111',
    email: 'baogia@anphat.vn',
    website: null,
    bankAccount: null,
    bankName: null,
    representative: null,
    representativeTitle: null,
    hasLogo: true,
    isDefault: true,
    active: true,
    sortOrder: 0,
    inUse: false,
    updatedAt: '2026-11-09T00:00:00.000Z',
    logo: LOGO_A,
    ...patch,
  };
}
const ORG_A = organization({});
const ORG_B = organization({
  id: 'org-b',
  name: 'Công ty Bình Minh',
  address: '9 Nguyễn Huệ, TP. Hồ Chí Minh',
  taxCode: '0302222222',
  phone: '028 3888 2222',
  email: 'sales@binhminh.vn',
  isDefault: false,
  logo: LOGO_B,
});
/** Danh sách không có logo. */
const summaryOf = (org: SalesOrganization): SalesOrganizationSummary =>
  Object.fromEntries(Object.entries(org).filter(([key]) => key !== 'logo')) as unknown as SalesOrganizationSummary;

function stubOrganizations() {
  mockApi.listSalesOrganizations.mockResolvedValue([summaryOf(ORG_A), summaryOf(ORG_B)]);
  mockApi.getSalesOrganization.mockImplementation((id: string) => Promise.resolve(id === 'org-b' ? ORG_B : ORG_A));
}

/** Mục Tổ chức báo giá, mở ra nếu đang thu gọn (thu gọn mặc định). */
const sellerSection = () => {
  const section = screen.getByRole('region', { name: 'Tổ chức báo giá' });
  const toggle = within(section).getByRole('button', { name: /^Tổ chức báo giá/ });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  return section;
};
const sellerInput = (label: string) => within(sellerSection()).getByLabelText(label) as HTMLInputElement;
const previewHeader = () => document.querySelector('[data-block-type="companyHeader"]') as HTMLElement;
const savedWithA = (patch: Partial<QuoteVersion> = {}) =>
  fixtureDetail(fixtureSellerVersion(fixtureSeller({ name: ORG_A.name, address: ORG_A.address, taxCode: ORG_A.taxCode, phone: ORG_A.phone, email: ORG_A.email, shortName: null }), LOGO_A, patch));

describe('Tổ chức báo giá: hàm thuần (P3C6-06)', () => {
  it('savedSeller, sameSeller, sellerPatch: rỗng hết thì gửi seller null; chỉ khác khoảng trắng coi là không đổi', () => {
    const saved = savedSeller(savedWithA());
    expect(saved.organizationId).toBe('org-a');
    expect(saved.seller.name).toBe('Công ty An Phát');
    expect(sameSeller(saved, { ...saved, seller: { ...saved.seller, phone: ` ${saved.seller.phone} ` } })).toBe(true);
    expect(sameSeller(saved, { ...saved, seller: { ...saved.seller, phone: '0900' } })).toBe(false);
    expect(sameSeller(saved, { ...saved, organizationId: 'org-b' })).toBe(false);
    expect(sellerPatch(EMPTY_SELLER_STATE)).toEqual({ organizationId: null, seller: null });
    // Nhập thủ công: không gắn tổ chức, gửi thông tin đang nhập; không chọn: bỏ cả thông tin còn sót.
    expect(sellerPatch({ ...saved, organizationId: MANUAL_ORGANIZATION })).toMatchObject({ organizationId: null, seller: { name: 'Công ty An Phát' } });
    expect(sellerPatch({ ...saved, organizationId: '' })).toEqual({ organizationId: null, seller: null });
    expect(sellerPatch({ ...saved, seller: { ...saved.seller, phone: ' 0900 ' } }).seller).toMatchObject({ phone: '0900', website: null });
  });

  it('sellerErrors chỉ kiểm độ dài, không ép bắt buộc', () => {
    expect(sellerErrors(EMPTY_SELLER_STATE)).toEqual({});
    expect(sellerErrors({ organizationId: '', seller: { ...EMPTY_SELLER_STATE.seller, phone: '1'.repeat(51) } }).phone).toBe('Điện thoại tối đa 50 ký tự.');
  });

  it('withSellerDraft: giữ tổ chức đã lưu thì dùng sellerLogo của server; đổi tổ chức thì logo, tên theo tổ chức mới; bỏ chọn thì không logo', () => {
    const detail = savedWithA();
    const same = withSellerDraft(detail, savedSeller(detail), ORG_B);
    expect(same.version.sellerLogo).toBe(LOGO_A);
    const changed = withSellerDraft(detail, sellerStateFromOrganization(ORG_B), ORG_B);
    expect(changed.version.sellerLogo).toBe(LOGO_B);
    expect(changed.version.form).toMatchObject({ organizationId: 'org-b', organizationName: 'Công ty Bình Minh', seller: expect.objectContaining({ name: 'Công ty Bình Minh' }) });
    const cleared = withSellerDraft(detail, EMPTY_SELLER_STATE, null);
    expect(cleared.version.sellerLogo).toBeNull();
    expect(cleared.version.form.seller).toBeNull();
  });
});

describe('Tổ chức báo giá trên màn báo giá (P3C6-06)', () => {
  beforeEach(stubOrganizations);

  it('TC-ORG-15: màn lập mới chọn sẵn A (chỉ xem thông tin); đổi B thì thông tin và xem trước đổi theo; Nhập thủ công mới hiện ô, Lưu gửi thông tin sửa tay', async () => {
    mockApi.listCustomers.mockResolvedValue({ items: [fixtureCustomer({ id: CUSTOMER_ID })] });
    mockApi.createQuote.mockResolvedValue({ id: 'q-new', code: 'BG-01' });
    render(<NewQuoteScreen onBack={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(sellerSection().textContent).toContain('Công ty An Phát'));
    expect(sellerSection().querySelector('[data-select-value="org-a"]')).toBeTruthy();
    // Chọn tổ chức: thông tin chỉ xem, chưa có ô nhập.
    expect(within(sellerSection()).queryAllByRole('textbox')).toHaveLength(0);
    await waitFor(() => expect(previewHeader().textContent).toContain('Mã số thuế: 0101111111'));
    await waitFor(() => expect(previewHeader().querySelector('img')?.getAttribute('src')).toBe(LOGO_A));

    fireEvent.click(within(sellerSection()).getByText('chọn Công ty Bình Minh'));
    expect(sellerSection().textContent).toContain('9 Nguyễn Huệ, TP. Hồ Chí Minh');
    await waitFor(() => expect(previewHeader().textContent).toContain('Công ty Bình Minh'));
    await waitFor(() => expect(previewHeader().querySelector('img')?.getAttribute('src')).toBe(LOGO_B));
    expect(previewHeader().textContent).not.toContain('An Phát');

    // Nhập thủ công: hiện ô, điền sẵn thông tin đang có (của B) để sửa; không còn logo tổ chức.
    fireEvent.click(within(sellerSection()).getByText('chọn Nhập thủ công'));
    expect(sellerInput('Tên công ty').value).toBe('Công ty Bình Minh');
    fireEvent.change(sellerInput('Điện thoại'), { target: { value: '0900 000 999' } });
    await waitFor(() => expect(previewHeader().textContent).toContain('Điện thoại: 0900 000 999'));
    expect(previewHeader().querySelector('img')).toBeNull();
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    await act(async () => {
      fireEvent.click(button('Lưu'));
    });
    expect(mockApi.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        seller: expect.objectContaining({ name: 'Công ty Bình Minh', phone: '0900 000 999', taxCode: '0302222222' }),
      }),
    );
  });

  it('màn lập mới: bỏ chọn tổ chức thì không có thông tin, gửi organizationId và seller null; hộp thoại lập nhỏ không gửi tổ chức', async () => {
    mockApi.listCustomers.mockResolvedValue({ items: [fixtureCustomer({ id: CUSTOMER_ID })] });
    mockApi.createQuote.mockResolvedValue({ id: 'q-new', code: 'BG-01' });
    const { unmount } = render(<NewQuoteScreen onBack={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(sellerSection().textContent).toContain('Công ty An Phát'));
    expect(sellerSection().textContent).toContain(ORG_A.address);
    fireEvent.click(within(sellerSection()).getByText('bỏ chọn Không chọn tổ chức'));
    expect(sellerSection().textContent).not.toContain(ORG_A.address);
    expect(within(sellerSection()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(sellerSection()).queryByRole('button', { name: /Lấy lại từ tổ chức/ })).toBeNull();
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    await act(async () => {
      fireEvent.click(button('Lưu'));
    });
    expect(mockApi.createQuote).toHaveBeenCalledWith(expect.objectContaining({ organizationId: null, seller: null }));
    unmount();

    mockApi.createQuote.mockResolvedValue({ id: 'q2', code: 'BG2600002' });
    render(<CreateQuoteDialog opportunityId="o1" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('region', { name: 'Tổ chức báo giá' })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Tên báo giá/), { target: { value: 'Báo giá trạm bơm' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lập báo giá' }));
    });
    const request = mockApi.createQuote.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty('organizationId');
    expect(request).not.toHaveProperty('seller');
  });

  it('mục Tổ chức báo giá nằm trên Thông tin chung', async () => {
    renderEditor(savedWithA());
    await screen.findByText('Thông tin chung');
    const left = screen.getByTestId('quote-workspace-left');
    const seller = within(left).getByRole('region', { name: 'Tổ chức báo giá' });
    const general = within(left).getByRole('region', { name: 'Thông tin báo giá' });
    expect(seller.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('TC-ORG-15, TC-ORG-16: báo giá Nháp dùng A, đổi sang B: thông tin, logo xem trước đổi theo; Lấy lại từ tổ chức; Nhập thủ công rồi Lưu', async () => {
    mockApi.updateQuoteVersion.mockResolvedValue(fixtureDetail(fixtureVersion({ revision: 4 })));
    renderEditor(savedWithA());
    await waitFor(() => expect(previewHeader()?.textContent).toContain('Công ty An Phát'));
    expect(previewHeader().querySelector('img')?.getAttribute('src')).toBe(LOGO_A);
    expect(sellerSection().textContent).toContain('baogia@anphat.vn');
    expect(button('Lưu').disabled).toBe(true);

    fireEvent.click(within(sellerSection()).getByText('chọn Công ty Bình Minh'));
    expect(button('Lưu').disabled).toBe(false);
    await waitFor(() => expect(previewHeader().textContent).toContain('Công ty Bình Minh'));
    await waitFor(() => expect(previewHeader().querySelector('img')?.getAttribute('src')).toBe(LOGO_B));
    expect(mockApi.getSalesOrganization).toHaveBeenCalledWith('org-b');
    fireEvent.click(within(sellerSection()).getByRole('button', { name: /Lấy lại từ tổ chức/ }));
    expect(sellerSection().textContent).toContain('028 3888 2222');

    fireEvent.click(within(sellerSection()).getByText('chọn Nhập thủ công'));
    fireEvent.change(sellerInput('Điện thoại'), { target: { value: '0900 111 222' } });
    await act(async () => {
      fireEvent.click(button('Lưu'));
    });
    expect(mockApi.updateQuoteVersion).toHaveBeenCalledWith(
      'q1',
      1,
      expect.objectContaining({
        revision: 3,
        organizationId: null,
        seller: expect.objectContaining({ name: 'Công ty Bình Minh', phone: '0900 111 222' }),
      }),
    );
  });

  it('báo giá đã lưu ở dạng nhập thủ công mở ra vẫn là Nhập thủ công; Huỷ về bản đã lưu; lỗi trường từ server hiện tại ô', async () => {
    const saved = savedWithA();
    const manual = { ...saved, version: { ...saved.version, sellerLogo: null, form: { ...saved.version.form, organizationId: null, organizationName: null } } };
    expect(savedSeller(manual).organizationId).toBe(MANUAL_ORGANIZATION);
    renderEditor(manual);
    await waitFor(() => expect(sellerInput('Tên công ty').value).toBe('Công ty An Phát'));
    expect(sellerSection().querySelector(`[data-select-value="${MANUAL_ORGANIZATION}"]`)).toBeTruthy();
    fireEvent.change(sellerInput('Tên công ty'), { target: { value: 'Tên sửa tay' } });
    fireEvent.click(button('Huỷ'));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(sellerInput('Tên công ty').value).toBe('Công ty An Phát');

    mockApi.updateQuoteVersion.mockRejectedValueOnce({
      statusCode: 400,
      code: 'SALES_ORGANIZATION_INVALID',
      message: 'Email tối đa 200 ký tự.',
      fieldErrors: [{ field: 'email', message: 'Email tối đa 200 ký tự.' }],
    });
    fireEvent.change(sellerInput('Email'), { target: { value: 'x@y.vn' } });
    await act(async () => {
      fireEvent.click(button('Lưu'));
    });
    expect(within(sellerSection()).getByText('Email tối đa 200 ký tự.')).toBeTruthy();
  });

  it('TC-ORG-19: báo giá đã gửi: mục Tổ chức báo giá chỉ xem; xem trước dùng logo chụp lúc gửi dù tổ chức đã đổi logo', async () => {
    mockApi.getSalesOrganization.mockResolvedValue({ ...ORG_A, logo: LOGO_B, phone: '024 9999 9999' });
    renderEditor(savedWithA({ versionNo: 2, status: 'SENT', sentAt: '2026-11-02T00:00:00.000Z' }));
    await waitFor(() => expect(previewHeader()?.textContent).toContain('Công ty An Phát'));
    const section = sellerSection();
    expect(within(section).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(section).queryByRole('button', { name: /Lấy lại từ tổ chức/ })).toBeNull();
    expect(section.textContent).toContain('Công ty An Phát');
    expect(section.textContent).toContain('024 3333 1111');
    expect(previewHeader().textContent).toContain('Điện thoại: 024 3333 1111');
    expect(previewHeader().querySelector('img')?.getAttribute('src')).toBe(LOGO_A);
  });

  it('TC-ORG-19: người chỉ có quyền xem mở báo giá Nháp: mục Tổ chức báo giá chỉ xem; không chọn tổ chức thì ghi rõ', async () => {
    mockCrm = { ...mockCrm, capabilities: READER };
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    const section = sellerSection();
    expect(within(section).queryAllByRole('textbox')).toHaveLength(0);
    expect(section.textContent).toContain('Không chọn tổ chức');
  });
});

describe('Việc cần xử lý trên màn báo giá (P3C7-06)', () => {
  const procedureTarget = { subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: 'inst-1', procedureInstanceCode: 'HS-0007' } as const;

  afterEach(() => {
    window.location.hash = '';
  });

  it('TC-TSK-17: báo giá chờ chính người xem duyệt qua Quy trình: dòng thông báo kèm nút Duyệt trên Quy trình, quay về đúng màn', async () => {
    window.location.hash = '#quotes/q1';
    renderEditor(fixtureDetail(fixtureVersion({ status: 'PENDING' }), { awaitingMyApproval: procedureTarget }));
    const notice = await screen.findByRole('status', { name: 'Đang chờ bạn duyệt' });
    const left = screen.getByTestId('quote-workspace-left');
    // Ở đầu cột trái, trên Tổ chức báo giá.
    expect(left.firstElementChild).toBe(notice);
    expect(notice.textContent).toContain('Báo giá này đang chờ bạn duyệt.');
    expect(notice.textContent).toContain('HS-0007');
    const link = within(notice).getByRole('link', { name: 'Duyệt trên Quy trình' });
    expect(link.getAttribute('href')).toBe(`/modules/procedure?returnTo=${encodeURIComponent('/modules/crm#quotes/q1')}#workspace/inst-1`);
  });

  it('TC-TSK-17: người khác (không chờ mình duyệt) không thấy dòng thông báo', async () => {
    renderEditor(fixtureDetail(fixtureVersion({ status: 'PENDING' }), { awaitingMyApproval: null }));
    await screen.findByText('Thông tin chung');
    expect(screen.queryByText(/đang chờ bạn duyệt/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Duyệt trên Quy trình' })).toBeNull();
  });

  it('duyệt trực tiếp: chỉ tới nút Duyệt; PAKD trình riêng thì câu PAKD và nút mở khối PAKD', async () => {
    const { unmount } = renderEditor(
      fixtureDetail(fixtureVersion({ status: 'PENDING' }), { awaitingMyApproval: { ...procedureTarget, mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null } }),
    );
    const notice = await screen.findByRole('status', { name: 'Đang chờ bạn duyệt' });
    expect(notice.textContent).toContain('Dùng nút Duyệt hoặc Từ chối duyệt');
    expect(within(notice).queryByRole('link')).toBeNull();
    unmount();

    renderEditor(
      fixtureDetail(fixtureVersion(), {
        awaitingMyApproval: { subject: 'BUSINESS_PLAN', mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null },
      }),
    );
    const planNotice = await screen.findByRole('status', { name: 'Đang chờ bạn duyệt' });
    expect(planNotice.textContent).toContain('Phương án kinh doanh của báo giá này đang chờ bạn duyệt.');
    const section = document.getElementById('quote-section-business-plan') as HTMLDetailsElement;
    expect(section.open).toBe(false);
    fireEvent.click(within(planNotice).getByRole('button', { name: 'Mở khối PAKD' }));
    expect(section.open).toBe(true);
  });

  it('TC-TSK-15: mở từ việc PAKD thì khối PAKD mở sẵn và có nút quay về Việc cần xử lý', async () => {
    const back = jest.fn();
    mockApi.getQuote.mockResolvedValue(fixtureDetail());
    render(
      <QuoteEditor quoteId="q1" openPanel="business-plan" onBack={jest.fn()} onBackToTasks={back} onOpenCustomer={jest.fn()} onOpenOpportunity={jest.fn()} />,
    );
    await screen.findByText('Thông tin chung');
    expect((document.getElementById('quote-section-business-plan') as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(button('Quay lại Việc cần xử lý'));
    expect(back).toHaveBeenCalled();
  });

  it('mở bình thường: khối PAKD thu gọn, không có nút quay về Việc cần xử lý', async () => {
    renderEditor(fixtureDetail());
    await screen.findByText('Thông tin chung');
    expect((document.getElementById('quote-section-business-plan') as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByRole('button', { name: 'Quay lại Việc cần xử lý' })).toBeNull();
  });
});

describe('Danh sách báo giá: Cần tôi duyệt (TC-TSK-16)', () => {
  const summary = { ...fixtureDetail(), version: undefined };

  it('người có việc chờ thấy khối Cần tôi duyệt (n); bộ lọc gửi awaitingMyApproval=true, tắt thì không gửi', async () => {
    mockApi.getMyTasks.mockResolvedValue(fixtureTaskList({ awaitingMe: [fixtureTask()] }));
    mockApi.listQuotes.mockResolvedValue({ items: [summary], total: 1 });
    render(<QuotesPage onOpen={jest.fn()} onCreate={jest.fn()} onOpenProcedure={jest.fn()} />);
    expect(await screen.findByText('Cần tôi duyệt (1)')).toBeTruthy();
    await waitFor(() => expect(mockApi.listQuotes).toHaveBeenCalled());
    expect(mockApi.listQuotes.mock.calls[0][0].awaitingMyApproval).toBeUndefined();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Cần tôi duyệt' }));
    await waitFor(() => expect(mockApi.listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ awaitingMyApproval: true, page: 1 })));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cần tôi duyệt' }));
    await waitFor(() => expect(mockApi.listQuotes.mock.calls.at(-1)?.[0].awaitingMyApproval).toBeUndefined());
  });

  it('người không có việc chờ không thấy khối; bật lọc mà không có báo giá thì câu trống riêng', async () => {
    mockApi.getMyTasks.mockResolvedValue(fixtureTaskList());
    mockApi.listQuotes.mockResolvedValue({ items: [], total: 0 });
    render(<QuotesPage onOpen={jest.fn()} onCreate={jest.fn()} />);
    await waitFor(() => expect(mockApi.getMyTasks).toHaveBeenCalled());
    await screen.findByText('Chưa có báo giá nào.');
    expect(screen.queryByText(/Cần tôi duyệt \(/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cần tôi duyệt' }));
    expect(await screen.findByText('Không có báo giá nào đang chờ bạn duyệt.')).toBeTruthy();
  });
});
