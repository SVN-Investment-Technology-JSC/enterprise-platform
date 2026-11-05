import { addMonths, computeWarranty, daysBetween, vietnamDate } from './warranty-period.js';

describe('Hạn bảo hành (T6-02)', () => {
  it('TC-WAR-04: tính từ ngày giao thực tế của serial, không từ ngày đơn', () => {
    // Đơn ngày 01/02, serial giao 15/03: bắt đầu 15/03.
    const coverage = computeWarranty({ deliveredOn: '2026-03-15', contractMonths: null, materialMonths: 12, today: '2026-03-20' });
    expect(coverage).toMatchObject({ deliveredOn: '2026-03-15', months: 12, source: 'MATERIAL', warrantyUntil: '2027-03-15', expired: false });
    expect(coverage.remainingDays).toBe(daysBetween('2026-03-20', '2027-03-15'));
  });

  it('TC-WAR-01: mặt hàng 12 tháng, giao 3 tháng trước, còn khoảng 9 tháng', () => {
    const coverage = computeWarranty({ deliveredOn: '2026-07-27', contractMonths: null, materialMonths: 12, today: '2026-10-27' });
    expect(coverage).toMatchObject({ source: 'MATERIAL', warrantyUntil: '2027-07-27', expired: false });
    expect(coverage.remainingDays).toBe(273);
  });

  it('TC-WAR-02: hợp đồng dài hơn mặt hàng thì dùng hợp đồng', () => {
    const coverage = computeWarranty({ deliveredOn: '2026-02-27', contractMonths: 24, materialMonths: 12, today: '2026-10-27' });
    expect(coverage).toMatchObject({ source: 'CONTRACT', months: 24, warrantyUntil: '2028-02-27', expired: false });
    // Còn khoảng 16 tháng.
    expect(coverage.remainingDays).toBeGreaterThan(480);
    expect(coverage.remainingDays).toBeLessThan(500);
  });

  it('TC-WAR-03: hợp đồng ngắn hơn vẫn dùng hợp đồng: hết hạn, không lấy 12 tháng của mặt hàng', () => {
    const coverage = computeWarranty({ deliveredOn: '2026-02-27', contractMonths: 6, materialMonths: 12, today: '2026-10-27' });
    expect(coverage).toMatchObject({ source: 'CONTRACT', months: 6, warrantyUntil: '2026-08-27', expired: true, remainingDays: 0 });
  });

  it('TC-WAR-05: giao 13 tháng trước, bảo hành 12 tháng: hết hạn', () => {
    const coverage = computeWarranty({ deliveredOn: '2025-09-27', contractMonths: null, materialMonths: 12, today: '2026-10-27' });
    expect(coverage).toMatchObject({ warrantyUntil: '2026-09-27', expired: true, remainingDays: 0 });
  });

  it('biên: còn bảo hành đến hết ngày cuối; sang ngày sau mới hết hạn', () => {
    const base = { deliveredOn: '2025-10-27', contractMonths: null, materialMonths: 12 };
    expect(computeWarranty({ ...base, today: '2026-10-26' })).toMatchObject({ expired: false, remainingDays: 1 });
    expect(computeWarranty({ ...base, today: '2026-10-27' })).toMatchObject({ expired: false, remainingDays: 0 });
    expect(computeWarranty({ ...base, today: '2026-10-28' })).toMatchObject({ expired: true, remainingDays: 0 });
  });

  it('hợp đồng không ghi (hoặc 0) tháng thì dùng mặt hàng; không có thời hạn nào là không bảo hành', () => {
    expect(computeWarranty({ deliveredOn: '2026-10-01', contractMonths: 0, materialMonths: 12, today: '2026-10-27' }).source).toBe('MATERIAL');
    expect(computeWarranty({ deliveredOn: '2026-10-01', contractMonths: null, materialMonths: null, today: '2026-10-27' })).toMatchObject({
      source: 'NONE',
      warrantyUntil: null,
      expired: true,
    });
    expect(computeWarranty({ deliveredOn: '2026-10-01', contractMonths: null, materialMonths: 0, today: '2026-10-27' }).source).toBe('NONE');
  });

  it('không biết ngày giao: coi như hết hạn (tiếp nhận loại có phí)', () => {
    expect(computeWarranty({ deliveredOn: null, contractMonths: 24, materialMonths: 12, today: '2026-10-27' })).toMatchObject({
      source: 'CONTRACT',
      warrantyUntil: null,
      expired: true,
    });
  });

  it('Q9, TC-WAR-10: serial thay thế kế thừa đúng ngày hết hạn của serial cũ, không tính lại 12 tháng', () => {
    const original = computeWarranty({ deliveredOn: '2025-11-20', contractMonths: null, materialMonths: 12, today: '2026-10-27' });
    expect(original.warrantyUntil).toBe('2026-11-20');
    const replacement = computeWarranty({
      deliveredOn: '2026-10-27',
      contractMonths: null,
      materialMonths: 12,
      inheritedUntil: original.warrantyUntil,
      today: '2026-10-27',
    });
    expect(replacement).toMatchObject({ source: 'INHERITED', warrantyUntil: '2026-11-20', expired: false, remainingDays: 24 });
  });

  it('cộng tháng theo lịch, ngày không có thì lấy cuối tháng', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', 24)).toBe('2028-03-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('ngày giao theo giờ Việt Nam từ thời điểm Kho ghi sổ', () => {
    expect(vietnamDate('2026-03-14T18:00:00Z')).toBe('2026-03-15');
    expect(vietnamDate('2026-03-14T16:59:59Z')).toBe('2026-03-14');
    expect(vietnamDate(null)).toBeNull();
    expect(vietnamDate('abc')).toBeNull();
  });
});
