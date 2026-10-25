import { HttpPeopleProfile, parseFacts, parseOrganization } from './http-people-profile.js';

const TENANT = 't1';
const USER_A = '20000000-0000-4000-8000-00000000000a';
const USER_B = '20000000-0000-4000-8000-00000000000b';

const organization = {
  units: [
    { id: 'u-dept', name: 'Phòng Kế toán', typeCategory: 'unit' },
    { id: 'u-pos', name: 'Kế toán trưởng', typeCategory: 'position', parentId: 'u-dept' },
  ],
  members: [
    { userId: USER_A, displayName: 'An', email: 'an@example.com', positionName: 'Kế toán trưởng', unitId: 'u-pos' },
    { userId: USER_B, displayName: 'Bình', email: 'binh@example.com' },
    { userId: USER_A, displayName: 'An (trùng)' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(facts: () => Response | Promise<Response>, clock = { now: 0 }) {
  const calls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const fetcher = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    inits.push(init);
    const url = String(input);
    calls.push(url);
    return url.includes('/v1/internal/people/profile-facts') ? facts() : json(organization);
  });
  const people = new HttpPeopleProfile({
    organizationContextUrl: 'http://core/organization-contexts',
    hrmApiUrl: 'http://hrm/api/hrm/',
    serviceToken: 'token',
    fetcher: fetcher as unknown as typeof fetch,
    now: () => clock.now,
  });
  return { people, calls, fetcher, clock };
}

describe('parseOrganization', () => {
  it('walks from a position node up to the unit name and merges duplicate members', () => {
    const map = parseOrganization(organization);
    expect([...map.keys()]).toEqual([USER_A, USER_B]);
    expect(map.get(USER_A)).toEqual({
      user: { id: USER_A, name: 'An', position: 'Kế toán trưởng', unitName: 'Phòng Kế toán' },
      email: 'an@example.com',
    });
  });

  it('survives an empty or malformed payload', () => {
    expect(parseOrganization(null).size).toBe(0);
    expect(parseOrganization({ members: 'x' }).size).toBe(0);
  });
});

describe('parseFacts', () => {
  it('keeps day and month only, ignoring any year-bearing field and bad rows', () => {
    const map = parseFacts({
      data: [
        { userId: USER_A, birthMonth: 4, birthDay: 3, dateOfBirth: '1990-04-03', joinDate: '2020-01-02T00:00:00Z' },
        { userId: USER_B, birthMonth: 2, birthDay: 30 },
        { birthMonth: 1, birthDay: 1 },
      ],
    });
    expect(map.get(USER_A)).toEqual({ birthday: { month: 4, day: 3 }, joinedAt: '2020-01-02' });
    expect(map.has(USER_B)).toBe(false);
    expect(JSON.stringify([...map.values()])).not.toContain('1990');
  });
});

describe('HttpPeopleProfile', () => {
  const facts = () =>
    json({
      data: [
        { userId: USER_A, birthMonth: 10, birthDay: 23, joinDate: '2020-01-02', employeeCode: 'NV001' },
        { userId: USER_B, birthMonth: 2, birthDay: 29 },
      ],
    });

  it('merges the directory with HRM facts and sends service credentials', async () => {
    const { people, fetcher } = client(facts);
    const record = await people.profileOf(TENANT, USER_A.toUpperCase());
    expect(record).toEqual({
      user: { id: USER_A, name: 'An', position: 'Kế toán trưởng', unitName: 'Phòng Kế toán' },
      unitName: 'Phòng Kế toán',
      position: 'Kế toán trưởng',
      email: 'an@example.com',
      birthday: { month: 10, day: 23 },
      joinedAt: '2020-01-02',
      employeeCode: 'NV001',
    });
    const hrmCall = fetcher.mock.calls.find(([url]) => String(url).includes('profile-facts'));
    expect(String(hrmCall?.[0])).toBe('http://hrm/api/hrm/v1/internal/people/profile-facts');
    expect(hrmCall?.[1]).toMatchObject({ headers: { 'x-tenant-id': TENANT, 'x-service-token': 'token' } });
    await expect(people.profileOf(TENANT, 'ffffffff-0000-4000-8000-000000000000')).resolves.toBeUndefined();
  });

  it('lists upcoming birthdays inside the window, nearest first, 29 February on the 28th in common years', async () => {
    const { people } = client(facts);
    const result = await people.birthdays(TENANT, { today: '2027-02-26', days: 7 });
    expect(result.map((item) => [item.user.name, item.daysUntil])).toEqual([['Bình', 2]]);
    const later = await people.birthdays(TENANT, { today: '2026-10-21', days: 7 });
    expect(later.map((item) => [item.user.name, item.daysUntil])).toEqual([['An', 2]]);
  });

  it('lists birthday people with the birth year kept only for age, and not in the profile', async () => {
    const { people } = client(() =>
      json({ data: [{ userId: USER_A, birthMonth: 10, birthDay: 23, birthYear: 1990, joinDate: '2020-01-02' }] }),
    );
    await expect(people.listBirthdayPeople(TENANT)).resolves.toEqual([
      {
        user: { id: USER_A, name: 'An', position: 'Kế toán trưởng', unitName: 'Phòng Kế toán' },
        birthday: { month: 10, day: 23 },
        birthYear: 1990,
      },
    ]);
    expect(JSON.stringify(await people.profileOf(TENANT, USER_A))).not.toContain('1990');
  });

  it('degrades to no birthdays and no join date when HRM has no such endpoint', async () => {
    const { people } = client(() => json({ message: 'Not Found' }, 404));
    await expect(people.birthdays(TENANT, { today: '2026-10-21', days: 30 })).resolves.toEqual([]);
    const record = await people.profileOf(TENANT, USER_A);
    expect(record?.birthday).toBeUndefined();
    expect(record?.joinedAt).toBeUndefined();
    expect(record?.email).toBe('an@example.com');
  });

  it('caches the directory, retries a failed source after 15 seconds, and lists active users', async () => {
    const clock = { now: 0 };
    let ok = false;
    const { people, calls } = client(() => (ok ? facts() : json({}, 500)), clock);
    await people.listActiveUserIds(TENANT);
    await people.listActiveUserIds(TENANT);
    expect(calls.filter((url) => url.includes('organization-contexts'))).toHaveLength(1);

    await people.birthdays(TENANT, { today: '2026-10-21', days: 7 });
    ok = true;
    clock.now = 5_000;
    expect(await people.birthdays(TENANT, { today: '2026-10-21', days: 7 })).toEqual([]);
    clock.now = 20_000;
    expect(await people.birthdays(TENANT, { today: '2026-10-21', days: 7 })).toHaveLength(1);
    await expect(people.listActiveUserIds(TENANT)).resolves.toEqual([USER_A, USER_B]);
  });

  it('only lets people open their own HRM profile until HRM can check access', async () => {
    const { people } = client(facts);
    await expect(people.canOpenInHrm(TENANT, USER_A, USER_A.toUpperCase())).resolves.toBe(true);
    await expect(people.canOpenInHrm(TENANT, USER_A, USER_B)).resolves.toBe(false);
  });
});
