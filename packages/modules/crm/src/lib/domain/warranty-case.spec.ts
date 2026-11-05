import { WARRANTY_STATUSES, type WarrantyStatus } from '@enterprise-platform/contracts-crm';
import {
  assertClosable,
  assertResolution,
  assertWarrantyTransition,
  canWarrantyTransition,
  documentsForResolution,
  formatWarrantyCode,
  isLineResolved,
  lineDocumentKey,
  lineRefundAmount,
  needsResend,
  receiveIdempotencyKey,
} from './warranty-case.js';

/** Các cặp hợp lệ theo mục 5.5 kế hoạch. */
const ALLOWED: ReadonlySet<string> = new Set([
  'RECEIVED>AWAITING_GOODS',
  'RECEIVED>REJECTED',
  'AWAITING_GOODS>INSPECTING',
  'INSPECTING>RESOLVING',
  'RESOLVING>RESOLVED',
  'RESOLVED>CLOSED',
  'REJECTED>CLOSED',
]);

describe('Máy trạng thái yêu cầu bảo hành (TC-SM-10)', () => {
  it('lặp mọi cặp: hợp lệ thành công, còn lại 409', () => {
    for (const from of WARRANTY_STATUSES) {
      for (const to of WARRANTY_STATUSES) {
        const key = `${from}>${to}`;
        expect([key, canWarrantyTransition(from, to)]).toEqual([key, ALLOWED.has(key)]);
        if (ALLOWED.has(key)) {
          expect(() => assertWarrantyTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertWarrantyTransition(from, to)).toThrow(expect.objectContaining({ statusCode: 409, code: 'INVALID_WARRANTY_TRANSITION' }));
        }
      }
    }
  });

  it('ví dụ Đã đóng → Đang xử lý trả 409 với thông điệp tiếng Việt', () => {
    expect(() => assertWarrantyTransition('CLOSED', 'RESOLVING')).toThrow(
      'Không thể chuyển yêu cầu bảo hành từ "Đã đóng" sang "Đang xử lý".',
    );
  });

  it('mã yêu cầu và khoá chống lặp ổn định', () => {
    expect(formatWarrantyCode(2026, 12)).toBe('BH2600012');
    expect(receiveIdempotencyKey('c1')).toBe('crm-warranty:c1:receive');
    expect(lineDocumentKey('c1', 'l1', 'REPLACEMENT')).toBe('crm-warranty:c1:l1:replacement');
    expect(lineDocumentKey('c1', 'l1', 'TRANSFER', 2)).toBe('crm-warranty:c1:l1:transfer:2');
  });
});

describe('Hướng xử lý (T6-05, T6-06)', () => {
  it('Đạt chỉ nhập lại; Lỗi chuyển kho lỗi hoặc loại bỏ; phải kiểm định trước', () => {
    expect(() => assertResolution({ result: 'PASSED', disposition: 'RESTOCK', remedy: 'NONE', hasOrderLine: false })).not.toThrow();
    expect(() => assertResolution({ result: 'DEFECTIVE', disposition: 'MOVE_TO_DEFECT', remedy: 'REPLACE', hasOrderLine: false })).not.toThrow();
    expect(() => assertResolution({ result: 'DEFECTIVE', disposition: 'SCRAP', remedy: 'CREDIT', hasOrderLine: true })).not.toThrow();
    expect(() => assertResolution({ result: 'PASSED', disposition: 'SCRAP', remedy: 'NONE', hasOrderLine: false })).toThrow(
      'Hàng kiểm định Đạt chỉ được nhập lại kho.',
    );
    expect(() => assertResolution({ result: 'DEFECTIVE', disposition: 'RESTOCK', remedy: 'NONE', hasOrderLine: false })).toThrow(
      'Hàng kiểm định Lỗi phải chuyển kho lỗi hoặc loại bỏ.',
    );
    expect(() => assertResolution({ result: null, disposition: 'RESTOCK', remedy: 'NONE', hasOrderLine: false })).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'LINE_NOT_INSPECTED' }),
    );
  });

  it('hoàn tiền, giảm trừ công nợ cần dòng đơn để tính giá trị', () => {
    for (const remedy of ['REFUND', 'CREDIT'] as const) {
      expect(() => assertResolution({ result: 'PASSED', disposition: 'RESTOCK', remedy, hasOrderLine: false })).toThrow(
        expect.objectContaining({ statusCode: 400, code: 'ORDER_LINE_REQUIRED' }),
      );
    }
  });

  it('chứng từ theo hướng xử lý, theo thứ tự gửi', () => {
    expect(documentsForResolution('RESTOCK', 'NONE')).toEqual(['QUALITY', 'TRANSFER']);
    expect(documentsForResolution('MOVE_TO_DEFECT', 'REPLACE')).toEqual(['QUALITY', 'TRANSFER', 'REPLACEMENT']);
    expect(documentsForResolution('SCRAP', 'CREDIT')).toEqual(['QUALITY', 'SCRAP', 'CREDIT']);
    expect(documentsForResolution('RESTOCK', 'REFUND')).toEqual(['QUALITY', 'TRANSFER', 'REFUND']);
  });

  it('dòng xong khi mọi chứng từ cần có đã sinh; chứng từ chưa gửi được thì chưa', () => {
    const line = { disposition: 'MOVE_TO_DEFECT', remedy: 'REPLACE' } as const;
    expect(isLineResolved(line, [{ kind: 'QUALITY', status: 'POSTED' }, { kind: 'TRANSFER', status: 'POSTED' }])).toBe(false);
    expect(
      isLineResolved(line, [
        { kind: 'QUALITY', status: 'POSTED' },
        { kind: 'TRANSFER', status: 'POSTED' },
        { kind: 'REPLACEMENT', status: 'PENDING' },
      ]),
    ).toBe(false);
    expect(
      isLineResolved(line, [
        { kind: 'QUALITY', status: 'POSTED' },
        { kind: 'TRANSFER', status: 'POSTED' },
        { kind: 'REPLACEMENT', status: 'REQUESTED' },
      ]),
    ).toBe(true);
    expect(isLineResolved({ disposition: null, remedy: null }, [])).toBe(false);
    expect(needsResend('PENDING')).toBe(true);
    expect(needsResend('PENDING_RECEIVABLE')).toBe(true);
    expect(needsResend('REQUESTED')).toBe(false);
  });

  it('số tiền hoàn: giá trị dòng đơn gồm VAT theo số lượng trả', () => {
    expect(lineRefundAmount({ quantity: 3, lineTotal: 33_000_000 }, 1)).toBe(11_000_000);
    expect(lineRefundAmount({ quantity: 3, lineTotal: 10_000 }, 1)).toBe(3333.33);
    expect(lineRefundAmount({ quantity: 0, lineTotal: 10_000 }, 1)).toBe(0);
  });
});

describe('Đóng yêu cầu (T6-07, TC-WAR-12)', () => {
  const done = { disposition: 'RESTOCK', inspectionResult: 'PASSED' } as const;
  const open = { disposition: null, inspectionResult: null } as const;

  it('còn dòng chưa xử lý: 409 "Còn dòng chưa xử lý"', () => {
    for (const status of ['INSPECTING', 'RESOLVING'] as WarrantyStatus[]) {
      expect(() => assertClosable(status, [done, open], [])).toThrow(
        expect.objectContaining({ statusCode: 409, code: 'LINES_UNRESOLVED', message: 'Còn dòng chưa xử lý.' }),
      );
    }
  });

  it('chứng từ chưa ghi sổ thì chưa đóng; đủ thì đóng; Từ chối đóng ngay', () => {
    expect(() => assertClosable('RESOLVED', [done], [{ status: 'POSTED' }, { status: 'PENDING_APPROVAL' }])).toThrow(
      expect.objectContaining({ code: 'DOCUMENTS_NOT_POSTED' }),
    );
    expect(() => assertClosable('RESOLVED', [done], [{ status: 'POSTED' }])).not.toThrow();
    expect(() => assertClosable('REJECTED', [open], [])).not.toThrow();
    expect(() => assertClosable('CLOSED', [done], [])).toThrow(expect.objectContaining({ code: 'INVALID_WARRANTY_TRANSITION' }));
    expect(() => assertClosable('RECEIVED', [done], [])).toThrow(expect.objectContaining({ code: 'INVALID_WARRANTY_TRANSITION' }));
  });
});
