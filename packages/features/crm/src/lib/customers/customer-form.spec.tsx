/**
 * @jest-environment jsdom
 */
import { CRM_NO_CAPABILITIES, type CrmCapabilities, type CustomerGroup } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrmDataProvider } from '../crm-context';
import * as api from '../crm-api';
import { CustomerFormDialog } from './customer-form';

jest.mock('../crm-api', () => ({
  createCustomer: jest.fn(),
  createGroup: jest.fn(),
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message || fallback,
  findTaxCodeMatches: jest.fn().mockResolvedValue([]),
  updateCustomer: jest.fn(),
  listGroups: jest.fn(),
  listPeople: jest.fn().mockResolvedValue([]),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const admin: CrmCapabilities = { ...CRM_NO_CAPABILITIES, isTenantAdmin: true, canManage: true };
const NEW_GROUP: CustomerGroup = { id: 'g-new', code: 'DAI-LY', name: 'Đại lý', description: null, customerCount: 0 };

function renderForm(capabilities: CrmCapabilities, existing: CustomerGroup[] = []) {
  // Lần tải đầu trả danh sách hiện có; sau khi tạo nhóm, lần tải lại trả thêm nhóm mới.
  mocked.listGroups.mockResolvedValueOnce(existing).mockResolvedValue([...existing, NEW_GROUP]);
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
