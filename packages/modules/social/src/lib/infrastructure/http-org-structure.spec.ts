import { HttpOrgStructure, parseOrgStructure } from './http-org-structure.js';

const TENANT = 'tenant-1';
const ROOT = 'a0000000-0000-4000-8000-000000000001';
const OPS = 'a0000000-0000-4000-8000-000000000002';
const WAREHOUSE = 'a0000000-0000-4000-8000-000000000003';
const KEEPER = 'a0000000-0000-4000-8000-000000000004'; // chức danh thuộc Kho
const ACCOUNTING = 'a0000000-0000-4000-8000-000000000005';
const LOOP_A = 'a0000000-0000-4000-8000-0000000000a1';
const LOOP_B = 'a0000000-0000-4000-8000-0000000000a2';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const DAVE = '44444444-4444-4444-8444-444444444444';

const payload = {
  units: [
    { id: ROOT, name: 'Công ty', typeCategory: 'unit' },
    { id: OPS, name: 'Khối vận hành', parentId: ROOT, typeCategory: 'unit' },
    { id: WAREHOUSE, name: 'Phòng Kho', parentId: OPS, typeCategory: 'unit' },
    { id: KEEPER, name: 'Thủ kho', parentId: WAREHOUSE, typeCategory: 'position' },
    { id: ACCOUNTING, name: 'Phòng Kế toán', parentId: ROOT, typeCategory: 'unit' },
    { id: LOOP_A, name: 'Vòng A', parentId: LOOP_B, typeCategory: 'unit' },
    { id: LOOP_B, name: 'Vòng B', parentId: LOOP_A, typeCategory: 'unit' },
  ],
  members: [
    { userId: ALICE, unitId: OPS },
    { userId: BOB, unitId: KEEPER }, // người chỉ được bổ nhiệm vào chức danh
    { userId: BOB, unitId: ACCOUNTING }, // và một phòng khác
    { userId: CAROL, unitId: ACCOUNTING },
    { userId: DAVE, unitId: LOOP_A },
    { userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', unitId: 'khong-co-trong-so-do' },
  ],
};

function service(response: () => Promise<Response>, clock = { now: 0 }) {
  const fetcher = jest.fn(async () => response()) as unknown as typeof fetch;
  const org = new HttpOrgStructure('http://core/org', 'token', fetcher, () => clock.now);
  return { org, fetcher: fetcher as unknown as jest.Mock, clock };
}

const ok = () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

describe('HttpOrgStructure: ViewerScopePort', () => {
  it('unitIds gồm nút được bổ nhiệm và mọi tổ tiên (phòng con thấy bài của phòng cha)', async () => {
    const { org } = service(ok);
    expect((await org.scopeOf(TENANT, ALICE)).unitIds).toEqual([OPS, ROOT]);
    // Bob: chức danh Thủ kho -> Phòng Kho -> Khối vận hành -> Công ty, cộng Phòng Kế toán.
    expect([...(await org.scopeOf(TENANT, BOB)).unitIds].sort()).toEqual([KEEPER, WAREHOUSE, OPS, ROOT, ACCOUNTING].sort());
    expect((await org.scopeOf(TENANT, CAROL)).unitIds).toEqual([ACCOUNTING, ROOT]);
  });

  it('người không có trong danh bạ, hoặc được bổ nhiệm vào nút lạ: unitIds rỗng', async () => {
    const { org } = service(ok);
    expect(await org.scopeOf(TENANT, '99999999-9999-4999-8999-999999999999')).toEqual({
      userId: '99999999-9999-4999-8999-999999999999',
      unitIds: [],
    });
    expect((await org.scopeOf(TENANT, 'ffffffff-ffff-4fff-8fff-ffffffffffff')).unitIds).toEqual([]);
  });

  it('id viết hoa vẫn tra được; scopesOf trả đủ mọi người được hỏi, khoá viết thường', async () => {
    const { org } = service(ok);
    const scopes = await org.scopesOf(TENANT, [ALICE.toUpperCase(), DAVE, ALICE]);
    expect([...scopes.keys()].sort()).toEqual([ALICE, DAVE].sort());
    expect(scopes.get(ALICE)?.unitIds).toEqual([OPS, ROOT]);
  });

  it('dữ liệu cha-con bị vòng lặp không làm treo', async () => {
    const { org } = service(ok);
    expect([...(await org.scopeOf(TENANT, DAVE)).unitIds].sort()).toEqual([LOOP_A, LOOP_B].sort());
  });

  it('authorUnitOf: nút gần nhất không phải vị trí, đi lên từ nút được bổ nhiệm', async () => {
    const { org } = service(ok);
    expect(await org.authorUnitOf(TENANT, ALICE)).toBe(OPS);
    expect(await org.authorUnitOf(TENANT, BOB)).toBe(WAREHOUSE);
    expect(await org.authorUnitOf(TENANT, '99999999-9999-4999-8999-999999999999')).toBeUndefined();
  });
});

describe('HttpOrgStructure: OrgStructurePort', () => {
  it('listNodes: lọc theo loại và tên không dấu, kèm tên nút cha và số người gồm nút con', async () => {
    const { org } = service(ok);
    const units = await org.listNodes(TENANT, { kind: 'unit', limit: 50 });
    expect(units.map((node) => node.name)).toEqual(['Công ty', 'Khối vận hành', 'Phòng Kế toán', 'Phòng Kho', 'Vòng A', 'Vòng B']);
    const root = units.find((node) => node.id === ROOT);
    expect(root).toMatchObject({ kind: 'unit', memberCount: 3 });
    expect(units.find((node) => node.id === WAREHOUSE)).toMatchObject({
      parentId: OPS,
      parentName: 'Khối vận hành',
      memberCount: 1,
    });
    expect(await org.listNodes(TENANT, { kind: 'position', limit: 50 })).toMatchObject([{ id: KEEPER, name: 'Thủ kho', memberCount: 1 }]);
    expect((await org.listNodes(TENANT, { query: 'ke toan', limit: 50 })).map((node) => node.id)).toEqual([ACCOUNTING]);
    expect(await org.listNodes(TENANT, { limit: 2 })).toHaveLength(2);
  });

  it('nodeRefs: chỉ trả nút có trong sơ đồ, khoá viết thường', async () => {
    const { org } = service(ok);
    const refs = await org.nodeRefs(TENANT, [WAREHOUSE.toUpperCase(), 'khong-co']);
    expect([...refs.keys()]).toEqual([WAREHOUSE]);
    expect(refs.get(WAREHOUSE)).toEqual({ id: WAREHOUSE, name: 'Phòng Kho', kind: 'unit', parentName: 'Khối vận hành' });
  });

  it('memberIdsOf: gồm nút con mặc định, không trùng, theo thứ tự ổn định', async () => {
    const { org } = service(ok);
    expect(await org.memberIdsOf(TENANT, [{ id: OPS }])).toEqual([ALICE, BOB]);
    expect(await org.memberIdsOf(TENANT, [{ id: ROOT }])).toEqual([ALICE, BOB, CAROL]);
    // includeDescendants=false: chỉ người được bổ nhiệm thẳng vào nút
    expect(await org.memberIdsOf(TENANT, [{ id: OPS, includeDescendants: false }])).toEqual([ALICE]);
    expect(await org.memberIdsOf(TENANT, [{ id: OPS }, { id: ACCOUNTING }])).toEqual([ALICE, BOB, CAROL]);
    expect(await org.memberIdsOf(TENANT, [])).toEqual([]);
  });
});

describe('HttpOrgStructure: bộ nhớ đệm và lỗi Tenant Core', () => {
  it('chỉ gọi mạng một lần trong 60 giây rồi đọc lại', async () => {
    const { org, fetcher, clock } = service(ok);
    await org.scopeOf(TENANT, ALICE);
    await org.authorUnitOf(TENANT, ALICE);
    await org.listNodes(TENANT, { limit: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.now = 59_000;
    await org.scopeOf(TENANT, ALICE);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.now = 61_000;
    await org.scopeOf(TENANT, ALICE);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('Core lỗi lần đầu: sơ đồ rỗng, unitIds rỗng, không ném lỗi, 15 giây sau mới thử lại', async () => {
    const { org, fetcher, clock } = service(() => Promise.resolve(new Response('lỗi', { status: 500 })));
    expect(await org.scopeOf(TENANT, ALICE)).toEqual({ userId: ALICE, unitIds: [] });
    expect(await org.authorUnitOf(TENANT, ALICE)).toBeUndefined();
    expect(await org.listNodes(TENANT, { limit: 5 })).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.now = 16_000;
    await org.scopeOf(TENANT, ALICE);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('Core lỗi sau khi đã có dữ liệu: dùng bản cũ', async () => {
    let healthy = true;
    const { org, clock } = service(() => (healthy ? ok() : Promise.reject(new Error('mất mạng'))));
    expect((await org.scopeOf(TENANT, ALICE)).unitIds).toEqual([OPS, ROOT]);
    healthy = false;
    clock.now = 61_000;
    expect((await org.scopeOf(TENANT, ALICE)).unitIds).toEqual([OPS, ROOT]);
  });

  it('gửi đúng địa chỉ và x-service-token', async () => {
    const { org, fetcher } = service(ok);
    await org.scopeOf('tenant/1', ALICE);
    expect(fetcher).toHaveBeenCalledWith('http://core/org/tenant%2F1', expect.objectContaining({ headers: { 'x-service-token': 'token' } }));
  });
});

describe('parseOrgStructure', () => {
  it('payload rác không làm vỡ; chức danh chỉ có trong positions[] được thêm làm nút vị trí', () => {
    expect(parseOrgStructure(null).nodes.size).toBe(0);
    expect(parseOrgStructure({ units: 'x', members: 5 }).assignments.size).toBe(0);
    const snapshot = parseOrgStructure({
      units: [{ id: OPS, name: 'Khối', typeCategory: 'unit' }],
      positions: [{ id: KEEPER, name: 'Thủ kho', unitId: OPS }],
      members: [{ userId: ALICE, positionId: KEEPER }],
    });
    expect(snapshot.nodes.get(KEEPER)).toMatchObject({ kind: 'position', parentId: OPS });
    expect(snapshot.assignments.get(ALICE)).toEqual([KEEPER]);
  });
});
