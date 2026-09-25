import {
  assertDepthWithinLimit,
  assertMoveAllowed,
  dependencyWouldCycle,
  depthFor,
  descendantsOf,
  nextSortOrder,
  wouldCreateCycle,
  type TreeNode,
} from './wbs.rules.js';
import { WorkspaceValidationError } from './workspace.error.js';

/** Cây: a → b → c, và a → d. */
const TREE: TreeNode[] = [
  { id: 'a', parentId: null, depth: 0, sortOrder: 0 },
  { id: 'b', parentId: 'a', depth: 1, sortOrder: 0 },
  { id: 'c', parentId: 'b', depth: 2, sortOrder: 0 },
  { id: 'd', parentId: 'a', depth: 1, sortOrder: 1 },
];

describe('depthFor', () => {
  it('node gốc có độ sâu 0', () => {
    expect(depthFor(undefined)).toBe(0);
  });

  it('con sâu hơn cha đúng một cấp', () => {
    expect(depthFor({ id: 'b', depth: 1 })).toBe(2);
  });
});

describe('assertDepthWithinLimit', () => {
  it('chấp nhận cấp sâu nhất còn hợp lệ', () => {
    // 10 cấp nghĩa là depth chạy 0..9, nên 9 vẫn phải qua.
    expect(() => assertDepthWithinLimit(9)).not.toThrow();
  });

  it('chặn cấp thứ 11', () => {
    expect(() => assertDepthWithinLimit(10)).toThrow(WorkspaceValidationError);
  });
});

describe('descendantsOf', () => {
  it('gồm cả chính nó và mọi hậu duệ', () => {
    expect([...descendantsOf(TREE, 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('node lá chỉ có chính nó', () => {
    expect([...descendantsOf(TREE, 'c')]).toEqual(['c']);
  });
});

describe('wouldCreateCycle', () => {
  it('tự làm cha của chính mình là vòng lặp', () => {
    expect(wouldCreateCycle(TREE, 'b', 'b')).toBe(true);
  });

  it('làm con của hậu duệ là vòng lặp', () => {
    expect(wouldCreateCycle(TREE, 'a', 'c')).toBe(true);
  });

  it('chuyển sang nhánh khác thì hợp lệ', () => {
    expect(wouldCreateCycle(TREE, 'c', 'd')).toBe(false);
  });

  it('đưa lên làm node gốc thì hợp lệ', () => {
    expect(wouldCreateCycle(TREE, 'c', null)).toBe(false);
  });
});

describe('assertMoveAllowed', () => {
  it('chặn khi tạo vòng lặp', () => {
    expect(() => assertMoveAllowed(TREE, 'a', { id: 'c', depth: 2 })).toThrow(
      WorkspaceValidationError,
    );
  });

  it('chặn khi nhánh con bị đẩy quá 10 cấp', () => {
    // Nhánh 'a' cao 3 cấp (a,b,c). Đặt dưới một node ở depth 8 thì 'c' rơi
    // vào depth 11 — phải bị chặn dù bản thân 'a' vẫn còn chỗ.
    expect(() => assertMoveAllowed(TREE, 'a', { id: 'deep', depth: 8 })).toThrow(
      WorkspaceValidationError,
    );
  });

  it('cho phép khi nhánh vẫn nằm trong giới hạn', () => {
    expect(() => assertMoveAllowed(TREE, 'a', { id: 'shallow', depth: 5 })).not.toThrow();
  });
});

describe('nextSortOrder', () => {
  it('nhóm rỗng bắt đầu từ 0', () => {
    expect(nextSortOrder(TREE, 'c')).toBe(0);
  });

  it('nối tiếp sau anh em lớn nhất', () => {
    expect(nextSortOrder(TREE, 'a')).toBe(2);
  });

  it('coi parentId rỗng và null là cùng một nhóm gốc', () => {
    expect(nextSortOrder(TREE, null)).toBe(1);
    expect(nextSortOrder(TREE, undefined)).toBe(1);
  });
});

describe('dependencyWouldCycle', () => {
  const edges = [
    { predecessorId: 't1', successorId: 't2' },
    { predecessorId: 't2', successorId: 't3' },
  ];

  it('cạnh tự trỏ là chu trình', () => {
    expect(dependencyWouldCycle(edges, 't1', 't1')).toBe(true);
  });

  it('khép vòng qua nhiều bước là chu trình', () => {
    // t3 → t1 sẽ khép vòng t1 → t2 → t3 → t1.
    expect(dependencyWouldCycle(edges, 't3', 't1')).toBe(true);
  });

  it('cạnh nối tiếp bình thường thì hợp lệ', () => {
    expect(dependencyWouldCycle(edges, 't3', 't4')).toBe(false);
  });

  it('đồ thị rỗng luôn hợp lệ', () => {
    expect(dependencyWouldCycle([], 'x', 'y')).toBe(false);
  });
});
