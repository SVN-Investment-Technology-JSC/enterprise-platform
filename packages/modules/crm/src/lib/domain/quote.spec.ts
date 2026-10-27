import { QUOTE_STATUSES, type QuoteStatus } from '@enterprise-platform/contracts-crm';
import {
  assertCustomerTransition,
  assertQuoteTransition,
  canQuoteTransition,
  formatQuoteCode,
  isQuoteClosed,
  planQuoteEdit,
} from './quote.js';

/** Các cặp hợp lệ theo mục 5.2 kế hoạch. */
const VALID: readonly [QuoteStatus, QuoteStatus][] = [
  ['DRAFT', 'PENDING'],
  ['DRAFT', 'APPROVED'],
  ['PENDING', 'APPROVED'],
  ['PENDING', 'REJECTED'],
  ['REJECTED', 'SUPERSEDED'],
  ['APPROVED', 'SENT'],
  ['APPROVED', 'SUPERSEDED'],
  ['APPROVED', 'EXPIRED'],
  ['SENT', 'SUPERSEDED'],
  ['SENT', 'ACCEPTED'],
  ['SENT', 'DECLINED'],
  ['SENT', 'EXPIRED'],
];
const isValid = (from: QuoteStatus, to: QuoteStatus) => VALID.some(([a, b]) => a === from && b === to);
const INVALID = QUOTE_STATUSES.flatMap((from) =>
  QUOTE_STATUSES.filter((to) => !isValid(from, to)).map((to) => [from, to] as [QuoteStatus, QuoteStatus]),
);

describe('máy trạng thái báo giá', () => {
  it.each(VALID)('TC-SM-03: %s → %s hợp lệ', (from, to) => {
    expect(canQuoteTransition(from, to)).toBe(true);
    expect(() => assertQuoteTransition(from, to)).not.toThrow();
  });

  it.each(INVALID)('TC-SM-04: %s → %s trả 409', (from, to) => {
    expect(canQuoteTransition(from, to)).toBe(false);
    expect(() => assertQuoteTransition(from, to)).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('TC-SM-04: thông báo rõ cho các ví dụ của bộ test', () => {
    expect(() => assertQuoteTransition('DRAFT', 'SENT')).toThrow('Báo giá chưa được duyệt, chưa gửi khách hay chốt được.');
    expect(() => assertQuoteTransition('EXPIRED', 'ACCEPTED')).toThrow('Báo giá đã hết hạn.');
    expect(() => assertQuoteTransition('DECLINED', 'APPROVED')).toThrow(
      'Không thể chuyển báo giá từ "Khách từ chối" sang "Đã duyệt".',
    );
    expect(() => assertQuoteTransition('PENDING', 'ACCEPTED')).toThrow(expect.objectContaining({ code: 'QUOTE_NOT_APPROVED' }));
  });

  it('trạng thái cuối', () => {
    expect(QUOTE_STATUSES.filter(isQuoteClosed)).toEqual(['ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED']);
  });

  it('khách chấp nhận báo giá đã quá hạn mà job chưa chạy: 409 hết hạn', () => {
    expect(() => assertCustomerTransition('SENT', 'ACCEPTED', '2026-10-26', '2026-10-27')).toThrow('Báo giá đã hết hạn.');
    expect(() => assertCustomerTransition('SENT', 'ACCEPTED', '2026-10-27', '2026-10-27')).not.toThrow();
    expect(() => assertCustomerTransition('SENT', 'ACCEPTED', null, '2026-10-27')).not.toThrow();
  });
});

describe('sửa phiên bản', () => {
  it('Nháp sửa tại chỗ; Đã duyệt, Đã gửi khách, Từ chối duyệt sinh phiên bản mới', () => {
    expect(planQuoteEdit({ currentVersion: 1, versionNo: 1, status: 'DRAFT' })).toBe('IN_PLACE');
    for (const status of ['APPROVED', 'SENT', 'REJECTED'] as const) {
      expect(planQuoteEdit({ currentVersion: 2, versionNo: 2, status })).toBe('NEW_VERSION');
    }
  });

  it('TC-QUO-06: phiên bản cũ chỉ đọc', () => {
    expect(() => planQuoteEdit({ currentVersion: 2, versionNo: 1, status: 'SUPERSEDED' })).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'QUOTE_VERSION_READ_ONLY', message: 'Phiên bản cũ chỉ đọc.' }),
    );
  });

  it.each(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const)('%s không sửa được', (status) => {
    expect(() => planQuoteEdit({ currentVersion: 1, versionNo: 1, status })).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('mã báo giá', () => {
    expect(formatQuoteCode(2026, 7)).toBe('BG2600007');
    expect(formatQuoteCode(2031, 123456)).toBe('BG31123456');
  });
});
