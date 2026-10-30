import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ChatMessage,
  ProjectChatFeedItem,
  ProjectChatFeedPage,
  ProjectChatThread,
  WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { publishRealtimeEvent } from '@enterprise-platform/shared-ui';
import { TabChats } from '@enterprise-platform/feature-workspace';

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  loadProjectChatFeed: jest.fn(),
  loadProjectChatThread: jest.fn(),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-directory', () => ({
  useDirectory: () => ({ nameOf: (userId: string) => (userId === 'u1' ? 'An' : userId) }),
}));

// 'jest.mock' ở trên thay các hàm gọi API; lấy chính các bản giả đó để dựng dữ liệu cho từng ca.
const api = jest.requireMock('../../../packages/features/workspace/src/lib/workspace-api') as {
  loadProjectChatFeed: jest.MockedFunction<typeof import('@enterprise-platform/feature-workspace').loadProjectChatFeed>;
  loadProjectChatThread: jest.MockedFunction<typeof import('@enterprise-platform/feature-workspace').loadProjectChatThread>;
};
const feed = api.loadProjectChatFeed;
const thread = api.loadProjectChatThread;

const workItem = (n: number): WorkItem =>
  ({ id: `w${n}`, code: `CV-${n}`, title: `Việc số ${n}`, parentId: n > 1 && n % 10 === 0 ? 'w1' : undefined }) as unknown as WorkItem;
const ITEMS = Array.from({ length: 25 }, (_, index) => workItem(index + 1));

const message = (id: string, body: string, minute: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channelId: 'c',
  body,
  mentions: [],
  isEdited: false,
  isDeleted: false,
  createdBy: 'u1',
  createdAt: `2026-10-30T10:${String(minute).padStart(2, '0')}:00.000Z`,
  updatedAt: `2026-10-30T10:${String(minute).padStart(2, '0')}:00.000Z`,
  ...extra,
});

/** Giả lập server: công việc có tin lên trước (mới nhất trước), tìm theo mã/tiêu đề/nội dung, trang tin 3 tin. */
function fakeServer(chats: Record<number, ChatMessage[]>, options: { threadPageSize?: number } = {}) {
  const threadPageSize = options.threadPageSize ?? 3;
  const latest = (n: number) => chats[n]?.[chats[n].length - 1];
  feed.mockImplementation(async (_projectId, page, pageSize, query = {}) => {
    const ordered = [...ITEMS].sort((a, b) => {
      const la = Number(a.id.slice(1)) in chats ? latest(Number(a.id.slice(1)))?.createdAt : undefined;
      const lb = Number(b.id.slice(1)) in chats ? latest(Number(b.id.slice(1)))?.createdAt : undefined;
      if (la && lb) return lb.localeCompare(la);
      return la ? -1 : lb ? 1 : 0;
    });
    const needle = query.search?.toLowerCase();
    const matching = ordered.filter((item) => {
      const n = Number(item.id.slice(1));
      if (query.onlyWithChat && !chats[n]?.length) return false;
      if (!needle) return true;
      return (
        item.code.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        (chats[n] ?? []).some((entry) => entry.body.toLowerCase().includes(needle))
      );
    });
    const items: ProjectChatFeedItem[] = matching.slice((page - 1) * pageSize, page * pageSize).map((item) => {
      const n = Number(item.id.slice(1));
      const last = latest(n);
      return {
        workItemId: item.id,
        messageCount: chats[n]?.length ?? 0,
        latestAt: last?.createdAt,
        latestBy: last?.createdBy,
        latestBody: last?.body,
      };
    });
    return { items, total: matching.length, page, pageSize } satisfies ProjectChatFeedPage;
  });
  thread.mockImplementation(async (_projectId, workItemId, before) => {
    const all = chats[Number(workItemId.slice(1))] ?? [];
    const end = before ? all.findIndex((entry) => entry.id === before) : all.length;
    const start = Math.max(0, end - threadPageSize);
    return { messages: all.slice(start, end), hasMore: start > 0 } satisfies ProjectChatThread;
  });
}

let counter = 0;
function mount(
  chats: Record<number, ChatMessage[]> = {},
  options: { threadPageSize?: number; projectId?: string } = {},
) {
  fakeServer(chats, options);
  const onOpen = jest.fn();
  const projectId = options.projectId ?? `project-${(counter += 1)}`;
  const view = render(
    <TabChats projectId={projectId} items={ITEMS} members={[]} documents={[]} onOpen={onOpen} />,
  );
  return { ...view, onOpen, projectId };
}

const rowsOf = () => screen.getAllByRole('button').filter((button) => /^CV-\d+/.test(button.textContent ?? '') && button.getAttribute('title') === null);
const rowFor = (code: string) => rowsOf().find((button) => button.textContent?.startsWith(code)) as HTMLElement;
const lastFeedCall = () => feed.mock.calls[feed.mock.calls.length - 1];

describe('Màn "Trao đổi công việc"', () => {
  beforeAll(() => {
    // `SearchableSelect` đo bằng ResizeObserver; jsdom chưa có.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    feed.mockReset();
    thread.mockReset();
  });

  afterEach(() => cleanup());

  it('tải trang 1 với 10 công việc, hiện tin xem trước, việc chưa có tin ghi "Chưa có trao đổi"', async () => {
    mount({ 3: [message('m1', 'Gửi báo giá cho khách', 5)] });
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0].slice(1, 3)).toEqual([1, 10]);
    // Việc có tin lên đầu, kèm "Tên: nội dung".
    expect(rowsOf()[0].textContent).toContain('CV-3');
    expect(rowsOf()[0].textContent).toContain('An: Gửi báo giá cho khách');
    expect(rowsOf()[1].textContent).toContain('Chưa có trao đổi');
    expect(screen.getByText('1–10 / 25')).toBeTruthy();
  });

  it('chọn sẵn công việc đầu danh sách và hiện trao đổi của nó; việc chưa có tin khỏi gọi API', async () => {
    mount({ 3: [message('m1', 'Xin chào cả nhà', 5)] });
    expect(await screen.findByText('Xin chào cả nhà', { selector: 'p' })).toBeTruthy();
    expect(thread).toHaveBeenCalledTimes(1);
    expect(thread.mock.calls[0].slice(1)).toEqual(['w3', undefined]);
    // Chọn việc chưa có tin: hiện thông báo, không gọi thêm API.
    fireEvent.click(rowFor('CV-1'));
    expect(await screen.findByText('Chưa có trao đổi nào.')).toBeTruthy();
    expect(thread).toHaveBeenCalledTimes(1);
  });

  it('qua trang 2 mới gọi trang 2, về trang 1 lấy từ bộ nhớ không gọi lại API', async () => {
    mount();
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
    expect(feed).toHaveBeenCalledTimes(2);
    expect(lastFeedCall().slice(1, 3)).toEqual([2, 10]);
    expect(rowsOf()[0].textContent).toContain('CV-11');
    fireEvent.click(screen.getByLabelText('Trang trước'));
    await waitFor(() => expect(rowsOf()[0].textContent).toMatch(/^CV-1(?!d)/));
    expect(feed).toHaveBeenCalledTimes(2);
  });

  it('đổi số công việc mỗi trang gọi lại từ trang 1 với cỡ mới', async () => {
    mount();
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
    fireEvent.click(screen.getByPlaceholderText('Chọn số công việc mỗi trang…'));
    fireEvent.click(await screen.findByText('20 / trang'));
    await waitFor(() => expect(rowsOf()).toHaveLength(20));
    expect(lastFeedCall().slice(1, 3)).toEqual([1, 20]);
    expect(screen.getByText('1–20 / 25')).toBeTruthy();
  });

  it('tìm kiếm chờ ngừng gõ rồi mới gọi API, quay về trang 1, tô sáng chỗ khớp và có nút xoá', async () => {
    mount({ 4: [message('m1', 'Nhớ gửi BÁO GIÁ', 5)], 7: [message('m2', 'chuyện khác', 6)] });
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
    feed.mockClear();
    const box = screen.getByLabelText('Tìm công việc hoặc nội dung tin');
    fireEvent.change(box, { target: { value: 'báo' } });
    fireEvent.change(box, { target: { value: 'báo giá' } });
    // Chưa hết thời gian chờ: chưa gọi.
    expect(feed).not.toHaveBeenCalled();
    await waitFor(() => expect(feed).toHaveBeenCalledTimes(1));
    expect(lastFeedCall().slice(1, 3)).toEqual([1, 10]);
    expect(lastFeedCall()[3]).toEqual({ search: 'báo giá', onlyWithChat: false });
    await waitFor(() => expect(rowsOf()).toHaveLength(1));
    expect(rowsOf()[0].querySelector('mark')?.textContent?.toLowerCase()).toBe('báo giá');
    // Xoá từ khoá: về danh sách đầy đủ.
    fireEvent.click(screen.getByLabelText('Xoá từ khoá'));
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    expect((box as HTMLInputElement).value).toBe('');
    // Danh sách đầy đủ trang 1 đã được nhớ từ lúc đầu: xoá từ khoá không gọi lại API.
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it('tìm không ra thì báo "Không có công việc phù hợp."', async () => {
    mount();
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.change(screen.getByLabelText('Tìm công việc hoặc nội dung tin'), { target: { value: 'không-có-gì' } });
    expect((await screen.findAllByText('Không có công việc phù hợp.')).length).toBeGreaterThan(0);
  });

  it('bộ lọc "Chỉ công việc có trao đổi" gửi onlyWithChat và về trang 1', async () => {
    mount({ 2: [message('m1', 'a', 1)], 5: [message('m2', 'b', 2)] });
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Chỉ công việc có trao đổi'));
    await waitFor(() => expect(rowsOf()).toHaveLength(2));
    expect(lastFeedCall()[3]).toEqual({ search: undefined, onlyWithChat: true });
    expect(rowsOf().map((row) => row.textContent?.slice(0, 4))).toEqual(['CV-5', 'CV-2']);
  });

  it('"Xem tin cũ hơn" nối trang liền trước theo before, đúng thứ tự cũ → mới, rồi biến mất khi hết', async () => {
    const msgs = Array.from({ length: 7 }, (_, index) => message(`m${index + 1}`, `Tin ${index + 1}`, index + 1));
    mount({ 3: msgs }, { threadPageSize: 3 });
    // Trang đầu: 3 tin mới nhất (5, 6, 7).
    expect(await screen.findByText('Tin 7', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText('Tin 4', { selector: 'p' })).toBeNull();
    fireEvent.click(screen.getByText('Xem tin cũ hơn'));
    expect(await screen.findByText('Tin 4', { selector: 'p' })).toBeTruthy();
    expect(thread.mock.calls[1].slice(1)).toEqual(['w3', 'm5']);
    fireEvent.click(screen.getByText('Xem tin cũ hơn'));
    expect(await screen.findByText('Tin 1', { selector: 'p' })).toBeTruthy();
    expect(thread.mock.calls[2].slice(1)).toEqual(['w3', 'm2']);
    await waitFor(() => expect(screen.queryByText('Xem tin cũ hơn')).toBeNull());
    const bodies = screen
      .getAllByText(/^Tin \d$/, { selector: 'p' })
      .map((node) => node.textContent);
    expect(bodies).toEqual(['Tin 1', 'Tin 2', 'Tin 3', 'Tin 4', 'Tin 5', 'Tin 6', 'Tin 7']);
  });

  it('trả lời hiện lồng dưới tin gốc; tin đã thu hồi hiện dòng thu hồi', async () => {
    mount({
      3: [
        message('m1', 'Gốc', 1),
        message('m2', 'Trả lời gốc', 2, { parentId: 'm1' }),
        message('m3', '', 3, { isDeleted: true }),
      ],
    });
    expect(await screen.findByText('Trả lời gốc', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Tin nhắn đã được thu hồi.')).toBeTruthy();
    const reply = screen.getByText('Trả lời gốc', { selector: 'p' });
    expect(reply.closest('[class*="chatFeedReply"]')).not.toBeNull();
  });

  it('bấm tên công việc ở đầu khung trao đổi thì mở công việc đó; đường dẫn cha hiện trên đầu việc lồng nhau', async () => {
    const { onOpen } = mount({ 10: [message('m1', 'Việc con', 1)] });
    expect(await screen.findByText('Việc con', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('CV-1 ›')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Mở chi tiết công việc'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'w10' }));
  });

  it('realtime: có tin mới (của người khác) thì danh sách và trao đổi đang xem tự cập nhật, tín hiệu "đã đọc" thì bỏ qua', async () => {
    const chats: Record<number, ChatMessage[]> = { 3: [message('m1', 'Tin cũ', 1)] };
    const { projectId } = mount(chats);
    expect(await screen.findByText('Tin cũ', { selector: 'p' })).toBeTruthy();
    feed.mockClear();
    thread.mockClear();
    const signal = (data: Record<string, unknown>) =>
      act(() => {
        publishRealtimeEvent({
          id: 'e',
          event: 'workspace.chat.changed',
          version: 1,
          tenantId: 't',
          userId: 'u',
          sequence: 1,
          occurredAt: '2026-10-30T10:00:00.000Z',
          data,
        } as never);
      });
    // "Đã đọc" và dự án khác: không tải lại.
    signal({ projectId, entityType: 'work_item', entityId: 'w3', change: 'read' });
    signal({ projectId: 'khac', entityType: 'work_item', entityId: 'w3', change: 'created' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(feed).not.toHaveBeenCalled();
    // Người khác nhắn ở việc đang xem và ở một việc chưa có tin.
    chats[3] = [...chats[3], message('m2', 'Tin mới realtime', 8)];
    chats[9] = [message('m3', 'Việc khác có tin', 9)];
    signal({ projectId, entityType: 'work_item', entityId: 'w3', change: 'created' });
    signal({ projectId, entityType: 'work_item', entityId: 'w9', change: 'created' });
    expect(await screen.findByText('Tin mới realtime', { selector: 'p' })).toBeTruthy();
    // Nhiều tín hiệu dồn dập chỉ gộp thành một lần tải danh sách.
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-9'));
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it('realtime làm danh sách đổi thứ tự thì khung bên phải vẫn giữ công việc đang đọc', async () => {
    const chats: Record<number, ChatMessage[]> = {
      3: [message('m1', 'Tin của ba', 1)],
      4: [message('m2', 'Tin của bốn', 2)],
    };
    const { projectId } = mount(chats);
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-4'));
    // Người dùng chọn CV-3 (đang ở dòng 2).
    fireEvent.click(rowFor('CV-3'));
    expect(await screen.findByText('Tin của ba', { selector: 'p' })).toBeTruthy();
    // Việc khác (CV-8) nhận tin mới làm danh sách đổi thứ tự.
    chats[8] = [message('m3', 'Tin của tám', 9)];
    act(() => {
      publishRealtimeEvent({
        id: 'e',
        event: 'workspace.chat.changed',
        version: 1,
        tenantId: 't',
        userId: 'u',
        sequence: 1,
        occurredAt: '2026-10-30T10:00:00.000Z',
        data: { projectId, entityType: 'work_item', entityId: 'w8', change: 'created' },
      } as never);
    });
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-8'));
    expect(screen.getByText('Tin của ba', { selector: 'p' })).toBeTruthy();
    expect(within(screen.getByLabelText('Trao đổi')).getByTitle('Mở chi tiết công việc').textContent).toContain('CV-3');
  });

  const signalOf = (data: Record<string, unknown>) =>
    act(() => {
      publishRealtimeEvent({
        id: 'e',
        event: 'workspace.chat.changed',
        version: 1,
        tenantId: 't',
        userId: 'u',
        sequence: 1,
        occurredAt: '2026-10-30T10:00:00.000Z',
        data,
      } as never);
    });

  it('realtime vẫn huỷ bộ nhớ khi tab đang đóng: mở lại thấy dữ liệu mới, không phải bản cũ', async () => {
    const chats: Record<number, ChatMessage[]> = { 3: [message('m1', 'Tin cũ', 1)] };
    const first = mount(chats, { projectId: 'project-dong-tab' });
    expect(await screen.findByText('Tin cũ', { selector: 'p' })).toBeTruthy();
    first.unmount();
    feed.mockClear();
    thread.mockClear();
    // Tab đóng, người khác nhắn.
    chats[3] = [...chats[3], message('m2', 'Tin lúc tab đóng', 9)];
    signalOf({ projectId: 'project-dong-tab', entityType: 'work_item', entityId: 'w3', change: 'created' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    mount(chats, { projectId: 'project-dong-tab' });
    expect(await screen.findByText('Tin lúc tab đóng', { selector: 'p' })).toBeTruthy();
    expect(feed).toHaveBeenCalled();
  });

  it('công việc đang đọc (chưa có tin) trôi khỏi trang vì có tin mới: vẫn nạp được trao đổi, không kẹt ở "Chưa có trao đổi"', async () => {
    const chats: Record<number, ChatMessage[]> = { 2: [message('m1', 'Tin của hai', 1)] };
    const { projectId } = mount(chats);
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    // Chọn việc chưa có tin ở trang 2 (CV-15), rồi người khác nhắn vào đúng việc đó.
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
    fireEvent.click(rowFor('CV-15'));
    expect(await screen.findByText('Chưa có trao đổi nào.')).toBeTruthy();
    chats[15] = [message('m2', 'Có tin rồi', 9)];
    signalOf({ projectId, entityType: 'work_item', entityId: 'w15', change: 'created' });
    expect(await screen.findByText('Có tin rồi', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText('Chưa có trao đổi nào.')).toBeNull();
  });

  it('đổi dự án thì trang, từ khoá và bộ lọc về mặc định, không gọi dự án mới với trạng thái của dự án cũ', async () => {
    fakeServer({});
    const view = render(<TabChats projectId="project-a" items={ITEMS} members={[]} documents={[]} onOpen={jest.fn()} />);
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
    fireEvent.click(screen.getByLabelText('Chỉ công việc có trao đổi'));
    await waitFor(() => expect(lastFeedCall()[3]).toEqual({ search: undefined, onlyWithChat: true }));
    feed.mockClear();
    view.rerender(<TabChats projectId="project-b" items={ITEMS} members={[]} documents={[]} onOpen={jest.fn()} />);
    await waitFor(() => expect(feed).toHaveBeenCalled());
    // Mọi lần gọi cho dự án mới đều là trang 1, không lọc.
    for (const call of feed.mock.calls) {
      expect(call[0]).toBe('project-b');
      expect(call.slice(1, 3)).toEqual([1, 10]);
      expect(call[3]).toEqual({ search: undefined, onlyWithChat: false });
    }
    expect((screen.getByLabelText('Chỉ công việc có trao đổi') as HTMLInputElement).checked).toBe(false);
  });

  it('thanh phân trang không biến mất khi đang tải trang khác', async () => {
    mount();
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    let release: (() => void) | undefined;
    const original = feed.getMockImplementation();
    feed.mockImplementationOnce(
      (...args) => new Promise((resolve) => { release = () => resolve(original?.(...args) as never); }),
    );
    fireEvent.click(screen.getByLabelText('Trang sau'));
    expect(screen.getByLabelText('Phân trang')).toBeTruthy();
    await act(async () => release?.());
    await waitFor(() => expect(rowsOf()[0].textContent).toContain('CV-11'));
  });

  it('từ khoá chỉ tô sáng phần nội dung của dòng xem trước, không tô tên người nhắn', async () => {
    mount({ 4: [message('m1', 'an toàn là trên hết', 5)] });
    await waitFor(() => expect(rowsOf()).toHaveLength(10));
    fireEvent.change(screen.getByLabelText('Tìm công việc hoặc nội dung tin'), { target: { value: 'an' } });
    await waitFor(() => expect(rowsOf().length).toBeGreaterThan(0));
    const row = rowFor('CV-4');
    // Tên "An" không được tô; chỉ chữ "an" trong nội dung.
    const marks = [...row.querySelectorAll('mark')].map((node) => node.textContent?.toLowerCase());
    expect(marks.every((text) => text === 'an')).toBe(true);
    expect(row.textContent).toContain('An: ');
  });

  it('lỗi tải danh sách hiện thông báo của server', async () => {
    feed.mockRejectedValue({ message: 'Máy chủ bận, thử lại sau.' });
    thread.mockResolvedValue({ messages: [], hasMore: false });
    render(<TabChats projectId="project-loi" items={ITEMS} members={[]} documents={[]} onOpen={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Máy chủ bận, thử lại sau.');
  });
});
