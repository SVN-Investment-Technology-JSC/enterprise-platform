import {
  buildSocialPath,
  legacyHashToPath,
  parseSocialPath,
  SOCIAL_ROUTES,
  type SocialRouteTarget,
} from './contracts-social-routes.js';

describe('SOCIAL_ROUTES', () => {
  it('dựng đúng đường dẫn đợt 2', () => {
    expect(SOCIAL_ROUTES.feed()).toBe('/modules/social');
    expect(SOCIAL_ROUTES.wall()).toBe('/modules/social/wall');
    expect(SOCIAL_ROUTES.wall({ announcementsOnly: true })).toBe('/modules/social/wall?kind=announcement');
    expect(SOCIAL_ROUTES.groups()).toBe('/modules/social/groups');
    expect(SOCIAL_ROUTES.group('g 1', 'members')).toBe('/modules/social/groups/g%201/members');
    expect(SOCIAL_ROUTES.group('g1', undefined, { topicId: 't1' })).toBe('/modules/social/groups/g1?topic=t1');
    expect(SOCIAL_ROUTES.saved()).toBe('/modules/social/saved');
    expect(SOCIAL_ROUTES.pending()).toBe('/modules/social/pending');
    expect(SOCIAL_ROUTES.pending('moderation')).toBe('/modules/social/pending?tab=moderation');
    expect(SOCIAL_ROUTES.scheduled()).toBe('/modules/social/scheduled');
    expect(SOCIAL_ROUTES.profile('u1')).toBe('/modules/social/profile/u1');
    expect(SOCIAL_ROUTES.search('họp lớp')).toBe('/modules/social/search?q=h%E1%BB%8Dp%20l%E1%BB%9Bp');
    expect(SOCIAL_ROUTES.search('  ')).toBe('/modules/social/search');
    expect(SOCIAL_ROUTES.post('p1')).toBe('/modules/social/posts/p1');
    expect(SOCIAL_ROUTES.post('p1', 'c1')).toBe('/modules/social/posts/p1/comments/c1');
    expect(SOCIAL_ROUTES.birthday()).toBe('/modules/social/birthday');
  });
});

describe('parseSocialPath', () => {
  const targets: SocialRouteTarget[] = [
    { name: 'feed' },
    { name: 'wall', announcementsOnly: false },
    { name: 'wall', topicId: 't1', announcementsOnly: false },
    { name: 'wall', announcementsOnly: true },
    { name: 'groups' },
    { name: 'group', groupId: 'g1' },
    { name: 'group', groupId: 'g1', section: 'requests' },
    { name: 'group', groupId: 'g1', section: 'topics', topicId: 't9' },
    { name: 'saved' },
    { name: 'pending' },
    { name: 'pending', tab: 'rejected' },
    { name: 'scheduled' },
    { name: 'profile', userId: 'u1' },
    { name: 'search', query: 'họp lớp' },
    { name: 'post', postId: 'p1' },
    { name: 'post', postId: 'p1', commentId: 'c1' },
    { name: 'birthday' },
  ];

  it.each(targets.map((target) => [buildSocialPath(target), target] as const))('khứ hồi %s', (path, target) => {
    const [pathname, search = ''] = path.split('?');
    const parsed = parseSocialPath(pathname ?? '', search);
    expect(parsed).toEqual(expect.objectContaining(JSON.parse(JSON.stringify(target))));
  });

  it('nhận path tương đối so với basePath và path lạ về bảng tin', () => {
    expect(parseSocialPath('/groups/g1/members')).toEqual({
      name: 'group',
      groupId: 'g1',
      section: 'members',
      topicId: undefined,
    });
    expect(parseSocialPath('/modules/social/khong-co')).toEqual({ name: 'feed' });
    expect(parseSocialPath('/modules/social/profile')).toEqual({ name: 'feed' });
  });
});

describe('legacyHashToPath', () => {
  it.each([
    ['', undefined],
    ['#', undefined],
    ['#feed', '/modules/social'],
    ['#wall', '/modules/social/wall'],
    ['#wall/announcements', '/modules/social/wall?kind=announcement'],
    ['#groups', '/modules/social/groups'],
    ['#groups/g1', '/modules/social/groups/g1'],
    ['#groups/g1/requests', '/modules/social/groups/g1/requests'],
    ['#saved', '/modules/social/saved'],
    ['#moderation', '/modules/social/pending?tab=moderation'],
    ['#my-posts/scheduled', '/modules/social/scheduled'],
    ['#my-posts/rejected', '/modules/social/pending?tab=rejected'],
    ['#my-posts/pending', '/modules/social/pending'],
    ['#people/u1', '/modules/social/profile/u1'],
    ['#search?q=abc', '/modules/social/search?q=abc'],
    ['#search/abc', '/modules/social/search?q=abc'],
    ['#posts/p1', '/modules/social/posts/p1'],
    ['#posts/p1/comment/c1', '/modules/social/posts/p1/comments/c1'],
    ['#khong-biet', '/modules/social'],
  ])('%s', (hash, expected) => {
    expect(legacyHashToPath(hash)).toBe(expected);
  });
});
