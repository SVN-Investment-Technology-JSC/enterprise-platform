import type { Lot, Reservation, StockDocument } from '@enterprise-platform/contracts-inventory';
import {
  addScannedSerials,
  allocateFefo,
  availableDocumentActions,
  draftToCreateRequest,
  issueLineProgress,
  issueReadiness,
  lotOptionsForWarehouse,
  parseSerialInput,
  splitLineByLots,
  validateDraft,
  validationMessages,
  type DocumentDraft,
  type DraftLine,
} from '@enterprise-platform/feature-inventory';

const writer = { canWriteTransactions: true, canApproveDocuments: false };
const approver = { canWriteTransactions: false, canApproveDocuments: true };
const both = { canWriteTransactions: true, canApproveDocuments: true };

const materials = new Map([
  ['QA-KHO-MUC', { code: 'QA-KHO-MUC', isSerialized: false, kind: 'STOCK' as const, isActive: true }],
  ['QA-KHO-LAP', { code: 'QA-KHO-LAP', isSerialized: true, kind: 'STOCK' as const, isActive: true }],
  ['QA-KHO-BT', { code: 'QA-KHO-BT', isSerialized: false, kind: 'SERVICE' as const, isActive: true }],
]);

const line = (patch: Partial<DraftLine>): DraftLine => ({
  key: patch.key ?? `k-${Math.random()}`,
  materialCode: 'QA-KHO-MUC',
  quantity: 1,
  serials: [],
  ...patch,
});

const draft = (patch: Partial<DocumentDraft>): DocumentDraft => ({
  docType: 'RECEIPT_PURCHASE',
  warehouseCode: 'QA-KHO-HN',
  documentDate: '2026-10-27',
  lines: [line({})],
  ...patch,
});

describe('Nút chứng từ theo trạng thái và quyền (mục 5.6)', () => {
  it('Nháp: loại phải duyệt thì Gửi duyệt, loại có nguồn đã duyệt thì Ghi sổ', () => {
    expect(availableDocumentActions({ docType: 'RECEIPT_OTHER', status: 'DRAFT' }, writer)).toEqual([
      'edit',
      'submit',
      'cancel',
    ]);
    expect(availableDocumentActions({ docType: 'ISSUE_SALES', status: 'DRAFT' }, writer)).toEqual([
      'edit',
      'post',
      'cancel',
    ]);
    expect(availableDocumentActions({ docType: 'ISSUE_SALES', status: 'DRAFT' }, approver)).toEqual([]);
  });

  it('Chờ duyệt: Duyệt, Từ chối chỉ khi có quyền duyệt; người lập chỉ huỷ được', () => {
    expect(availableDocumentActions({ docType: 'ADJUSTMENT', status: 'PENDING' }, approver)).toEqual([
      'approve',
      'reject',
    ]);
    expect(availableDocumentActions({ docType: 'ADJUSTMENT', status: 'PENDING' }, writer)).toEqual(['cancel']);
    expect(availableDocumentActions({ docType: 'ADJUSTMENT', status: 'PENDING' }, both)).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
  });

  it('Đã duyệt ghi sổ hoặc huỷ; Từ chối chỉ sửa; Đã ghi sổ chỉ đảo, trừ chứng từ đảo; Đã huỷ không còn gì', () => {
    expect(availableDocumentActions({ docType: 'ISSUE_OTHER', status: 'APPROVED' }, writer)).toEqual(['post', 'cancel']);
    expect(availableDocumentActions({ docType: 'ISSUE_OTHER', status: 'REJECTED' }, writer)).toEqual(['edit']);
    expect(availableDocumentActions({ docType: 'RECEIPT_PURCHASE', status: 'POSTED' }, writer)).toEqual(['reverse']);
    expect(
      availableDocumentActions({ docType: 'RECEIPT_PURCHASE', status: 'POSTED', reversesDocumentId: 'x' }, writer),
    ).toEqual([]);
    expect(availableDocumentActions({ docType: 'RECEIPT_PURCHASE', status: 'CANCELLED' }, both)).toEqual([]);
  });
});

describe('Kiểm form chứng từ', () => {
  it('báo lỗi phần đầu bằng tiếng Việt: thiếu kho, điều chuyển cùng kho, ngày sai', () => {
    const result = validateDraft(
      draft({ docType: 'TRANSFER', warehouseCode: 'A', targetWarehouseCode: 'A', documentDate: '27/10/2026' }),
      materials,
    );
    expect(result.valid).toBe(false);
    expect(result.header).toEqual(['Kho đi và kho đến phải khác nhau.', 'Ngày chứng từ không hợp lệ.']);
    expect(validateDraft(draft({ warehouseCode: ' ' }), materials).header).toContain('Chọn kho.');
  });

  it('báo lỗi dòng: chưa chọn mặt hàng, số lượng, dịch vụ, điều chỉnh thiếu chiều, lô và serial cùng lúc', () => {
    const result = validateDraft(
      draft({
        docType: 'ADJUSTMENT',
        lines: [
          line({ key: 'a', materialCode: '' }),
          line({ key: 'b', materialCode: 'QA-KHO-BT', quantity: 0, direction: 'IN' }),
          line({ key: 'c', direction: undefined }),
          line({ key: 'd', materialCode: 'QA-KHO-LAP', direction: 'OUT', lotNo: 'L01', serials: ['SN001'] }),
        ],
      }),
      materials,
    );
    expect(result.lines['a']).toEqual(['Dòng 1: Chọn mặt hàng.', 'Dòng 1: Chọn tăng hay giảm tồn.']);
    expect(result.lines['b']).toEqual([
      'Dòng 2: Mặt hàng dịch vụ không quản lý tồn.',
      'Dòng 2: Số lượng phải lớn hơn 0.',
    ]);
    expect(result.lines['c']).toEqual(['Dòng 3: Chọn tăng hay giảm tồn.']);
    expect(result.lines['d']).toEqual(['Dòng 4: Một dòng chỉ ghi lô hoặc serial, không ghi cả hai.']);
  });

  it('serial: số serial phải bằng số lượng; xuất bán bắt buộc đủ serial khi ghi sổ; không trùng giữa các dòng', () => {
    const partial = draft({ lines: [line({ key: 'a', materialCode: 'QA-KHO-LAP', quantity: 3, serials: ['SN001'] })] });
    expect(validationMessages(validateDraft(partial, materials))).toEqual([
      'Dòng 1: Đã chọn 1/3 serial; số serial phải bằng số lượng.',
    ]);
    const sales = draft({
      docType: 'ISSUE_SALES',
      lines: [line({ key: 'a', materialCode: 'QA-KHO-LAP', quantity: 2 })],
    });
    expect(validateDraft(sales, materials).valid).toBe(true);
    expect(validationMessages(validateDraft(sales, materials, { forPosting: true }))).toEqual([
      'Dòng 1: Chưa chọn serial (cần 2).',
    ]);
    const duplicate = draft({
      docType: 'ISSUE_PROJECT',
      lines: [
        line({ key: 'a', materialCode: 'QA-KHO-LAP', quantity: 1, serials: ['SN001'] }),
        line({ key: 'b', materialCode: 'QA-KHO-LAP', quantity: 1, serials: ['sn001'] }),
      ],
    });
    expect(validateDraft(duplicate, materials).lines['b']).toEqual(['Dòng 2: Serial sn001 đã có ở dòng 1.']);
  });

  it('chuyển bản nháp thành request: dòng nhập có đơn giá và lô, dòng xuất chỉ số lô, bỏ trường trống', () => {
    expect(
      draftToCreateRequest(
        draft({
          note: '  ',
          lines: [line({ quantity: 10, unitCost: 250000, lotNo: 'L01', lotExpiresOn: '2026-12-31', note: ' ' })],
        }),
      ),
    ).toEqual({
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'QA-KHO-HN',
      documentDate: '2026-10-27',
      lines: [{ materialCode: 'QA-KHO-MUC', quantity: 10, unitCost: 250000, lot: { lotNo: 'L01', expiresOn: '2026-12-31' } }],
    });
    expect(
      draftToCreateRequest(
        draft({ docType: 'ISSUE_OTHER', lines: [line({ quantity: 4, unitCost: 9, lotNo: 'L02', lotExpiresOn: '2026-11-30' })] }),
      ).lines,
    ).toEqual([{ materialCode: 'QA-KHO-MUC', quantity: 4, lot: { lotNo: 'L02' } }]);
  });
});

describe('Lô theo FEFO (TC-INV-08)', () => {
  const lot = (lotNo: string, expiresOn: string | undefined, available: number, qualityStatus: Lot['qualityStatus'] = 'PASSED'): Lot => ({
    id: lotNo,
    materialId: 'm',
    materialCode: 'QA-KHO-MUC',
    lotNo,
    expiresOn,
    qualityStatus,
    createdAt: '',
    updatedAt: '',
    quantity: available || 5,
    balances: [
      {
        warehouseId: 'w',
        warehouseCode: 'QA-KHO-HN',
        quantity: available || 5,
        quantityReserved: 0,
        quantityBlocked: qualityStatus === 'PASSED' ? 0 : 5,
        available,
      },
    ],
  });
  const lots = [
    lot('L01', '2026-12-31', 8),
    lot('L04', '2027-06-30', 0, 'QUARANTINE'),
    lot('L03', '2026-01-31', 5),
    lot('L02', '2026-11-30', 6),
    lot('L05', undefined, 20),
  ];

  it('xếp hạn gần nhất trước, lô hết hạn và lô Cách ly có lý do, lô không hạn xếp cuối', () => {
    const options = lotOptionsForWarehouse(lots, 'QA-KHO-HN', '2026-10-27');
    expect(options.map((item) => [item.lotNo, item.blockedReason])).toEqual([
      ['L03', 'Hết hạn'],
      ['L02', undefined],
      ['L01', undefined],
      ['L04', 'Không ở trạng thái Đạt'],
      ['L05', undefined],
    ]);
    expect(lotOptionsForWarehouse(lots, 'KHO-KHAC', '2026-10-27')).toEqual([]);
  });

  it('xuất 10: lấy L02 rồi L01, bỏ L03, L04; thiếu thì báo shortage', () => {
    const options = lotOptionsForWarehouse(lots.slice(0, 4), 'QA-KHO-HN', '2026-10-27');
    expect(allocateFefo(options, 10)).toEqual({
      allocations: [
        { lotNo: 'L02', expiresOn: '2026-11-30', quantity: 6 },
        { lotNo: 'L01', expiresOn: '2026-12-31', quantity: 4 },
      ],
      allocated: 10,
      shortage: 0,
    });
    expect(allocateFefo(options, 20)).toMatchObject({ allocated: 14, shortage: 6 });
  });

  it('tách dòng theo lô, giữ giữ hàng và ghi chú; không chọn lô thì bỏ lô', () => {
    const source = line({ key: 'x', quantity: 10, reservationId: 'r1', note: 'Đợt 1', lotNo: 'OLD' });
    const split = splitLineByLots(source, [
      { lotNo: 'L02', expiresOn: '2026-11-30', quantity: 6 },
      { lotNo: 'L01', quantity: 4 },
    ]);
    expect(split.map((item) => [item.key === 'x', item.quantity, item.lotNo, item.reservationId, item.note])).toEqual([
      [true, 6, 'L02', 'r1', 'Đợt 1'],
      [false, 4, 'L01', 'r1', 'Đợt 1'],
    ]);
    expect(splitLineByLots(source, [])).toMatchObject([{ key: 'x', quantity: 10, lotNo: undefined }]);
  });
});

describe('Quét serial', () => {
  it('tách chuỗi quét hoặc dán, bỏ trùng không phân biệt hoa thường', () => {
    expect(parseSerialInput(' SN001\nsn002, SN001;SN003  ')).toEqual(['SN001', 'sn002', 'SN003']);
  });

  it('chỉ nhận serial có trong kho, đúng cách viết của kho, không vượt số lượng', () => {
    const result = addScannedSerials(['SN001'], ['sn002', 'SN001', 'SN999', 'SN003'], {
      limit: 2,
      allowed: ['SN001', 'SN002', 'SN003'],
    });
    expect(result.serials).toEqual(['SN001', 'SN002']);
    expect(result.rejected).toEqual([
      { serial: 'SN001', reason: 'đã chọn' },
      { serial: 'SN999', reason: 'không có trong kho hoặc không ở trạng thái Đạt' },
      { serial: 'SN003', reason: 'vượt số lượng của dòng' },
    ]);
  });
});

describe('Yêu cầu xuất từ đơn bán: giữ hàng và phần còn thiếu', () => {
  const reservation: Reservation = {
    id: 'r1',
    reservationCode: 'GH-001',
    referenceType: 'crm_order',
    status: 'RESERVED',
    createdBy: 'u',
    createdAt: '',
    items: [
      { id: 'i1', reservationId: 'r1', warehouseId: 'w1', materialId: 'm-lap', quantityReserved: 4, quantityIssued: 1 },
    ],
  };
  const document: Pick<StockDocument, 'warehouseId' | 'lines'> = {
    warehouseId: 'w1',
    lines: [
      {
        id: 'l1',
        lineNo: 1,
        materialId: 'm-lap',
        materialCode: 'QA-KHO-LAP',
        materialName: 'Máy',
        quantity: 2,
        direction: 'OUT',
        unitCost: 0,
        reservationId: 'r1',
        serials: ['SN001'],
      },
      {
        id: 'l2',
        lineNo: 2,
        materialId: 'm-lap',
        materialCode: 'QA-KHO-LAP',
        materialName: 'Máy',
        quantity: 2,
        direction: 'OUT',
        unitCost: 0,
        reservationId: 'r1',
        serials: ['SN002', 'SN003'],
      },
    ],
  };

  it('tính còn chưa xuất của giữ hàng và số serial còn thiếu từng dòng', () => {
    const progress = issueLineProgress(document, [reservation], new Set(['QA-KHO-LAP']));
    expect(progress.map((item) => [item.reservationCode, item.outstanding, item.missingSerials])).toEqual([
      ['GH-001', 3, 1],
      ['GH-001', 3, 0],
    ]);
    expect(issueReadiness(progress)).toEqual([
      'Dòng 1 (QA-KHO-LAP): còn thiếu 1 serial.',
      'QA-KHO-LAP: xuất 4 nhưng giữ hàng GH-001 chỉ còn 3.',
    ]);
  });
});
