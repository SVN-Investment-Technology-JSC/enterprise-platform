import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type StockDocumentStatus,
  type StockDocumentType,
} from '@enterprise-platform/contracts-inventory';
import {
  assertEditable,
  assertNotSelfApproval,
  assertReversible,
  assertTransition,
  canTransition,
  requiresApproval,
  requiresSerialsAtPosting,
  resolveLineDirection,
  stockEventKind,
} from './stock-document-policy.js';

/** Các cặp chuyển hợp lệ theo sơ đồ mục 5.6 của kế hoạch, cho loại có nguồn đã duyệt. */
const VALID: ReadonlyArray<[StockDocumentStatus, StockDocumentStatus]> = [
  ['DRAFT', 'PENDING'],
  ['DRAFT', 'POSTED'],
  ['DRAFT', 'CANCELLED'],
  ['PENDING', 'APPROVED'],
  ['PENDING', 'REJECTED'],
  ['PENDING', 'CANCELLED'],
  ['REJECTED', 'DRAFT'],
  ['APPROVED', 'POSTED'],
  ['APPROVED', 'CANCELLED'],
];

const isValid = (from: StockDocumentStatus, to: StockDocumentStatus) =>
  VALID.some(([a, b]) => a === from && b === to);

describe('máy trạng thái chứng từ kho (TC-SM-11)', () => {
  const pairs = STOCK_DOCUMENT_STATUSES.flatMap((from) =>
    STOCK_DOCUMENT_STATUSES.map((to) => [from, to] as const),
  );

  it.each(pairs)('ISSUE_SALES %s → %s đúng như sơ đồ', (from, to) => {
    expect(canTransition('ISSUE_SALES', from, to)).toBe(isValid(from, to));
  });

  it.each(pairs)('ADJUSTMENT %s → %s: như sơ đồ nhưng không ghi sổ thẳng từ Nháp', (from, to) => {
    const expected = isValid(from, to) && !(from === 'DRAFT' && to === 'POSTED');
    expect(canTransition('ADJUSTMENT', from, to)).toBe(expected);
  });

  it('chuyển sai ném lỗi 409 tiếng Việt', () => {
    for (const [from, to] of [
      ['POSTED', 'DRAFT'],
      ['CANCELLED', 'PENDING'],
      ['APPROVED', 'PENDING'],
    ] as const) {
      expect(() => assertTransition({ docType: 'ISSUE_SALES', status: from }, to)).toThrow(
        expect.objectContaining({ statusCode: 409, code: 'STOCK_DOCUMENT_INVALID_TRANSITION' }),
      );
    }
    expect(() =>
      assertTransition({ docType: 'RECEIPT_OTHER', status: 'DRAFT' }, 'POSTED'),
    ).toThrow('Chứng từ loại này phải được duyệt trước khi ghi sổ.');
  });

  it('ba loại phải duyệt: nhập khác, xuất khác, điều chỉnh; loại có nguồn đã duyệt ghi sổ thẳng (TC-INV-05)', () => {
    const required = STOCK_DOCUMENT_TYPES.filter((type) => requiresApproval(type));
    expect(required.sort()).toEqual(['ADJUSTMENT', 'ISSUE_OTHER', 'RECEIPT_OTHER']);
    for (const type of ['ISSUE_SALES', 'RECEIPT_SALES_RETURN', 'ISSUE_WARRANTY', 'TRANSFER'] as StockDocumentType[]) {
      expect(canTransition(type, 'DRAFT', 'POSTED')).toBe(true);
    }
  });

  it('chứng từ đã ghi sổ không sửa được; chỉ sửa Nháp hoặc Từ chối (TC-INV-23)', () => {
    expect(() => assertEditable({ status: 'POSTED' })).toThrow('Chứng từ đã ghi sổ không được sửa.');
    expect(() => assertEditable({ status: 'APPROVED' })).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(() => assertEditable({ status: 'DRAFT' })).not.toThrow();
    expect(() => assertEditable({ status: 'REJECTED' })).not.toThrow();
  });

  it('người lập không tự duyệt, trừ khi cài đặt cho phép (TC-INV-04)', () => {
    expect(() => assertNotSelfApproval({ createdBy: 'u1' }, 'u1', false)).toThrow(
      expect.objectContaining({ statusCode: 403, message: 'Không được tự duyệt chứng từ do mình lập.' }),
    );
    expect(() => assertNotSelfApproval({ createdBy: 'u1' }, 'u1', true)).not.toThrow();
    expect(() => assertNotSelfApproval({ createdBy: 'u1' }, 'u2', false)).not.toThrow();
  });

  it('chỉ đảo chứng từ đã ghi sổ và không phải chứng từ đảo', () => {
    expect(() => assertReversible({ status: 'POSTED', code: 'PN-1' })).not.toThrow();
    expect(() => assertReversible({ status: 'APPROVED', code: 'PN-1' })).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(() =>
      assertReversible({ status: 'POSTED', code: 'PN-2', reversesDocumentId: 'x' }),
    ).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('chiều dòng suy theo loại chứng từ', () => {
    expect(resolveLineDirection('RECEIPT_PURCHASE', undefined, 1)).toBe('IN');
    expect(resolveLineDirection('ISSUE_SALES', undefined, 1)).toBe('OUT');
    expect(resolveLineDirection('TRANSFER', undefined, 1)).toBe('OUT');
    expect(resolveLineDirection('ADJUSTMENT', 'IN', 1)).toBe('IN');
    expect(() => resolveLineDirection('ADJUSTMENT', undefined, 2)).toThrow(/Dòng 2/);
    expect(() => resolveLineDirection('RECEIPT_OTHER', 'OUT', 3)).toThrow(/Dòng 3/);
    expect(() => resolveLineDirection('TRANSFER', 'IN', 1)).toThrow(/chỉ có dòng xuất/);
  });
});

describe('serial bắt buộc lúc ghi sổ và sự kiện kho (T1-25, T1-27)', () => {
  it('chỉ xuất bán, xuất bảo hành, nhập trả bắt buộc serial; chứng từ đảo thì không', () => {
    const required = STOCK_DOCUMENT_TYPES.filter((type) => requiresSerialsAtPosting(type, false));
    expect(required).toEqual(['RECEIPT_SALES_RETURN', 'ISSUE_SALES', 'ISSUE_WARRANTY']);
    expect(requiresSerialsAtPosting('ISSUE_SALES', true)).toBe(false);
  });

  it('chứng từ xuất phát issued, nhập trả hàng bán phát returned, loại khác không phát', () => {
    expect(stockEventKind('ISSUE_PROJECT')).toBe('ISSUED');
    expect(stockEventKind('ISSUE_TRANSFER')).toBe('ISSUED');
    expect(stockEventKind('RECEIPT_SALES_RETURN')).toBe('RETURNED');
    expect(stockEventKind('RECEIPT_PURCHASE')).toBeNull();
    expect(stockEventKind('TRANSFER')).toBeNull();
    expect(stockEventKind('ADJUSTMENT')).toBeNull();
  });
});
