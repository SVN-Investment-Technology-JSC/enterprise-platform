import { FinanceError } from '../domain/finance.error.js';
import { parseExternalSourceRequest, planExternalVoucher } from './external-sources.store.js';

const USER = '5b7f3c1e-2d4a-4b6c-8e9f-0a1b2c3d4e5f';
const PROJECT = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

const body = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: 'crm:receipt:1',
  sourceModule: 'crm',
  sourceRef: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
  sourceCode: 'PT-0001',
  kind: 'RECEIPT',
  amount: 4_000_000,
  content: 'Thu tiền đơn hàng DH-0001',
  counterpartyName: 'Công ty ABC',
  voucherDate: '2026-10-27',
  initiatedBy: USER,
  initiatedByName: 'Kế toán công nợ',
  ...over,
});

const invalidMessage = (raw: unknown): string => {
  try {
    parseExternalSourceRequest(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(FinanceError);
    expect((error as FinanceError).status).toBe(422);
    return (error as FinanceError).message;
  }
  throw new Error('expected invalid');
};

describe('parseExternalSourceRequest', () => {
  it('chuẩn hoá yêu cầu hợp lệ, làm tròn tiền và tính hash', () => {
    const parsed = parseExternalSourceRequest(body({ amount: 4_000_000.004, content: '  Thu tiền  ' }));
    expect(parsed).toMatchObject({
      sourceModule: 'crm',
      sourceCode: 'PT-0001',
      kind: 'RECEIPT',
      amount: 4_000_000,
      content: 'Thu tiền',
      initiatedBy: USER,
      description: null,
      projectId: null,
    });
    expect(parsed.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cùng nội dung thì cùng hash; đổi tên hiển thị không đổi hash; đổi số tiền hay ngày thì đổi hash', () => {
    const base = parseExternalSourceRequest(body()).requestHash;
    expect(parseExternalSourceRequest(body({ idempotencyKey: 'khác' })).requestHash).toBe(base);
    expect(parseExternalSourceRequest(body({ initiatedByName: 'Tên khác', sourceCode: 'PT-9' })).requestHash).toBe(base);
    expect(parseExternalSourceRequest(body({ amount: 4_000_001 })).requestHash).not.toBe(base);
    expect(parseExternalSourceRequest(body({ voucherDate: '2026-10-26' })).requestHash).not.toBe(base);
  });

  it('không có mã hiển thị thì lấy theo sourceRef', () => {
    expect(parseExternalSourceRequest(body({ sourceCode: undefined })).sourceCode).toBe('f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b');
  });

  it('từ chối phân hệ lạ, loại phiếu khác thu, số tiền không dương, thiếu trường bắt buộc', () => {
    expect(invalidMessage(body({ sourceModule: 'procedure-engine' }))).toContain('Phân hệ nguồn không hợp lệ.');
    expect(invalidMessage(body({ kind: 'PAYMENT' }))).toContain('Chỉ tạo được phiếu thu');
    expect(invalidMessage(body({ amount: 0 }))).toContain('Số tiền phải lớn hơn 0');
    expect(invalidMessage(body({ amount: '100' }))).toContain('Số tiền phải lớn hơn 0');
    expect(invalidMessage(body({ voucherDate: '2026-02-30' }))).toContain('Ngày chứng từ không hợp lệ.');
    expect(invalidMessage(body({ initiatedBy: 'abc' }))).toContain('người ghi nhận');
    expect(invalidMessage(body({ idempotencyKey: ' ', counterpartyName: '' }))).toMatch(/khoá chống lặp.*đối tượng/s);
    expect(invalidMessage(body({ projectId: 'x' }))).toContain('Dự án không hợp lệ.');
    expect(invalidMessage(null)).toContain('Thiếu khoá chống lặp');
  });
});

describe('planExternalVoucher', () => {
  it('phiếu thu nháp một dòng, khoá số tiền, nội dung, đối tượng, ngày', async () => {
    const request = parseExternalSourceRequest(body({ description: 'Phân bổ cho HĐ-01' }));
    const resolve = jest.fn();
    const plan = await planExternalVoucher(request, resolve, '2026-10-28');
    expect(resolve).not.toHaveBeenCalled();
    expect(plan.lockedFields).toEqual(['amount', 'content', 'counterpartyName', 'voucherDate']);
    expect(plan.voucher).toMatchObject({
      kind: 'RECEIPT',
      voucherDate: '2026-10-27',
      postingDate: '2026-10-28',
      accountId: null,
      totalAmount: 4_000_000,
      counterpartyName: 'Công ty ABC',
      lines: [{ lineNo: 1, description: 'Phân bổ cho HĐ-01', quantity: 1, unitAmount: 4_000_000, total: 4_000_000 }],
    });
    expect(plan.allocationNote).toBeNull();
  });

  it('dự án xác nhận được thì khoá hạch toán; Workspace lỗi thì để trống và ghi chú', async () => {
    const request = parseExternalSourceRequest(body({ projectId: PROJECT }));
    const allocation = { type: 'PROJECT' as const, projectId: PROJECT, projectCode: 'DA1', projectName: 'Dự án 1', workItemId: null, workItemCode: null, workItemTitle: null };
    const ok = await planExternalVoucher(request, async () => ({ allocation, relatedProjects: [] }));
    expect(ok.lockedFields).toContain('allocation');
    expect(ok.voucher.allocation).toEqual({ type: 'PROJECT', projectId: PROJECT, workItemId: null });

    const failed = await planExternalVoucher(request, async () => {
      throw new Error('Workspace không phản hồi');
    });
    expect(failed.lockedFields).not.toContain('allocation');
    expect(failed.voucher.allocation).toBeNull();
    expect(failed.allocationNote).toContain('Workspace không phản hồi');
  });
});
