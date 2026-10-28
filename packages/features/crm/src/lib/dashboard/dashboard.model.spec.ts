import { CRM_NO_CAPABILITIES, type SalesDashboard } from '@enterprise-platform/contracts-crm';
import {
  ATTENTION_VIEWS,
  bucketLabel,
  dashboardCards,
  dashboardQuery,
  formatDelta,
  formatRate,
  formatVndCompact,
} from './dashboard.model';

const EMPTY_LIST = { total: 0, items: [] };

function dashboard(kpis: Partial<SalesDashboard['kpis']> = {}): SalesDashboard {
  return {
    period: 'month',
    range: { from: '2026-10-01', to: '2026-10-28' },
    previous: { from: '2026-09-01', to: '2026-09-28' },
    asOf: '2026-10-28',
    scope: 'mine',
    kpis: {
      revenue: { value: 1_250_000_000, previous: 1_000_000_000, changePercent: 25 },
      profit: { value: 250_000_000, previous: 300_000_000, changePercent: -16.7 },
      marginPercent: { value: 20, previous: 30, changePoints: -10 },
      newOrders: { value: 4, previous: 0, changePercent: null },
      winRate: { value: 66.67, previous: 50, changePoints: 16.67, won: 2, lost: 1 },
      pipeline: { count: 3, value: 14_000_000, weightedValue: 5_400_000 },
      receivables: { balance: 8_000_000, overdue: 7_000_000, overdueCustomers: 2 },
      pendingQuotes: { count: 0, value: 0 },
      ...kpis,
    },
    trend: { granularity: 'day', buckets: [] },
    pipeline: [],
    topCustomers: [],
    topProducts: [],
    attention: {
      lateDeliveries: EMPTY_LIST,
      pendingQuotes: EMPTY_LIST,
      expiringContracts: EMPTY_LIST,
      activities: EMPTY_LIST,
      overdueReceivables: EMPTY_LIST,
    },
    contractExpiringDays: 30,
  };
}

describe('dashboard.model', () => {
  it('tiền rút gọn tiếng Việt', () => {
    expect(formatVndCompact(25_500_000_000)).toBe('25,5 tỷ');
    expect(formatVndCompact(850_000_000)).toBe('850 triệu');
    expect(formatVndCompact(1_500)).toBe('1,5 nghìn');
    expect(formatVndCompact(950)).toBe('950 ₫');
    expect(formatVndCompact(-2_000_000)).toBe('-2 triệu');
    expect(formatVndCompact(null)).toBe('—');
    expect(formatRate(66.67)).toBe('66,7%');
    expect(formatRate(null)).toBe('—');
  });

  it('so với kỳ trước: xanh khi tốt, đỏ khi xấu, kỳ trước bằng 0 thì không so', () => {
    expect(formatDelta(25, '%')).toEqual({ text: '▲ +25% so với kỳ trước', tone: 'good' });
    expect(formatDelta(-16.7, '%')).toEqual({ text: '▼ -16,7% so với kỳ trước', tone: 'bad' });
    expect(formatDelta(10, '%', false).tone).toBe('bad');
    expect(formatDelta(0, '%')).toEqual({ text: '= Không đổi so với kỳ trước', tone: 'flat' });
    expect(formatDelta(null, '%')).toEqual({ text: 'Kỳ trước chưa có số liệu', tone: 'flat' });
    expect(formatDelta(16.67, ' điểm').text).toBe('▲ +16,7 điểm so với kỳ trước');
  });

  it('thẻ chỉ số: giá trị, dòng so sánh, dòng phụ, trang mở khi bấm', () => {
    const cards = Object.fromEntries(dashboardCards(dashboard(), CRM_NO_CAPABILITIES).map((card) => [card.key, card]));
    expect(cards.revenue).toMatchObject({ label: 'Doanh thu', value: '1,3 tỷ', delta: { tone: 'good' }, view: 'orders' });
    expect(cards.revenue.title).toBe('1.250.000.000 ₫');
    expect(cards.profit).toMatchObject({ value: '250 triệu', delta: { tone: 'bad' }, hint: 'Biên 20% (-10 điểm)' });
    expect(cards.newOrders).toMatchObject({ value: '4', delta: { text: 'Kỳ trước chưa có số liệu' } });
    expect(cards.pipeline).toMatchObject({ value: '14 triệu', hint: '3 cơ hội · theo xác suất 5,4 triệu', view: 'opportunities' });
    expect(cards.winRate).toMatchObject({ value: '66,7%', hint: '2 thắng · 1 thua trong kỳ', view: 'opportunities' });
    expect(cards.receivables).toMatchObject({ value: '8 triệu', danger: true, hint: 'Quá hạn 7 triệu · 2 khách', view: 'receivables' });
    expect(cards.pendingQuotes).toMatchObject({ value: '0', hint: 'Không có báo giá chờ duyệt', view: 'quotes' });
  });

  it('người xem được báo cáo: doanh thu, lợi nhuận mở Báo cáo', () => {
    const cards = dashboardCards(dashboard(), { ...CRM_NO_CAPABILITIES, canReadReport: true });
    expect(cards.filter((card) => card.view === 'reports').map((card) => card.key)).toEqual(['revenue', 'profit']);
  });

  it('chưa có doanh thu, chưa có cơ hội đóng', () => {
    const cards = Object.fromEntries(
      dashboardCards(
        dashboard({
          marginPercent: { value: null, previous: null, changePoints: null },
          winRate: { value: null, previous: null, changePoints: null, won: 0, lost: 0 },
          receivables: { balance: 0, overdue: 0, overdueCustomers: 0 },
        }),
        CRM_NO_CAPABILITIES,
      ).map((card) => [card.key, card]),
    );
    expect(cards.profit.hint).toBe('Biên lợi nhuận: chưa có doanh thu');
    expect(cards.winRate).toMatchObject({ value: '—', delta: undefined, hint: 'Chưa có cơ hội đóng trong kỳ' });
    expect(cards.receivables).toMatchObject({ danger: false, hint: 'Không có khoản quá hạn' });
  });

  it('mục cần chú ý mở đúng trang; nhãn mốc; câu hỏi theo kỳ', () => {
    expect(ATTENTION_VIEWS.overdueReceivables).toBe('receivables');
    expect(ATTENTION_VIEWS.activities).toBe('activities');
    expect(bucketLabel('2026-10-21', 'week')).toBe('21/10');
    expect(bucketLabel('2026-03-01', 'month')).toBe('T3');
    expect(dashboardQuery('year', {})).toEqual({ period: 'year' });
    expect(dashboardQuery('custom', { from: '2026-01-01' })).toBeUndefined();
    expect(dashboardQuery('custom', { from: '2026-01-01', to: '2026-01-31' })).toEqual({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });
});
