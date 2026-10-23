import {
  CHAT_REACTIONS,
  chatNotificationLink,
  directChatKey,
  initialsOf,
  isChatAllowedType,
  isChatImageType,
  isChatReaction,
  isAllowedPushEndpoint,
  isCoreChatChange,
  userAvatarUrl,
} from './contracts-chat.js';

describe('contracts-chat', () => {
  it('khoá chat 1-1 không phụ thuộc thứ tự hai người và không phân biệt hoa thường', () => {
    const a = '0F0E9C1A-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    expect(directChatKey(a, b)).toBe(directChatKey(b, a));
    expect(directChatKey(a, b)).toBe('00000000-0000-4000-8000-000000000002:0f0e9c1a-0000-4000-8000-000000000001');
  });

  it('chữ viết tắt lấy chữ đầu của họ và tên cuối', () => {
    expect(initialsOf('Nguyễn Văn An')).toBe('NA');
    expect(initialsOf('  Thọ ')).toBe('TH');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });

  it('URL ảnh đại diện mang phiên bản để trình duyệt cache được', () => {
    expect(userAvatarUrl('u 1', 3)).toBe('/api/platform/v1/users/u%201/avatar?v=3');
    expect(chatNotificationLink('c/1')).toBe('/chat/c%2F1');
  });

  it('nhận biết loại tệp, cảm xúc và loại thay đổi hợp lệ', () => {
    expect(isChatImageType('IMAGE/PNG')).toBe(true);
    expect(isChatImageType('application/pdf')).toBe(false);
    expect(isChatAllowedType('application/pdf')).toBe(true);
    expect(isChatAllowedType('application/x-msdownload')).toBe(false);
    for (const reaction of CHAT_REACTIONS) expect(isChatReaction(reaction)).toBe(true);
    expect(isChatReaction('party')).toBe(false);
    expect(isCoreChatChange('message.created')).toBe(true);
    expect(isCoreChatChange('message.pinned')).toBe(false);
  });

  it('chỉ nhận endpoint push của máy chủ push chính thức (chặn gọi vào mạng nội bộ)', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-sg2p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://minio:9000/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.test/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
  });
});
