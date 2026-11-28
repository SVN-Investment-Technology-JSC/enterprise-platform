import { FINANCE_VOUCHER_SORT_KEYS } from '@enterprise-platform/contracts-finance';
import { FinanceError } from '../domain/finance.error.js';
import { bulkSkipReason } from '../application/finance.application.js';
import { voucherListOrderBy, voucherMissingFields, type Row } from './vouchers.store.js';

describe('sắp xếp danh sách phiếu', () => {
  it('không chọn cột thì giữ thứ tự mặc định: mới nhất trước', () => {
    expect(voucherListOrderBy(undefined, undefined)).toBe('v.voucher_date DESC, v.created_at DESC, v.id DESC');
    expect(voucherListOrderBy('', 'desc')).toBe('v.voucher_date DESC, v.created_at DESC, v.id DESC');
  });

  it('mọi cột trong danh sách trắng đều có biểu thức; ô trống xuống cuối, dòng bằng nhau giữ thứ tự mặc định', () => {
    for (const key of FINANCE_VOUCHER_SORT_KEYS) expect(voucherListOrderBy(key, 'asc')).toMatch(/ ASC NULLS LAST, v\.voucher_date DESC/);
    expect(voucherListOrderBy('amount', 'desc')).toBe('v.total_amount DESC NULLS LAST, v.voucher_date DESC, v.created_at DESC, v.id DESC');
    expect(voucherListOrderBy('created-by', undefined)).toMatch(/^v\.created_by_name ASC/);
    expect(voucherListOrderBy('account', 'asc')).toMatch(/^a\.name ASC/);
  });

  it('mã cột hoặc chiều lạ bị từ chối, không chuỗi nào của người dùng lọt vào SQL', () => {
    for (const bad of ['v.code; DROP TABLE x', 'created_by', 'CODE', 1, ['code']])
      expect(() => voucherListOrderBy(bad, 'asc')).toThrow(FinanceError);
    expect(() => voucherListOrderBy('code', 'sideways')).toThrow(/Chiều sắp xếp/);
  });
});

describe('trường còn thiếu của phiếu đã lưu', () => {
  const row = (over: Partial<Row> = {}): Row => ({
    kind: 'PAYMENT',
    status: 'DRAFT',
    voucher_date: '2026-10-14',
    posting_date: '2026-10-14',
    content: 'Thanh toán dịch vụ',
    total_amount: '500000',
    reason_id: 'r1',
    account_id: 'a1',
    account_type_ref: 'BANK',
    counterparty_group_id: 'g1',
    counterparty_name: 'Công ty X',
    counterparty_account_no: null,
    counterparty_bank: null,
    alloc_type: null,
    reason_require_project: false,
    ...over,
  });

  it('thiếu thông tin người nhận không bị báo; dự án bắt buộc theo cài đặt hoặc theo lý do', () => {
    expect(voucherMissingFields(row({ counterparty_name: null }), false)).toEqual([]);
    expect(voucherMissingFields(row({ account_type_ref: 'CASH' }), true)).toEqual(['allocation']);
    expect(voucherMissingFields(row({ account_type_ref: 'CASH', reason_require_project: true }), false)).toEqual(['allocation']);
    expect(voucherMissingFields(row({ account_type_ref: 'CASH', alloc_type: 'PROJECT' }), true)).toEqual([]);
  });

  it('phiếu đã ghi sổ hoặc đã huỷ không bị báo thiếu', () => {
    expect(voucherMissingFields(row({ status: 'APPROVED', counterparty_name: null }), false)).toEqual([]);
    expect(voucherMissingFields(row({ status: 'CANCELLED', counterparty_name: null }), false)).toEqual([]);
    expect(voucherMissingFields(row({ status: 'REJECTED', account_type_ref: 'CASH', reason_id: null }), false)).toEqual(['reason']);
  });
});

describe('nhóm lý do bỏ qua của duyệt hàng loạt', () => {
  it('suy từ mã lỗi của lần duyệt một phiếu', () => {
    expect(bulkSkipReason(new FinanceError('FINANCE_SUBMIT_INVALID', 'Còn thiếu: Lý do chi.', 422))).toBe('INCOMPLETE');
    expect(bulkSkipReason(new FinanceError('FINANCE_FORBIDDEN', 'Không được tự duyệt phiếu do mình lập.', 403))).toBe('FORBIDDEN');
    expect(bulkSkipReason(new FinanceError('FINANCE_NOT_FOUND', 'Không tìm thấy phiếu.', 404))).toBe('FORBIDDEN');
    expect(bulkSkipReason(new FinanceError('FINANCE_PROCEDURE_MANAGED', 'x', 409))).toBe('PROCEDURE');
    expect(bulkSkipReason(new FinanceError('FINANCE_VOUCHER_STATE', 'x', 409))).toBe('STATE');
    expect(bulkSkipReason(new FinanceError('FINANCE_INSUFFICIENT_BALANCE', 'x', 409))).toBe('OTHER');
    expect(bulkSkipReason(new Error('lỗi lạ'))).toBe('OTHER');
  });
});
