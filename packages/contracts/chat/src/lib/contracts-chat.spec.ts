import {
  CHAT_REACTIONS,
  chatNotificationLink,
  directChatKey,
  initialsOf,
  isChatAllowedType,
  isChatImageType,
  isChatReaction,
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
});
