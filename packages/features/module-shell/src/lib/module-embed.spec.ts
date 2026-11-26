/**
 * @jest-environment jsdom
 */
import {
  MODULE_EMBED_MESSAGE,
  forwardEscapeToHost,
  isInsideFrame,
  isModuleEmbedMessage,
  listenModuleEmbed,
  postModuleEmbedMessage,
  postModuleEmbedSummary,
} from './module-embed';

describe('isModuleEmbedMessage', () => {
  it('nhận đúng hai loại tin và từ chối mọi thứ khác', () => {
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.changed })).toBe(true);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.close })).toBe(true);
    expect(isModuleEmbedMessage({ type: 'khac' })).toBe(false);
    expect(isModuleEmbedMessage({})).toBe(false);
    expect(isModuleEmbedMessage('savina-embed:changed')).toBe(false);
    expect(isModuleEmbedMessage(null)).toBe(false);
    expect(isModuleEmbedMessage([MODULE_EMBED_MESSAGE.close])).toBe(false);
  });
});

describe('tin tóm tắt (summary)', () => {
  it('nhận tin có mã, ghi chú ngắn và tối đa 4 nhãn đúng màu', () => {
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary })).toBe(true);
    expect(
      isModuleEmbedMessage({
        type: MODULE_EMBED_MESSAGE.summary,
        code: 'PC-2611-0006',
        note: 'Mã nháp: NHAP_PC_2611_0021',
        badges: [{ label: 'Đã duyệt', tone: 'success' }],
      }),
    ).toBe(true);
  });

  it('từ chối chữ quá dài, quá 4 nhãn, màu lạ, nhãn rỗng hay sai kiểu', () => {
    const badge = { label: 'Nháp', tone: 'neutral' };
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, code: 'x'.repeat(121) })).toBe(false);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, note: 5 })).toBe(false);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, badges: Array(5).fill(badge) })).toBe(false);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, badges: [{ label: 'A', tone: 'tim' }] })).toBe(false);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, badges: [{ label: '', tone: 'info' }] })).toBe(false);
    expect(isModuleEmbedMessage({ type: MODULE_EMBED_MESSAGE.summary, badges: 'Nháp' })).toBe(false);
  });

  it('gửi lên cửa sổ cha cùng tên miền, và không gửi gì khi không nằm trong iframe', () => {
    postModuleEmbedSummary({ code: 'A' });
    const parent = { postMessage: jest.fn() };
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    try {
      postModuleEmbedSummary({ code: 'PC-1', badges: [{ label: 'Nháp', tone: 'neutral' }] });
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: MODULE_EMBED_MESSAGE.summary, code: 'PC-1', badges: [{ label: 'Nháp', tone: 'neutral' }] },
        window.location.origin,
      );
    } finally {
      if (original) Object.defineProperty(window, 'parent', original);
    }
  });
});

describe('postModuleEmbedMessage', () => {
  it('không gửi gì khi trang đang là cửa sổ ngoài cùng', () => {
    const spy = jest.spyOn(window, 'postMessage');
    expect(isInsideFrame()).toBe(false);
    postModuleEmbedMessage('savina-embed:changed');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('gửi lên cửa sổ cha, chỉ cho đúng tên miền của mình, khi nằm trong iframe', () => {
    const parent = { postMessage: jest.fn() };
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    try {
      expect(isInsideFrame()).toBe(true);
      postModuleEmbedMessage(MODULE_EMBED_MESSAGE.changed);
      expect(parent.postMessage).toHaveBeenCalledWith({ type: MODULE_EMBED_MESSAGE.changed }, window.location.origin);
    } finally {
      if (original) Object.defineProperty(window, 'parent', original);
    }
  });
});

describe('listenModuleEmbed', () => {
  function dispatch(init: { data: unknown; origin?: string; source?: unknown }) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: init.data,
        origin: init.origin ?? window.location.origin,
        source: (init.source ?? null) as MessageEventSource | null,
      }),
    );
  }

  it('chỉ nhận tin hợp lệ từ đúng cửa sổ con, cùng tên miền', () => {
    const frameWindow = window;
    const other = {} as Window;
    const onMessage = jest.fn();
    const stop = listenModuleEmbed(() => frameWindow, onMessage);

    dispatch({ data: { type: MODULE_EMBED_MESSAGE.changed }, source: frameWindow });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: MODULE_EMBED_MESSAGE.changed });

    dispatch({ data: { type: MODULE_EMBED_MESSAGE.changed }, origin: 'https://evil.example', source: frameWindow });
    dispatch({ data: { type: MODULE_EMBED_MESSAGE.changed }, source: other });
    dispatch({ data: { type: 'khong-hop-le' }, source: frameWindow });
    expect(onMessage).toHaveBeenCalledTimes(1);

    stop();
    dispatch({ data: { type: MODULE_EMBED_MESSAGE.close }, source: frameWindow });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('không nhận gì khi chưa có iframe', () => {
    const onMessage = jest.fn();
    const stop = listenModuleEmbed(() => null, onMessage);
    dispatch({ data: { type: MODULE_EMBED_MESSAGE.changed }, source: window });
    expect(onMessage).not.toHaveBeenCalled();
    stop();
  });
});

describe('forwardEscapeToHost', () => {
  function inFrame<T>(run: (parent: { postMessage: jest.Mock }) => T): T {
    const parent = { postMessage: jest.fn() };
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    try {
      return run(parent);
    } finally {
      if (original) Object.defineProperty(window, 'parent', original);
      document.body.innerHTML = '';
    }
  }
  const escape = (over: Partial<{ key: string; defaultPrevented: boolean }> = {}) => ({
    key: 'Escape',
    defaultPrevented: false,
    target: null,
    ...over,
  });

  it('Esc không có lớp phủ nào mở thì xin bên chủ đóng popup', () => {
    inFrame((parent) => {
      expect(forwardEscapeToHost(escape())).toBe(true);
      expect(parent.postMessage).toHaveBeenCalledWith({ type: MODULE_EMBED_MESSAGE.close }, window.location.origin);
    });
  });

  it('còn lớp phủ đang mở (danh sách chọn, hộp xác nhận…) thì Esc dành cho lớp phủ, không đóng popup', () => {
    for (const markup of ['<ul role="listbox"></ul>', '<div role="dialog"></div>', '<button aria-expanded="true"></button>']) {
      document.body.innerHTML = markup;
      inFrame((parent) => {
        expect(forwardEscapeToHost(escape())).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();
      });
    }
  });

  it('phím khác, phím đã có người xử lý, hoặc trang không nằm trong iframe thì không làm gì', () => {
    inFrame((parent) => {
      expect(forwardEscapeToHost(escape({ key: 'Enter' }))).toBe(false);
      expect(forwardEscapeToHost(escape({ defaultPrevented: true }))).toBe(false);
      expect(parent.postMessage).not.toHaveBeenCalled();
    });
    expect(forwardEscapeToHost(escape())).toBe(false);
  });
});
