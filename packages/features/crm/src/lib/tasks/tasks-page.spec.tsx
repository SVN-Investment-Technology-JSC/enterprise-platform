/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fixtureTask, fixtureTaskList } from './tasks.fixtures';
import { ReasonsCell, TasksPage } from './tasks-page';
import { AwaitingApprovalBlock } from './awaiting-approval-block';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

jest.mock('antd', () => ({
  Table: ({
    columns,
    dataSource,
    rowKey,
    onRow,
    locale,
  }: {
    columns: { key?: string; title?: string; render?: (value: unknown, row: unknown, index: number) => unknown }[];
    dataSource: Record<string, unknown>[];
    rowKey: (row: unknown) => string;
    onRow?: (row: unknown, index: number) => Record<string, unknown>;
    locale?: { emptyText?: string };
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataSource.length ? (
          dataSource.map((row, index) => (
            <tr key={rowKey(row)} data-testid="task-row" {...(onRow?.(row, index) ?? {})}>
              {columns.map((column) => (
                <td key={column.key}>{column.render?.(undefined, row, index) as never}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td>{locale?.emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  ),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  formatDateTime: (value: string) => (value ? `lúc ${value}` : ''),
}));

const mockGetMyTasks = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  getMyTasks: (...args: unknown[]) => mockGetMyTasks(...args),
}));

jest.mock('../crm-context', () => ({
  useCrm: () => ({ people: [{ userId: 'u2', displayName: 'Trần Thị Bình' }] }),
}));

const DIRECT = { subject: 'QUOTE', mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null } as const;

beforeEach(() => {
  jest.clearAllMocks();
});

function table(name: string) {
  return screen.getByRole('region', { name });
}
const headers = (region: HTMLElement) => within(region).getAllByRole('columnheader').map((cell) => cell.textContent);

describe('Trang Việc cần xử lý (TC-TSK-13)', () => {
  it('hai bảng có mã, khách, tổng tiền, biên, lý do, cách duyệt; báo số việc ra ngoài', async () => {
    const list = fixtureTaskList({
      awaitingMe: [fixtureTask(), fixtureTask({ kind: 'BUSINESS_PLAN_APPROVAL', quoteId: 'q2', quoteCode: 'BG2600002', approval: { ...DIRECT, subject: 'BUSINESS_PLAN' } })],
      mine: [fixtureTask({ kind: 'QUOTE_REJECTED', quoteId: 'q3', quoteCode: 'BG2600003', approval: null, reasons: ['Giá quá thấp'], marginPercent: null, ownerName: null, ownerUserId: 'u2' })],
    });
    mockGetMyTasks.mockResolvedValue(list);
    const loaded = jest.fn();
    render(<TasksPage onOpenQuote={jest.fn()} onOpenProcedure={jest.fn()} onLoaded={loaded} />);

    await screen.findByText('Chờ tôi duyệt (2)');
    expect(loaded).toHaveBeenCalledWith(list);
    const awaiting = table('Chờ tôi duyệt');
    expect(headers(awaiting)).toEqual(['Việc', 'Báo giá', 'Khách hàng', 'Người trình', 'Thời điểm', 'Tổng tiền', 'Biên', 'Lý do cần duyệt', 'Cách duyệt', '']);
    const [first, second] = within(awaiting).getAllByTestId('task-row');
    expect(first.textContent).toContain('Duyệt báo giá');
    expect(first.textContent).toContain('BG2600001 - Báo giá bơm (v2)');
    expect(first.textContent).toContain('Công ty A');
    expect(first.textContent).toContain('Nguyễn Văn An');
    expect(first.textContent).toContain('lúc 2026-11-09T03:05:00.000Z');
    expect(first.textContent).toMatch(/125\.000\.000/);
    expect(first.textContent).toContain('Biên lợi nhuận dưới ngưỡng');
    expect(first.textContent).toContain('Qua Quy trình HS-0007');
    expect(within(first).getByRole('button', { name: 'Duyệt trên Quy trình' })).toBeTruthy();
    expect(second.textContent).toContain('Duyệt phương án kinh doanh');
    expect(second.textContent).toContain('Trực tiếp');

    // Bảng Việc của tôi: người phụ trách, không có cột Biên (mọi dòng rỗng), không có Cách duyệt.
    const mine = table('Việc của tôi');
    expect(headers(mine)).toEqual(['Việc', 'Báo giá', 'Khách hàng', 'Người phụ trách', 'Thời điểm', 'Tổng tiền', 'Lý do', '']);
    const row = within(mine).getByTestId('task-row');
    expect(row.textContent).toContain('Báo giá bị từ chối duyệt');
    expect(row.textContent).toContain('Trần Thị Bình');
    expect(row.textContent).toContain('Giá quá thấp');
  });

  it('không có việc: câu trống tiếng Việt ở cả hai bảng; Làm mới tải lại', async () => {
    mockGetMyTasks.mockResolvedValue(fixtureTaskList());
    render(<TasksPage onOpenQuote={jest.fn()} />);
    await screen.findByText('Không có báo giá hay phương án kinh doanh nào đang chờ bạn duyệt.');
    expect(screen.getByText('Không có báo giá nào của bạn cần xử lý.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(mockGetMyTasks).toHaveBeenCalledTimes(2));
  });

  it('lỗi tải: báo lỗi, không vỡ trang', async () => {
    mockGetMyTasks.mockRejectedValue({ statusCode: 500 });
    render(<TasksPage onOpenQuote={jest.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Không tải được việc cần xử lý.');
  });
});

describe('Bấm việc (TC-TSK-14, TC-TSK-15)', () => {
  it('qua Quy trình: sang hồ sơ kèm returnTo về Việc cần xử lý; trực tiếp và việc của tôi: mở báo giá có nút quay về', async () => {
    mockGetMyTasks.mockResolvedValue(
      fixtureTaskList({
        awaitingMe: [fixtureTask(), fixtureTask({ kind: 'BUSINESS_PLAN_APPROVAL', quoteId: 'q2', approval: { ...DIRECT, subject: 'BUSINESS_PLAN' } })],
        mine: [fixtureTask({ kind: 'QUOTE_READY_TO_SEND', quoteId: 'q3', approval: null })],
      }),
    );
    const openQuote = jest.fn();
    const openProcedure = jest.fn();
    render(<TasksPage onOpenQuote={openQuote} onOpenProcedure={openProcedure} />);
    await screen.findByText('Chờ tôi duyệt (2)');
    const [procedureRow, planRow] = within(table('Chờ tôi duyệt')).getAllByTestId('task-row');

    fireEvent.click(procedureRow);
    expect(openProcedure).toHaveBeenCalledWith(`/modules/procedure?returnTo=${encodeURIComponent('/modules/crm#tasks')}#workspace/inst-1`);
    fireEvent.click(within(procedureRow).getByRole('button', { name: 'Duyệt trên Quy trình' }));
    expect(openProcedure).toHaveBeenCalledTimes(2);

    fireEvent.click(planRow);
    expect(openQuote).toHaveBeenLastCalledWith('q2?panel=business-plan&from=tasks');
    fireEvent.click(within(table('Việc của tôi')).getByRole('button', { name: 'Mở báo giá' }));
    expect(openQuote).toHaveBeenLastCalledWith('q3?from=tasks');
    expect(openQuote).toHaveBeenCalledTimes(2);
  });
});

describe('Khối Cần tôi duyệt ở danh sách báo giá (TC-TSK-16)', () => {
  it('có việc: hiện số, mở rộng thì liệt kê, bấm mở đúng nơi và quay về danh sách báo giá', async () => {
    mockGetMyTasks.mockResolvedValue(
      fixtureTaskList({ awaitingMe: [fixtureTask(), fixtureTask({ quoteId: 'q2', quoteCode: 'BG2600002', approval: DIRECT })] }),
    );
    const openQuote = jest.fn();
    const openProcedure = jest.fn();
    render(<AwaitingApprovalBlock onOpenQuote={openQuote} onOpenProcedure={openProcedure} />);
    expect(await screen.findByText('Cần tôi duyệt (2)')).toBeTruthy();
    expect(screen.queryByText(/BG2600001/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt trên Quy trình' }));
    expect(openProcedure).toHaveBeenCalledWith(`/modules/procedure?returnTo=${encodeURIComponent('/modules/crm#quotes')}#workspace/inst-1`);
    fireEvent.click(screen.getByRole('button', { name: 'BG2600002 - Báo giá bơm (v2)' }));
    expect(openQuote).toHaveBeenCalledWith('q2');
  });

  it('không có việc hoặc lỗi tải: ẩn khối', async () => {
    mockGetMyTasks.mockResolvedValue(fixtureTaskList({ mine: [fixtureTask({ approval: null, kind: 'QUOTE_REJECTED' })] }));
    const { container, unmount } = render(<AwaitingApprovalBlock onOpenQuote={jest.fn()} />);
    await waitFor(() => expect(mockGetMyTasks).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();

    mockGetMyTasks.mockRejectedValue({ statusCode: 404 });
    const second = render(<AwaitingApprovalBlock onOpenQuote={jest.fn()} />);
    await waitFor(() => expect(mockGetMyTasks).toHaveBeenCalledTimes(2));
    expect(second.container.textContent).toBe('');
  });
});

describe('ReasonsCell', () => {
  it('hiện lý do đầu và số lý do còn lại, đủ danh sách ở tooltip', () => {
    const { container } = render(<ReasonsCell reasons={['Chiết khấu vượt hạn mức', 'Có ghi đè giá', 'Biên thấp']} />);
    expect(container.textContent).toBe('Chiết khấu vượt hạn mứcvà 2 lý do khác');
    expect(container.firstElementChild?.getAttribute('title')).toBe('Chiết khấu vượt hạn mức\nCó ghi đè giá\nBiên thấp');
    const single = render(<ReasonsCell reasons={['Giá quá thấp']} />);
    expect(single.container.textContent).toBe('Giá quá thấp');
  });
});

