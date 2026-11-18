/**
 * @jest-environment jsdom
 */
import type { PriceListDetail, PriceListSummary } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PriceListDialog, RATIO_CHANGE_CONFIRM } from './price-lists-page';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('antd', () => ({ Table: () => null }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({ options, value }: { options: { value: string; label: string }[]; value: string }) => (
    <div data-select-value={value}>{options.map((option) => option.label).join(', ')}</div>
  ),
  Popconfirm: () => null,
  toast: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({
  DatePickerInput: ({ value, onChange, 'aria-label': label }: { value?: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const mockApi = { createPriceList: jest.fn(), updatePriceList: jest.fn() };
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  createPriceList: (...args: unknown[]) => mockApi.createPriceList(...args),
  updatePriceList: (...args: unknown[]) => mockApi.updatePriceList(...args),
}));
jest.mock('../crm-context', () => ({
  labelOptions: (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label })),
  useCrm: () => ({ capabilities: {} }),
}));

const DERIVED: PriceListSummary = {
  id: '105',
  code: 'BG-105',
  name: 'Bảng giá 105',
  listType: 'DERIVED',
  ratioPercent: 105,
  isStandard: false,
  currency: 'VND',
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  note: null,
  itemCount: 3,
  usageCount: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};
const SAVED = { ...DERIVED, items: [] } as PriceListDetail;

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const ratio = () => field(/Tỷ lệ giá so với bảng mặc định/);
const save = () => fireEvent.click(within(screen.getByRole('dialog', { name: /bảng giá/ })).getByRole('button', { name: 'Lưu' }));

function fillNew(ratioText?: string) {
  fireEvent.change(field(/Mã bảng giá/), { target: { value: 'BG-105' } });
  fireEvent.change(field(/Tên bảng giá/), { target: { value: 'Bảng giá 105' } });
  fireEvent.change(field(/Hiệu lực từ ngày/), { target: { value: '2026-01-01' } });
  if (ratioText !== undefined) fireEvent.change(ratio(), { target: { value: ratioText } });
}

beforeEach(() => jest.clearAllMocks());

describe('Hộp tạo, sửa bảng giá (C3)', () => {
  it('C3.1: có ô tỷ lệ mặc định 100; không còn lựa chọn "Bảng giá chuẩn"', () => {
    render(<PriceListDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(ratio().value).toBe('100');
    expect(screen.queryByText(/Bảng giá chuẩn/)).toBeNull();
    expect(screen.queryByText(/Loại bảng giá/)).toBeNull();
  });

  it('C3.2: nhập "105,5" gửi 105.5', async () => {
    mockApi.createPriceList.mockResolvedValue(SAVED);
    const onSaved = jest.fn();
    render(<PriceListDialog onClose={jest.fn()} onSaved={onSaved} />);
    fillNew('105,5');
    save();
    await waitFor(() =>
      expect(mockApi.createPriceList).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'BG-105', name: 'Bảng giá 105', ratioPercent: 105.5, validFrom: '2026-01-01', validTo: null, status: 'ACTIVE' }),
      ),
    );
    expect(mockApi.createPriceList.mock.calls[0][0]).not.toHaveProperty('isStandard');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
  });

  it.each(['0', '-5', '1001', '105,555', 'abc'])('C3.3: tỷ lệ "%s" báo lỗi tại ô, không gửi', (text) => {
    render(<PriceListDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    fillNew(text);
    save();
    expect(ratio().getAttribute('aria-invalid')).toBe('true');
    expect(ratio().closest('label')?.textContent).toMatch(/Tỷ lệ (phải|chỉ được)/);
    expect(mockApi.createPriceList).not.toHaveBeenCalled();
  });

  it('C3.4: thiếu mã, tên, ngày bắt đầu; ngày kết thúc trước ngày bắt đầu: lỗi tại ô', () => {
    render(<PriceListDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    save();
    expect(field(/Mã bảng giá/).closest('label')?.textContent).toContain('Vui lòng nhập mã bảng giá.');
    expect(field(/Tên bảng giá/).closest('label')?.textContent).toContain('Vui lòng nhập tên bảng giá.');
    expect(field(/Hiệu lực từ ngày/).closest('label')?.textContent).toContain('Vui lòng chọn ngày bắt đầu hiệu lực.');
    fillNew();
    fireEvent.change(field(/Hiệu lực đến ngày/), { target: { value: '2025-12-31' } });
    save();
    expect(field(/Hiệu lực đến ngày/).closest('label')?.textContent).toContain('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
    expect(mockApi.createPriceList).not.toHaveBeenCalled();
  });

  it('C3.5: mã trùng (409) hiện lỗi tại ô mã', async () => {
    mockApi.createPriceList.mockRejectedValue({ statusCode: 409, code: 'PRICE_LIST_CODE_EXISTS', message: 'Mã bảng giá BG-105 đã có.' });
    render(<PriceListDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    fillNew();
    save();
    await waitFor(() => expect(field(/Mã bảng giá/).closest('label')?.textContent).toContain('Mã bảng giá BG-105 đã có.'));
    expect(field(/Mã bảng giá/).getAttribute('aria-invalid')).toBe('true');
  });

  it('C3.6: sửa bảng theo tỷ lệ, đổi tỷ lệ thì hỏi lại; Huỷ không gửi, Đồng ý thì gửi', async () => {
    mockApi.updatePriceList.mockResolvedValue(SAVED);
    render(<PriceListDialog list={DERIVED} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(ratio().value).toBe('105');
    fireEvent.change(ratio(), { target: { value: '110' } });
    save();
    let confirm = screen.getByRole('dialog', { name: 'Đổi tỷ lệ bảng giá?' });
    expect(confirm.textContent).toContain(RATIO_CHANGE_CONFIRM);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(mockApi.updatePriceList).not.toHaveBeenCalled();
    save();
    confirm = screen.getByRole('dialog', { name: 'Đổi tỷ lệ bảng giá?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Đồng ý' }));
    await waitFor(() => expect(mockApi.updatePriceList).toHaveBeenCalledWith('105', expect.objectContaining({ ratioPercent: 110 })));
  });

  it('sửa bảng theo tỷ lệ mà không đổi tỷ lệ thì lưu ngay, không hỏi', async () => {
    mockApi.updatePriceList.mockResolvedValue(SAVED);
    render(<PriceListDialog list={DERIVED} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.change(field(/Tên bảng giá/), { target: { value: 'Bảng giá đại lý' } });
    save();
    expect(screen.queryByRole('dialog', { name: 'Đổi tỷ lệ bảng giá?' })).toBeNull();
    await waitFor(() => expect(mockApi.updatePriceList).toHaveBeenCalledWith('105', expect.objectContaining({ name: 'Bảng giá đại lý', ratioPercent: 105 })));
  });

  it('bảng tự nhập cũ không có ô tỷ lệ, không gửi tỷ lệ', async () => {
    mockApi.updatePriceList.mockResolvedValue(SAVED);
    render(<PriceListDialog list={{ ...DERIVED, listType: 'MANUAL', ratioPercent: null }} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.queryByLabelText(/Tỷ lệ giá so với bảng mặc định/)).toBeNull();
    save();
    await waitFor(() => expect(mockApi.updatePriceList).toHaveBeenCalled());
    expect(mockApi.updatePriceList.mock.calls[0][1]).not.toHaveProperty('ratioPercent');
  });
});
