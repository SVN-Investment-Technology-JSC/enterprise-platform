/*
 * Service worker của chat nội bộ: nhận thông báo đẩy (Web Push) và hiện thông báo của Windows/hệ điều hành, kể cả khi
 * người dùng đã đóng hết tab ERP (trình duyệt vẫn chạy nền).
 *
 * Đặt ở gốc trang nên phạm vi là cả hệ thống (kể cả các phân hệ dưới /modules). Không có trình xử lý `fetch`: service
 * worker này không chặn hay lưu đệm bất kỳ request nào của trang.
 */
const NOTICE_ICON = '/brand-logo.jpg';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function isLooking(client) {
  return client.focused === true && client.visibilityState === 'visible';
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let message;
      try {
        message = event.data ? event.data.json() : null;
      } catch {
        return;
      }
      if (!message || message.type !== 'chat.message' || typeof message.title !== 'string') return;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Người dùng đang nhìn một trang ERP: trang tự báo (toast trong trang), không hiện thêm thông báo hệ điều hành.
      if (windows.some(isLooking)) return;
      await self.registration.showNotification(message.title, {
        body: typeof message.body === 'string' ? message.body : '',
        icon: typeof message.icon === 'string' ? message.icon : NOTICE_ICON,
        badge: NOTICE_ICON,
        // Cùng thẻ với thông báo trang tự tạo (nếu tab còn mở ở nền): thông báo sau thay thông báo trước, không trùng.
        tag: typeof message.tag === 'string' ? message.tag : undefined,
        renotify: false,
        data: { url: message.url, conversationId: message.conversationId },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Còn tab ERP đang mở: đưa tab đó lên và bảo nó mở đúng cuộc trò chuyện; không thì mở tab mới.
      const target = windows.find(isLooking) || windows[0];
      if (target) {
        await target.focus();
        target.postMessage({ type: 'ep-chat:open', conversationId });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
