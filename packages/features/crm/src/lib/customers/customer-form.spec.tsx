/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  type CrmCapabilities,
  type CustomerGroup,
  type CustomerKindOption,
} from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrmDataProvider } from '../crm-context';
import * as api from '../crm-api';
import { CustomerFormDialog } from './customer-form';

jest.mock('../crm-api', () => ({
  createCustomer: jest.fn(),
  createGroup: jest.fn(),
  createKind: jest.fn(),
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message || fallback,
  findTaxCodeMatches: jest.fn().mockResolvedValue([]),
  listPriceLists: jest.fn().mockResolvedValue([]),
  updateCustomer: jest.fn(),
  listGroups: jest.fn(),
  listKinds: jest.fn(),
  listPeople: jest.fn().mockResolvedValue([]),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const admin: CrmCapabilities = { ...CRM_NO_CAPABILITIES, isTenantAdmin: true, canManage: true };
const NEW_GROUP: CustomerGroup = { id: 'g-new', code: 'DAI-LY', name: 'Đại lý', description: null, customerCount: 0 };
const SYSTEM_KINDS: CustomerKindOption[] = [
  { code: 'LEAD_CUSTOMER', name: 'Khách hàng tiềm năng', description: null, isSystem: true, sortOrder: 10, customerCount: 0 },
  { code: 'CUSTOMER', name: 'Khách hàng', description: null, isSystem: true, sortOrder: 20, customerCount: 0 },
];
const NEW_KIND: CustomerKindOption = { code: 'KHACH-VIP', name: 'Khách VIP', description: null, isSystem: false, sortOrder: 100, customerCount: 0 };

function renderForm(capabilities: CrmCapabilities, existing: CustomerGroup[] = []) {
  // Lần tải đầu trả danh sách hiện có; sau khi tạo nhóm, lần tải lại trả thêm nhóm mới.
  mocked.listGroups.mockResolvedValueOnce(existing).mockResolvedValue([...existing, NEW_GROUP]);
  mocked.listKinds.mockResolvedValueOnce(SYSTEM_KINDS).mockResolvedValue([...SYSTEM_KINDS, NEW_KIND]);
  const onClose = jest.fn();
  render(
    <CrmDataProvider capabilities={capabilities}>
      <CustomerFormDialog onClose={onClose} onSaved={jest.fn()} />
    </CrmDataProvider>,
  );
  return { onClose };
}

const openGroupSelect = () => fireEvent.click(screen.getByPlaceholderText('Chọn nhóm'));

describe('Tạo nhóm khách hàng ngay trong form khách', () => {
  beforeEach(() => jest.clearAllMocks());

  it('TC-FB-07: có crm.manage thì tạo nhóm tại chỗ, tải lại danh sách và tự chọn nhóm mới', async () => {
    mocked.createGroup.mockResolvedValue(NEW_GROUP);
    renderForm(admin);
    await waitFor(() => expect(mocked.listGroups).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/Tên khách hàng/), { target: { value: 'Khách A' } });

    openGroupSelect();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm mới' }));
    fireEvent.change(screen.getByLabelText(/Tên nhóm/), { target: { value: 'Đại lý' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);

    await waitFor(() => expect(mocked.createGroup).toHaveBeenCalledWith({ code: 'DAI-LY', name: 'Đại lý', description: null }));
    await waitFor(() => expect(mocked.listGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByPlaceholderText('Chọn nhóm') as HTMLInputElement).value).toBe('Đại lý'));
    // Form khách vẫn giữ nội dung đã nhập.
    expect((screen.getByLabelText(/Tên khách hàng/) as HTMLInputElement).value).toBe('Khách A');
    expect(screen.queryByRole('dialog', { name: 'Tạo nhóm khách hàng' })).toBeNull();
  });

  it('TC-FB-08: không có crm.manage thì không có nút tạo nhóm, hiện câu hướng dẫn', async () => {
    renderForm({ ...CRM_NO_CAPABILITIES, canWriteOpportunity: true });
    await waitFor(() => expect(mocked.listGroups).toHaveBeenCalled());
    openGroupSelect();
    expect(screen.queryByRole('button', { name: 'Tạo nhóm mới' })).toBeNull();
    expect(await screen.findByText(/nhờ quản trị viên tạo nhóm/)).toBeTruthy();
  });

  it('TC-FB-09: tên trùng nhóm đã có báo lỗi tiếng Việt, không gọi API, form khách giữ nguyên', async () => {
    renderForm(admin, [{ ...NEW_GROUP, id: 'g-old' }]);
    await waitFor(() => expect(mocked.listGroups).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/Tên khách hàng/), { target: { value: 'Khách A' } });
    openGroupSelect();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm mới' }));
    fireEvent.change(screen.getByLabelText(/Tên nhóm/), { target: { value: ' đai LY ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);

    expect((await screen.findAllByRole('alert')).some((el) => /đã tồn tại/.test(el.textContent ?? ''))).toBe(true);
    expect(mocked.createGroup).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Tên khách hàng/) as HTMLInputElement).value).toBe('Khách A');
  });

  it('TC-FB-09: server trả 409 trùng mã (danh sách cục bộ chưa kịp có nhóm) cũng báo lỗi tiếng Việt', async () => {
    mocked.createGroup.mockRejectedValue({ code: 'GROUP_CODE_EXISTS', message: 'Mã nhóm khách hàng đã tồn tại.' });
    renderForm(admin);
    await waitFor(() => expect(mocked.listGroups).toHaveBeenCalledTimes(1));
    openGroupSelect();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm mới' }));
    fireEvent.change(screen.getByLabelText(/Tên nhóm/), { target: { value: 'Đại lý' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);
    expect((await screen.findAllByRole('alert')).some((el) => /đã tồn tại/.test(el.textContent ?? ''))).toBe(true);
    expect(mocked.listGroups).toHaveBeenCalledTimes(1);
  });
});

describe('Phân loại khách hàng do tenant cấu hình trong form khách', () => {
  beforeEach(() => jest.clearAllMocks());

  const openKindSelect = () => fireEvent.click(screen.getByPlaceholderText('Chọn phân loại'));

  it('mặc định là Khách hàng tiềm năng; có crm.manage thì tạo phân loại tại chỗ và tự chọn', async () => {
    mocked.createKind.mockResolvedValue(NEW_KIND);
    renderForm(admin);
    await waitFor(() => expect((screen.getByPlaceholderText('Chọn phân loại') as HTMLInputElement).value).toBe('Khách hàng tiềm năng'));
    fireEvent.change(screen.getByLabelText(/Tên khách hàng/), { target: { value: 'Khách A' } });

    openKindSelect();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo phân loại mới' }));
    fireEvent.change(screen.getByLabelText(/Tên phân loại/), { target: { value: 'Khách VIP' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);

    await waitFor(() => expect(mocked.createKind).toHaveBeenCalledWith({ code: 'KHACH-VIP', name: 'Khách VIP', description: null }));
    await waitFor(() => expect(mocked.listKinds).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByPlaceholderText('Chọn phân loại') as HTMLInputElement).value).toBe('Khách VIP'));
    expect((screen.getByLabelText(/Tên khách hàng/) as HTMLInputElement).value).toBe('Khách A');
  });

  it('không có crm.manage thì không có nút tạo phân loại', async () => {
    renderForm({ ...CRM_NO_CAPABILITIES, canWriteOpportunity: true });
    await waitFor(() => expect(mocked.listKinds).toHaveBeenCalled());
    openKindSelect();
    expect(await screen.findByText('Khách hàng')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạo phân loại mới' })).toBeNull();
  });

  it('tên trùng phân loại đã có báo lỗi tiếng Việt, không gọi API', async () => {
    renderForm(admin);
    await waitFor(() => expect(mocked.listKinds).toHaveBeenCalledTimes(1));
    openKindSelect();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo phân loại mới' }));
    fireEvent.change(screen.getByLabelText(/Tên phân loại/), { target: { value: ' khach hang ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);
    expect((await screen.findAllByRole('alert')).some((el) => /đã tồn tại/.test(el.textContent ?? ''))).toBe(true);
    expect(mocked.createKind).not.toHaveBeenCalled();
  });
});

describe('Bảng giá chọn ở hồ sơ khách (D3-38)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ô Bảng giá chỉ có bảng giá riêng đang dùng (không có bảng chuẩn, bảng đã tắt); lưu gửi priceListId', async () => {
    const list = (id: string, extra: Record<string, unknown> = {}) =>
      ({ id, code: id.toUpperCase(), name: `Bảng ${id}`, isStandard: false, status: 'ACTIVE', validFrom: '2026-01-01', validTo: null, ...extra }) as never;
    mocked.listPriceLists.mockResolvedValue([list('chuan', { isStandard: true }), list('dl1'), list('cu', { status: 'INACTIVE' })]);
    mocked.createCustomer.mockResolvedValue({ id: 'c-new' } as never);
    renderForm(admin);
    await waitFor(() => expect(mocked.listPriceLists).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Tên khách hàng/), { target: { value: 'Khách A' } });
    fireEvent.click(screen.getByPlaceholderText('Bảng giá chuẩn'));
    expect(await screen.findByText('Bảng dl1')).toBeTruthy();
    expect(screen.queryByText('Bảng chuan')).toBeNull();
    expect(screen.queryByText('Bảng cu')).toBeNull();
    fireEvent.click(screen.getByText('Bảng dl1'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).at(-1) as HTMLElement);
    await waitFor(() => expect(mocked.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'Khách A', priceListId: 'dl1' })));
  });
});
