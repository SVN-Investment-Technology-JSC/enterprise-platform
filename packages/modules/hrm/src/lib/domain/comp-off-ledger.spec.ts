import {
  accrualDate,
  addMonths,
  allocateFromLots,
  availableDays,
  expiryDate,
  lotBalances,
  requestLotNets,
  roundLedgerDays,
  summarizeLedger,
  sortLotsForUse,
  type LedgerRow,
} from './comp-off-ledger.js';

const accrual = (lotId: string, days: number, openedOn: string, expiresOn: string | null): LedgerRow => ({
  kind: 'ACCRUAL',
  days,
  lotId,
  expiresOn,
  occurredOn: openedOn,
});

describe('lotBalances và availableDays', () => {
  it('cộng dồn từng lô, giữ chỗ và đã dùng đều trừ khỏi số dư khả dụng', () => {
    const rows: LedgerRow[] = [
      accrual('A', 4.3, '2026-11-01', null),
      { kind: 'RESERVE', days: -1, lotId: 'A', requestId: 'R1' },
      { kind: 'RESERVE', days: -0.5, lotId: 'A', requestId: 'R2' },
    ];
    expect(lotBalances(rows)).toEqual([
      { lotId: 'A', expiresOn: null, openedOn: '2026-11-01', granted: 4.3, remaining: 2.8 },
    ]);
    expect(availableDays(lotBalances(rows), '2026-11-15')).toBe(2.8);
  });

  it('lô hết hạn không tính vào số khả dụng', () => {
    const lots = lotBalances([accrual('A', 2, '2026-09-01', '2026-10-31'), accrual('B', 1, '2026-10-01', null)]);
    expect(availableDays(lots, '2026-10-31')).toBe(3);
    expect(availableDays(lots, '2026-11-01')).toBe(1);
  });

  it('ADJUST dương mở lô riêng, ADJUST âm trừ vào lô chỉ định', () => {
    const lots = lotBalances([
      accrual('A', 3, '2026-10-01', null),
      { kind: 'ADJUST', days: 1, lotId: 'ADJ1', occurredOn: '2026-10-05', expiresOn: null },
      { kind: 'ADJUST', days: -1, lotId: 'A', occurredOn: '2026-10-06' },
    ]);
    expect(lots.find((l) => l.lotId === 'A')?.remaining).toBe(2);
    expect(lots.find((l) => l.lotId === 'ADJ1')?.granted).toBe(1);
  });
});

describe('allocateFromLots', () => {
  const lots = lotBalances([
    accrual('NOEXP', 5, '2026-08-01', null),
    accrual('SOON', 1, '2026-09-01', '2026-11-30'),
    accrual('LATER', 2, '2026-10-01', '2027-03-31'),
  ]);

  it('lấy lô gần hết hạn trước, lô không hạn sau cùng', () => {
    expect(sortLotsForUse(lots).map((l) => l.lotId)).toEqual(['SOON', 'LATER', 'NOEXP']);
    expect(allocateFromLots(lots, 2.5, '2026-11-10')).toEqual([
      { lotId: 'SOON', days: 1 },
      { lotId: 'LATER', days: 1.5 },
    ]);
  });

  it('không đủ số dư thì không chia một phần', () => {
    expect(allocateFromLots(lots, 8.5, '2026-11-10')).toBeNull();
    expect(allocateFromLots(lots, 8, '2026-11-10')).toHaveLength(3);
  });

  it('bỏ qua lô đã hết hạn tại ngày dùng', () => {
    expect(allocateFromLots(lots, 7, '2026-12-01')).toEqual([
      { lotId: 'LATER', days: 2 },
      { lotId: 'NOEXP', days: 5 },
    ]);
    expect(allocateFromLots(lots, 7.5, '2026-12-01')).toBeNull();
  });

  it('hai đơn liên tiếp không dùng chung số dư khi dòng giữ chỗ của đơn đầu đã vào sổ', () => {
    const rows: LedgerRow[] = [accrual('A', 1, '2026-10-01', null)];
    const first = allocateFromLots(lotBalances(rows), 1, '2026-11-10');
    expect(first).toEqual([{ lotId: 'A', days: 1 }]);
    rows.push({ kind: 'RESERVE', days: -1, lotId: 'A', requestId: 'R1' });
    expect(allocateFromLots(lotBalances(rows), 0.5, '2026-11-10')).toBeNull();
  });
});

describe('requestLotNets', () => {
  const base: LedgerRow[] = [
    accrual('A', 3, '2026-10-01', null),
    { kind: 'RESERVE', days: -1.5, lotId: 'A', requestId: 'R1' },
  ];

  it('đơn mới gửi: đang chiếm chỗ, chưa dùng', () => {
    expect(requestLotNets(base, 'R1')).toEqual([{ lotId: 'A', held: 1.5, used: false }]);
  });

  it('đơn đã duyệt: RELEASE và USAGE cặp đôi, vẫn chiếm 1,5 ngày và đã dùng', () => {
    const rows: LedgerRow[] = [
      ...base,
      { kind: 'RELEASE', days: 1.5, lotId: 'A', requestId: 'R1' },
      { kind: 'USAGE', days: -1.5, lotId: 'A', requestId: 'R1' },
    ];
    expect(requestLotNets(rows, 'R1')).toEqual([{ lotId: 'A', held: 1.5, used: true }]);
    expect(lotBalances(rows)[0]?.remaining).toBe(1.5);
  });

  it('đơn bị hủy sau khi duyệt: hoàn đủ, held bằng 0', () => {
    const rows: LedgerRow[] = [
      ...base,
      { kind: 'RELEASE', days: 1.5, lotId: 'A', requestId: 'R1' },
      { kind: 'USAGE', days: -1.5, lotId: 'A', requestId: 'R1' },
      { kind: 'RELEASE', days: 1.5, lotId: 'A', requestId: 'R1' },
    ];
    expect(requestLotNets(rows, 'R1')).toEqual([{ lotId: 'A', held: 0, used: true }]);
    expect(lotBalances(rows)[0]?.remaining).toBe(3);
  });
});

describe('ngày phát sinh và hạn dùng', () => {
  it('cộng tháng qua ranh giới năm', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', 0)).toBe('2026-01');
  });

  it('quỹ tháng 10 cộng vào mùng 1 tháng 11 (tháng kế tiếp) hoặc mùng 1 tháng 10 (cùng tháng)', () => {
    expect(accrualDate('2026-10', 1)).toBe('2026-11-01');
    expect(accrualDate('2026-10', 0)).toBe('2026-10-01');
  });

  it('hạn dùng là ngày cuối tháng; 0 tháng là không hạn', () => {
    expect(expiryDate('2026-11-01', 3)).toBe('2027-02-28');
    expect(expiryDate('2027-11-01', 3)).toBe('2028-02-29');
    expect(expiryDate('2026-11-01', 0)).toBeNull();
  });

  it('làm tròn một chữ số thập phân', () => {
    expect(roundLedgerDays(4.3125)).toBe(4.3);
    expect(roundLedgerDays(0.1 + 0.2)).toBe(0.3);
  });
});

describe('summarizeLedger', () => {
  it('tách đã dùng, giữ chỗ và còn dùng được; hạn gần nhất lấy từ lô còn số dư', () => {
    const rows: LedgerRow[] = [
      accrual('A', 4, '2026-10-01', '2027-01-31'),
      accrual('B', 2, '2026-11-01', null),
      { kind: 'RESERVE', days: -1, lotId: 'A', requestId: 'R1' },
      { kind: 'RELEASE', days: 1, lotId: 'A', requestId: 'R1' },
      { kind: 'USAGE', days: -1, lotId: 'A', requestId: 'R1' },
      { kind: 'RESERVE', days: -0.5, lotId: 'A', requestId: 'R2' },
    ];
    const s = summarizeLedger(rows, '2026-11-15');
    expect(s).toMatchObject({ accrued: 6, used: 1, reserved: 0.5, available: 4.5, expired: 0, adjusted: 0 });
    expect(s.nextExpiry).toEqual({ days: 2.5, on: '2027-01-31' });
  });

  it('đơn đã duyệt rồi hủy không còn tính là đã dùng', () => {
    const rows: LedgerRow[] = [
      accrual('A', 2, '2026-10-01', null),
      { kind: 'RESERVE', days: -1, lotId: 'A', requestId: 'R1' },
      { kind: 'RELEASE', days: 1, lotId: 'A', requestId: 'R1' },
      { kind: 'USAGE', days: -1, lotId: 'A', requestId: 'R1' },
      { kind: 'RELEASE', days: 1, lotId: 'A', requestId: 'R1' },
    ];
    expect(summarizeLedger(rows, '2026-11-15')).toMatchObject({ used: 0, reserved: 0, available: 2 });
  });
});
