import type { SocialComment, SocialCommentPage } from '@enterprise-platform/contracts-social';
import { COMMENT_REFRESH_MAX_PAGES, findFreshComment, type LoadCommentPage } from './comment-refresh';

const comment = (id: string) => ({ id }) as SocialComment;

describe('findFreshComment', () => {
  it('thấy ở trang đầu thì chỉ gọi một lần', async () => {
    const load = jest.fn<ReturnType<LoadCommentPage>, Parameters<LoadCommentPage>>(() =>
      Promise.resolve({ items: [comment('a'), comment('b')], nextCursor: 'c1' } as SocialCommentPage),
    );
    await expect(findFreshComment(load, 'p1', 'b')).resolves.toEqual(comment('b'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('p1', {});
  });

  it('bình luận ở trang sau thì đi theo nextCursor; trả lời thì kèm parentId', async () => {
    const pages: Record<string, SocialCommentPage> = {
      first: { items: [comment('a')], nextCursor: 'c1' },
      c1: { items: [comment('b')], nextCursor: 'c2' },
      c2: { items: [comment('target')] },
    };
    const load = jest.fn<ReturnType<LoadCommentPage>, Parameters<LoadCommentPage>>((_post, options) => Promise.resolve(pages[options.cursor ?? 'first']));
    await expect(findFreshComment(load, 'p1', 'target', 'root')).resolves.toEqual(comment('target'));
    expect(load.mock.calls.map(([, options]) => options)).toEqual([
      { parentId: 'root' },
      { parentId: 'root', cursor: 'c1' },
      { parentId: 'root', cursor: 'c2' },
    ]);
  });

  it('hết trang mà không thấy thì trả undefined', async () => {
    const load = jest.fn<ReturnType<LoadCommentPage>, Parameters<LoadCommentPage>>(() => Promise.resolve({ items: [comment('a')] }));
    await expect(findFreshComment(load, 'p1', 'zzz')).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('dừng ở số trang tối đa', async () => {
    const load = jest.fn<ReturnType<LoadCommentPage>, Parameters<LoadCommentPage>>(() => Promise.resolve({ items: [comment('a')], nextCursor: 'more' }));
    await expect(findFreshComment(load, 'p1', 'zzz')).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(COMMENT_REFRESH_MAX_PAGES);
  });
});
