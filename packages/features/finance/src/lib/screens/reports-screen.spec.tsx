/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceLedgerReport, FinanceLedgerReportRow, FinanceReport } from '@enterprise-platform/contracts-finance';
import { financeFetch } from '../finance-api';
import { periodPresets, todayVn } from '../finance-format';
import ReportsScreen from './reports-screen';

jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn() };
});
const mockDownload = jest.fn();
jest.mock('../finance-csv', () => {
  const actual = jest.requireActual('../finance-csv');
  return { ...actual, downloadCsv: (...args: unknown[]) => mockDownload(...args) };
});

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

const report: FinanceReport = {
  from: '2026-10-01',
  to: '2026-10-31',
  granularity: 'day',
  totals: { receipts: 3_000_000, payments: 1_200_000, net: 1_800_000, receiptCount: 3, paymentCount: 2, transferCount: 1 },
  cashflow: [
    { period: '2026-10-01', receipts: 2_000_000, payments: 0, net: 2_000_000 },
    { period: '2026-10-02', receipts: 1_000_000, payments: 1_200_000, net: -200_000 },
  ],
  receiptsByReason: [{ id: 'r1', name: 'Thu tiền hàng', amount: 3_000_000, count: 3 }],
  paymentsByReason: [
    { id: 'p1', name: 'Văn phòng phẩm', amount: 900_000, count: 1 },
    { id: 'p2', name: 'Điện nước', amount: 300_000, count: 1 },
  ],
  receiptsByProject: [{ id: 'p1', name: 'DA001 - Trạm biến áp Đà Nẵng', amount: 3_000_000, count: 3 }],
  paymentsByProject: [
    { id: 'p1', name: 'DA001 - Trạm biến áp Đà Nẵng', amount: 700_000, count: 1 },
    { id: null, name: 'Chưa hạch toán', amount: 500_000, count: 1 },
  ],
  accounts: [{ accountId: 'a1', accountName: 'Vietcombank', openingBalance: 10_000_000, receipts: 3_000_000, payments: 1_200_000, transfersIn: 0, transfersOut: 500_000, closingBalance: 11_300_000 }],
};

const ledgerRow = (n: number, over: Partial<FinanceLedgerReportRow> = {}): FinanceLedgerReportRow => ({
  id: `l${n}`,
  voucherId: `v${n}`,
  voucherCode: `PT-2610-${String(n).padStart(4, '0')}`,
  voucherKind: 'RECEIPT',
  content: `Thu tiền lần ${n}`,
  createdByName: 'Nguyễn Văn Tý',
  createdAt: '2026-10-14T03:00:00.000Z',
  postedDate: '2026-10-14',
  accountId: 'a1',
  accountName: 'Vietcombank',
  receipt: 1_000_000,
  payment: 0,
  balanceAfter: 5_000_000 + n * 1_000_000,
  isReversal: false,
  ...over,
});
const ledgerPage = (offset: number, count: number, total: number): FinanceLedgerReport => ({
  from: '2026-10-01',
  to: '2026-10-31',
  openingBalance: 5_000_000,
  closingBalance: 5_000_000 + total * 1_000_000,
  totalReceipts: total * 1_000_000,
  totalPayments: 0,
  total,
  offset,
  items: Array.from({ length: count }, (_, i) => ledgerRow(offset + i + 1)),
});
const ledgerPaths = () => fetchMock.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/reports/ledger'));

function renderAnalysis() {
  render(<ReportsScreen />);
  fireEvent.click(screen.getByRole('tab', { name: 'Phân tích' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/accounts')) return [{ id: 'a1', name: 'Vietcombank' }] as never;
    if (path.startsWith('/workspace/projects')) return { items: [{ id: 'p1', code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' }], truncated: false } as never;
    if (path.startsWith('/reports/summary')) return report as never;
    if (path.startsWith('/reports/ledger')) {
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset') ?? 0);
      const limit = Number(new URLSearchParams(path.split('?')[1]).get('limit') ?? 60);
      return ledgerPage(offset, Math.min(limit, 111 - offset), 111) as never;
    }
    throw new Error(`route lạ ${path}`);
  });
});

const summaryPaths = () => fetchMock.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/reports/summary'));

describe('Báo cáo thu chi', () => {
  it('mặc định xem tháng này; hiện tổng thu, tổng chi, chênh lệch, số phiếu và các bảng phân tích', async () => {
    renderAnalysis();
    const month = periodPresets(todayVn())[0];
    await waitFor(() => expect(summaryPaths()[0]).toContain(`from=${month.from}&to=${month.to}`));
    expect(await screen.findByText('Chênh lệch thu - chi')).toBeTruthy();
    expect(screen.getByText('3 / 2 / 1')).toBeTruthy(); // số phiếu thu / chi / chuyển
    const byReason = screen.getByRole('region', { name: 'Chi theo lý do' });
    expect(within(byReason).getByText('Văn phòng phẩm')).toBeTruthy();
    expect(within(byReason).getByText('75%')).toBeTruthy(); // 900.000 / 1.200.000
    expect(within(byReason).getByText('25%')).toBeTruthy();
    const accounts = screen.getByRole('region', { name: 'Biến động tài khoản' });
    expect(within(accounts).getByText('11.300.000')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('2 kỳ');
  });

  it('chọn nhanh khoảng thời gian gửi đúng từ ngày đến ngày và đánh dấu mục đang chọn', async () => {
    renderAnalysis();
    await screen.findByText('Chênh lệch thu - chi');
    const year = periodPresets(todayVn()).find((p) => p.id === 'year');
    fireEvent.click(screen.getByRole('button', { name: 'Năm nay' }));
    await waitFor(() => expect(summaryPaths().some((p) => p.includes(`from=${year?.from}&to=${year?.to}`))).toBe(true));
    expect(screen.getByRole('button', { name: 'Năm nay' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('xuất Excel gồm tổng quan, dòng tiền, các bảng phân tích và biến động tài khoản', async () => {
    renderAnalysis();
    await screen.findByText('Chênh lệch thu - chi');
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(String(mockDownload.mock.calls[0][0])).toBe('bao-cao-thu-chi-2026-10-01-2026-10-31');
    const csv = String(mockDownload.mock.calls[0][1]);
    for (const text of ['Báo cáo thu chi', 'Tổng thu', 'Dòng tiền theo kỳ', 'Thu theo lý do', 'Chi theo lý do', 'Thu theo dự án', 'Chi theo dự án', 'Chưa hạch toán', 'Biến động tài khoản', 'Vietcombank']) expect(csv).toContain(text);
  });

  it('bảng theo dự án và lọc báo cáo theo một dự án', async () => {
    renderAnalysis();
    await screen.findByText('Chênh lệch thu - chi');
    const spend = screen.getByRole('region', { name: 'Chi theo dự án' });
    expect(within(spend).getByText('DA001 - Trạm biến áp Đà Nẵng')).toBeTruthy();
    expect(within(spend).getByText('Chưa hạch toán')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Thu theo dự án' })).getByText('100%')).toBeTruthy();

    fireEvent.click(screen.getByPlaceholderText('Mọi dự án'));
    fireEvent.click(await screen.findByRole('option', { name: /DA001/ }));
    await waitFor(() => expect(summaryPaths().some((p) => p.includes('projectId=p1'))).toBe(true));
  });

  it('Workspace không trả về dự án nào thì ẩn ô lọc dự án, báo cáo vẫn hiện', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/accounts')) return [{ id: 'a1', name: 'Vietcombank' }] as never;
      if (path.startsWith('/workspace/projects')) throw new Error('Workspace đang không khả dụng.');
      if (path.startsWith('/reports/summary')) return report as never;
      throw new Error(`route lạ ${path}`);
    });
    renderAnalysis();
    expect(await screen.findByText('Chênh lệch thu - chi')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Mọi dự án')).toBeNull();
  });

  it('báo lỗi khi người dùng không có quyền xem báo cáo', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/summary')) throw new Error('Bạn không có quyền xem báo cáo.');
      return [] as never;
    });
    renderAnalysis();
    expect((await screen.findByRole('alert')).textContent).toContain('Bạn không có quyền xem báo cáo.');
    expect((screen.getByRole('button', { name: /Xuất Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mặc định là sổ thu chi: tiêu đề theo kỳ, dòng Dư đầu kỳ, tồn quỹ chạy và đủ cột', async () => {
    render(<ReportsScreen />);
    const month = periodPresets(todayVn())[0];
    const ledger = await screen.findByRole('region', { name: 'Báo cáo thu chi dạng sổ' });
    await waitFor(() => expect(ledgerPaths()[0]).toContain(`from=${month.from}&to=${month.to}&offset=0&limit=60`));
    expect(within(ledger).getByRole('heading').textContent).toMatch(/^Báo cáo thu chi từ \d{2}\/\d{2}\/\d{4} đến \d{2}\/\d{2}\/\d{4}$/);
    for (const name of ['STT', 'Nội dung', 'Mã chứng từ', 'Người tạo', 'Ngày tạo', 'Ngày hạch toán', 'Tài khoản', 'Phát sinh thu', 'Phát sinh chi', 'Tồn quỹ'])
      expect(within(ledger).getByRole('columnheader', { name })).toBeTruthy();
    const rows = within(ledger).getAllByRole('row');
    expect(within(rows[1]).getByText('Dư đầu kỳ')).toBeTruthy();
    expect(within(rows[1]).getByText('5.000.000')).toBeTruthy();
    expect(within(rows[2]).getByText('PT-2610-0001')).toBeTruthy();
    expect(within(rows[2]).getByText('6.000.000')).toBeTruthy(); // tồn quỹ sau dòng đầu
    expect(within(rows[2]).getAllByText('14/10/2026')).toHaveLength(2); // ngày tạo và ngày hạch toán
  });

  it('chỉ tải 60 dòng đầu; "Hiện tất cả" tải nốt phần còn lại và hiện dòng cộng phát sinh', async () => {
    render(<ReportsScreen />);
    expect((await screen.findByText(/Đang hiện 60\/111 dòng, kéo xuống để tải thêm/)).textContent).toBeTruthy();
    expect(screen.queryByText('Cộng phát sinh')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện tất cả' }));
    expect(await screen.findByText('Đã hiện tất cả 111 dòng.')).toBeTruthy();
    expect(ledgerPaths().some((p) => p.includes('offset=60&limit=51'))).toBe(true);
    expect(screen.getByText('Cộng phát sinh')).toBeTruthy();
    expect(screen.getByText('PT-2610-0111')).toBeTruthy();
  });

  it('lọc theo tài khoản gửi accountId; Export tải đủ dòng gồm dư đầu kỳ và cộng phát sinh', async () => {
    render(<ReportsScreen />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByPlaceholderText('Mọi tài khoản'));
    fireEvent.click(await screen.findByRole('option', { name: 'Vietcombank' }));
    await waitFor(() => expect(ledgerPaths().some((p) => p.includes('accountId=a1'))).toBe(true));
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    const csv = String(mockDownload.mock.calls[0][1]);
    for (const text of ['Dư đầu kỳ', 'Cộng phát sinh', 'PT-2610-0111', 'Tồn quỹ']) expect(csv).toContain(text);
    expect(ledgerPaths().some((p) => p.includes('limit=5000'))).toBe(true);
  });

  it('kỳ không có phát sinh vẫn hiện dư đầu kỳ và báo không có dòng', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/reports/ledger')) return { ...ledgerPage(0, 0, 0), items: [] } as never;
      return [] as never;
    });
    render(<ReportsScreen />);
    expect(await screen.findByText('Không có phát sinh trong kỳ.')).toBeTruthy();
    expect(screen.getByText('Dư đầu kỳ')).toBeTruthy();
  });
});
