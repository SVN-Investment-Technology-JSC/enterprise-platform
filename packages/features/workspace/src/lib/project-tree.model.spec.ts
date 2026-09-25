import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { branchOf, buildWorkItemTree, matchWorkItems, moveTargets } from './project-tree.model';

function item(id: string, parentId: string | undefined, sortOrder: number): WorkItem {
  return {
    id,
    projectId: 'p1',
    parentId,
    code: id.toUpperCase(),
    title: `Việc ${id}`,
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder,
    depth: 0,
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

// a(0) ├─ b(0) ─ c(0)
//      └─ d(1)
const ITEMS = [
  item('a', undefined, 0),
  item('d', 'a', 1),
  item('b', 'a', 0),
  item('c', 'b', 0),
];

const ALL = new Set(ITEMS.map((node) => node.id));

describe('buildWorkItemTree', () => {
  it('phẳng hoá theo thứ tự cha con rồi sortOrder', () => {
    expect(buildWorkItemTree(ITEMS, ALL).map((row) => row.item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('gán đúng độ sâu hiển thị', () => {
    const depths = Object.fromEntries(
      buildWorkItemTree(ITEMS, ALL).map((row) => [row.item.id, row.depth]),
    );
    expect(depths).toEqual({ a: 0, b: 1, c: 2, d: 1 });
  });

  it('nhánh thu gọn ẩn toàn bộ con cháu', () => {
    const rows = buildWorkItemTree(ITEMS, ALL, new Set(['b']));
    expect(rows.map((row) => row.item.id)).toEqual(['a', 'b', 'd']);
    expect(rows.find((row) => row.item.id === 'b')).toMatchObject({
      hasChildren: true,
      expanded: false,
    });
  });

  it('lọc giữ lại cả chuỗi tổ tiên của node khớp', () => {
    // Chỉ 'c' khớp, nhưng 'a' và 'b' phải còn để nhánh hiển thị được.
    expect(buildWorkItemTree(ITEMS, new Set(['c'])).map((row) => row.item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('parentId mồ côi được coi là node gốc', () => {
    const orphan = [item('x', 'khong-ton-tai', 0)];
    expect(buildWorkItemTree(orphan, new Set(['x']))).toMatchObject([{ depth: 0 }]);
  });
});

describe('matchWorkItems', () => {
  it('từ khoá rỗng thì giữ tất cả', () => {
    expect(matchWorkItems(ITEMS, '   ').size).toBe(4);
  });

  it('khớp cả theo mã lẫn theo tên, không phân biệt hoa thường', () => {
    expect([...matchWorkItems(ITEMS, 'việc c')]).toEqual(['c']);
    expect([...matchWorkItems(ITEMS, 'd')]).toEqual(['d']);
  });
});

describe('branchOf', () => {
  it('gồm chính nó và mọi con cháu', () => {
    expect([...branchOf(ITEMS, 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('node lá chỉ có chính nó', () => {
    expect([...branchOf(ITEMS, 'c')]).toEqual(['c']);
  });
});

describe('moveTargets', () => {
  it('bỏ chính nhánh và cha hiện tại', () => {
    // b nằm dưới a; con của b là c. Còn lại d.
    expect(moveTargets(ITEMS, 'b').map((node) => node.id)).toEqual(['d']);
  });

  it('node gốc chuyển được vào mọi node ngoài nhánh', () => {
    const extra = [...ITEMS, item('e', undefined, 1)];
    expect(moveTargets(extra, 'e').map((node) => node.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('chặn đích làm nhánh vượt 10 cấp', () => {
    // Chuỗi x0 → x8 sâu tới cấp 8; y có một con z (nhánh cao 1).
    const chain = Array.from({ length: 9 }, (_, depth) => ({
      ...item(`x${depth}`, depth === 0 ? undefined : `x${depth - 1}`, 0),
      depth,
    }));
    const nodes = [...chain, item('y', undefined, 1), { ...item('z', 'y', 0), depth: 1 }];
    const targets = moveTargets(nodes, 'y').map((node) => node.id);
    // y vào x7 → y cấp 8, z cấp 9: vừa đủ. Vào x8 → z cấp 10: vượt.
    expect(targets).toContain('x7');
    expect(targets).not.toContain('x8');
  });

  it('id không có trong danh sách thì rỗng', () => {
    expect(moveTargets(ITEMS, 'khong-co')).toEqual([]);
  });
});
