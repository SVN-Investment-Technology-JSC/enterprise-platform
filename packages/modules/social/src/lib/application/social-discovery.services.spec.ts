import type { SocialPost, SocialUserRef } from '@enterprise-platform/contracts-social';
import { SocialValidationError } from '../domain/social.error.js';
import { SocialPersonNotFoundError } from '../domain/social-discovery.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { PeopleProfilePort, PersonRecord } from './ports/people-profile.port.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort, PostVisibilityScope } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialActivityStore } from './social-activity-store.port.js';
import type { GroupSearchRow, SocialSearchStore } from './social-search-store.port.js';
import { SocialActivityService } from './social-activity.service.js';
import { SocialBirthdayService } from './social-birthday.service.js';
import { SocialProfileService } from './social-profile.service.js';
import { SocialRealtimeAccessService } from './social-realtime-access.service.js';
import { SocialSearchService } from './social-search.service.js';

const TENANT = '10000000-0000-4000-8000-000000000001';
const ME = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const GROUP = '30000000-0000-4000-8000-000000000001';

const actor = (overrides: Partial<SocialActor> = {}): SocialActor => ({
  tenantId: TENANT,
  userId: ME,
  displayName: 'Tôi',
  isTenantAdmin: false,
  canRead: true,
  canWrite: true,
  canModerate: false,
  canManage: false,
  ...overrides,
});

const scope: PostVisibilityScope = { viewerId: ME, seesAllGroups: false, canModerate: false, memberGroupIds: [GROUP] };
const visibility: PostVisibilityPort = {
  scopeFor: jest.fn(async () => scope),
  canView: jest.fn(async () => true),
};

const user = (id: string, name: string): SocialUserRef => ({ id, name });

function row(id: string, publishedAt: string): ExtendedPostRow {
  return {
    id,
    authorId: OTHER,
    kind: 'post',
    bodyHtml: '<p>x</p>',
    pinned: false,
    mentionsAll: false,
    publishedAt,
    commentCount: 0,
    status: 'published',
    requiresReadConfirmation: false,
  };
}

const assembler: PostViewAssembler = {
  assemble: jest.fn(async (_actor, rows) => rows.map((item) => ({ id: item.id }) as unknown as SocialPost)),
};

function searchStore(overrides: Partial<SocialSearchStore> = {}): SocialSearchStore {
  return {
    searchPosts: jest.fn(async () => []),
    searchGroups: jest.fn(async () => []),
    countVisibleAuthorPosts: jest.fn(async () => 0),
    ...overrides,
  };
}

const directory = (people: SocialUserRef[] = []): OrganizationDirectory => ({
  resolve: jest.fn(async (_tenant, ids) => new Map(people.filter((p) => ids.includes(p.id)).map((p) => [p.id, p]))),
  search: jest.fn(async (_tenant, _query, limit) => people.slice(0, limit)),
});

function peopleProfile(overrides: Partial<PeopleProfilePort> = {}): PeopleProfilePort {
  return {
    profileOf: jest.fn(async () => undefined),
    birthdays: jest.fn(async () => []),
    listBirthdayPeople: jest.fn(async () => []),
    listActiveUserIds: jest.fn(async () => []),
    canOpenInHrm: jest.fn(async () => false),
    ...overrides,
  };
}

describe('SocialProfileService', () => {
  const record: PersonRecord = {
    user: user(OTHER, 'Bình'),
    unitName: 'Phòng Kế toán',
    position: 'Kế toán trưởng',
    email: 'binh@example.com',
    birthday: { day: 3, month: 4 },
    joinedAt: '2020-01-02',
  };

  it('builds the profile with the visible post count and omits missing optional fields', async () => {
    const countVisibleAuthorPosts = jest.fn(async () => 7);
    const service = new SocialProfileService(
      peopleProfile({ profileOf: jest.fn(async () => ({ user: user(OTHER, 'Bình') })) }),
      visibility,
      searchStore({ countVisibleAuthorPosts }),
    );
    const profile = await service.profile(actor(), OTHER);
    expect(profile).toEqual({ user: user(OTHER, 'Bình'), isSelf: false, postCount: 7, canOpenInHrm: false });
    expect(countVisibleAuthorPosts).toHaveBeenCalledWith(TENANT, scope, OTHER);
  });

  it('passes through HRM facts and marks the viewer own profile', async () => {
    const service = new SocialProfileService(
      peopleProfile({ profileOf: jest.fn(async () => ({ ...record, user: user(ME, 'Tôi') })) }),
      visibility,
      searchStore(),
    );
    const profile = await service.profile(actor(), ME.toUpperCase());
    expect(profile).toMatchObject({
      isSelf: true,
      canOpenInHrm: true,
      unitName: 'Phòng Kế toán',
      position: 'Kế toán trưởng',
      birthday: { day: 3, month: 4 },
      joinedAt: '2020-01-02',
    });
  });

  it('lets tenant admins open HRM, and treats an HRM failure as no access', async () => {
    const people = peopleProfile({
      profileOf: jest.fn(async () => record),
      canOpenInHrm: jest.fn(async () => {
        throw new Error('HRM down');
      }),
    });
    const service = new SocialProfileService(people, visibility, searchStore());
    expect((await service.profile(actor({ isTenantAdmin: true }), OTHER)).canOpenInHrm).toBe(true);
    expect((await service.profile(actor(), OTHER)).canOpenInHrm).toBe(false);
  });

  it('answers 404 PERSON_NOT_FOUND for unknown or malformed ids', async () => {
    const service = new SocialProfileService(peopleProfile(), visibility, searchStore());
    await expect(service.profile(actor(), OTHER)).rejects.toBeInstanceOf(SocialPersonNotFoundError);
    await expect(service.profile(actor(), 'khong-phai-uuid')).rejects.toMatchObject({
      code: 'PERSON_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('SocialBirthdayService', () => {
  const clock = () => new Date('2026-10-20T20:00:00Z'); // 21/10 ở Việt Nam

  it('asks for the company day and splits today from upcoming, nearest first', async () => {
    const birthdays = jest.fn(async () => [
      { user: user(OTHER, 'Chi'), birthday: { day: 25, month: 10 }, daysUntil: 4 },
      { user: user(ME, 'An'), birthday: { day: 21, month: 10 }, daysUntil: 0 },
      { user: user('x', 'Bảo'), birthday: { day: 22, month: 10 }, daysUntil: 1 },
      { user: user('y', 'Quá xa'), birthday: { day: 1, month: 12 }, daysUntil: 41 },
    ]);
    const service = new SocialBirthdayService(peopleProfile({ birthdays }), clock);
    const result = await service.birthdays(actor(), { days: 7 });
    expect(birthdays).toHaveBeenCalledWith(TENANT, { today: '2026-10-21', days: 7 });
    expect(result.today.map((item) => item.user.name)).toEqual(['An']);
    expect(result.upcoming.map((item) => item.user.name)).toEqual(['Bảo', 'Chi']);
  });

  it('defaults to 7 days and rejects out-of-range values', async () => {
    const birthdays = jest.fn(async () => []);
    const service = new SocialBirthdayService(peopleProfile({ birthdays }), clock);
    await service.birthdays(actor());
    expect(birthdays).toHaveBeenCalledWith(TENANT, { today: '2026-10-21', days: 7 });
    await expect(service.birthdays(actor(), { days: 0 })).rejects.toBeInstanceOf(SocialValidationError);
    await expect(service.birthdays(actor(), { days: 31 })).rejects.toThrow('Số ngày phải từ 1 đến 30.');
    await expect(service.birthdays(actor(), { days: 1.5 })).rejects.toBeInstanceOf(SocialValidationError);
  });
});

describe('SocialBirthdayService.upcoming', () => {
  const clock = () => new Date('2026-12-20T20:00:00Z'); // 21/12 ở Việt Nam
  const people = [
    { user: { ...user(ME, 'An'), unitName: 'Phòng Kế toán' }, birthday: { day: 21, month: 12 }, birthYear: 1990 },
    { user: user(OTHER, 'Bảo'), birthday: { day: 2, month: 1 }, birthYear: 1985 },
    { user: user('c', 'Chi'), birthday: { day: 29, month: 12 } },
    { user: user('d', 'Dũng'), birthday: { day: 15, month: 3 }, birthYear: 1999 },
    { user: user('e', 'Em'), birthday: { day: 20, month: 12 }, birthYear: 2000 },
  ];
  const service = (list = people) =>
    new SocialBirthdayService(peopleProfile({ listBirthdayPeople: jest.fn(async () => list) }), clock);

  it('groups by month across the year boundary, marks today and computes the turning age', async () => {
    const result = await service().upcoming(actor(), { months: 2 });
    expect(result.today).toBe('2026-12-21');
    expect(result.total).toBe(3);
    expect(result.groups.map((group) => [group.year, group.month, group.items.map((item) => item.user.name)])).toEqual([
      [2026, 12, ['An', 'Chi']],
      [2027, 1, ['Bảo']],
    ]);
    const [an, chi] = result.groups[0].items;
    expect(an).toMatchObject({ isToday: true, daysUntil: 0, date: '2026-12-21', age: 36 });
    expect(chi.age).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('birthYear');
    expect(result.groups[1].items[0]).toMatchObject({ date: '2027-01-02', age: 42, isToday: false });
  });

  it('defaults to three months and filters by name or unit without diacritics', async () => {
    expect((await service().upcoming(actor())).groups.map((group) => group.month)).toEqual([12, 1]);
    const byUnit = await service().upcoming(actor(), { q: ' ke TOAN ' });
    expect(byUnit.groups.flatMap((group) => group.items.map((item) => item.user.name))).toEqual(['An']);
    const byName = await service().upcoming(actor(), { months: 12, q: 'dung' });
    expect(byName.groups).toEqual([{ year: 2027, month: 3, items: [expect.objectContaining({ age: 28 })] }]);
  });

  it('rejects out-of-range months', async () => {
    await expect(service().upcoming(actor(), { months: 0 })).rejects.toBeInstanceOf(SocialValidationError);
    await expect(service().upcoming(actor(), { months: 13 })).rejects.toThrow('Số tháng phải từ 1 đến 12.');
  });
});

describe('SocialSearchService', () => {
  it('searches posts under the viewer visibility scope and pages with a cursor', async () => {
    const rows = [
      row('40000000-0000-4000-8000-000000000003', '2026-10-03T00:00:00.000001Z'),
      row('40000000-0000-4000-8000-000000000002', '2026-10-02T00:00:00.000001Z'),
      row('40000000-0000-4000-8000-000000000001', '2026-10-01T00:00:00.000001Z'),
    ];
    const searchPosts = jest.fn(async () => rows);
    const service = new SocialSearchService(searchStore({ searchPosts }), visibility, assembler, directory());
    const page = await service.posts(actor(), { q: 'Họp tổng kết', limit: 2 });

    expect(searchPosts).toHaveBeenCalledWith(TENANT, scope, { tokens: ['hop', 'tong', 'ket'], limit: 3, cursor: undefined });
    expect(page.items.map((item) => item.id)).toEqual([rows[0].id, rows[1].id]);
    expect(page.nextCursor).toBeDefined();
  });

  it('omits the cursor on the last page', async () => {
    const searchPosts = jest.fn(async () => [row('40000000-0000-4000-8000-000000000001', '2026-10-01T00:00:00.000001Z')]);
    const service = new SocialSearchService(searchStore({ searchPosts }), visibility, assembler, directory());
    expect((await service.posts(actor(), { q: 'báo cáo', limit: 5 })).nextCursor).toBeUndefined();
  });

  it('validates filters and the date range', async () => {
    const service = new SocialSearchService(searchStore(), visibility, assembler, directory());
    await expect(service.posts(actor(), { q: 'x' })).rejects.toBeInstanceOf(SocialValidationError);
    await expect(service.posts(actor(), { q: 'báo cáo', groupId: 'abc' })).rejects.toThrow('Nhóm không hợp lệ.');
    await expect(service.posts(actor(), { q: 'báo cáo', from: '2026-10-05', to: '2026-10-01' })).rejects.toThrow(
      'Khoảng thời gian không hợp lệ',
    );
    await expect(service.posts(actor(), { q: 'báo cáo', from: 'hôm qua' })).rejects.toThrow(
      'Khoảng thời gian không hợp lệ.',
    );
  });

  it('includes the whole last day when `to` is a plain date', async () => {
    const searchPosts = jest.fn(async () => []);
    const service = new SocialSearchService(searchStore({ searchPosts }), visibility, assembler, directory());
    await service.posts(actor(), { q: 'báo cáo', from: '2026-10-01', to: '2026-10-02' });
    expect(searchPosts).toHaveBeenCalledWith(
      TENANT,
      scope,
      expect.objectContaining({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T23:59:59.999Z' }),
    );
  });

  it('builds the overview with at most 5 of each kind', async () => {
    const searchPosts = jest.fn(async () => []);
    const searchGroups = jest.fn(
      async (): Promise<GroupSearchRow[]> => [
        {
          id: GROUP,
          name: 'Dự án A',
          description: 'Nhóm dự án',
          privacy: 'public',
          color: 'blue',
          icon: 'users',
          memberCount: 3,
          myRole: 'admin',
          myJoinedAt: '2026-10-01T00:00:00.123456Z',
          createdAt: '2026-09-01T00:00:00.123456Z',
        },
      ],
    );
    const people = directory([user(OTHER, 'Bình')]);
    const service = new SocialSearchService(searchStore({ searchPosts, searchGroups }), visibility, assembler, people);
    const overview = await service.overview(actor(), 'dự án');

    expect(overview.query).toBe('dự án');
    expect(searchPosts).toHaveBeenCalledWith(TENANT, scope, { tokens: ['du', 'an'], limit: 5 });
    expect(people.search).toHaveBeenCalledWith(TENANT, 'dự án', 5);
    expect(overview.groups[0]).toMatchObject({
      id: GROUP,
      memberCount: 3,
      myMembership: { role: 'admin', joinedAt: '2026-10-01T00:00:00.123Z' },
      createdAt: '2026-09-01T00:00:00.123Z',
    });
    expect(overview.people).toEqual([user(OTHER, 'Bình')]);
  });

  it('caps the people search and pages groups with a cursor', async () => {
    const people = directory([user(OTHER, 'Bình')]);
    const searchGroups = jest.fn(
      async (): Promise<GroupSearchRow[]> =>
        ['a', 'b'].map((suffix, index) => ({
          id: `30000000-0000-4000-8000-00000000000${index + 1}`,
          name: `Nhóm ${suffix}`,
          privacy: 'public' as const,
          color: 'blue' as const,
          icon: 'users' as const,
          memberCount: 1,
          createdAt: `2026-09-0${index + 1}T00:00:00.000001Z`,
        })),
    );
    const service = new SocialSearchService(searchStore({ searchGroups }), visibility, assembler, people);

    await service.people(actor(), { q: 'bình', limit: 999 });
    expect(people.search).toHaveBeenCalledWith(TENANT, 'bình', 20);

    const page = await service.groups(actor(), { q: 'nhóm', limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
  });
});

describe('SocialActivityService', () => {
  const store = (inserted = true): SocialActivityStore & { insertDaily: jest.Mock } => ({
    insertDaily: jest.fn(async () => inserted),
  });

  it('creates an avatar.updated post authored by the person, with no group and no payload', async () => {
    const activityStore = store();
    const service = new SocialActivityService(
      activityStore,
      directory([user(OTHER, 'Bình')]),
      'Asia/Ho_Chi_Minh',
      () => '50000000-0000-4000-8000-000000000001',
    );
    await expect(service.handleEvent(TENANT, 'core.user.avatar-updated', { userId: OTHER })).resolves.toBe(true);
    expect(activityStore.insertDaily).toHaveBeenCalledWith(TENANT, {
      id: '50000000-0000-4000-8000-000000000001',
      authorId: OTHER,
      type: 'avatar.updated',
      payload: {},
      timeZone: 'Asia/Ho_Chi_Minh',
      authorName: 'Bình',
    });
  });

  it('reports false when the daily limit already applies', async () => {
    const service = new SocialActivityService(store(false), directory([user(OTHER, 'Bình')]));
    await expect(service.handleEvent(TENANT, 'core.user.avatar-updated', { userId: OTHER })).resolves.toBe(false);
  });

  it('ignores unknown events, bad payloads and people who left the company', async () => {
    const activityStore = store();
    const service = new SocialActivityService(activityStore, directory([user(OTHER, 'Bình')]));
    await expect(service.handleEvent(TENANT, 'core.user.created', { userId: OTHER })).resolves.toBe(false);
    await expect(service.handleEvent(TENANT, 'core.user.avatar-updated', { userId: 'x' })).resolves.toBe(false);
    await expect(service.handleEvent(TENANT, 'core.user.avatar-updated', null)).resolves.toBe(false);
    await expect(service.handleEvent(TENANT, 'core.user.avatar-updated', { userId: ME })).resolves.toBe(false);
    expect(activityStore.insertDaily).not.toHaveBeenCalled();
  });
});

describe('SocialRealtimeAccessService', () => {
  it('lets only group members join the group room', async () => {
    const isMember = jest.fn(async (_tenant: string, _group: string, userId: string) => userId === ME);
    const service = new SocialRealtimeAccessService({ isMember } as unknown as GroupMembershipPort);
    await expect(service.canJoinGroupRoom(actor(), GROUP)).resolves.toBe(true);
    await expect(service.canJoinGroupRoom(actor({ userId: OTHER }), GROUP)).resolves.toBe(false);
    await expect(service.canJoinGroupRoom(actor(), 'khong-phai-uuid')).resolves.toBe(false);
  });
});
