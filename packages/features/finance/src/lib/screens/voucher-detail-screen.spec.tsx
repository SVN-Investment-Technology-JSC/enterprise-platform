/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import { MODULE_EMBED_MESSAGE } from '@enterprise-platform/feature-module-shell';
import { financeFetch, financePost } from '../finance-api';
import VoucherDetailScreen from './voucher-detail-screen';

const mockPush = jest.fn();
let mockPathname = '/modules/finance/payments/v1';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => mockPathname,
}));
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn(), financePost: jest.fn(), financeDelete: jest.fn() };
});
let mockCapabilities: Record<string, unknown> | null = null;
jest.mock('../finance-permissions', () => ({
  useFinancePermissions: () => ({ loading: false, error: null, capabilities: mockCapabilities, canOpenPage: () => true }),
}));

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;
const postMock = financePost as jest.MockedFunction<typeof financePost>;

const noSourced = { canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: false, canRetryReversal: false };
const none = { canEdit: false, canSubmit: false, canApprove: false, canReject: false, canCancel: false, canReverse: false, canDelete: false, canRetryProcedure: false, sourced: noSourced };

function voucher(over: Partial<FinanceVoucher> = {}): FinanceVoucher {
  return {
    id: 'v1',
    kind: 'PAYMENT',
    code: 'NHAP_PC_2610_0003',
    voucherDate: '2026-10-14',
    postingDate: '2026-10-14',
    content: 'Chi văn phòng phẩm',
    reasonId: 'r1',
    reasonName: 'Văn phòng phẩm',
    accountId: 'a1',
    accountName: 'Vietcombank',
    destAccountId: null,
    destAccountName: null,
    counterpartyGroupName: 'Nhà cung cấp',
    counterpartyName: 'Công ty Điện lực',
    totalAmount: 1_500_000,
    status: 'PENDING',
    createdBy: 'u1',
    createdByName: 'Nguyễn Văn An',
    createdAt: '2026-10-14T02:00:00.000Z',
    updatedAt: '2026-10-14T02:00:00.000Z',
    submittedAt: '2026-10-14T02:05:00.000Z',
    decidedAt: null,
    approvalMode: 'DIRECT',
    draftCode: 'NHAP_PC_2610_0003',
    officialCode: null,
    sourceCode: null,
    counterpartyGroupId: 'g1',
    counterpartyAccountNo: '0011 2233',
    counterpartyBank: 'Vietcombank',
    allocation: {
      type: 'PROJECT',
      projectId: 'p1',
      projectCode: 'DA001',
      projectName: 'Trạm biến áp Đà Nẵng',
      workItemId: null,
      workItemCode: null,
      workItemTitle: null,
    },
    taxIncluded: true,
    taxRate: 10,
    taxAmount: 136_363.64,
    note: 'Ghi chú nội bộ',
    decisionNote: null,
    decidedBy: null,
    decidedByName: null,
    revision: 2,
    lines: [{ id: 'l1', lineNo: 1, description: 'Giấy in A4', quantity: 3, unitAmount: 500_000, total: 1_500_000 }],
    invoices: [{ id: 'i1', invoiceNo: 'HD001', invoiceDate: '2026-10-10', taxCode: '0312345678', amount: 1_500_000 }],
    relatedProjects: [{ projectId: 'p2', projectCode: 'DA002', projectName: 'Đường dây 110kV' }],
    attachments: [],
    events: [
      { id: 'e1', action: 'CREATED', actorId: 'u1', actorName: 'Nguyễn Văn An', note: null, createdAt: '2026-10-14T02:00:00.000Z' },
      { id: 'e2', action: 'SUBMITTED', actorId: 'u1', actorName: 'Nguyễn Văn An', note: null, createdAt: '2026-10-14T02:05:00.000Z' },
    ],
    posted: false,
    procedure: null,
    source: null,
    permissions: { ...none },
    ...over,
  } as FinanceVoucher;
}

/** Nút xác nhận trong hộp Popconfirm (vẽ ra cuối trang, sau nút mở): lấy nút cuối cùng có tên đó. */
async function confirm(name: string) {
  const buttons = await screen.findAllByRole('button', { name });
  fireEvent.click(buttons[buttons.length - 1]);
}

const load = (v: FinanceVoucher) => fetchMock.mockImplementation(async () => v as never);

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/modules/finance/payments/v1';
  mockCapabilities = null;
  postMock.mockImplementation(async () => voucher({ status: 'APPROVED', posted: true }) as never);
});

describe('Chi tiết phiếu', () => {
  it('phiếu đã ghi sổ hiện mã chính thức, kèm mã nháp bên dưới', async () => {
    load(voucher({ status: 'APPROVED', code: 'PC-2610-0045', officialCode: 'PC-2610-0045' }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    expect(await screen.findByRole('heading', { name: 'PC-2610-0045' })).toBeTruthy();
    expect(screen.getByText('Mã nháp: NHAP_PC_2610_0003')).toBeTruthy();
  });

  it('phiếu chưa ghi sổ chỉ hiện mã nháp, không lặp lại', async () => {
    load(voucher());
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('heading', { name: 'NHAP_PC_2610_0003' });
    expect(screen.queryByText(/^Mã nháp:/)).toBeNull();
  });

  it('hiện thông tin chung, dòng chi tiết với thuế, hoá đơn, ghi chú, đối tượng liên quan và lịch sử xử lý', async () => {
    load(voucher());
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    expect(await screen.findByRole('heading', { name: 'NHAP_PC_2610_0003' })).toBeTruthy();
    // Chỉ hai trạng thái hiển thị: phiếu đang chờ duyệt vẫn hiện "Nháp".
    expect(screen.getByText('Nháp')).toBeTruthy();
    const info = screen.getByRole('region', { name: 'Thông tin chung' });
    expect(within(info).getAllByText('14/10/2026').length).toBe(2); // ngày lập và ngày hạch toán
    const lines = screen.getByRole('region', { name: 'Chi tiết chi' });
    expect(within(lines).getByText('Giấy in A4')).toBeTruthy();
    expect(within(lines).getByText(/Đã gồm thuế 10%/)).toBeTruthy();
    expect(within(lines).getByText('HD001', { exact: false })).toBeTruthy();
    expect(screen.getByText('DA002 - Đường dây 110kV')).toBeTruthy();
    // Hạch toán chỉ ở cấp dự án; khối "Liên quan" cũng liệt kê dự án hạch toán (liên kết sang Workspace).
    expect(screen.getByText('Hạch toán cho dự án: DA001 - Trạm biến áp Đà Nẵng')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Liên quan' })).getByRole('link', { name: 'DA001 - Trạm biến áp Đà Nẵng' })).toBeTruthy();
    const history = screen.getByRole('complementary', { name: 'Lịch sử xử lý' });
    expect(within(history).getByText('Tạo phiếu')).toBeTruthy();
    expect(within(history).getByText('Gửi duyệt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Duyệt/ })).toBeNull(); // không có quyền thao tác nào
  });

  it('lệnh chuyển tiền hiện hai tài khoản, không có bảng chi tiết dòng', async () => {
    load(voucher({ kind: 'TRANSFER', accountName: 'Vietcombank', destAccountName: 'Quỹ tiền mặt', lines: [], taxIncluded: false }));
    render(<VoucherDetailScreen kind="TRANSFER" id="v1" />);
    await screen.findByRole('heading', { name: 'NHAP_PC_2610_0003' });
    expect(screen.getByText('Tài khoản nguồn')).toBeTruthy();
    expect(screen.getByText('Quỹ tiền mặt')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Thông tin chuyển tiền' })).toBeNull();
  });

  it('duyệt trực tiếp: nút Duyệt gọi /approve', async () => {
    load(voucher({ permissions: { ...none, canApprove: true, canReject: true } }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await confirm('Duyệt');
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/approve', { note: undefined }));
  });

  it('phiếu qua quy trình: Duyệt và Từ chối đi qua /procedure-action kèm mã chống gửi trùng; hiện hồ sơ và người đang xử lý', async () => {
    load(
      voucher({
        approvalMode: 'PROCEDURE',
        permissions: { ...none, canApprove: true, canReject: true },
        procedure: { instanceId: 'inst-9', instanceCode: 'QT-9', status: 'running', currentStepName: 'Kế toán trưởng duyệt', currentAssigneeName: 'Lê Thị Kế Toán', canAct: true, syncStatus: 'RUNNING', lastError: null },
      }),
    );
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    const panel = await screen.findByRole('region', { name: 'Quy trình duyệt' });
    expect(within(panel).getByRole('link', { name: 'QT-9' }).getAttribute('href')).toBe('/modules/procedure#workspace/inst-9');
    expect(within(panel).getByText('Kế toán trưởng duyệt')).toBeTruthy();
    expect(within(panel).getByText(/Lê Thị Kế Toán/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await confirm('Duyệt');
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body] = postMock.mock.calls[0] as [string, { action: string; idempotencyKey: string }];
    expect(path).toBe('/vouchers/v1/procedure-action');
    expect(body.action).toBe('approve');
    expect(body.idempotencyKey).toBeTruthy();
  });

  it('phiếu kẹt: hiện lý do và nút Áp lại; đang khởi tạo hồ sơ thì hiện nút Thử lại', async () => {
    load(
      voucher({
        approvalMode: 'PROCEDURE',
        permissions: { ...none, canRetryProcedure: true },
        procedure: { instanceId: 'inst-9', instanceCode: 'QT-9', status: 'completed', currentStepName: null, currentAssigneeName: null, canAct: null, syncStatus: 'CONFLICT', lastError: 'Số dư Vietcombank không đủ' },
      }),
    );
    const { unmount } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Số dư Vietcombank không đủ');
    fireEvent.click(screen.getByRole('button', { name: /Áp lại/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/procedure-retry', {}));
    unmount();

    load(
      voucher({
        approvalMode: 'PROCEDURE',
        permissions: { ...none, canRetryProcedure: true },
        procedure: { instanceId: null, instanceCode: null, status: 'running', currentStepName: null, currentAssigneeName: null, canAct: null, syncStatus: 'FAILED', lastError: 'Hệ thống bận' },
      }),
    );
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    expect((await screen.findByRole('status')).textContent).toContain('Hệ thống bận');
    expect(screen.getByRole('button', { name: /Thử lại/ })).toBeTruthy();
  });

  it('phiếu đã ghi sổ: Huỷ chạy ngay không hỏi lại (đảo bút toán), rồi về danh sách; không có nút sửa hay xoá riêng', async () => {
    postMock.mockResolvedValueOnce({ id: 'v1', code: 'PC-2610-0045', deleted: false } as never);
    load(voucher({ status: 'APPROVED', posted: true, permissions: { ...none, canReverse: true, canCancel: true } }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    expect(await screen.findByText('Đã ghi sổ tài khoản')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sửa/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xoá/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Huỷ$/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/cancel', {}));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/payments'));
  });

  it('phiếu nháp: Huỷ xoá hẳn phiếu ngay (không hộp xác nhận) và về danh sách', async () => {
    postMock.mockResolvedValueOnce({ id: 'v1', code: 'NHAP_PC_2610_0003', deleted: true } as never);
    load(voucher({ status: 'DRAFT', permissions: { ...none, canEdit: true, canCancel: true, canDelete: true } }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Huỷ$/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/cancel', {}));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/payments'));
  });

  it('Nhân bản mở form tạo mới điền sẵn từ phiếu này (trong popup thì giữ trong khung nhúng); không có quyền lập thì không hiện', async () => {
    load(voucher({ status: 'APPROVED', posted: true }));
    const { unmount } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('region', { name: 'Thông tin chung' });
    expect(screen.queryByRole('button', { name: /Nhân bản/ })).toBeNull();
    unmount();

    mockCapabilities = { payment: { create: true, approve: true } };
    const first = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhân bản/ }));
    expect(mockPush).toHaveBeenCalledWith('/payments/new?from=v1');
    first.unmount();

    mockPathname = '/modules/finance/embed/payments/v1';
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhân bản/ }));
    expect(mockPush).toHaveBeenCalledWith('/embed/payments/new?from=v1');
  });

  it('người duyệt mà phiếu chưa đủ thông tin: nút "Duyệt ghi sổ" mờ kèm lý do máy chủ trả', async () => {
    load(voucher({ status: 'DRAFT', permissions: { ...none, approveBlockedReason: 'Chưa đủ thông tin để duyệt ghi sổ. Còn thiếu: Tài khoản chi.' } }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    const button = (await screen.findByRole('button', { name: /Duyệt ghi sổ/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Còn thiếu: Tài khoản chi.');
  });

  it('phiếu nháp còn thiếu trường bắt buộc: báo đủ danh sách và mở form để bổ sung (người sửa được phiếu)', async () => {
    load(voucher({ status: 'DRAFT', missingFields: ['reason', 'account', 'counterpartyName'], permissions: { ...none, canEdit: true } }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    const banner = await screen.findByRole('alert', { name: 'Phiếu còn thiếu thông tin' });
    expect(banner.textContent).toContain('Còn thiếu: Lý do chi, Tài khoản chi, Người nhận tiền.');
    fireEvent.click(within(banner).getByRole('button', { name: /Bổ sung thông tin/ }));
    expect(mockPush).toHaveBeenCalledWith('/payments/v1/edit');
  });

  it('người không sửa được phiếu vẫn thấy danh sách còn thiếu nhưng không có nút bổ sung; phiếu đủ thông tin thì không có cảnh báo', async () => {
    load(voucher({ status: 'DRAFT', missingFields: ['counterpartyBank'] }));
    const { unmount } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    const banner = await screen.findByRole('alert', { name: 'Phiếu còn thiếu thông tin' });
    expect(banner.textContent).toContain('Ngân hàng nhận tiền');
    expect(within(banner).queryByRole('button')).toBeNull();
    unmount();
    load(voucher({ status: 'DRAFT', missingFields: [] }));
    render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('region', { name: 'Thông tin chung' });
    expect(screen.queryByRole('alert', { name: 'Phiếu còn thiếu thông tin' })).toBeNull();
  });

  describe('phiếu tạo từ hồ sơ quy trình', () => {
    const source = (over: Partial<NonNullable<FinanceVoucher['source']>> = {}): NonNullable<FinanceVoucher['source']> => ({
      instanceId: 'inst-12',
      instanceCode: 'PR-0012',
      instanceTitle: 'Đề nghị thanh toán',
      definitionName: 'Đề nghị thanh toán',
      stepName: 'Chi tiền',
      activation: 1,
      status: 'OPEN',
      values: { amount: 1_500_000, content: 'Chi văn phòng phẩm', counterpartyName: 'Công ty ABC', counterpartyAccountNo: '0123', counterpartyBank: 'VCB', voucherDate: null },
      requestedProjectId: null,
      requestedWorkItemId: null,
      lockedFields: ['amount', 'content', 'counterpartyName'],
      assigneeLabel: 'Kế toán thanh toán',
      handlingBy: null,
      handlingByName: null,
      handlingSince: null,
      canAct: true,
      canActReason: null,
      reversalReason: null,
      reversalError: null,
      sourceModule: 'procedure-engine',
      sourceRef: null,
      ...over,
    });
    const sourced = (over: Partial<FinanceVoucher> = {}) =>
      voucher({ status: 'DRAFT', approvalMode: 'INHERITED', sourceCode: 'PR-0012', source: source(), ...over });

    it('hiện khối Nguồn, trường lấy từ hồ sơ không còn khoá (sửa được); Ghi sổ gửi kèm phiên bản đang xem', async () => {
      load(sourced({ permissions: { ...none, sourced: { canEditSourced: true, canPost: true, canReturnSource: true, canTakeOver: false, canRetryReversal: false } } }));
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      const panel = await screen.findByRole('region', { name: 'Nguồn hồ sơ quy trình' });
      expect(within(panel).getByRole('link', { name: 'PR-0012' }).getAttribute('href')).toBe('/modules/procedure#workspace/inst-12');
      expect(within(panel).getByText('Kế toán thanh toán')).toBeTruthy();
      const info = screen.getByRole('region', { name: 'Thông tin chung' });
      // Mọi trường điền sẵn từ hồ sơ đều sửa được nên không còn biểu tượng khoá.
      expect(within(info).queryAllByLabelText('Lấy từ hồ sơ')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /Gửi duyệt/ })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /^Sửa$/ }));
      expect(mockPush).toHaveBeenCalledWith('/payments/v1/edit');
      fireEvent.click(screen.getByRole('button', { name: /Ghi sổ/ }));
      await confirm('Ghi sổ');
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/post-sourced', { revision: 2 }));
    });

    it('người khác đang xử lý: chỉ có Nhận xử lý thay', async () => {
      load(
        sourced({
          source: source({ handlingBy: 'u9', handlingByName: 'Trần Kế Toán', handlingSince: '2026-10-14T03:00:00.000Z' }),
          permissions: { ...none, sourced: { canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: true, canRetryReversal: false } },
        }),
      );
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      expect((await screen.findByRole('region', { name: 'Nguồn hồ sơ quy trình' })).textContent).toContain('Đang xử lý: Trần Kế Toán');
      expect(screen.queryByRole('button', { name: /Ghi sổ/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Nhận xử lý thay/ }));
      await confirm('Nhận xử lý');
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/take-over', {}));
    });

    it('không được giao bước hoặc không xác minh được: phiếu chỉ xem, nêu lý do', async () => {
      load(sourced({ source: source({ canAct: false, canActReason: 'Bạn không giữ vai R của bước này.' }) }));
      const { unmount } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      expect((await screen.findByRole('region', { name: 'Nguồn hồ sơ quy trình' })).textContent).toContain('Bạn không giữ vai R của bước này. Phiếu chỉ xem.');
      expect(screen.queryByRole('button', { name: /Ghi sổ|Trả hồ sơ|^Sửa$/ })).toBeNull();
      unmount();

      load(sourced({ source: source({ canAct: null, canActReason: 'Không xác minh được quyền ở bước quy trình, thử lại sau.' }) }));
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      expect((await screen.findByRole('alert')).textContent).toContain('Không xác minh được');
    });

    it('hồ sơ đã huỷ hiệu lực mà chưa đảo được: nêu lỗi, người có quyền bấm Đảo lại', async () => {
      load(
        sourced({
          status: 'APPROVED',
          source: source({
            status: 'REVERSAL_PENDING',
            canAct: null,
            reversalReason: 'Hồ sơ PR-0012 bị huỷ hiệu lực: nhập sai',
            reversalError: 'Sổ đã khoá đến ngày 2026-10-31',
          }),
          permissions: { ...none, sourced: { canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: false, canRetryReversal: true } },
        }),
      );
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      const panel = await screen.findByRole('region', { name: 'Nguồn hồ sơ quy trình' });
      expect(panel.textContent).toContain('chờ đảo phiếu');
      expect(within(panel).getByRole('alert').textContent).toContain('Sổ đã khoá đến ngày 2026-10-31');
      fireEvent.click(screen.getByRole('button', { name: /Đảo lại/ }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/retry-source-reversal', {}));
    });
  });

  it('báo lỗi khi không xem được phiếu (không lộ nội dung) và cho về danh sách', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Không tìm thấy phiếu.'));
    render(<VoucherDetailScreen kind="PAYMENT" id="x" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy phiếu.');
    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách' }));
    expect(mockPush).toHaveBeenCalledWith('/payments');
  });
});

describe('Chi tiết phiếu nhúng trong popup của phân hệ khác (/embed)', () => {
  const sourcedVoucher = () =>
    voucher({
      status: 'DRAFT',
      approvalMode: 'INHERITED',
      sourceCode: 'PR-0012',
      source: {
        instanceId: 'inst-12',
        instanceCode: 'PR-0012',
        instanceTitle: 'Đề nghị thanh toán',
        definitionName: 'Đề nghị thanh toán',
        stepName: 'Chi tiền',
        activation: 1,
        status: 'OPEN',
        values: { amount: 1_500_000, content: 'Chi', counterpartyName: 'ABC', counterpartyAccountNo: '0123', counterpartyBank: 'VCB', voucherDate: null },
        requestedProjectId: null,
        requestedWorkItemId: null,
        lockedFields: [],
        assigneeLabel: 'Kế toán',
        handlingBy: null,
        handlingByName: null,
        handlingSince: null,
        canAct: true,
        canActReason: null,
        reversalReason: null,
        reversalError: null,
        sourceModule: 'procedure-engine',
        sourceRef: null,
      },
      permissions: { ...none, sourced: { canEditSourced: true, canPost: true, canReturnSource: false, canTakeOver: false, canRetryReversal: false } },
    });

  function insideFrame() {
    const parent = { postMessage: jest.fn() };
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    return {
      parent,
      restore: () => original && Object.defineProperty(window, 'parent', original),
    };
  }

  it('ghi sổ xong thì báo bên chủ tải lại hồ sơ (chỉ tới đúng tên miền của mình); Sửa đi trang sửa nhúng', async () => {
    mockPathname = '/modules/finance/embed/payments/v1';
    const frame = insideFrame();
    try {
      load(sourcedVoucher());
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      await screen.findByRole('region', { name: 'Thông tin chung' });

      fireEvent.click(screen.getByRole('button', { name: /^Sửa$/ }));
      expect(mockPush).toHaveBeenCalledWith('/embed/payments/v1/edit');

      fireEvent.click(screen.getByRole('button', { name: /Ghi sổ/ }));
      await confirm('Ghi sổ');
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/post-sourced', { revision: 2 }));
      await waitFor(() =>
        expect(frame.parent.postMessage).toHaveBeenCalledWith({ type: MODULE_EMBED_MESSAGE.changed }, window.location.origin),
      );
    } finally {
      frame.restore();
    }
  });

  it('trong popup không lặp mã và trạng thái ở đầu trang mà báo lên tiêu đề popup: mã, mã nháp, trạng thái và ghi sổ', async () => {
    mockPathname = '/modules/finance/embed/payments/v1';
    const frame = insideFrame();
    try {
      load(voucher({ status: 'APPROVED', code: 'PC-2610-0045', officialCode: 'PC-2610-0045', posted: true }));
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      await screen.findByRole('region', { name: 'Thông tin chung' });
      expect(screen.queryByRole('heading', { name: 'PC-2610-0045' })).toBeNull();
      expect(screen.queryByText('Mã nháp: NHAP_PC_2610_0003')).toBeNull();
      await waitFor(() =>
        expect(frame.parent.postMessage).toHaveBeenCalledWith(
          {
            type: MODULE_EMBED_MESSAGE.summary,
            code: 'PC-2610-0045',
            note: 'Mã nháp: NHAP_PC_2610_0003',
            badges: [
              { label: 'Đã duyệt', tone: 'success' },
              { label: 'Đã ghi sổ tài khoản', tone: 'success' },
            ],
          },
          window.location.origin,
        ),
      );
    } finally {
      frame.restore();
    }
  });

  it('trong popup không còn thanh đầu trang; dải nút nằm ở chân và bị ẩn khi phiếu không có nút thao tác nào', async () => {
    mockPathname = '/modules/finance/embed/payments/v1';
    load(voucher());
    const { container } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('region', { name: 'Thông tin chung' });
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    const footer = container.querySelector('footer') as HTMLElement;
    expect(footer.className).toContain('hidden');
    expect(footer.className).toContain('has-[button]:flex');
    expect(footer.querySelectorAll('button')).toHaveLength(0);
  });

  it('dải nút ở chân popup: Sửa, Trả hồ sơ, rồi Ghi sổ ngoài cùng bên phải', async () => {
    mockPathname = '/modules/finance/embed/payments/v1';
    const sourcedWithAll = sourcedVoucher();
    sourcedWithAll.permissions = {
      ...none,
      sourced: { canEditSourced: true, canPost: true, canReturnSource: true, canTakeOver: false, canRetryReversal: false },
    };
    load(sourcedWithAll);
    const { container } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('region', { name: 'Thông tin chung' });
    const labels = Array.from((container.querySelector('footer') as HTMLElement).querySelectorAll('button')).map((button) =>
      (button.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Sửa', 'Trả hồ sơ', 'Ghi sổ']);
  });

  it('trang đầy đủ (ngoài popup) vẫn có thanh đầu trang với mã, trạng thái và dải nút cùng thứ tự: Trả hồ sơ trước Ghi sổ', async () => {
    const sourcedWithAll = sourcedVoucher();
    sourcedWithAll.permissions = {
      ...none,
      sourced: { canEditSourced: true, canPost: true, canReturnSource: true, canTakeOver: false, canRetryReversal: false },
    };
    load(sourcedWithAll);
    const { container } = render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
    await screen.findByRole('heading', { name: 'NHAP_PC_2610_0003' });
    expect(container.querySelector('footer')).toBeNull();
    const labels = Array.from((container.querySelector('header') as HTMLElement).querySelectorAll('button')).map((button) =>
      (button.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Sửa', 'Trả hồ sơ', 'Ghi sổ']);
  });

  it('không tìm thấy phiếu: báo lỗi và không có nút "Về danh sách" (popup không có danh sách để về)', async () => {
    mockPathname = '/modules/finance/embed/payments/x';
    fetchMock.mockRejectedValueOnce(new Error('Không tìm thấy phiếu.'));
    render(<VoucherDetailScreen kind="PAYMENT" id="x" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy phiếu.');
    expect(screen.queryByRole('button', { name: 'Về danh sách' })).toBeNull();
  });

  it('ngoài popup (trang đầy đủ) thao tác xong không phát tin nào cho cửa sổ cha', async () => {
    const frame = insideFrame();
    try {
      load(sourcedVoucher());
      render(<VoucherDetailScreen kind="PAYMENT" id="v1" />);
      await screen.findByRole('heading', { name: 'NHAP_PC_2610_0003' });
      fireEvent.click(screen.getByRole('button', { name: /^Sửa$/ }));
      expect(mockPush).toHaveBeenCalledWith('/payments/v1/edit');
    } finally {
      frame.restore();
    }
  });
});
