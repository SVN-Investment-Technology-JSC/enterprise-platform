import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { buildHeaderTree, flattenColumns, pruneEmpty } from './columns';

/**
 * Snapshot tối giản: một phòng, một chức danh trưởng phòng do hai người cùng
 * giữ (để tầng chức danh không bị làm phẳng), và một nhân viên.
 */
const snapshot = {
  tenantId: 't',
  generatedAt: '2026-01-01T00:00:00.000Z',
  unitTypes: [],
  // Hình dạng theo contract: chức danh nằm ở `positions`, người gắn vào chức
  // danh qua `positionId`. Snapshot thật hiện trả `positions: []` và dồn mọi
  // node vào `units` — xem ghi chú cuối file.
  positions: [
    { id: 'truong', key: 'TRUONG', name: 'Trưởng phòng', unitId: 'phong', createdAt: '' },
  ],
  membershipSubjects: {},
  units: [
    {
      id: 'phong',
      code: 'P',
      name: 'Phòng Kỹ thuật',
      typeId: 'ty',
      typeName: 'Phòng ban',
      typeCategory: 'unit' as const,
      memberCount: 2,
      headMembershipId: 'u1',
      headName: 'Người A',
      createdAt: '',
      updatedAt: '',
    },
  ],
  members: [
    {
      membershipId: 'u1',
      userId: 'u1',
      displayName: 'Người A',
      email: 'a@x',
      unitId: 'phong',
      positionId: 'truong',
      isHead: true,
    },
    {
      membershipId: 'u2',
      userId: 'u2',
      displayName: 'Người B',
      email: 'b@x',
      unitId: 'phong',
      positionId: 'truong',
      isHead: false,
    },
  ],
} as unknown as TenantOrganizationSnapshot;

const keysOf = (used: Set<string>, expanded: Set<string>) =>
  flattenColumns(pruneEmpty(buildHeaderTree(snapshot, expanded), used)).map((c) => c.key);

describe('cột cấp đơn vị trên ma trận', () => {
  it('đơn vị thu gọn là ô gán cấp đơn vị', () => {
    const columns = flattenColumns(buildHeaderTree(snapshot, new Set()));
    const unitColumn = columns.find((c) => c.subjectId === 'phong');
    expect(unitColumn?.subjectType).toBe('organization_unit');
  });

  it('sổ đơn vị ra thì KHÔNG còn ô "cả đơn vị" khi chưa gán vai nào', () => {
    const keys = keysOf(new Set(), new Set(['phong']));
    expect(keys.some((key) => key.endsWith('/unit:phong#self'))).toBe(false);
  });

  it('đơn vị đang giữ vai thì ô cấp đơn vị vẫn hiện dù đã sổ ra', () => {
    // Nếu cắt mất ô này, vai đã gán sẽ biến mất khỏi màn hình dù dữ liệu còn.
    const keys = keysOf(new Set(['phong']), new Set(['phong']));
    expect(keys.some((key) => key.endsWith('/unit:phong#self'))).toBe(true);
  });

  it('neo của chức danh vẫn luôn được giữ', () => {
    const keys = keysOf(new Set(), new Set(['phong', 'truong']));
    expect(keys.some((key) => key.endsWith('/position:truong#self'))).toBe(true);
  });
});

/**
 * Chức danh CHỈ MỘT NGƯỜI giữ thì tầng chức danh bị gộp lại thành cột con người.
 * Cột đó phải tiếp tục mang subject của CHỨC DANH: vai trò trong quy trình gán
 * cho node chức danh, nên nếu cột mang userId thì không ô nào khớp và toàn bộ
 * vai biến mất khỏi bảng ngay khi sổ đơn vị ra — dù dữ liệu vẫn còn nguyên.
 */
describe('chức danh một người', () => {
  const oneHolder = {
    ...snapshot,
    members: [snapshot.members[0]],
  } as unknown as TenantOrganizationSnapshot;

  it('cột gộp mang subject của chức danh, không phải của người', () => {
    const columns = flattenColumns(buildHeaderTree(oneHolder, new Set(['phong'])));
    const person = columns.find((column) => column.label === 'Người A');
    expect(person?.subjectType).toBe('position');
    expect(person?.subjectId).toBe('truong');
  });

  it('vai gán cho chức danh vẫn còn cột sau khi sổ đơn vị ra', () => {
    const keys = flattenColumns(
      pruneEmpty(buildHeaderTree(oneHolder, new Set(['phong'])), new Set(['truong'])),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((column) => column.subjectId === 'truong')).toBe(true);
  });

  it('vẫn giữ userId để vai gán đích danh không mất tăm', () => {
    const columns = flattenColumns(buildHeaderTree(oneHolder, new Set(['phong'])));
    const person = columns.find((column) => column.label === 'Người A');
    expect(person?.descendantSubjectIds).toContain('u1');
  });

  it('mang theo đơn vị và cờ trưởng đơn vị, để suy ra vai kế thừa', () => {
    const columns = flattenColumns(buildHeaderTree(oneHolder, new Set(['phong'])));
    const person = columns.find((column) => column.label === 'Người A');
    expect(person?.unitId).toBe('phong');
    expect(person?.isHead).toBe(true);
  });
});

/**
 * Ghi chú: snapshot tổ chức thật hiện trả `positions: []` và members không có
 * `positionId` — mọi node, kể cả chức danh, đều nằm trong `units`. Vì vậy nhánh
 * chức danh và cột người trong `buildHeaderTree` chưa chạy trên dữ liệu thật.
 * Fixture ở trên cố ý dựng theo hình dạng contract khai báo, để nhánh đó vẫn
 * được kiểm và không hỏng thầm lặng khi snapshot bắt đầu trả đủ dữ liệu.
 */
