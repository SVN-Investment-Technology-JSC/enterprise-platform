import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  type StockDocumentStatus,
  type StockDocumentType,
} from '@enterprise-platform/contracts-inventory';
import {
  assertEditable,
  assertNotSelfApproval,
  assertNotSelfReversal,
  assertPostable,
  assertReversible,
  assertTransition,
  canTransition,
  documentRequiresApproval,
  POSTING_ORIGINS,
  requiresApproval,
  requiresSerialsAtPosting,
  assertSerializedLine,
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
    ).toThrow('Chứng từ này cần được duyệt trước khi ghi sổ.');
  });

  it('ba loại phải duyệt: nhập khác, xuất khác, điều chỉnh; loại có nguồn đã duyệt ghi sổ thẳng (TC-INV-05)', () => {
    const required = STOCK_DOCUMENT_TYPES.filter((type) => requiresApproval(type));
    expect(required.sort()).toEqual(['ADJUSTMENT', 'ISSUE_OTHER', 'RECEIPT_OTHER']);
    for (const type of ['ISSUE_SALES', 'RECEIPT_SALES_RETURN', 'ISSUE_WARRANTY', 'TRANSFER'] as StockDocumentType[]) {
      expect(canTransition(type, 'DRAFT', 'POSTED')).toBe(true);
    }
  });

  it('nhập mua, xuất dự án không nguồn cũng phải duyệt; có nguồn thì ghi sổ thẳng (ISS-BE-006)', () => {
    for (const docType of ['RECEIPT_PURCHASE', 'ISSUE_PROJECT'] as StockDocumentType[]) {
      expect(documentRequiresApproval({ docType })).toBe(true);
      expect(documentRequiresApproval({ docType, sourceId: '  ' })).toBe(true);
      expect(documentRequiresApproval({ docType, sourceId: 'src-1' })).toBe(false);
      expect(canTransition(docType, 'DRAFT', 'POSTED')).toBe(false);
      expect(canTransition(docType, 'DRAFT', 'POSTED', 'src-1')).toBe(true);
      expect(() => assertTransition({ docType, status: 'DRAFT' }, 'POSTED')).toThrow(
        expect.objectContaining({ statusCode: 409, message: 'Chứng từ này cần được duyệt trước khi ghi sổ.' }),
      );
    }
    for (const docType of ['RECEIPT_OTHER', 'ISSUE_OTHER', 'ADJUSTMENT'] as StockDocumentType[]) {
      expect(documentRequiresApproval({ docType, sourceId: 'src-1' })).toBe(true);
    }
    for (const docType of ['ISSUE_SALES', 'ISSUE_WARRANTY', 'RECEIPT_SALES_RETURN', 'TRANSFER'] as StockDocumentType[]) {
      expect(documentRequiresApproval({ docType })).toBe(false);
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
  it('mọi loại chứng từ bắt buộc serial cho hàng theo serial; chứng từ đảo thì không (ISS-BE-005)', () => {
    // Không còn danh sách loại chứng từ: chỉ chứng từ đảo được miễn (chép serial của chứng từ gốc).
    expect(requiresSerialsAtPosting({ reversesDocumentId: undefined })).toBe(true);
    expect(requiresSerialsAtPosting({ reversesDocumentId: 'goc' })).toBe(false);
  });

  it('dòng hàng serial: số lượng nguyên và đúng bằng số serial, lời nhắc tiếng Việt', () => {
    const line = { lineNo: 2, materialCode: 'VT-SR', quantity: 2 };
    expect(() => assertSerializedLine(line, 2, 'posting')).not.toThrow();
    expect(() => assertSerializedLine(line, 1, 'request')).toThrow(
      expect.objectContaining({
        statusCode: 400,
        code: 'SERIALS_REQUIRED',
        message: 'Dòng 2: VT-SR theo dõi theo serial; nhập đủ 2 serial (đang có 1).',
      }),
    );
    expect(() => assertSerializedLine(line, 3, 'posting')).toThrow(
      'Dòng 2: VT-SR theo dõi theo serial; chọn đủ 2 serial trước khi ghi sổ (đang có 3).',
    );
    expect(() => assertSerializedLine({ ...line, quantity: 1.5 }, 1, 'request')).toThrow(
      expect.objectContaining({ code: 'SERIALS_REQUIRED', message: expect.stringContaining('Hàng theo dõi serial phải có số lượng nguyên.') }),
    );
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

describe('mọi đường ghi sổ đều kiểm duyệt (ISS-BE-006)', () => {
  type Doc = Parameters<typeof assertPostable>[0];
  const doc = (patch: Partial<Doc>): Doc => ({ docType: 'RECEIPT_OTHER', status: 'DRAFT', ...patch });
  const blocked = (document: Doc, origin?: (typeof POSTING_ORIGINS)[number]) => {
    try {
      assertPostable(document, { origin });
      return false;
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, message: 'Chứng từ này cần được duyệt trước khi ghi sổ.' });
      return true;
    }
  };

  it.each(STOCK_DOCUMENT_TYPES.flatMap((docType) => [[docType, false], [docType, true]] as const))(
    '%s, có nguồn = %s: chưa duyệt thì chặn đúng loại cần duyệt; Đã duyệt thì luôn ghi được',
    (docType, sourced) => {
      const sourceId = sourced ? 'src-1' : undefined;
      const needsApproval =
        ['RECEIPT_OTHER', 'ISSUE_OTHER', 'ADJUSTMENT'].includes(docType) ||
        (!sourced && ['RECEIPT_PURCHASE', 'ISSUE_PROJECT'].includes(docType));
      expect(blocked(doc({ docType, sourceId }))).toBe(needsApproval);
      expect(blocked(doc({ docType, sourceId, status: 'APPROVED' }))).toBe(false);
    },
  );

  it('nguồn miễn chỉ áp cho đúng dạng chứng từ của nó', () => {
    expect(blocked(doc({ docType: 'ADJUSTMENT', sourceType: 'stocktake', sourceId: 's' }), 'stocktake')).toBe(false);
    expect(blocked(doc({ docType: 'ADJUSTMENT' }), 'stocktake')).toBe(true);
    expect(blocked(doc({ docType: 'RECEIPT_OTHER', sourceType: 'stocktake', sourceId: 's' }), 'stocktake')).toBe(true);

    expect(blocked(doc({ sourceType: 'asset', sourceId: 'a' }), 'asset_uninstall')).toBe(false);
    expect(blocked(doc({ sourceType: 'asset', sourceId: 'a' }), 'asset_return')).toBe(false);
    expect(blocked(doc({}), 'asset_return')).toBe(true);
    expect(blocked(doc({ docType: 'ISSUE_OTHER', sourceType: 'asset', sourceId: 'a' }), 'asset_uninstall')).toBe(true);

    expect(blocked(doc({ docType: 'RECEIPT_PURCHASE', sourceType: 'OPENING_BALANCE' }), 'opening_balance')).toBe(false);
    expect(blocked(doc({ docType: 'RECEIPT_PURCHASE' }), 'opening_balance')).toBe(true);
    expect(blocked(doc({ sourceType: 'OPENING_BALANCE' }), 'opening_balance')).toBe(true);

    expect(blocked(doc({ reversesDocumentId: 'orig' }), 'reversal')).toBe(false);
    expect(blocked(doc({}), 'reversal')).toBe(true);
    // Chứng từ đảo mà không qua đường đảo (không khai nguồn) vẫn bị chặn.
    expect(blocked(doc({ reversesDocumentId: 'orig' }))).toBe(true);

    // Cấp vật tư theo yêu cầu Quy trình (ISS-BE-031): chỉ chứng từ xuất dự án có nguồn hồ sơ.
    const requisition = { docType: 'ISSUE_PROJECT', sourceType: 'procedure_instance', sourceId: 'i-1' } as const;
    expect(blocked(doc(requisition), 'procedure_requisition')).toBe(false);
    expect(blocked(doc({ ...requisition, sourceId: undefined }), 'procedure_requisition')).toBe(true);
    expect(blocked(doc({ ...requisition, docType: 'ISSUE_OTHER' }), 'procedure_requisition')).toBe(true);
    expect(blocked(doc({ docType: 'ISSUE_OTHER', sourceType: 'asset', sourceId: 'a' }), 'procedure_requisition')).toBe(true);
    // Nguồn lạ (chuỗi do client gửi) không miễn được gì.
    expect(blocked(doc({}), 'client' as never)).toBe(true);
  });

  it('người lập chứng từ gốc không tự đảo, trừ khi cài đặt cho tự duyệt', () => {
    expect(() => assertNotSelfReversal({ createdBy: 'u1' }, 'u1', false)).toThrow(
      expect.objectContaining({
        statusCode: 403,
        code: 'STOCK_DOCUMENT_SELF_REVERSAL',
        message: 'Bạn không được đảo chứng từ do chính mình lập.',
      }),
    );
    expect(() => assertNotSelfReversal({ createdBy: 'u1' }, 'u1', true)).not.toThrow();
    expect(() => assertNotSelfReversal({ createdBy: 'u1' }, 'u2', false)).not.toThrow();
  });
});
