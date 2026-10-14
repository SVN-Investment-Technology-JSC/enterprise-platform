/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceApprovalBinding } from '@enterprise-platform/contracts-finance';
import { financeFetch, financePut } from '../finance-api';
import SettingsScreen from './settings-screen';

jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn(), financePost: jest.fn(), financePut: jest.fn() };
});

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;
const putMock = financePut as jest.MockedFunction<typeof financePut>;

const binding = (kind: FinanceApprovalBinding['kind'], over: Partial<FinanceApprovalBinding> = {}): FinanceApprovalBinding => ({
  kind,
  mode: 'DIRECT',
  procedureDefinitionId: null,
  procedureDefinitionName: null,
  isActive: true,
  ...over,
});

let bindings: FinanceApprovalBinding[];

beforeEach(() => {
  jest.clearAllMocks();
  bindings = [binding('RECEIPT'), binding('PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: 'd1', procedureDefinitionName: 'Duyệt phiếu chi' }), binding('TRANSFER')];
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/catalogs')) return { reasons: [{ id: 'r1', kind: 'RECEIPT', code: 'THU', name: 'Thu tiền hàng', isActive: true, note: null }, { id: 'r2', kind: 'PAYMENT', code: 'VPP', name: 'Văn phòng phẩm', isActive: false, note: null }], counterpartyGroups: [], costCenters: [] } as never;
    if (path === '/settings') return { booksLockedUntil: '2026-09-30', allowSelfApproval: false } as never;
    if (path === '/approval-bindings') return bindings as never;
    if (path === '/approval-bindings/procedure-definitions') return [{ id: 'd1', code: 'DUYET-CHI', name: 'Duyệt phiếu chi' }, { id: 'd2', code: 'DUYET-LON', name: 'Duyệt chi lớn' }] as never;
    throw new Error(`route lạ ${path}`);
  });
});

describe('Tùy chỉnh', () => {
  it('có các nhóm cấu hình theo thiết kế và mở nhóm lý do thu trước', async () => {
    render(<SettingsScreen />);
    for (const label of ['Lý do thu', 'Lý do chi', 'Đối tượng thu chi', 'Hạch toán nội bộ', 'Quy trình duyệt', 'Khoá sổ và duyệt']) expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    expect(await screen.findByText('Thu tiền hàng')).toBeTruthy();
    expect(screen.queryByText('Văn phòng phẩm')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Lý do chi' }));
    expect(screen.getByText('Văn phòng phẩm')).toBeTruthy();
    expect(screen.getByText('Ngừng dùng')).toBeTruthy(); // lý do đã ngừng dùng vẫn hiện để cấu hình lại
  });

  it('khoá sổ và tự duyệt: lưu đúng giá trị', async () => {
    putMock.mockResolvedValue({ booksLockedUntil: '2026-09-30', allowSelfApproval: true } as never);
    render(<SettingsScreen />);
    await screen.findByText('Thu tiền hàng');
    fireEvent.click(screen.getByRole('tab', { name: 'Khoá sổ và duyệt' }));
    expect(screen.getByText(/Hiện đang khoá đến 30\/09\/2026/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Cho phép người lập tự duyệt/));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/settings', { booksLockedUntil: '2026-09-30', allowSelfApproval: true }));
  });
});

/** Mở danh sách của ô SearchableSelect rồi chọn một mục theo tên (mục có thể kèm mô tả nên so khớp một phần). */
async function choose(input: HTMLElement, name: RegExp) {
  fireEvent.click(input);
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('Tab Quy trình duyệt', () => {
  const openTab = async () => {
    render(<SettingsScreen />);
    await screen.findByText('Thu tiền hàng');
    fireEvent.click(screen.getByRole('tab', { name: 'Quy trình duyệt' }));
    return screen.findByRole('region', { name: 'Quy trình duyệt' });
  };

  it('hiện cách duyệt hiện tại của từng loại phiếu và quy trình đang gán', async () => {
    const panel = await openTab();
    await waitFor(() => expect(within(panel).getByText('Phiếu chi')).toBeTruthy());
    expect(within(panel).getByText('Phiếu thu')).toBeTruthy();
    expect(within(panel).getByText('Lệnh chuyển tiền')).toBeTruthy();
    expect(within(panel).getByDisplayValue('Duyệt qua quy trình (Procedure)')).toBeTruthy();
    expect(within(panel).getByDisplayValue('Duyệt phiếu chi')).toBeTruthy();
    expect(within(panel).getAllByRole('button', { name: 'Lưu' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true); // chưa đổi gì
  });

  it('đổi sang duyệt trực tiếp rồi lưu gửi mode DIRECT không kèm quy trình', async () => {
    putMock.mockResolvedValue({ binding: binding('PAYMENT'), warnings: [] } as never);
    const panel = await openTab();
    await choose(await within(panel).findByDisplayValue('Duyệt qua quy trình (Procedure)'), /Duyệt trực tiếp/);
    const save = within(panel).getAllByRole('button', { name: 'Lưu' }).find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement;
    fireEvent.click(save);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/approval-bindings/PAYMENT', { mode: 'DIRECT', procedureDefinitionId: null }));
  });

  it('cảnh báo cấu hình trả về khi lưu được hiện ngay dưới loại phiếu', async () => {
    putMock.mockResolvedValue({ binding: bindings[1], warnings: ['Bước đầu “Lập phiếu” không chỉ có vai S của người lập, phiếu sẽ dừng chờ người lập mở quy trình xử lý.'] } as never);
    const panel = await openTab();
    // Đổi quy trình đang gán sang quy trình khác.
    await choose(await within(panel).findByDisplayValue('Duyệt phiếu chi'), /Duyệt chi lớn/);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Lưu' }).find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/approval-bindings/PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: 'd2' }));
    expect(await within(panel).findByText(/không chỉ có vai S/)).toBeTruthy();
  });

  it('lỗi từ máy chủ (ví dụ thuộc tính bắt buộc không hỗ trợ) hiện rõ và cấu hình không đổi', async () => {
    const { FinanceApiError } = jest.requireActual('../finance-api') as typeof import('../finance-api');
    putMock.mockRejectedValue(new FinanceApiError('Quy trình yêu cầu thuộc tính mà phiếu tài chính không cung cấp được: Số hợp đồng.', 422, 'FINANCE_PROCEDURE_ATTRIBUTES', ['Quy trình yêu cầu thuộc tính mà phiếu tài chính không cung cấp được: Số hợp đồng.', 'Bỏ tính bắt buộc ...']));
    const panel = await openTab();
    await choose(await within(panel).findByDisplayValue('Duyệt phiếu chi'), /Duyệt chi lớn/);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Lưu' }).find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement);
    expect((await within(panel).findByRole('alert')).textContent).toContain('Số hợp đồng');
    expect(within(panel).getByDisplayValue('Duyệt chi lớn')).toBeTruthy(); // bản nháp được giữ để sửa
  });
});
