/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { ConfigHistoryDrawer } from './config-history-drawer';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const row = (id: string, action: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  action,
  actionLabel: action === 'request_reason.updated' ? 'Sửa lý do đơn' : 'Thêm lý do đơn',
  entityKind: 'Lý do đơn',
  entityLabel: `Lý do ${id}`,
  actorLabel: 'Hà Nguyên Hoàng',
  approverLabel: null,
  detail: { reason: 'Điều chỉnh theo quy chế', ...extra },
});

const ACTIONS = [
  { value: 'attendance.punch', label: 'Chấm công' },
  { value: 'request_reason.created', label: 'Thêm lý do đơn' },
  { value: 'request_reason.updated', label: 'Sửa lý do đơn' },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    const url = new URL(path, 'http://x');
    const action = url.searchParams.get('action');
    if (!action) return { data: [], meta: { total: 3, actions: ACTIONS } };
    if (action === 'request_reason.created')
      return { data: [row('r1', action, '2026-10-01T08:00:00.000Z')], meta: { total: 1, actions: ACTIONS } };
    if (action === 'request_reason.updated')
      return { data: [row('r2', action, '2026-10-05T09:00:00.000Z')], meta: { total: 1, actions: ACTIONS } };
    throw new Error(`unexpected ${path}`);
  }) as never);
});

describe('ConfigHistoryDrawer', () => {
  it('chỉ lấy các mã hành động theo tiền tố, gộp và xếp mới nhất trước; không gọi khi đóng', async () => {
    const { rerender } = render(
      <ConfigHistoryDrawer open={false} onOpenChange={() => undefined} actionPrefixes={['request_reason.']} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<ConfigHistoryDrawer open onOpenChange={() => undefined} actionPrefixes={['request_reason.']} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(2));
    const items = within(dialog).getAllByRole('listitem');
    expect(items[0].textContent).toContain('Lý do r2');
    expect(items[1].textContent).toContain('Lý do r1');
    expect(items[0].textContent).toContain('Ghi chú: Điều chỉnh theo quy chế');
    const paths = fetchMock.mock.calls.map(([p]) => String(p));
    expect(paths.some((p) => p.includes('action=attendance.punch'))).toBe(false);
    expect(paths.filter((p) => p.includes('action=request_reason.'))).toHaveLength(2);
  });

  it('bấm một bản ghi để xem chi tiết nội dung ghi nhận', async () => {
    render(<ConfigHistoryDrawer open onOpenChange={() => undefined} actionPrefixes={['request_reason.']} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(2));
    const first = within(dialog).getAllByRole('button', { expanded: false })[0];
    fireEvent.click(first);
    expect(await within(dialog).findByText('Điều chỉnh theo quy chế', { selector: 'dd' })).toBeTruthy();
  });

  it('không có mã hành động phù hợp thì báo chưa có thay đổi; lỗi tải thì hiện lỗi', async () => {
    const { rerender } = render(<ConfigHistoryDrawer open onOpenChange={() => undefined} actionPrefixes={['khong_co.']} />);
    expect(await screen.findByText('Chưa có thay đổi nào được ghi nhận')).toBeTruthy();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Không đủ quyền xem nhật ký'));
    rerender(<ConfigHistoryDrawer open onOpenChange={() => undefined} actionPrefixes={['request_type.']} />);
    expect(await screen.findByText('Không đủ quyền xem nhật ký')).toBeTruthy();
  });
});
