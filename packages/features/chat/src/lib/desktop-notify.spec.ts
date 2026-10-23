/** @jest-environment jsdom */
import { flashTitle, notifyChat, requestDesktopPermission, resetChatSettingsForTest, updateChatSettings } from './desktop-notify';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static created: FakeNotification[] = [];
  static requestPermission = jest.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.created.push(this);
  }
  close() {
    this.closed = true;
  }
}

function lookAtPage(looking: boolean) {
  jest.spyOn(document, 'hasFocus').mockReturnValue(looking);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (looking ? 'visible' : 'hidden') });
}

describe('báo tin nhắn mới', () => {
  beforeEach(() => {
    jest.useRealTimers();
    FakeNotification.created = [];
    FakeNotification.permission = 'granted';
    Object.assign(window, { Notification: FakeNotification });
    window.localStorage.clear();
    resetChatSettingsForTest({ sound: false });
    document.title = 'ERP';
  });

  afterEach(() => jest.restoreAllMocks());

  it('đang nhìn trang: báo ngay trong trang (toast), không cần quyền thông báo của trình duyệt', async () => {
    lookAtPage(true);
    FakeNotification.permission = 'denied';
    const inApp = jest.fn();
    expect(await notifyChat({ id: 'm0', title: 'An', body: 'Chào', inApp })).toBe('in-app');
    expect(inApp).toHaveBeenCalledTimes(1);
    expect(FakeNotification.created).toHaveLength(0);
  });

  it('không nhìn trang: thông báo Windows một lần cho mỗi tin, bấm vào thì mở đúng cuộc; tiêu đề tab nhấp nháy', async () => {
    lookAtPage(false);
    const onClick = jest.fn();
    const inApp = jest.fn();
    expect(await notifyChat({ id: 'm1', title: 'Nguyễn Văn An', body: 'Họp lúc 9h', onClick, inApp })).toBe('desktop');
    expect(document.title).toBe('Tin nhắn mới · Nguyễn Văn An');
    expect(await notifyChat({ id: 'm1', title: 'Nguyễn Văn An', body: 'Họp lúc 9h' })).toBe('none');
    expect(FakeNotification.created).toHaveLength(1);
    expect(inApp).not.toHaveBeenCalled();
    expect(FakeNotification.created[0]).toMatchObject({ title: 'Nguyễn Văn An', options: expect.objectContaining({ body: 'Họp lúc 9h', tag: 'ep-chat:m1' }) });
    FakeNotification.created[0].onclick?.();
    expect(onClick).toHaveBeenCalled();
    expect(FakeNotification.created[0].closed).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.title).toBe('ERP');
  });

  it('không nhìn trang mà chưa cho phép thông báo: vẫn để toast chờ sẵn trong trang', async () => {
    lookAtPage(false);
    FakeNotification.permission = 'default';
    const inApp = jest.fn();
    expect(await notifyChat({ id: 'm2', title: 'A', body: 'B', inApp })).toBe('in-app');
    updateChatSettings({ desktop: false });
    FakeNotification.permission = 'granted';
    expect(await notifyChat({ id: 'm3', title: 'A', body: 'B', inApp })).toBe('in-app');
    expect(FakeNotification.created).toHaveLength(0);
  });

  it('xin quyền và bật thông báo khi được cho phép', async () => {
    lookAtPage(false);
    updateChatSettings({ desktop: false });
    expect(await requestDesktopPermission()).toBe('granted');
    expect(await notifyChat({ id: 'm4', title: 'A', body: 'B' })).toBe('desktop');
  });

  it('tiêu đề trang đổi trong lúc nhấp nháy thì trả về tiêu đề mới', () => {
    jest.useFakeTimers();
    lookAtPage(false);
    flashTitle('Bình');
    expect(document.title).toBe('Tin nhắn mới · Bình');
    jest.advanceTimersByTime(1_500);
    expect(document.title).toBe('ERP');
    document.title = 'Trang khác';
    jest.advanceTimersByTime(1_500);
    expect(document.title).toBe('Tin nhắn mới · Bình');
    lookAtPage(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe('Trang khác');
  });
});
