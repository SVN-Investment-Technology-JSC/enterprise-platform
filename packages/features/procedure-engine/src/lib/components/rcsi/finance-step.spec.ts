import type {
  ProcedureAttributeDefinition,
  ProcedureDefinition,
  ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  autoMatchedCandidate,
  candidatesForField,
  cleanIntegration,
  financeAttributeCandidates,
  financeReturnTargets,
  financeVoucherCard,
  financeVoucherHref,
} from './finance-step';

const attribute = (code: string, type: ProcedureAttributeDefinition['type'], name = code): ProcedureAttributeDefinition => ({
  id: `a-${code}`,
  code,
  name,
  type,
  required: false,
});

const step = (id: string, order: number, attributes?: ProcedureAttributeDefinition[]): ProcedureStepDefinition => ({
  id,
  key: id.toUpperCase(),
  order,
  name: `Bước ${id}`,
  attributes,
  assignments: [],
});

/** Lập đề nghị → (nhánh a | nhánh b) → chi tiền. Thuộc tính của nhánh không chắc đã đi qua. */
function definition(): ProcedureDefinition {
  return {
    id: 'def',
    code: 'DNTT',
    name: 'Đề nghị thanh toán',
    kind: 'process',
    status: 'draft',
    attributes: [attribute('noi_dung', 'text', 'Nội dung đề nghị')],
    steps: [
      step('lap', 1, [attribute('so_tien', 'money', 'Số tiền đề nghị'), attribute('ghi_chu', 'text')]),
      step('a', 2, [attribute('amount', 'number')]),
      step('b', 3),
      step('chi', 4, [attribute('tong_tien', 'money')]),
    ],
    gateways: [
      {
        id: 'g1',
        key: 'G1',
        name: 'Theo giá trị',
        type: 'exclusive',
        afterStepId: 'lap',
        branches: [
          { id: 'n1', key: 'N1', label: 'Lớn', isDefault: false, stepIds: ['a'] },
          { id: 'n2', key: 'N2', label: 'Nhỏ', isDefault: true, stepIds: ['b'] },
        ],
      },
    ],
  } as unknown as ProcedureDefinition;
}

describe('bước Tài chính trên màn thiết kế', () => {
  it('chỉ chào mời thuộc tính cấp quy trình và của bước chắc chắn đã đi qua', () => {
    const keys = financeAttributeCandidates(definition(), 'chi').map((item) => item.key);
    expect(keys).toEqual(['process:noi_dung', 'step:lap:so_tien', 'step:lap:ghi_chu']);
  });

  it('lọc theo kiểu và tự khớp theo thứ tự mã của server', () => {
    const candidates = financeAttributeCandidates(definition(), 'chi');
    expect(candidatesForField('amount', candidates).map((item) => item.key)).toEqual(['step:lap:so_tien']);
    expect(autoMatchedCandidate('amount', candidates)?.key).toBe('step:lap:so_tien');
    expect(autoMatchedCandidate('content', candidates)?.key).toBe('process:noi_dung');
    expect(autoMatchedCandidate('voucherDate', candidates)).toBeUndefined();
  });

  it('bước nhận hồ sơ khi trả về là các bước chắc chắn đứng trước', () => {
    expect(financeReturnTargets(definition(), 'chi').map((item) => item.id)).toEqual(['lap']);
  });

  it('bỏ ánh xạ trống trước khi gửi', () => {
    expect(
      cleanIntegration({
        module: 'finance',
        action: 'voucher',
        voucherKind: 'PAYMENT',
        mapping: { amount: 'step:lap:so_tien', content: '' },
      }),
    ).toEqual({ module: 'finance', action: 'voucher', voucherKind: 'PAYMENT', mapping: { amount: 'step:lap:so_tien' } });
    expect(cleanIntegration({ module: 'finance', action: 'voucher', voucherKind: 'RECEIPT', mapping: {} })).toEqual({
      module: 'finance',
      action: 'voucher',
      voucherKind: 'RECEIPT',
    });
  });
});

describe('thẻ phiếu trên hồ sơ', () => {
  const base = { activation: 1, requestedAt: '2026-10-15T00:00:00Z' };

  it('hiển thị theo tiến trình phiếu', () => {
    expect(financeVoucherCard({ ...base, state: 'requested' }).title).toBe('Chờ Tài chính tạo phiếu');
    expect(financeVoucherCard({ ...base, activation: 2, state: 'requested', code: 'NHAP_PC_2610_0045' }).title).toBe(
      'NHAP_PC_2610_0045 · Chờ Tài chính cập nhật phiếu',
    );
    expect(financeVoucherCard({ ...base, state: 'linked', code: 'NHAP_PC_2610_0045', amount: 12500000 }).title).toBe(
      `NHAP_PC_2610_0045 · Chờ ghi sổ · ${(12500000).toLocaleString('vi-VN')} đ`,
    );
    expect(
      financeVoucherCard({ ...base, state: 'posted', code: 'PC-2610-0045', amount: 1000, postedByName: 'Kế toán A' }).title,
    ).toBe(`PC-2610-0045 · Đã ghi sổ bởi Kế toán A · ${(1000).toLocaleString('vi-VN')} đ`);
    const returned = financeVoucherCard({ ...base, state: 'returned', returnedReason: 'Thiếu hoá đơn' });
    expect(returned.title).toBe('Kế toán đã trả hồ sơ');
    expect(returned.detail).toBe('Lý do: Thiếu hoá đơn');
  });

  it('dựng link mở phiếu theo loại phiếu', () => {
    expect(financeVoucherHref('PAYMENT', 'v1')).toBe('/modules/finance/payments/v1');
    expect(financeVoucherHref('RECEIPT', 'v2')).toBe('/modules/finance/receipts/v2');
  });
});
