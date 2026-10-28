import { STOCK_DOCUMENT_TYPES, type Warehouse } from '@enterprise-platform/contracts-inventory';
import {
  MOVEMENT_CATEGORY_RULES,
  classifyMovement,
  daysBetween,
  filterWarehouseCatalog,
  foldMovementGroups,
  resolveExpiringWithinDays,
  resolveReportPaging,
  resolveReportPeriod,
  stockQuantities,
  type MovementGroup,
} from './inventory-report.js';

describe('stockQuantities', () => {
  it('TC-INV-14: thực tế 90, đã giữ 10, không Đạt 5 cho khả dụng 75', () => {
    expect(stockQuantities(90, 10, 5)).toEqual({ onHand: 90, reserved: 10, blocked: 5, available: 75 });
  });

  it('không trả khả dụng âm và làm tròn 3 chữ số', () => {
    expect(stockQuantities(1, 2, 0).available).toBe(0);
    expect(stockQuantities(0.1 + 0.2, 0, 0).onHand).toBe(0.3);
  });
});

describe('classifyMovement', () => {
  it('mỗi loại chứng từ thuộc đúng một nhóm', () => {
    for (const docType of STOCK_DOCUMENT_TYPES) {
      const owners = Object.values(MOVEMENT_CATEGORY_RULES).filter((rule) => rule.docTypes.includes(docType));
      expect([docType, owners.length]).toEqual([docType, 1]);
    }
  });

  it('nhóm theo loại chứng từ, chứng từ đảo tách riêng', () => {
    expect(classifyMovement({ docType: 'RECEIPT_PURCHASE', isReversal: false, ledgerType: 'IMPORT' })).toBe('RECEIPT');
    expect(classifyMovement({ docType: 'ISSUE_SALES', isReversal: false, ledgerType: 'EXPORT' })).toBe('ISSUE');
    expect(classifyMovement({ docType: 'TRANSFER', isReversal: false, ledgerType: 'IMPORT' })).toBe('TRANSFER');
    expect(classifyMovement({ docType: 'RECEIPT_SALES_RETURN', isReversal: false, ledgerType: 'IMPORT' })).toBe(
      'SALES_RETURN',
    );
    expect(classifyMovement({ docType: 'ADJUSTMENT', isReversal: false, ledgerType: 'ADJUST' })).toBe('ADJUSTMENT');
    expect(classifyMovement({ docType: 'RECEIPT_PURCHASE', isReversal: true, ledgerType: 'EXPORT' })).toBe('REVERSAL');
  });

  it('bút toán cũ không có chứng từ nhóm theo loại bút toán', () => {
    expect(classifyMovement({ isReversal: false, ledgerType: 'EXPORT' })).toBe('ISSUE');
    expect(classifyMovement({ isReversal: false, ledgerType: 'RETURN' })).toBe('RECEIPT');
    expect(classifyMovement({ isReversal: false, ledgerType: 'ADJUST' })).toBe('ADJUSTMENT');
    expect(classifyMovement({ isReversal: false, ledgerType: 'TRANSFER_OUT' })).toBe('TRANSFER');
  });
});

describe('foldMovementGroups', () => {
  const group = (patch: Partial<MovementGroup>): MovementGroup => ({
    isReversal: false,
    ledgerType: 'IMPORT',
    warehouseCode: 'KHO-A',
    warehouseName: 'Kho A',
    quantityIn: 0,
    quantityOut: 0,
    valueIn: 0,
    valueOut: 0,
    entries: 1,
    ...patch,
  });

  it('cộng theo nhóm, đủ sáu nhóm theo thứ tự, tổng khớp', () => {
    const folded = foldMovementGroups([
      group({ docType: 'RECEIPT_PURCHASE', quantityIn: 10, valueIn: 1_000_000.1 }),
      group({ docType: 'RECEIPT_OTHER', quantityIn: 2, valueIn: 0.2, entries: 2 }),
      group({ docType: 'TRANSFER', ledgerType: 'EXPORT', quantityOut: 3, valueOut: 300 }),
      group({ docType: 'TRANSFER', ledgerType: 'IMPORT', warehouseCode: 'KHO-B', quantityIn: 3, valueIn: 300 }),
      group({ docType: 'RECEIPT_PURCHASE', isReversal: true, ledgerType: 'EXPORT', quantityOut: 1, valueOut: 100 }),
    ]);
    expect(folded.summary.map((row) => row.category)).toEqual([
      'RECEIPT',
      'ISSUE',
      'TRANSFER',
      'SALES_RETURN',
      'ADJUSTMENT',
      'REVERSAL',
    ]);
    expect(folded.summary[0]).toMatchObject({ quantityIn: 12, valueIn: 1_000_000.3, entries: 3 });
    expect(folded.summary[2]).toMatchObject({ quantityIn: 3, quantityOut: 3, valueIn: 300, valueOut: 300 });
    expect(folded.summary[3]).toMatchObject({ quantityIn: 0, entries: 0 });
    expect(folded.summary[5]).toMatchObject({ quantityOut: 1, valueOut: 100 });
    expect(folded.totals).toEqual({ quantityIn: 15, quantityOut: 4, valueIn: 1_000_300.3, valueOut: 400, entries: 6 });
    expect(folded.breakdown.map((row) => [row.category, row.docType, row.warehouseCode])).toEqual([
      ['RECEIPT', 'RECEIPT_OTHER', 'KHO-A'],
      ['RECEIPT', 'RECEIPT_PURCHASE', 'KHO-A'],
      ['TRANSFER', 'TRANSFER', 'KHO-A'],
      ['TRANSFER', 'TRANSFER', 'KHO-B'],
      ['REVERSAL', 'RECEIPT_PURCHASE', 'KHO-A'],
    ]);
  });
});

describe('tham số báo cáo', () => {
  it('kỳ mặc định từ đầu tháng tới hôm nay; kiểm ngày và thứ tự', () => {
    expect(resolveReportPeriod(undefined, undefined, '2026-10-28')).toEqual({
      fromDate: '2026-10-01',
      toDate: '2026-10-28',
    });
    expect(resolveReportPeriod('2026-01-01', '2026-01-31', '2026-10-28')).toEqual({
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });
    expect(() => resolveReportPeriod('2026-02-30', undefined, '2026-10-28')).toThrow(/không hợp lệ/);
    expect(() => resolveReportPeriod('2026-02-01', '2026-01-01', '2026-10-28')).toThrow(/trước hoặc bằng/);
    expect(() => resolveReportPeriod('2020-01-01', '2026-01-01', '2026-10-28')).toThrow(/tối đa/);
  });

  it('trang mặc định 50, giới hạn 1 đến 1000', () => {
    expect(resolveReportPaging(undefined, undefined)).toEqual({ limit: 50, offset: 0 });
    expect(resolveReportPaging('200', '400')).toEqual({ limit: 200, offset: 400 });
    expect(() => resolveReportPaging(0, 0)).toThrow();
    expect(() => resolveReportPaging(1001, 0)).toThrow();
    expect(() => resolveReportPaging(Number.NaN, 0)).toThrow();
    expect(() => resolveReportPaging(10, -1)).toThrow();
  });

  it('số ngày sắp hết hạn là số nguyên không âm', () => {
    expect(resolveExpiringWithinDays(undefined)).toBeUndefined();
    expect(resolveExpiringWithinDays(30)).toBe(30);
    expect(() => resolveExpiringWithinDays(-1)).toThrow();
    expect(() => resolveExpiringWithinDays(1.5)).toThrow();
  });

  it('daysBetween tính theo ngày lịch', () => {
    expect(daysBetween('2026-10-28', '2026-11-27')).toBe(30);
    expect(daysBetween('2026-10-28', '2026-10-27')).toBe(-1);
  });
});

describe('filterWarehouseCatalog (T4-19)', () => {
  const warehouses: Warehouse[] = [
    { id: '11111111-1111-4111-8111-111111111111', code: 'KHO-HN', name: 'Kho Hà Nội', type: 'PHYSICAL', isActive: true },
    { id: '22222222-2222-4222-8222-222222222222', code: 'KHO-CU', name: 'Kho cũ', type: 'PHYSICAL', isActive: false },
    { id: '33333333-3333-4333-8333-333333333333', code: 'KHO-DN', name: 'Kho Đà Nẵng', type: 'PHYSICAL', isActive: true },
  ];

  it('mặc định chỉ kho đang dùng, sắp theo mã, chỉ trả trường cần', () => {
    expect(filterWarehouseCatalog(warehouses, {})).toEqual([
      { id: warehouses[2].id, code: 'KHO-DN', name: 'Kho Đà Nẵng', isActive: true, type: 'PHYSICAL' },
      { id: warehouses[0].id, code: 'KHO-HN', name: 'Kho Hà Nội', isActive: true, type: 'PHYSICAL' },
    ]);
    expect(filterWarehouseCatalog(warehouses, { includeInactive: true })).toHaveLength(3);
  });

  it('lọc theo mã, id, chuỗi tìm có dấu', () => {
    expect(filterWarehouseCatalog(warehouses, { codes: ['kho-hn'] }).map((item) => item.code)).toEqual(['KHO-HN']);
    expect(
      filterWarehouseCatalog(warehouses, { ids: [warehouses[1].id], includeInactive: true }).map((item) => item.code),
    ).toEqual(['KHO-CU']);
    expect(filterWarehouseCatalog(warehouses, { search: 'đà nẵng' }).map((item) => item.code)).toEqual(['KHO-DN']);
    expect(() => filterWarehouseCatalog(warehouses, { ids: ['abc'] })).toThrow(/id kho/);
  });
});
