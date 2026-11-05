import { CONTRACT_STATUSES, CONTRACT_STATUS_TRANSITIONS, type ContractStatus } from '@enterprise-platform/contracts-crm';
import {
  assertContractTransition,
  assertContractUsableForOrder,
  canContractTransition,
  contractDefaultValue,
  contractLineAmount,
  formatContractCode,
  reservableContractLines,
} from './contract.js';

/** Các cặp hợp lệ theo mục 5.3 kế hoạch. */
const VALID: readonly [ContractStatus, ContractStatus][] = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'EXPIRED'],
  ['ACTIVE', 'CANCELLED'],
  ['COMPLETED', 'LIQUIDATED'],
  ['EXPIRED', 'LIQUIDATED'],
];

describe('máy trạng thái hợp đồng (TC-SM-05)', () => {
  const pairs = CONTRACT_STATUSES.flatMap((from) => CONTRACT_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)('%s → %s', (from, to) => {
    const valid = VALID.some(([a, b]) => a === from && b === to);
    expect(canContractTransition(from, to)).toBe(valid);
    if (valid) expect(() => assertContractTransition(from, to)).not.toThrow();
    else expect(() => assertContractTransition(from, to)).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('bảng ở contracts khớp đúng các cặp hợp lệ', () => {
    const count = Object.values(CONTRACT_STATUS_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    expect(count).toBe(VALID.length);
  });

  it('Đã thanh lý → Hiệu lực trả thông báo tiếng Việt', () => {
    expect(() => assertContractTransition('LIQUIDATED', 'ACTIVE')).toThrow('Không thể chuyển hợp đồng từ "Đã thanh lý" sang "Hiệu lực".');
  });
});

describe('hợp đồng dùng để lập đơn (TC-CON-03)', () => {
  const contract = { code: 'HD2600001', validFrom: '2026-01-01', validTo: '2026-06-30' as string | null };

  it('hết hạn (đã chuyển hoặc job chưa kịp chạy) trả 409 "Hợp đồng đã hết hiệu lực."', () => {
    expect(() => assertContractUsableForOrder({ ...contract, status: 'EXPIRED' }, '2026-07-01')).toThrow('Hợp đồng đã hết hiệu lực.');
    expect(() => assertContractUsableForOrder({ ...contract, status: 'ACTIVE' }, '2026-07-01')).toThrow(
      expect.objectContaining({ code: 'CONTRACT_EXPIRED', statusCode: 409 }),
    );
  });

  it('Nháp, đã huỷ, chưa tới ngày hiệu lực: 409; Hiệu lực trong hạn thì dùng được', () => {
    expect(() => assertContractUsableForOrder({ ...contract, status: 'DRAFT' }, '2026-03-01')).toThrow(expect.objectContaining({ code: 'CONTRACT_NOT_ACTIVE' }));
    expect(() => assertContractUsableForOrder({ ...contract, status: 'CANCELLED' }, '2026-03-01')).toThrow(expect.objectContaining({ code: 'CONTRACT_CLOSED' }));
    expect(() => assertContractUsableForOrder({ ...contract, status: 'ACTIVE' }, '2025-12-31')).toThrow(expect.objectContaining({ code: 'CONTRACT_NOT_STARTED' }));
    expect(() => assertContractUsableForOrder({ ...contract, status: 'ACTIVE', validTo: null }, '2030-01-01')).not.toThrow();
  });
});

describe('dòng và giá trị hợp đồng', () => {
  it('chỉ giữ hàng cho dòng hàng tồn kho có số lượng (TC-CON-07)', () => {
    const lines = [
      { id: 'a', materialKind: 'STOCK', quantity: 5 },
      { id: 'b', materialKind: 'SERVICE', quantity: 1 },
      { id: 'c', materialKind: 'STOCK', quantity: null },
    ];
    expect(reservableContractLines(lines).map((line) => line.id)).toEqual(['a']);
  });

  it('thành tiền làm tròn đến đồng; giá trị mặc định cộng VAT của dòng có số lượng', () => {
    expect(contractLineAmount(3, 333_333.33)).toBe(1_000_000);
    expect(contractLineAmount(null, 900_000)).toBeNull();
    expect(contractDefaultValue([{ lineAmount: 1_000_000, vatRate: 10 }, { lineAmount: null, vatRate: 10 }])).toBe(1_100_000);
  });

  it('mã HD<yy><5 chữ số>', () => {
    expect(formatContractCode(2026, 7)).toBe('HD2600007');
  });
});
