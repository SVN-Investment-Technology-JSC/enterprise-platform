import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../src/app/assistant/form/page';

// Tin nhắn giữa card trong khung chat và trang form nhúng (`ASSISTANT_MESSAGE` của contracts-assistant).
const ACTION = 'savina-assistant:action';
const RESULT = 'savina-assistant:result';
const FORM_READY = 'savina-assistant:form-ready';
const KEY = 'workspace.standalone-task.create';

interface Message {
  readonly type: string;
  readonly [field: string]: unknown;
}

const CAPABILITIES = {
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: false,
  canDeleteDocuments: false,
};

const person = (userId: string, displayName: string) => ({
  userId,
  displayName,
  unitNames: [],
  orgNodeIds: [],
});

describe('Trang form nhúng của Trợ lý', () => {
  const originalFetch = global.fetch;
  /** Khung chat chứa card: trang form nhúng chỉ nói chuyện với nó. */
  const chat = { postMessage: jest.fn() };
  let createdBody: Record<string, unknown> | undefined;

  beforeAll(() => {
    Object.defineProperty(window, 'parent', { configurable: true, value: chat });
    // Ô chọn ngày của antd cần matchMedia; host đo chiều cao bằng ResizeObserver. jsdom chưa có hai thứ này.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    chat.postMessage.mockReset();
  });

  function open(status: Record<string, unknown> = {}) {
    window.history.replaceState(null, '', `/assistant/form?key=${KEY}&rid=r1`);
    createdBody = undefined;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      let body: unknown;
      if (path === '/api/auth/v1/me') body = { userId: 'u-me' };
      else if (path === '/api/workspace/v1/status')
        body = {
          tenantId: 't1',
          schemaExists: true,
          tablesReady: true,
          capabilities: CAPABILITIES,
          ...status,
        };
      else if (path === '/api/workspace/v1/directory')
        body = { people: [person('u-me', 'Nguyễn An'), person('u-binh', 'Trần Bình')] };
      else if (path === '/api/workspace/v1/standalone-tasks' && init?.method === 'POST') {
        createdBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        body = { task: { id: 't-1', code: 'CV-1', title: createdBody['title'] } };
      }
      return (
        body === undefined
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => body }
      ) as Response;
    }) as typeof fetch;
    render(<Page />);
  }

  /** Card gửi bản nháp (lần đầu, hoặc sửa tiếp cùng requestId). */
  function sendDraft(draft: Record<string, unknown>) {
    const event = new MessageEvent('message', {
      data: { type: ACTION, key: KEY, requestId: 'r1', draft },
      origin: window.location.origin,
    });
    Object.defineProperty(event, 'source', { value: chat });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  const posted = (type: string): Message[] =>
    chat.postMessage.mock.calls
      .map(([message]) => message as Message)
      .filter((message) => message.type === type);

  it('dựng form ngay trong trang, điền sẵn bản nháp, lưu xong báo kết quả cho card', async () => {
    open();
    expect(posted(FORM_READY)).toEqual([{ type: FORM_READY, requestId: 'r1' }]);
    // Bản nháp đến khi trang còn đang tải người dùng và trạng thái: được giữ lại rồi giao cho form.
    sendDraft({ title: 'Soạn báo giá', dueDate: '2026-10-31' });

    const card = await screen.findByRole('region', { name: 'Giao việc' });
    const title = screen.getByDisplayValue('Soạn báo giá');
    expect(card.contains(title)).toBe(true);
    // Không phải hộp thoại nổi: không lớp phủ, không nút X, không giành con trỏ khỏi ô chat.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    expect(document.activeElement).not.toBe(title);

    fireEvent.click(screen.getByRole('button', { name: 'Giao việc' }));

    await waitFor(() =>
      expect(posted(RESULT)).toEqual([
        {
          type: RESULT,
          requestId: 'r1',
          key: KEY,
          outcome: 'saved',
          id: 't-1',
          label: 'CV-1 · Soạn báo giá',
          href: '/modules/workspace#tasks/t-1',
        },
      ]),
    );
    // Không nói người phụ trách thì là chính người dùng, như khi tự mở form.
    expect(createdBody).toMatchObject({
      title: 'Soạn báo giá',
      assigneeUserId: 'u-me',
      dueDate: '2026-10-31',
    });
    expect(screen.queryByRole('region', { name: 'Giao việc' })).toBeNull();
  });

  it('đánh dấu cả trang để lịch antd co theo bề ngang card; rời trang thì bỏ', () => {
    open();
    expect(document.documentElement.classList.contains('embedded')).toBe(true);
    cleanup();
    expect(document.documentElement.classList.contains('embedded')).toBe(false);
  });

  it('bản nháp sửa tiếp chỉ đổi ô có trong đó, giữ ô người dùng đã sửa', async () => {
    open();
    sendDraft({ title: 'Soạn báo giá' });
    const title = await screen.findByDisplayValue('Soạn báo giá');
    fireEvent.change(title, { target: { value: 'Soạn báo giá khách A' } });

    sendDraft({ priority: 'urgent' });

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Mức ưu tiên' }).getAttribute('title')).toBe(
        'Khẩn cấp',
      ),
    );
    expect(screen.getByDisplayValue('Soạn báo giá khách A')).toBeTruthy();
  });

  it('nút Huỷ báo cancelled', async () => {
    open();
    sendDraft({ title: 'Soạn báo giá' });
    await screen.findByRole('region', { name: 'Giao việc' });

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(posted(RESULT)).toEqual([
      { type: RESULT, requestId: 'r1', key: KEY, outcome: 'cancelled' },
    ]);
    expect(screen.queryByRole('region', { name: 'Giao việc' })).toBeNull();
  });

  it('chưa tạo được gì thì báo unavailable, không mở form', async () => {
    open({ capabilities: { ...CAPABILITIES, canWriteTasks: false } });
    sendDraft({ title: 'Soạn báo giá' });

    await waitFor(() =>
      expect(posted(RESULT)).toEqual([
        {
          type: RESULT,
          requestId: 'r1',
          key: KEY,
          outcome: 'unavailable',
          message: 'Bạn không có quyền ghi dự án và công việc.',
        },
      ]),
    );
    expect(screen.queryByRole('region', { name: 'Giao việc' })).toBeNull();
  });
});
