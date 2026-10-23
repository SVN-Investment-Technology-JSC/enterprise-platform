/** @jest-environment jsdom */
import { notifyChat, requestDesktopPermission, resetChatSettingsForTest, updateChatSettings } from './desktop-notify';

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

describe('thông báo Windows', () => {
  beforeEach(() => {
    FakeNotification.created = [];
    FakeNotification.permission = 'granted';
    Object.assign(window, { Notification: FakeNotification });
    window.localStorage.clear();
    resetChatSettingsForTest({ sound: false });
  });

  it('hiện thông báo của hệ điều hành một lần cho mỗi tin, bấm vào thì mở đúng cuộc', async () => {
    const onClick = jest.fn();
    expect(await notifyChat({ id: 'm1', title: 'Nguyễn Văn An', body: 'Họp lúc 9h', onClick })).toBe(true);
    expect(await notifyChat({ id: 'm1', title: 'Nguyễn Văn An', body: 'Họp lúc 9h' })).toBe(false);
    expect(FakeNotification.created).toHaveLength(1);
    expect(FakeNotification.created[0]).toMatchObject({ title: 'Nguyễn Văn An', options: expect.objectContaining({ body: 'Họp lúc 9h', tag: 'ep-chat:m1' }) });
    FakeNotification.created[0].onclick?.();
    expect(onClick).toHaveBeenCalled();
    expect(FakeNotification.created[0].closed).toBe(true);
  });

  it('không hiện khi người dùng tắt hoặc trình duyệt chưa cho phép', async () => {
    updateChatSettings({ desktop: false });
    expect(await notifyChat({ id: 'm2', title: 'A', body: 'B' })).toBe(false);
    updateChatSettings({ desktop: true });
    FakeNotification.permission = 'denied';
    expect(await notifyChat({ id: 'm3', title: 'A', body: 'B' })).toBe(false);
    expect(FakeNotification.created).toHaveLength(0);
  });

  it('xin quyền và bật thông báo khi được cho phép', async () => {
    updateChatSettings({ desktop: false });
    FakeNotification.permission = 'granted';
    expect(await requestDesktopPermission()).toBe('granted');
    expect(await notifyChat({ id: 'm4', title: 'A', body: 'B' })).toBe(true);
  });
});
