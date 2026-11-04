import type { DirectoryOrgNode, DirectoryPerson } from '@enterprise-platform/contracts-workspace';
import { buildOrgTree, checkStateOf, toggleGroup } from './org-tree.model';

const nodes: DirectoryOrgNode[] = [
  { id: 'co', name: 'Công ty', kind: 'unit' },
  { id: 'it', name: 'Phòng IT', parentId: 'co', kind: 'unit' },
  { id: 'dev', name: 'Lập trình viên', parentId: 'it', kind: 'position' },
  { id: 'hr', name: 'Phòng Nhân sự', parentId: 'co', kind: 'unit' },
];

const person = (userId: string, orgNodeIds: string[]): DirectoryPerson => ({
  userId,
  displayName: userId,
  unitNames: [],
  orgNodeIds,
});

const people = [person('a', ['dev', 'it', 'co']), person('b', ['it', 'co']), person('c', ['hr', 'co'])];

describe('buildOrgTree', () => {
  const tree = buildOrgTree(nodes, people);

  it('gom mọi người dưới đơn vị cha, kể cả ở đơn vị con', () => {
    expect([...(tree.under.get('co') ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(tree.under.get('it') ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('chỉ đặt người ở node sâu nhất của họ', () => {
    expect((tree.direct.get('dev') ?? []).map((p) => p.userId)).toEqual(['a']);
    expect((tree.direct.get('it') ?? []).map((p) => p.userId)).toEqual(['b']);
    expect(tree.direct.get('co') ?? []).toEqual([]);
  });
});

describe('checkStateOf / toggleGroup', () => {
  const none = new Set<string>();

  it('tích đơn vị cha chọn hết người của đơn vị con lồng bên trong', () => {
    const picked = toggleGroup(['a', 'b', 'c'], none, none);
    expect([...picked].sort()).toEqual(['a', 'b', 'c']);
    expect(checkStateOf(['a', 'b'], picked, none)).toBe('checked');
  });

  it('chọn một người trong đơn vị thì đơn vị cha ở trạng thái nửa vời', () => {
    const picked = new Set(['a']);
    expect(checkStateOf(['a', 'b', 'c'], picked, none)).toBe('indeterminate');
    expect(checkStateOf(['a', 'b'], picked, none)).toBe('indeterminate');
    expect(checkStateOf(['c'], picked, none)).toBe('unchecked');
  });

  it('tích lại khi đã đủ thì bỏ chọn', () => {
    const all = new Set(['a', 'b']);
    expect(toggleGroup(['a', 'b'], all, none).size).toBe(0);
  });

  it('không đụng người đã có trong dự án', () => {
    const locked = new Set(['b']);
    expect(checkStateOf(['b'], none, locked)).toBe('checked');
    expect([...toggleGroup(['a', 'b'], none, locked)]).toEqual(['a']);
  });
});
