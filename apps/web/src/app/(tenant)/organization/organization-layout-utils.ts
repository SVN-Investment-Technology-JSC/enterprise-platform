export type LayoutNode = {
  id: string;
  parentId?: string;
  category?: 'unit' | 'position';
  sortOrder?: number;
  name: string;
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

const CARD_WIDTH = 260; // w-64 card width
const CARD_HEIGHT = 160; // Standard card height
const LEVEL_STEP_Y = 240; // 240px per hierarchy level in top-down mode
const H_GAP = 40; // Horizontal gap in top-down mode
const V_GAP = 80; // Vertical gap between levels in top-down mode

export type LayoutDirection = 'horizontal' | 'vertical';

/**
 * 1. Horizontal Left-to-Right layout (Phân tầng theo chiều dọc Y, mở rộng sang phải)
 * - Level X phát triển từ trái sang phải: X = level * 360px
 * - Các nhánh con xếp dọc theo trục Y, node cha được căn giữa theo chiều cao các con.
 */
export function calculateHorizontalLayout(nodes: LayoutNode[]): LayoutPositions {
  if (!nodes.length) return {};

  const nodeMap = new Map<string, LayoutNode>(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, LayoutNode[]>();

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  childrenMap.forEach((list) => {
    list.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category === 'unit' ? -1 : 1;
      }
      return (
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, 'vi')
      );
    });
  });

  const roots = nodes
    .filter((n) => !n.parentId || !nodeMap.has(n.parentId))
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, 'vi'),
    );

  const LEVEL_GAP_X = 360;
  const SIBLING_GAP_Y = 32;

  const subtreeHeight = new Map<string, number>();

  function computeSubtreeHeight(nodeId: string): number {
    const children = childrenMap.get(nodeId) ?? [];
    if (children.length === 0) {
      subtreeHeight.set(nodeId, CARD_HEIGHT);
      return CARD_HEIGHT;
    }

    let totalHeight = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) totalHeight += SIBLING_GAP_Y;
      totalHeight += computeSubtreeHeight(children[i].id);
    }

    const height = Math.max(CARD_HEIGHT, totalHeight);
    subtreeHeight.set(nodeId, height);
    return height;
  }

  roots.forEach((r) => computeSubtreeHeight(r.id));
  nodes
    .filter((n) => !subtreeHeight.has(n.id))
    .forEach((n) => computeSubtreeHeight(n.id));

  const positions = new Map<string, { x: number; y: number }>();

  function assignPositions(nodeId: string, levelX: number, topY: number) {
    const totalH = subtreeHeight.get(nodeId) ?? CARD_HEIGHT;
    const nodeY = topY + (totalH - CARD_HEIGHT) / 2;

    positions.set(nodeId, {
      x: Math.round(levelX),
      y: Math.round(nodeY),
    });

    const children = childrenMap.get(nodeId) ?? [];
    if (children.length === 0) return;

    let currentChildTopY = topY;
    const nextLevelX = levelX + LEVEL_GAP_X;

    for (const child of children) {
      const childH = subtreeHeight.get(child.id) ?? CARD_HEIGHT;
      assignPositions(child.id, nextLevelX, currentChildTopY);
      currentChildTopY += childH + SIBLING_GAP_Y;
    }
  }

  const ROOT_GAP_Y = 80;
  let currentRootY = 0;

  for (const r of roots) {
    const rHeight = subtreeHeight.get(r.id) ?? CARD_HEIGHT;
    assignPositions(r.id, 0, currentRootY);
    currentRootY += rHeight + ROOT_GAP_Y;
  }

  nodes
    .filter((n) => !positions.has(n.id))
    .forEach((n) => {
      const h = subtreeHeight.get(n.id) ?? CARD_HEIGHT;
      assignPositions(n.id, 0, currentRootY);
      currentRootY += h + ROOT_GAP_Y;
    });

  const result: LayoutPositions = {};
  positions.forEach((pos, id) => {
    result[id] = {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    };
  });

  return result;
}

/**
 * 2. Vertical Top-Down layout (Bố cục trên xuống truyền thống)
 * - Root ở trên, con xòe sang ngang bên dưới.
 */
export function calculateVerticalTopDownLayout(nodes: LayoutNode[]): LayoutPositions {
  if (!nodes.length) return {};

  const nodeMap = new Map<string, LayoutNode>(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, LayoutNode[]>();

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  childrenMap.forEach((list) => {
    list.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category === 'unit' ? -1 : 1;
      }
      return (
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, 'vi')
      );
    });
  });

  const roots = nodes
    .filter((n) => !n.parentId || !nodeMap.has(n.parentId))
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, 'vi'),
    );

  type BoxInfo = {
    width: number;
    height: number;
    isCompactGrid: boolean;
    cols?: number;
    rows?: number;
    colGap?: number;
    rowGap?: number;
  };

  const subtreeBox = new Map<string, BoxInfo>();

  function computeSubtreeBox(nodeId: string): BoxInfo {
    const children = childrenMap.get(nodeId) ?? [];
    if (children.length === 0) {
      const box: BoxInfo = {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        isCompactGrid: false,
      };
      subtreeBox.set(nodeId, box);
      return box;
    }

    const allLeaves = children.every(
      (c) => (childrenMap.get(c.id) ?? []).length === 0,
    );

    if (allLeaves && children.length >= 3) {
      const cols = 2;
      const rows = Math.ceil(children.length / cols);
      const colGap = 28;
      const rowGap = 24;
      const width = cols * CARD_WIDTH + (cols - 1) * colGap;
      const height =
        CARD_HEIGHT + V_GAP + rows * CARD_HEIGHT + (rows - 1) * rowGap;
      const box: BoxInfo = {
        width,
        height,
        isCompactGrid: true,
        cols,
        rows,
        colGap,
        rowGap,
      };
      subtreeBox.set(nodeId, box);
      return box;
    }

    let totalWidth = 0;
    let maxChildHeight = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) totalWidth += H_GAP;
      const childBox = computeSubtreeBox(children[i].id);
      totalWidth += childBox.width;
      maxChildHeight = Math.max(maxChildHeight, childBox.height);
    }

    const width = Math.max(CARD_WIDTH, totalWidth);
    const height = CARD_HEIGHT + V_GAP + maxChildHeight;
    const box: BoxInfo = { width, height, isCompactGrid: false };
    subtreeBox.set(nodeId, box);
    return box;
  }

  roots.forEach((r) => computeSubtreeBox(r.id));
  nodes
    .filter((n) => !subtreeBox.has(n.id))
    .forEach((n) => computeSubtreeBox(n.id));

  const positions = new Map<string, { x: number; y: number }>();

  function assignPositions(nodeId: string, leftX: number, topY: number) {
    const box = subtreeBox.get(nodeId);
    if (!box) return;

    const centerX = leftX + box.width / 2;
    positions.set(nodeId, {
      x: Math.round(centerX - CARD_WIDTH / 2),
      y: Math.round(topY),
    });

    const children = childrenMap.get(nodeId) ?? [];
    if (children.length === 0) return;

    if (box.isCompactGrid && box.cols) {
      const cols = box.cols;
      const colGap = box.colGap ?? 28;
      const rowGap = box.rowGap ?? 24;
      const gridLeft = centerX - box.width / 2;
      const startY = topY + CARD_HEIGHT + V_GAP;

      children.forEach((child, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const childX = gridLeft + col * (CARD_WIDTH + colGap);
        const childY = startY + row * (CARD_HEIGHT + rowGap);
        positions.set(child.id, {
          x: Math.round(childX),
          y: Math.round(childY),
        });
      });
      return;
    }

    let totalChildrenWidth = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) totalChildrenWidth += H_GAP;
      totalChildrenWidth += subtreeBox.get(children[i].id)?.width ?? CARD_WIDTH;
    }

    let childLeft = leftX;
    if (box.width > totalChildrenWidth) {
      childLeft += (box.width - totalChildrenWidth) / 2;
    }

    const nextY = topY + LEVEL_STEP_Y;
    for (const child of children) {
      const childBox = subtreeBox.get(child.id);
      const childWidth = childBox?.width ?? CARD_WIDTH;
      assignPositions(child.id, childLeft, nextY);
      childLeft += childWidth + H_GAP;
    }
  }

  let rootLeft = 0;
  for (const r of roots) {
    const box = subtreeBox.get(r.id);
    assignPositions(r.id, rootLeft, 0);
    rootLeft += (box?.width ?? CARD_WIDTH) + H_GAP * 2;
  }

  nodes
    .filter((n) => !positions.has(n.id))
    .forEach((n) => {
      assignPositions(n.id, rootLeft, 0);
      rootLeft += (subtreeBox.get(n.id)?.width ?? CARD_WIDTH) + H_GAP;
    });

  const xs = [...positions.values()].map((p) => p.x);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const centerOffset = (minX + maxX) / 2;

  const result: LayoutPositions = {};
  positions.forEach((pos, id) => {
    result[id] = {
      x: Math.round(pos.x - centerOffset),
      y: Math.round(pos.y),
    };
  });

  return result;
}

export function calculateHierarchicalLayout(
  nodes: LayoutNode[],
  direction: LayoutDirection = 'horizontal',
): LayoutPositions {
  if (direction === 'vertical') {
    return calculateVerticalTopDownLayout(nodes);
  }
  return calculateHorizontalLayout(nodes);
}
