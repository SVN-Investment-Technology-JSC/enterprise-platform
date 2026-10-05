import { resolveFinalActorId } from './procedure-progress.js';

const SYSTEM = '00000000-0000-4000-8000-000000000001';
const entry = (action: string, actorId: string) => ({ action, actorId }) as never;

describe('resolveFinalActorId', () => {
  it('lấy người duyệt thật dù nhật ký hệ thống nằm trên cùng', () => {
    const instance = {
      activity: [entry('comment', SYSTEM), entry('approve', 'user-a'), entry('approve', 'user-b')],
    };
    expect(resolveFinalActorId(instance)).toBe('user-a');
  });

  it('bỏ qua bình luận của người dùng sau khi duyệt', () => {
    const instance = { activity: [entry('comment', 'user-c'), entry('reject', 'user-a')] };
    expect(resolveFinalActorId(instance)).toBe('user-a');
  });

  it('chỉ có hệ thống thì giữ actor mới nhất', () => {
    expect(resolveFinalActorId({ activity: [entry('complete', SYSTEM)] })).toBe(SYSTEM);
    expect(resolveFinalActorId({ activity: [] })).toBeUndefined();
  });
});
