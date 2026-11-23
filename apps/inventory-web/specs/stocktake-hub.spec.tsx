import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from '@enterprise-platform/shared-ui';
import {
  InventoryPermissionsContext,
  StocktakeHub,
  isSelfApprovalBlocked,
} from '@enterprise-platform/feature-inventory';

// Màn kiểm kê (ISS-BE-001): ẩn nút tự duyệt, nút ghi sổ lại cho đợt đã duyệt, lý do huỷ bắt buộc, lỗi hiện bằng toast.
const mockApi = {
  loadStocktakes: jest.fn(),
  loadStocktakeLines: jest.fn(),
  loadCurrentUserId: jest.fn(),
  loadInventorySettings: jest.fn(),
  approveAndPostStocktake: jest.fn(),
  postStocktake: jest.fn(),
  cancelStocktakeSession: jest.fn(),
};

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadStocktakes: (...args: unknown[]) => mockApi.loadStocktakes(...args),
  loadStocktakeLines: (...args: unknown[]) => mockApi.loadStocktakeLines(...args),
  loadCurrentUserId: (...args: unknown[]) => mockApi.loadCurrentUserId(...args),
  loadInventorySettings: (...args: unknown[]) => mockApi.loadInventorySettings(...args),
  approveAndPostStocktake: (...args: unknown[]) => mockApi.approveAndPostStocktake(...args),
  postStocktake: (...args: unknown[]) => mockApi.postStocktake(...args),
  cancelStocktakeSession: (...args: unknown[]) => mockApi.cancelStocktakeSession(...args),
  createStocktakeSession: jest.fn(),
  startStocktakeCounting: jest.fn(),
  saveStocktakeLines: jest.fn(),
  submitStocktakeForApproval: jest.fn(),
  rejectStocktakeSession: jest.fn(),
  loadAuditorCandidates: jest.fn(async () => []),
}));

const WORKSPACE = { warehouses: [], materials: [], assets: [], stock: [] };

function session(patch: Record<string, unknown> = {}) {
  return {
    id: 'st-1',
    code: 'KK-0001',
    title: 'Kiểm kê tháng 11',
    warehouseId: 'w1',
    warehouseCode: 'KHO-1',
    status: 'PENDING_APPROVAL',
    scopeType: 'ALL',
    leadAuditor: 'Thủ kho',
    totalItems: 2,
    countedItems: 2,
    differenceItems: 1,
    totalVarianceValue: 0,
    createdAt: '2026-11-20T01:00:00Z',
    updatedAt: '2026-11-20T01:00:00Z',
    createdBy: 'u-creator',
    submittedBy: 'u-creator',
    ...patch,
  };
}

function settings(allowSelfApproval: boolean) {
  return { 'documents.approval': { value: { allowSelfApproval }, version: 1 } };
}

function setup(options: {
  session?: Record<string, unknown>;
  viewerId?: string;
  allowSelfApproval?: boolean;
  canApprove?: boolean;
  canCreate?: boolean;
}) {
  mockApi.loadStocktakes.mockResolvedValue([session(options.session)]);
  mockApi.loadStocktakeLines.mockResolvedValue([]);
  mockApi.loadCurrentUserId.mockResolvedValue(options.viewerId);
  mockApi.loadInventorySettings.mockResolvedValue(settings(options.allowSelfApproval ?? false));
  const onNotice = jest.fn();
  render(
    <InventoryPermissionsContext.Provider
      value={{
        canManage: false,
        canWriteTransactions: false,
        canWriteQuality: false,
        canApproveDocuments: false,
        canCreateStocktake: options.canCreate ?? false,
        canApproveStocktake: options.canApprove ?? true,
      }}
    >
      <StocktakeHub workspace={WORKSPACE as never} onNotice={onNotice} />
    </InventoryPermissionsContext.Provider>,
  );
  return { onNotice };
}

async function waitForSettings() {
  await waitFor(() => expect(mockApi.loadInventorySettings).toHaveBeenCalled());
  await waitFor(() => expect(mockApi.loadCurrentUserId).toHaveBeenCalled());
}

describe('StocktakeHub', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    alertSpy.mockRestore();
  });

  it('isSelfApprovalBlocked chỉ chặn người lập/gửi duyệt khi không cho tự duyệt', () => {
    const s = { createdBy: 'a', submittedBy: 'b' };
    expect(isSelfApprovalBlocked(s, 'a', false)).toBe(true);
    expect(isSelfApprovalBlocked(s, 'b', false)).toBe(true);
    expect(isSelfApprovalBlocked(s, 'c', false)).toBe(false);
    expect(isSelfApprovalBlocked(s, 'a', true)).toBe(false);
    // Chưa biết người xem thì để server quyết.
    expect(isSelfApprovalBlocked(s, undefined, false)).toBe(false);
  });

  it('người lập đợt không thấy nút "Duyệt & Ghi sổ" khi tắt tự duyệt', async () => {
    setup({ viewerId: 'u-creator' });
    await screen.findByText('Bạn đã lập hoặc gửi duyệt đợt này, cần người khác duyệt.');
    expect(screen.queryByRole('button', { name: /Duyệt & Ghi sổ/ })).toBeNull();
  });

  it('người lập thấy nút duyệt khi cấu hình cho tự duyệt', async () => {
    setup({ viewerId: 'u-creator', allowSelfApproval: true });
    await waitForSettings();
    expect(await screen.findByRole('button', { name: /Duyệt & Ghi sổ/ })).toBeTruthy();
    expect(screen.queryByText('Bạn đã lập hoặc gửi duyệt đợt này, cần người khác duyệt.')).toBeNull();
  });

  it('người duyệt khác thấy nút, lỗi duyệt hiện bằng toast thay vì alert', async () => {
    const errorSpy = jest.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    mockApi.approveAndPostStocktake.mockRejectedValue(new Error('Bạn không có quyền duyệt và ghi sổ kiểm kê kho.'));
    setup({ viewerId: 'u-approver' });
    await waitForSettings();
    fireEvent.click(await screen.findByRole('button', { name: /Duyệt & Ghi sổ/ }));
    // Popconfirm hỏi lại; nút xác nhận cùng nhãn.
    const confirmButtons = await screen.findAllByRole('button', { name: /Duyệt & Ghi sổ/ });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        'Không thể duyệt và ghi sổ: Bạn không có quyền duyệt và ghi sổ kiểm kê kho.',
      ),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('đợt APPROVED có nút "Ghi sổ" gọi ghi sổ lại, bấm nhanh hai lần chỉ gọi một lần', async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    mockApi.postStocktake.mockImplementation(
      () => new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    const { onNotice } = setup({ session: { status: 'APPROVED' }, viewerId: 'u-approver' });
    const button = await screen.findByRole('button', { name: /^Ghi sổ$/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockApi.postStocktake).toHaveBeenCalledTimes(1);
    expect(mockApi.postStocktake).toHaveBeenCalledWith('st-1');
    expect(mockApi.approveAndPostStocktake).not.toHaveBeenCalled();
    resolvePost(session({ status: 'POSTED', documentCode: 'DC-0001' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^Ghi sổ$/ })).toBeNull();
  });

  it('không có quyền duyệt thì không có nút "Ghi sổ" cho đợt APPROVED', async () => {
    setup({ session: { status: 'APPROVED' }, viewerId: 'u-approver', canApprove: false });
    await screen.findByText('KK-0001', { selector: 'h2' });
    expect(screen.queryByRole('button', { name: /^Ghi sổ$/ })).toBeNull();
  });

  it('huỷ đợt bắt buộc nhập lý do và gửi đúng lý do người dùng nhập', async () => {
    mockApi.cancelStocktakeSession.mockResolvedValue(session({ status: 'CANCELLED', cancelReason: 'Sai phạm vi kho' }));
    const { onNotice } = setup({ session: { status: 'DRAFT' }, canCreate: true, viewerId: 'u-creator' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy đợt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hủy đợt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Vui lòng nhập lý do hủy đợt kiểm kê.');
    expect(mockApi.cancelStocktakeSession).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Lý do hủy đợt/), { target: { value: '  Sai phạm vi kho  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hủy đợt' }));
    await waitFor(() => expect(mockApi.cancelStocktakeSession).toHaveBeenCalledWith('st-1', 'Sai phạm vi kho'));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Đã hủy đợt kiểm kê KK-0001.'));
    expect(screen.queryByRole('button', { name: 'Xác nhận hủy đợt' })).toBeNull();
  });
});
