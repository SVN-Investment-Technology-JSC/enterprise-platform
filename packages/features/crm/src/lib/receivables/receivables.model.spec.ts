import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { adjustmentActions, allocationError, allocationRequests, autoAllocate, receiptActions } from './receivables.model';

const items = [
  { entryId: 'b', dueDate: '2026-11-10', entryDate: '2026-10-10', allocatableAmount: 2_000_000, orderCode: 'DH2' },
  { entryId: 'a', dueDate: '2026-10-01', entryDate: '2026-09-01', allocatableAmount: 3_000_000, orderCode: 'DH1' },
];

describe('phân bổ lần thu', () => {
  it('TC-AR-03: thu 4.000.000 chia hạn sớm trước: A 3.000.000, B 1.000.000', () => {
    expect(autoAllocate(items, 4_000_000)).toEqual({ a: 3_000_000, b: 1_000_000 });
  });

  it('TC-AR-04: vượt số còn nợ hoặc vượt số thu thì báo lỗi', () => {
    expect(allocationError(2_000_000, { a: 3_500_000 }, items)).toBe('Số phân bổ vào khoản nợ đơn DH1 vượt số còn nợ.');
    expect(allocationError(1_000_000, { a: 1_200_000 }, items)).toBe('Tổng số tiền phân bổ vượt số tiền thu.');
    expect(allocationError(0, {}, items)).toBe('Số tiền thu phải lớn hơn 0.');
    expect(allocationError(4_000_000, { a: 3_000_000, b: 1_000_000 }, items)).toBeUndefined();
  });

  it('bỏ dòng 0 khi gửi', () => {
    expect(allocationRequests({ a: 10, b: 0 })).toEqual([{ entryId: 'a', amount: 10 }]);
  });
});

describe('thao tác theo quyền', () => {
  const writer = { ...CRM_NO_CAPABILITIES, canWriteReceivable: true };
  const manager = { ...CRM_NO_CAPABILITIES, canManage: true };

  it('lần thu bị trả lại hoặc bị từ chối thì sửa gửi lại, huỷ', () => {
    expect(receiptActions({ status: 'RETURNED', voucherError: null }, writer)).toEqual(['resend', 'cancel']);
    expect(receiptActions({ status: 'PENDING_VOUCHER', voucherError: 'Sai' }, writer)).toEqual(['resend', 'cancel']);
    expect(receiptActions({ status: 'POSTED', voucherError: null }, writer)).toEqual([]);
    expect(receiptActions({ status: 'RETURNED', voucherError: null }, CRM_NO_CAPABILITIES)).toEqual([]);
  });

  it('điều chỉnh: người lập không tự duyệt', () => {
    expect(adjustmentActions({ status: 'DRAFT', createdBy: 'u1' }, manager, 'u1')).toEqual(['cancel']);
    expect(adjustmentActions({ status: 'DRAFT', createdBy: 'u1' }, manager, 'u2')).toEqual(['approve', 'cancel']);
    expect(adjustmentActions({ status: 'DRAFT', createdBy: 'u1' }, writer, 'u1')).toEqual(['cancel']);
    expect(adjustmentActions({ status: 'APPROVED', createdBy: 'u1' }, manager, 'u2')).toEqual([]);
  });
});
