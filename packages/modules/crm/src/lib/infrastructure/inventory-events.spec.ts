import { eventActorId } from './inventory-events.js';

describe('người làm của sự kiện Kho', () => {
  it('lấy actorUserId của người dùng Kho để ghi nhật ký Bán hàng', () => {
    expect(eventActorId({ actorUserId: '7F1C2B3A-1111-4222-8333-944455556666' })).toBe('7f1c2b3a-1111-4222-8333-944455556666');
  });

  it('không có người làm (job, hệ thống) hoặc giá trị lạ thì để trống', () => {
    expect(eventActorId({})).toBeNull();
    expect(eventActorId({ actorUserId: null })).toBeNull();
    expect(eventActorId({ actorUserId: 'system' })).toBeNull();
  });
});
