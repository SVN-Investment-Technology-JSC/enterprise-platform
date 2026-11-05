import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ChatMessage,
  ProjectChatTimeline,
  ProjectChatTimelineItem,
  ProjectMember,
  WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { TabChats } from '@enterprise-platform/feature-workspace';

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  loadProjectChatFeed: jest.fn(),
  loadProjectChatThread: jest.fn(),
  loadProjectChatTimeline: jest.fn(),
  replyChatMessage: jest.fn(),
  sendChatMessage: jest.fn(),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-directory', () => ({
  useDirectory: () => ({ nameOf: (userId: string) => (userId === 'u1' ? 'An' : userId) }),
}));

const api = jest.requireMock('../../../packages/features/workspace/src/lib/workspace-api') as {
  loadProjectChatFeed: jest.Mock;
  loadProjectChatThread: jest.Mock;
  loadProjectChatTimeline: jest.Mock;
  replyChatMessage: jest.Mock;
  sendChatMessage: jest.Mock;
};

const ITEMS = ['A', 'B', 'C'].map(
  (id) => ({ id: `w${id}`, code: `CV-${id}`, title: `Việc ${id}` }) as unknown as WorkItem,
);

const entry = (
  id: string,
  entityId: string,
  hour: number,
  extra: Partial<ProjectChatTimelineItem> = {},
  body = `Tin ${id}`,
): ProjectChatTimelineItem => ({
  message: {
    id,
    channelId: `channel-${entityId}`,
    body,
    mentions: [],
    isEdited: false,
    isDeleted: false,
    createdBy: 'u1',
    createdAt: new Date(2026, 10, 2, hour, 0, 0).toISOString(),
    updatedAt: new Date(2026, 10, 2, hour, 0, 0).toISOString(),
  } satisfies ChatMessage,
  entityType: 'work_item',
  entityId,
  ...extra,
});

/** A lúc 13h và 15h, B lúc 14h, C lúc 20h — như ví dụ của người dùng; trang cũ → mới. */
const TIMELINE: ProjectChatTimeline = {
  hasMore: false,
  items: [entry('m1', 'wA', 13), entry('m2', 'wB', 14), entry('m3', 'wA', 15), entry('m4', 'wA', 16), entry('m5', 'wC', 20)],
};

let counter = 0;
function mount(options: { members?: ProjectMember[]; currentUserId?: string; toolbarSlot?: HTMLElement | null } = {}) {
  api.loadProjectChatFeed.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  api.loadProjectChatThread.mockResolvedValue({ messages: [], hasMore: false });
  const onOpen = jest.fn();
  const projectId = `project-timeline-${(counter += 1)}`;
  render(
    <TabChats
      projectId={projectId}
      items={ITEMS}
      members={options.members ?? []}
      documents={[]}
      onOpen={onOpen}
      currentUserId={options.currentUserId}
      toolbarSlot={options.toolbarSlot}
    />,
  );
  if (options.toolbarSlot !== null) fireEvent.click(screen.getByRole('button', { name: 'Theo thời gian' }));
  return { onOpen, projectId };
}

const articles = () => screen.getAllByRole('article');

/** Chip công việc của một tin (nút có data-slot; chú thích hiện bằng Tooltip, không còn thuộc tính title). */
const chipOf = (root: HTMLElement) => root.querySelector('[data-slot="node-chip"]') as HTMLElement;
/** Nút dòng trích của tin trả lời (cũng là nút "đi tới tin gốc"). */
const quoteButton = async () => {
  await waitFor(() => expect(document.querySelector('[data-slot="reply-quote"]')).not.toBeNull());
  return document.querySelector('[data-slot="reply-quote"]') as HTMLElement;
};

/** "Trả lời" nằm trong menu "⋯" của tin (nút chỉ hiện khi rê chuột, nhưng luôn có trong DOM). */
const startReply = (article: HTMLElement) => {
  fireEvent.click(within(article).getByRole('button', { name: 'Tuỳ chọn tin nhắn' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Trả lời' }));
};

describe('Trao đổi theo thời gian', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.loadProjectChatTimeline.mockResolvedValue(TIMELINE);
  });

  afterEach(() => cleanup());

  it('hiện tin của mọi công việc xếp chung theo giờ, không phân biệt công việc', async () => {
    const { projectId } = mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    expect(articles().map((node) => /Tin m\d/.exec(node.textContent ?? '')?.[0])).toEqual([
      'Tin m1',
      'Tin m2',
      'Tin m3',
      'Tin m4',
      'Tin m5',
    ]);
    expect(api.loadProjectChatTimeline.mock.calls[0]).toEqual([projectId, undefined, {}]);
  });

  it('mỗi mạch tin của một công việc có chip; tin liền sau cùng công việc thì không lặp chip', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const chipsOf = (index: number) =>
      within(articles()[index])
        .queryAllByRole('button')
        .filter((button) => button.getAttribute('data-slot') === 'node-chip')
        .map((button) => button.textContent);
    expect(chipsOf(0)).toEqual(['CV-AViệc A']);
    expect(chipsOf(1)).toEqual(['CV-BViệc B']);
    // m3 sau m2 (việc B) nên A hiện lại chip; m4 liền sau m3 cùng A nên không có.
    expect(chipsOf(2)).toEqual(['CV-AViệc A']);
    expect(chipsOf(3)).toEqual([]);
    expect(chipsOf(4)).toEqual(['CV-CViệc C']);
  });

  it('bấm chip mở đúng công việc của tin đó', async () => {
    const { onOpen } = mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    fireEvent.click(chipOf(articles()[1]));
    expect(onOpen).toHaveBeenCalledWith(ITEMS[1]);
  });

  it('tin ở chat chung của dự án nằm ở cột phải, không có chip; tin công việc ở cột trái', async () => {
    api.loadProjectChatTimeline.mockResolvedValue({
      hasMore: false,
      items: [entry('p1', 'project-x', 9, { entityType: 'project' }), entry('m1', 'wA', 10)],
    });
    mount();
    await screen.findByText('Tin p1');
    const head = screen.getByRole('heading', { name: 'Chung dự án' });
    const projectColumn = head.parentElement as HTMLElement;
    expect(within(projectColumn).getByText('Tin p1')).toBeTruthy();
    expect(within(projectColumn).queryByText('Tin m1')).toBeNull();
    expect(projectColumn.querySelector('[data-slot="node-chip"]')).toBeNull();
    const workColumn = screen.getByRole('heading', { name: 'Công việc' }).parentElement as HTMLElement;
    expect(within(workColumn).getByText('Tin m1')).toBeTruthy();
    expect(within(workColumn).queryByText('Tin p1')).toBeNull();
  });

  it('mỗi công việc một màu chip riêng, cùng công việc thì cùng màu', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const hueOf = (index: number) =>
      chipOf(articles()[index]).style.getPropertyValue('--chip-hue');
    // m1 (A), m2 (B), m3 (A lại), m5 (C)
    expect(hueOf(0)).not.toBe('');
    expect(hueOf(0)).not.toBe(hueOf(1));
    expect(hueOf(1)).not.toBe(hueOf(4));
    expect(hueOf(0)).not.toBe(hueOf(4));
    expect(hueOf(2)).toBe(hueOf(0));
  });

  it('nhắn thẳng vào chat chung của dự án bằng ô nhập ở cột phải', async () => {
    api.sendChatMessage.mockResolvedValue({ message: { id: 'new' }, droppedMentions: [] });
    const { projectId } = mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const box = screen.getByLabelText('Nhắn vào chat chung của dự án');
    fireEvent.change(box, { target: { value: 'Chào cả nhà' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(api.sendChatMessage).toHaveBeenCalledWith({
      entityType: 'project',
      entityId: projectId,
      body: 'Chào cả nhà',
      mentions: [],
    });
    await waitFor(() => expect(api.loadProjectChatTimeline.mock.calls.length).toBeGreaterThan(1));
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('tin trả lời hiện dòng trích tin gốc', async () => {
    api.loadProjectChatTimeline.mockResolvedValue({
      hasMore: false,
      items: [
        entry('m1', 'wA', 13, {}, 'Báo giá xong chưa?'),
        entry('m2', 'wA', 14, { parent: { id: 'm1', createdBy: 'u1', body: 'Báo giá xong chưa?', isDeleted: false } }, 'Xong rồi'),
      ],
    });
    mount();
    expect(await screen.findByText('An: Báo giá xong chưa?', { selector: 'button' })).toBeTruthy();
  });

  it('"Nhắc tôi" và "Có đính kèm" (trong bảng Bộ lọc) gọi lại server; nút xoá luôn có mặt, chỉ mờ khi chưa lọc', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const lastFilter = () => api.loadProjectChatTimeline.mock.calls.at(-1)?.[2];
    const clear = screen.getByRole('button', { name: 'Xoá bộ lọc' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Nhắc tôi/ }));
    await waitFor(() => expect(lastFilter()).toEqual({ mentionsMe: true }));
    expect(clear.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    fireEvent.click(screen.getByLabelText('Chỉ tin có đính kèm'));
    await waitFor(() => expect(lastFilter()).toEqual({ mentionsMe: true, hasAttachment: true }));
    // Số nhóm lọc trong bảng hiện trên nút (đính kèm = 1); "Nhắc tôi" có ô riêng nên không tính.
    expect(screen.getByRole('button', { name: /^Bộ lọc/ }).textContent).toContain('1');
    fireEvent.click(clear);
    expect(clear.disabled).toBe(true);
    expect((screen.getByLabelText('Chỉ tin có đính kèm') as HTMLInputElement).checked).toBe(false);
  });

  it('lọc nhiều người gửi và nhiều công việc cùng lúc', async () => {
    mount({ members: [{ userId: 'u1', role: 'member' } as ProjectMember, { userId: 'u2', role: 'member' } as ProjectMember] });
    await waitFor(() => expect(articles()).toHaveLength(5));
    const lastFilter = () => api.loadProjectChatTimeline.mock.calls.at(-1)?.[2];
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    const pick = (field: string, list: string, optionName: string) => {
      fireEvent.focus(screen.getByLabelText(field));
      fireEvent.click(within(screen.getByRole('listbox', { name: list })).getByText(optionName));
    };
    pick('Chọn người gửi', 'Người gửi', 'An');
    pick('Chọn người gửi', 'Người gửi', 'u2');
    await waitFor(() => expect(lastFilter()).toEqual({ authors: ['u1', 'u2'] }));
    pick('Chọn công việc', 'Công việc', 'Việc A');
    pick('Chọn công việc', 'Công việc', 'Chat chung của dự án');
    await waitFor(() => expect(lastFilter()).toEqual({ authors: ['u1', 'u2'], nodes: ['wA', 'project'] }));
    // Hai nhóm trong bảng đang bật: nút ghi số 2.
    expect(screen.getByRole('button', { name: /^Bộ lọc/ }).textContent).toContain('2');
    // Bỏ một người: chỉ còn người kia.
    fireEvent.click(screen.getByLabelText('Bỏ An'));
    await waitFor(() => expect(lastFilter()).toEqual({ authors: ['u2'], nodes: ['wA', 'project'] }));
  });

  it('có chỗ trên hàng tab: công tắc và thanh lọc nằm ở đó, trong khung chỉ còn hai cột', async () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    mount({ toolbarSlot: slot });
    await waitFor(() => expect(articles()).toHaveLength(5));
    expect(within(slot).getByRole('group', { name: 'Cách xem trao đổi' })).toBeTruthy();
    expect(within(slot).getByRole('search')).toBeTruthy();
    const feedSection = screen.getByRole('region', { name: 'Dòng thời gian trao đổi' });
    expect(within(feedSection).queryByRole('search')).toBeNull();
    expect(within(feedSection).queryByRole('group', { name: 'Cách xem trao đổi' })).toBeNull();
    slot.remove();
  });

  it('chỗ trên hàng tab chưa sẵn sàng (null): chưa vẽ công tắc và thanh lọc, không rơi vào trong khung', async () => {
    mount({ toolbarSlot: null });
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Cách xem trao đổi' })).toBeNull();
  });

  it('chọn ngày bằng lịch (shadcn Date Picker): chọn "Từ ngày" thì lọc từ 0h ngày đó, ô hiện dd/mm/yyyy, "Xoá" bỏ ngày', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const lastFilter = () => api.loadProjectChatTimeline.mock.calls.at(-1)?.[2];
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ ngày' }));
    const calendar = screen.getByRole('dialog', { name: 'Từ ngày' });
    const day15 = within(calendar).getAllByRole('button').find((button) => button.textContent === '15');
    fireEvent.click(day15 as HTMLElement);
    await waitFor(() => expect(lastFilter()?.from).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/));
    expect(screen.getByRole('button', { name: 'Từ ngày' }).textContent?.trim()).toMatch(/^15[/][0-9]{2}[/][0-9]{4}$/);
    expect(screen.queryByRole('dialog', { name: 'Từ ngày' })).toBeNull();
    // Mở lại: ngày đã chọn có nút "Xoá" để bỏ.
    fireEvent.click(screen.getByRole('button', { name: 'Từ ngày' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Từ ngày' })).getByRole('button', { name: /Xoá/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Từ ngày' }).textContent).toContain('dd/mm/yyyy'));
  });

  it('tìm theo từ khoá: chờ gõ xong rồi mới gọi, tô sáng chỗ khớp, không khớp thì báo', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const calls = () => api.loadProjectChatTimeline.mock.calls.length;
    const before = calls();
    api.loadProjectChatTimeline.mockResolvedValue({
      hasMore: false,
      items: [entry('m9', 'wA', 13, {}, 'Báo giá xong rồi')],
    });
    const box = screen.getByLabelText('Tìm tin nhắn');
    fireEvent.change(box, { target: { value: 'b' } });
    fireEvent.change(box, { target: { value: 'giá' } });
    expect(calls()).toBe(before);
    await waitFor(() => expect(api.loadProjectChatTimeline.mock.calls.at(-1)?.[2]).toEqual({ q: 'giá' }));
    await waitFor(() => expect(document.querySelector('mark')?.textContent).toBe('giá'));
    api.loadProjectChatTimeline.mockResolvedValue({ hasMore: false, items: [] });
    fireEvent.change(box, { target: { value: 'không có từ này' } });
    await waitFor(() => expect(screen.getAllByText('Không có tin nào khớp bộ lọc.')).toHaveLength(2));
  });

  it('bấm dòng trích thì cuộn tới tin gốc và cho nó nháy', async () => {
    const parent = { id: 'm1', createdBy: 'u1', body: 'Báo giá xong chưa?', isDeleted: false };
    api.loadProjectChatTimeline.mockResolvedValue({
      hasMore: false,
      items: [entry('m1', 'wA', 13, {}, 'Báo giá xong chưa?'), entry('m2', 'wA', 14, { parent }, 'Xong rồi')],
    });
    mount();
    fireEvent.click(await quoteButton());
    const original = articles()[0];
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts.at(-1)).toBe(original);
    // Nháy sau khi cuộn xong, không phải ngay lúc bấm.
    await waitFor(() => expect(original.className).toMatch(/timelineFlash/));
  });

  it('tin gốc cũ hơn phần đã nạp: nạp thêm trang cũ rồi mới cuộn tới', async () => {
    const parent = { id: 'old', createdBy: 'u1', body: 'Tin rất cũ', isDeleted: false };
    api.loadProjectChatTimeline.mockImplementation(async (_project: string, before?: string) =>
      before
        ? { hasMore: false, items: [entry('old', 'wA', 8, {}, 'Tin rất cũ')] }
        : { hasMore: true, items: [entry('m2', 'wA', 14, { parent }, 'Trả lời tin cũ')] },
    );
    mount();
    fireEvent.click(await quoteButton());
    await waitFor(() => expect(articles()).toHaveLength(2));
    await waitFor(() => expect((Element.prototype.scrollIntoView as jest.Mock).mock.contexts.at(-1)).toBe(articles()[0]));
    expect(articles()[0].textContent).toContain('Tin rất cũ');
  });

  it('trả lời một tin: gọi API bằng id của tin đó (server lấy kênh từ tin), rồi tải lại dòng thời gian', async () => {
    api.replyChatMessage.mockResolvedValue({ message: { id: 'new' }, droppedMentions: [] });
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    startReply(articles()[1]);
    const box = screen.getByLabelText(/^Trả lời An · CV-B/);
    fireEvent.change(box, { target: { value: 'Đã nhận' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.replyChatMessage).toHaveBeenCalledTimes(1));
    // Chỉ truyền id tin + nội dung; không có kênh hay công việc nào do client chọn.
    expect(api.replyChatMessage).toHaveBeenCalledWith('m2', { body: 'Đã nhận', mentions: [] });
    await waitFor(() => expect(api.loadProjectChatTimeline.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByLabelText(/^Trả lời An · CV-B/)).toBeNull();
  });

  it('nút "⋯" mở menu có "Trả lời"; chọn thì menu đóng, ô trả lời mở và nút "⋯" của tin đó ẩn trong lúc trả lời', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    const first = articles()[0];
    fireEvent.click(within(first).getByRole('button', { name: 'Tuỳ chọn tin nhắn' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trả lời' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByLabelText(/^Trả lời An · CV-A/)).toBeTruthy();
    expect(within(first).queryByRole('button', { name: 'Tuỳ chọn tin nhắn' })).toBeNull();
  });

  it('Shift+Enter không gửi; Esc huỷ ô trả lời; ô trống không gửi', async () => {
    mount();
    await waitFor(() => expect(articles()).toHaveLength(5));
    startReply(articles()[0]);
    const box = screen.getByLabelText(/^Trả lời An · CV-A/);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'dòng 1' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(api.replyChatMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByLabelText(/^Trả lời An · CV-A/)).toBeNull();
  });

  it('viewer chỉ đọc: không có nút "Trả lời"', async () => {
    mount({ members: [{ userId: 'viewer1', role: 'viewer' } as ProjectMember], currentUserId: 'viewer1' });
    await waitFor(() => expect(articles()).toHaveLength(5));
    expect(screen.queryByRole('button', { name: 'Tuỳ chọn tin nhắn' })).toBeNull();
    expect(screen.queryByLabelText('Nhắn vào chat chung của dự án')).toBeNull();
  });

  it('chưa có trao đổi thì mỗi cột nói rõ', async () => {
    api.loadProjectChatTimeline.mockResolvedValue({ items: [], hasMore: false });
    mount();
    expect(await screen.findByText('Các công việc chưa có trao đổi nào.')).toBeTruthy();
    expect(screen.getByText('Chưa có trao đổi chung nào.')).toBeTruthy();
  });

  it('xem tin cũ hơn: nạp trang liền trước bằng id tin đầu danh sách', async () => {
    api.loadProjectChatTimeline.mockImplementation(async (_project: string, before?: string) =>
      before
        ? { hasMore: false, items: [entry('old', 'wA', 8)] }
        : { hasMore: true, items: [entry('m1', 'wA', 13), entry('m2', 'wB', 14)] },
    );
    mount();
    // Hai cột cùng đọc một dòng thời gian nên cả hai đều có nút; bấm nút nào cũng nạp trang liền trước.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem tin cũ hơn' }))[0]);
    await waitFor(() => expect(articles()).toHaveLength(3));
    expect(api.loadProjectChatTimeline.mock.calls[1][1]).toBe('m1');
    expect(articles()[0].textContent).toContain('Tin old');
  });
});
