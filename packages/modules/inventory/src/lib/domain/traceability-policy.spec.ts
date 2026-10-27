import {
  assertQualityChange,
  isLotExpired,
  normalizeLineSerials,
  normalizeLotInput,
  requiresPassedQuality,
  serialKey,
  serialMovementType,
  splitByLots,
  suggestLotsFefo,
  todayInVietnam,
  type LotCandidate,
} from './traceability-policy.js';

const lot = (lotNo: string, extra: Partial<LotCandidate> = {}): LotCandidate => ({
  lotId: lotNo.toLowerCase(),
  lotNo,
  qualityStatus: 'PASSED',
  available: 10,
  ...extra,
});

describe('traceability-policy', () => {
  it('khoá serial bỏ khoảng trắng hai đầu và không phân biệt hoa thường như unique index 0013', () => {
    expect(serialKey('  sn001 ')).toBe('SN001');
  });

  it('serial của dòng: bỏ trống là không có; rỗng, lặp, khác số lượng thì từ chối', () => {
    expect(normalizeLineSerials(undefined, 3, 1)).toBeUndefined();
    expect(normalizeLineSerials([], 3, 1)).toBeUndefined();
    expect(normalizeLineSerials([' a ', 'b'], 2, 1)).toEqual(['a', 'b']);
    expect(() => normalizeLineSerials('a', 1, 2)).toThrow('Dòng 2: danh sách serial không hợp lệ.');
    expect(() => normalizeLineSerials(['a', ' '], 2, 1)).toThrow('Dòng 1: serial thứ 2 để trống.');
    expect(() => normalizeLineSerials(['a', 'A'], 2, 1)).toThrow('Dòng 1: serial A bị lặp lại.');
    expect(() => normalizeLineSerials(['a'], 2, 1)).toThrow('Dòng 1: số serial (1) phải bằng số lượng (2).');
    expect(() => normalizeLineSerials(['a'], 1.5, 1)).toThrow('Dòng 1: số serial (1) phải bằng số lượng (1.5).');
    expect(() => normalizeLineSerials(['x'.repeat(101)], 1, 1)).toThrow(/dài quá 100 ký tự/);
  });

  it('lô của dòng: dòng nhập giữ ngày, dòng xuất chỉ giữ số lô; ngày sai dạng bị từ chối', () => {
    expect(normalizeLotInput(undefined, 'IN', 1)).toBeUndefined();
    expect(normalizeLotInput({ lotNo: ' l1 ', expiresOn: '2026-12-31', supplier: ' ABB ' }, 'IN', 1)).toEqual({
      lotNo: 'L1',
      manufacturedOn: undefined,
      expiresOn: '2026-12-31',
      supplier: 'ABB',
      certificateNo: undefined,
    });
    expect(normalizeLotInput({ lotNo: 'l1', expiresOn: 'x' }, 'OUT', 1)).toEqual({ lotNo: 'L1' });
    expect(() => normalizeLotInput({ lotNo: ' ' }, 'IN', 3)).toThrow('Dòng 3: số lô không được để trống.');
    expect(() => normalizeLotInput({ lotNo: 'L1', expiresOn: '31/12/2026' }, 'IN', 1)).toThrow(
      'Dòng 1: hạn dùng phải có dạng YYYY-MM-DD.',
    );
  });

  it('chỉ chứng từ xuất (ISSUE_*) đòi hàng Đạt; điều chuyển, điều chỉnh mang được hàng không Đạt', () => {
    expect(requiresPassedQuality('ISSUE_SALES', 'OUT')).toBe(true);
    expect(requiresPassedQuality('ISSUE_WARRANTY', 'OUT')).toBe(true);
    expect(requiresPassedQuality('ISSUE_SALES', 'IN')).toBe(false);
    expect(requiresPassedQuality('TRANSFER', 'OUT')).toBe(false);
    expect(requiresPassedQuality('ADJUSTMENT', 'OUT')).toBe(false);
    expect(requiresPassedQuality('RECEIPT_PURCHASE', 'OUT')).toBe(false);
  });

  it('loại lịch sử serial theo loại chứng từ', () => {
    expect(serialMovementType('RECEIPT_PURCHASE', false)).toBe('RECEIPT');
    expect(serialMovementType('RECEIPT_SALES_RETURN', false)).toBe('RETURN');
    expect(serialMovementType('ISSUE_SALES', false)).toBe('ISSUE');
    expect(serialMovementType('ISSUE_WARRANTY', false)).toBe('WARRANTY_ISSUE');
    expect(serialMovementType('TRANSFER', false)).toBe('TRANSFER');
    expect(serialMovementType('ADJUSTMENT', false)).toBe('ADJUSTMENT');
    expect(serialMovementType('ISSUE_SALES', true)).toBe('REVERSAL');
  });

  it('đổi chất lượng: bắt buộc lý do, trạng thái hợp lệ và khác trạng thái hiện tại', () => {
    expect(assertQualityChange('PASSED', 'QUARANTINE', ' nghi lỗi ', 'Lô L01')).toEqual({
      to: 'QUARANTINE',
      reason: 'nghi lỗi',
    });
    expect(() => assertQualityChange('PASSED', 'BROKEN', 'x', 'Lô L01')).toThrow('Trạng thái chất lượng không hợp lệ.');
    expect(() => assertQualityChange('PASSED', 'DEFECTIVE', '  ', 'Lô L01')).toThrow(
      'Phải ghi lý do đổi trạng thái chất lượng.',
    );
    expect(() => assertQualityChange('QUARANTINE', 'QUARANTINE', 'x', 'Lô L01')).toThrow(
      'Lô L01 đang ở trạng thái Cách ly.',
    );
  });

  it('hạn dùng: dùng được đến hết ngày hạn; ngày Việt Nam tính theo múi giờ +07', () => {
    expect(isLotExpired('2026-10-27', '2026-10-27')).toBe(false);
    expect(isLotExpired('2026-10-26', '2026-10-27')).toBe(true);
    expect(isLotExpired(undefined, '2026-10-27')).toBe(false);
    expect(todayInVietnam(new Date('2026-10-26T18:30:00Z'))).toBe('2026-10-27');
  });

  it('TC-INV-08: FEFO hạn gần nhất trước, bỏ lô hết hạn và lô không Đạt, lô không hạn xếp cuối', () => {
    const result = suggestLotsFefo(
      [
        lot('L01', { expiresOn: '2026-12-31', available: 30 }),
        lot('L02', { expiresOn: '2026-11-30', available: 4 }),
        lot('L03', { expiresOn: '2026-10-01' }),
        lot('L04', { expiresOn: '2026-11-01', qualityStatus: 'QUARANTINE' }),
        lot('L05'),
        lot('L06', { expiresOn: '2026-11-30', manufacturedOn: '2026-01-01', available: 0 }),
      ],
      10,
      '2026-10-27',
    );
    expect(result.lines.map((line) => [line.lotNo, line.quantity])).toEqual([
      ['L02', 4],
      ['L01', 6],
      ['L05', 0],
    ]);
    expect([result.allocated, result.shortage]).toEqual([10, 0]);
    const short = suggestLotsFefo([lot('L01', { available: 3 })], 5, '2026-10-27');
    expect([short.allocated, short.shortage]).toEqual([3, 2]);
    expect(() => suggestLotsFefo([], 0, '2026-10-27')).toThrow('Số lượng cần xuất phải là số dương.');
  });

  it('phân bổ lô của API cũ: cộng dồn lô lặp, phần còn lại không theo lô, vượt số lượng thì từ chối', () => {
    expect(splitByLots(10, undefined)).toEqual([{ quantity: 10 }]);
    expect(
      splitByLots(10, [
        { lotNo: 'l1', quantity: 3 },
        { lotNo: 'L1', quantity: 2 },
        { lotNo: 'L2', quantity: 1 },
      ]),
    ).toEqual([
      { lotNo: 'L1', quantity: 5 },
      { lotNo: 'L2', quantity: 1 },
      { quantity: 4 },
    ]);
    expect(splitByLots(2, [{ lotNo: 'L1', quantity: 2 }])).toEqual([{ lotNo: 'L1', quantity: 2 }]);
    expect(() => splitByLots(2, [{ lotNo: 'L1', quantity: 3 }])).toThrow(
      'Tổng phân bổ theo lô (3) vượt số lượng (2).',
    );
    expect(() => splitByLots(2, [{ lotNo: 'L1', quantity: 0 }])).toThrow(
      'Số lượng lấy từ lô L1 phải là số dương.',
    );
  });
});
