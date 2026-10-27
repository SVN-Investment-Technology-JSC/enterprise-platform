import type { SocialInboxCounts, SocialPost, SocialUserRef } from '@enterprise-platform/contracts-social';
import {
  routePageKey,
  activeMentionQuery,
  buildFeedQuery,
  buildFeedRequestPath,
  buildSocialHash,
  buildSocialPath,
  isLegacySocialHash,
  parseSocialPath,
  socialHref,
  parseSocialRoute,
  plainExcerpt,
  postHeadline,
  tabForRoute,
  visibleTabs,
  decodeMentions,
  encodeMentions,
  formatRelativeTime,
  initials,
  isEmptyHtml,
  orderMyGroups,
  mergePages,
  normalizeLink,
  parsePostLink,
  parseCommentBody,
  replacePost,
  validateAttachment,
} from './social.model';

const NOW = new Date('2026-05-20T10:00:00').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelativeTime', () => {
  it('đổi khoảng cách thời gian thành chữ tiếng Việt', () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('Vừa xong');
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 phút trước');
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe('3 giờ trước');
    expect(formatRelativeTime(ago(2 * 86_400_000), NOW)).toBe('2 ngày trước');
  });

  it('từ 7 ngày trở đi hiện ngày tháng', () => {
    expect(formatRelativeTime(ago(10 * 86_400_000), NOW)).toBe('10/05/2026');
  });

  it('thời gian sai thì trả về chuỗi rỗng', () => {
    expect(formatRelativeTime('không phải ngày', NOW)).toBe('');
  });
});

describe('buildFeedQuery', () => {
  it('bỏ giá trị rỗng', () => {
    expect(buildFeedQuery({})).toBe('');
    expect(buildFeedQuery({ topicId: 't1', kind: 'announcement', limit: 20, cursor: 'abc' })).toBe(
      '?limit=20&cursor=abc&topicId=t1&kind=announcement',
    );
  });
});

describe('mergePages', () => {
  it('nối trang mới và bỏ id trùng', () => {
    const merged = mergePages([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('không đổi tham chiếu khi không có gì mới', () => {
    const existing = [{ id: 'a' }];
    expect(mergePages(existing, [{ id: 'a' }])).toBe(existing);
  });
});

describe('replacePost', () => {
  const post = (id: string, title: string) => ({ id, title }) as unknown as SocialPost;

  it('thay đúng bài theo id', () => {
    const next = replacePost([post('a', 'cũ'), post('b', 'b')], post('a', 'mới'));
    expect(next.map((item) => item.title)).toEqual(['mới', 'b']);
  });

  it('không có bài đó thì giữ nguyên', () => {
    const list = [post('a', 'a')];
    expect(replacePost(list, post('z', 'z'))).toBe(list);
  });
});

describe('validateAttachment', () => {
  it('nhận tệp hợp lệ', () => {
    expect(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, 0)).toBeUndefined();
  });

  it('chặn định dạng lạ, tệp quá lớn và quá số lượng', () => {
    expect(validateAttachment({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }, 0)).toContain('Không nhận');
    expect(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 51 * 1024 * 1024 }, 0)).toContain('vượt quá');
    expect(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 10 }, 10)).toContain('tối đa');
  });
});

describe('isEmptyHtml', () => {
  it('nhận ra nội dung trống', () => {
    expect(isEmptyHtml('')).toBe(true);
    expect(isEmptyHtml('<p><br></p>')).toBe(true);
    expect(isEmptyHtml('<p>&nbsp; </p>')).toBe(true);
    expect(isEmptyHtml('<p>Xin chào</p>')).toBe(false);
  });
});

describe('normalizeLink', () => {
  it('thêm https và chặn scheme nguy hiểm', () => {
    expect(normalizeLink('savina.vn')).toBe('https://savina.vn');
    expect(normalizeLink('http://a.vn/x')).toBe('http://a.vn/x');
    expect(normalizeLink('javascript:alert(1)')).toBeUndefined();
    expect(normalizeLink('  ')).toBeUndefined();
  });
});

describe('mention', () => {
  const an: SocialUserRef = { id: 'u1', name: 'Nguyễn Văn An' };
  const van: SocialUserRef = { id: 'u2', name: 'Nguyễn Văn' };

  it('mã hoá ưu tiên tên dài và chỉ giữ người còn xuất hiện', () => {
    const encoded = encodeMentions('Chào @Nguyễn Văn An và @Nguyễn Văn', [van, an, { id: 'u3', name: 'Lê' }]);
    expect(encoded.body).toBe('Chào @[u1] và @[u2]');
    expect(encoded.userIds).toEqual(['u1', 'u2']);
  });

  it('giải mã để sửa và tách phần hiển thị', () => {
    const decoded = decodeMentions('Chào @[u1], xem giúp', [an]);
    expect(decoded.text).toBe('Chào @Nguyễn Văn An, xem giúp');
    expect(decoded.picks).toEqual([{ id: 'u1', name: 'Nguyễn Văn An' }]);
    expect(parseCommentBody('Chào @[u1], xem giúp @[zz]', [an])).toEqual([
      { type: 'text', text: 'Chào ' },
      { type: 'mention', userId: 'u1', name: 'Nguyễn Văn An' },
      { type: 'text', text: ', xem giúp @[zz]' },
    ]);
  });

  it('nhận ra từ khoá @ đang gõ', () => {
    expect(activeMentionQuery('Chào @an', 8)).toEqual({ query: 'an', start: 5 });
    expect(activeMentionQuery('mail@an', 7)).toBeUndefined();
    expect(activeMentionQuery('không có', 3)).toBeUndefined();
  });
});

describe('initials', () => {
  it('lấy chữ đầu của từ đầu và từ cuối', () => {
    expect(initials('Nguyễn Văn An')).toBe('NA');
    expect(initials('An')).toBe('A');
    expect(initials('  ')).toBe('?');
  });
});

describe('parsePostLink', () => {
  it('đọc liên kết bài và bình luận', () => {
    expect(parsePostLink('#posts/p1')).toEqual({ postId: 'p1', commentId: undefined });
    expect(parsePostLink('#posts/p1/comment/c9')).toEqual({ postId: 'p1', commentId: 'c9' });
    expect(parsePostLink('/modules/social/posts/p1/comments/c9')).toEqual({ postId: 'p1', commentId: 'c9' });
    expect(parsePostLink('/posts/p1')).toEqual({ postId: 'p1', commentId: undefined });
  });

  it('bỏ qua hash khác', () => {
    expect(parsePostLink('#feed/t1')).toBeUndefined();
    expect(parsePostLink('')).toBeUndefined();
  });
});

describe('buildFeedQuery (P2)', () => {
  it('thêm scope và groupId, bỏ scope khi có groupId', () => {
    expect(buildFeedQuery({ limit: 20, scope: 'all', topicId: 't1' })).toBe('?limit=20&topicId=t1&scope=all');
    expect(buildFeedQuery({ groupId: 'g1', scope: 'wall' })).toBe('?groupId=g1');
    expect(buildFeedQuery({})).toBe('');
  });
});

describe('buildFeedRequestPath', () => {
  const page = { limit: 20 };

  it('mặc định Tường công ty; có authorId thì scope all', () => {
    expect(buildFeedRequestPath({}, page)).toBe('/feed?limit=20&scope=wall');
    expect(buildFeedRequestPath({ authorId: 'u1' }, page)).toBe('/feed?limit=20&authorId=u1&scope=all');
  });

  it('bảng tin dùng source all, nhóm dùng groupId', () => {
    expect(buildFeedRequestPath({ source: 'all', kind: 'announcement' }, { ...page, cursor: 'c' })).toBe(
      '/feed?limit=20&cursor=c&kind=announcement&scope=all',
    );
    expect(buildFeedRequestPath({ groupId: 'g1', topicId: 't' }, page)).toBe('/feed?limit=20&topicId=t&groupId=g1');
  });

  it('đã lưu gọi /bookmarks và bỏ bộ lọc', () => {
    expect(buildFeedRequestPath({ bookmarked: true, topicId: 't' }, { limit: 10, cursor: 'x' })).toBe(
      '/bookmarks?limit=10&cursor=x',
    );
  });
});

describe('parseSocialRoute', () => {
  it('mặc định về bảng tin', () => {
    expect(parseSocialRoute('')).toEqual({ name: 'feed', topicId: undefined });
    expect(parseSocialRoute('#lung-tung')).toEqual({ name: 'feed', topicId: undefined });
  });

  it('đọc bảng tin, tường và chuyên mục', () => {
    expect(parseSocialRoute('#feed/t1')).toEqual({ name: 'feed', topicId: 't1' });
    expect(parseSocialRoute('#wall')).toEqual({ name: 'wall', topicId: undefined, announcementsOnly: false });
    expect(parseSocialRoute('#wall/t1')).toEqual({ name: 'wall', topicId: 't1', announcementsOnly: false });
    expect(parseSocialRoute('#wall/announcements')).toEqual({ name: 'wall', announcementsOnly: true });
  });

  it('đọc nhóm, hồ sơ, tìm kiếm', () => {
    expect(parseSocialRoute('#groups')).toEqual({ name: 'groups' });
    expect(parseSocialRoute('#groups/g1')).toEqual({ name: 'group', groupId: 'g1', section: undefined });
    expect(parseSocialRoute('#groups/g1/requests')).toEqual({ name: 'group', groupId: 'g1', section: 'requests' });
    expect(parseSocialRoute('#profile/u1')).toEqual({ name: 'profile', userId: 'u1' });
    expect(parseSocialRoute('#people/u1')).toEqual({ name: 'profile', userId: 'u1' });
    expect(parseSocialRoute('#profile')).toEqual({ name: 'feed' });
    expect(parseSocialRoute('#search?q=h%E1%BB%8Dp%20nh%C3%B3m')).toEqual({ name: 'search', query: 'họp nhóm' });
    expect(parseSocialRoute('#search/abc')).toEqual({ name: 'search', query: 'abc' });
    expect(parseSocialRoute('#search')).toEqual({ name: 'search', query: '' });
  });

  it('đọc thư viện và kiểm duyệt, kể cả tên gợi ý khác', () => {
    expect(parseSocialRoute('#saved')).toEqual({ name: 'saved' });
    expect(parseSocialRoute('#pending')).toEqual({ name: 'pending' });
    expect(parseSocialRoute('#moderation')).toEqual({ name: 'pending' });
    expect(parseSocialRoute('#scheduled')).toEqual({ name: 'scheduled' });
    expect(parseSocialRoute('#my-posts/scheduled')).toEqual({ name: 'scheduled' });
    expect(parseSocialRoute('#my-posts/rejected')).toEqual({ name: 'pending' });
  });

  it('giữ liên kết bài và bình luận từ thông báo', () => {
    expect(parseSocialRoute('#posts/p1')).toEqual({ name: 'post', postId: 'p1', commentId: undefined });
    expect(parseSocialRoute('#posts/p1/comment/c9')).toEqual({ name: 'post', postId: 'p1', commentId: 'c9' });
    expect(parseSocialRoute('#posts')).toEqual({ name: 'feed' });
  });

  it('không vỡ với mã hoá hỏng', () => {
    expect(parseSocialRoute('#profile/%E0%A4%A')).toEqual({ name: 'profile', userId: '%E0%A4%A' });
  });
});

describe('parseSocialPath', () => {
  it('đọc từng đường dẫn, có hoặc không có basePath', () => {
    expect(parseSocialPath('/')).toEqual({ name: 'feed', topicId: undefined });
    expect(parseSocialPath('/modules/social')).toEqual({ name: 'feed', topicId: undefined });
    expect(parseSocialPath('/modules/social/')).toEqual({ name: 'feed', topicId: undefined });
    expect(parseSocialPath('/wall')).toEqual({ name: 'wall', topicId: undefined, announcementsOnly: false });
    expect(parseSocialPath('/modules/social/wall/announcements')).toEqual({ name: 'wall', announcementsOnly: true });
    expect(parseSocialPath('/groups')).toEqual({ name: 'groups' });
    expect(parseSocialPath('/modules/social/groups/g1')).toEqual({ name: 'group', groupId: 'g1', section: undefined });
    for (const section of ['members', 'requests', 'announcements', 'topics']) {
      expect(parseSocialPath(`/groups/g1/${section}`)).toEqual({ name: 'group', groupId: 'g1', section });
    }
    expect(parseSocialPath('/saved')).toEqual({ name: 'saved' });
    expect(parseSocialPath('/pending')).toEqual({ name: 'pending' });
    expect(parseSocialPath('/scheduled')).toEqual({ name: 'scheduled' });
    expect(parseSocialPath('/profile/u1')).toEqual({ name: 'profile', userId: 'u1' });
    expect(parseSocialPath('/birthday')).toEqual({ name: 'birthday' });
    expect(parseSocialPath('/posts/p1')).toEqual({ name: 'post', postId: 'p1', commentId: undefined });
    expect(parseSocialPath('/posts/p1/comments/c9')).toEqual({ name: 'post', postId: 'p1', commentId: 'c9' });
  });

  it('đọc tìm kiếm từ chuỗi truy vấn', () => {
    expect(parseSocialPath('/search', '?q=h%E1%BB%8Dp%20nh%C3%B3m')).toEqual({ name: 'search', query: 'họp nhóm' });
    expect(parseSocialPath('/modules/social/search', 'q=abc')).toEqual({ name: 'search', query: 'abc' });
    expect(parseSocialPath('/search')).toEqual({ name: 'search', query: '' });
  });

  it('đường dẫn lạ hoặc thiếu id về bảng tin', () => {
    expect(parseSocialPath('/lung-tung').name).toBe('feed');
    expect(parseSocialPath('/posts').name).toBe('feed');
    expect(parseSocialPath('/profile').name).toBe('feed');
  });
});

describe('buildSocialPath và socialHref', () => {
  it('đi và về giữ nguyên tuyến', () => {
    const paths = [
      '/',
      '/feed/t1',
      '/wall',
      '/wall/t1',
      '/wall/announcements',
      '/groups',
      '/groups/g1',
      '/groups/g1/requests',
      '/saved',
      '/pending',
      '/scheduled',
      '/profile/u1',
      '/search?q=h%E1%BB%8Dp',
      '/posts/p1',
      '/posts/p1/comments/c9',
      '/birthday',
    ];
    for (const path of paths) {
      const [pathname, query = ''] = path.split('?');
      expect(buildSocialPath(parseSocialPath(pathname ?? '', query))).toBe(path);
    }
  });

  it('socialHref có basePath; gốc không có dấu / thừa', () => {
    expect(socialHref({ name: 'feed' })).toBe('/modules/social');
    expect(socialHref({ name: 'group', groupId: 'a b' })).toBe('/modules/social/groups/a%20b');
    expect(buildSocialHash({ name: 'saved' })).toBe('/modules/social/saved');
  });
});

describe('liên kết hash cũ', () => {
  it('nhận ra hash cũ cần chuyển, bỏ qua neo lạ', () => {
    expect(isLegacySocialHash('#posts/p1')).toBe(true);
    expect(isLegacySocialHash('#feed')).toBe(true);
    expect(isLegacySocialHash('#search?q=ab')).toBe(true);
    expect(isLegacySocialHash('#/modules/social/groups/g1')).toBe(true);
    expect(isLegacySocialHash('')).toBe(false);
    expect(isLegacySocialHash('#')).toBe(false);
    expect(isLegacySocialHash('#main')).toBe(false);
  });

  it('hash đổi sang đường dẫn mới', () => {
    const toPath = (hash: string) => buildSocialPath(parseSocialRoute(hash));
    expect(toPath('#posts/p1/comment/c9')).toBe('/posts/p1/comments/c9');
    expect(toPath('#groups/g1/requests')).toBe('/groups/g1/requests');
    expect(toPath('#profile/u1')).toBe('/profile/u1');
    expect(toPath('#people/u1')).toBe('/profile/u1');
    expect(toPath('#search?q=ab')).toBe('/search?q=ab');
    expect(toPath('#feed')).toBe('/');
    expect(toPath('#/modules/social/groups/g1')).toBe('/groups/g1');
  });
});

describe('visibleTabs', () => {
  const counts = (patch: Partial<SocialInboxCounts>): SocialInboxCounts => ({
    myPending: 0,
    myScheduled: 0,
    myRejected: 0,
    toModerate: 0,
    bookmarks: 0,
    ...patch,
  });
  const ids = (tabs: ReturnType<typeof visibleTabs>) => tabs.map((tab) => tab.id);

  it('người thường thấy Bảng tin, Tường công ty, Nhóm và Hẹn giờ (không có Đã lưu)', () => {
    expect(ids(visibleTabs(['social.read', 'social.post.write'], counts({})))).toEqual([
      'feed',
      'wall',
      'groups',
      'scheduled',
    ]);
    expect(ids(visibleTabs([], undefined))).toEqual(['feed', 'wall', 'groups', 'scheduled']);
  });

  it('thứ tự và nhãn: Bảng tin, Tường công ty, Bài viết chờ duyệt, Nhóm thảo luận, Bài viết hẹn giờ', () => {
    const tabs = visibleTabs(['social.post.moderate'], counts({}));
    expect(tabs.map((tab) => tab.label)).toEqual([
      'Bảng tin',
      'Tường công ty',
      'Bài viết chờ duyệt',
      'Nhóm, thảo luận',
      'Bài viết hẹn giờ',
    ]);
  });

  it('moderator luôn thấy Chờ duyệt, kèm số bài cần duyệt', () => {
    const tabs = visibleTabs(['social.post.moderate'], counts({ toModerate: 3, myPending: 1 }));
    expect(tabs.find((tab) => tab.id === 'pending')?.badge).toBe(4);
    expect(ids(visibleTabs(['social.post.moderate'], undefined))).toContain('pending');
  });

  it('tác giả có bài chờ duyệt hoặc bị từ chối thấy Chờ duyệt; Hẹn giờ mang số bài đang hẹn', () => {
    expect(ids(visibleTabs([], counts({ myRejected: 1 })))).toContain('pending');
    expect(visibleTabs([], counts({ myScheduled: 2 })).find((tab) => tab.id === 'scheduled')?.badge).toBe(2);
    expect(visibleTabs([], counts({})).find((tab) => tab.id === 'scheduled')?.badge).toBe(0);
  });
});

describe('tabForRoute', () => {
  it('nhóm và liên kết bài thuộc thẻ cha; hồ sơ, tìm kiếm không thuộc thẻ nào', () => {
    expect(tabForRoute(parseSocialRoute('#groups/g1'))).toBe('groups');
    expect(tabForRoute(parseSocialRoute('#posts/p1'))).toBe('feed');
    expect(tabForRoute(parseSocialRoute('#wall'))).toBe('wall');
    expect(tabForRoute(parseSocialRoute('#profile/u1'))).toBeUndefined();
    expect(tabForRoute(parseSocialRoute('#search?q=ab'))).toBeUndefined();
  });
});

describe('plainExcerpt và postHeadline', () => {
  it('bỏ thẻ, gộp khoảng trắng, cắt có dấu chấm lửng', () => {
    expect(plainExcerpt('<p>Xin&nbsp;chào</p><p>mọi  người</p>')).toBe('Xin chào mọi người');
    expect(plainExcerpt('<p>abcdefghij</p>', 5)).toBe('abcd…');
  });

  it('ưu tiên tiêu đề', () => {
    expect(postHeadline({ title: ' Nghỉ lễ ', bodyHtml: '<p>nội dung</p>' })).toBe('Nghỉ lễ');
    expect(postHeadline({ bodyHtml: '<p>nội dung</p>' })).toBe('nội dung');
    expect(postHeadline({ bodyHtml: '<p></p>' })).toBe('Bài viết');
  });
});

describe('orderMyGroups', () => {
  it('nhóm ưu tiên đứng đầu (mới ưu tiên trước), còn lại giữ thứ tự', () => {
    const result = orderMyGroups([
      { id: 'a' },
      { id: 'b', myPriorityAt: '2026-01-01T00:00:00Z' },
      { id: 'c' },
      { id: 'd', myPriorityAt: '2026-02-01T00:00:00Z' },
    ]);
    expect(result.map((group) => group.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('routePageKey', () => {
  it('đổi chuyên mục, mục trong nhóm hay bình luận của cùng một bài vẫn là cùng một trang', () => {
    expect(routePageKey({ name: 'feed', topicId: 'a' })).toBe(routePageKey({ name: 'feed' }));
    expect(routePageKey({ name: 'group', groupId: 'g', section: 'members' })).toBe(routePageKey({ name: 'group', groupId: 'g' }));
    expect(routePageKey({ name: 'post', postId: 'p', commentId: 'c' })).toBe(routePageKey({ name: 'post', postId: 'p' }));
  });

  it('khác loại trang hoặc khác nhóm, bài, người thì là trang khác', () => {
    expect(routePageKey({ name: 'saved' })).not.toBe(routePageKey({ name: 'scheduled' }));
    expect(routePageKey({ name: 'group', groupId: 'g1' })).not.toBe(routePageKey({ name: 'group', groupId: 'g2' }));
    expect(routePageKey({ name: 'profile', userId: 'u1' })).not.toBe(routePageKey({ name: 'profile', userId: 'u2' }));
    expect(routePageKey({ name: 'feed' })).not.toBe(routePageKey({ name: 'groups' }));
  });
});
