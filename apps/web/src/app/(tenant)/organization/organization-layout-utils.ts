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
const H_GAP = 40; // Horizontal gap between subtrees
const V_GAP = 80; // Vertical gap between levels for clear smoothstep edges
const LEVEL_STEP_Y = CARD_HEIGHT + V_GAP; // 240px per hierarchy level

/**
 * Calculates a balanced, clean, and aesthetic hierarchical tree layout for organization charts.
 * Features:
 * - Subtree width calculation for true visual centering of parents over children.
 * - 2-column compact grid packing for nodes with >= 3 leaf children (prevents 10,000px+ horizontal stretching).
 * - Leaves with only 1 or 2 children remain horizontally centered.
 * - Perfectly centers the entire tree structure horizontally at x = 0.
 */
export function calculateHierarchicalLayout(nodes: LayoutNode[]): LayoutPositions {
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

  // Sort children: 'unit' before 'position', then sortOrder, then alphabetical
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

    // If all children are leaves and count >= 3, pack them into a neat 2-column grid
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

    // Standard horizontal hierarchical layout
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

  // Handle orphan / disconnected nodes if any
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

  // Handle remaining nodes
  nodes
    .filter((n) => !positions.has(n.id))
    .forEach((n) => {
      assignPositions(n.id, rootLeft, 0);
      rootLeft += (subtreeBox.get(n.id)?.width ?? CARD_WIDTH) + H_GAP;
    });

  // Horizontally center entire tree at x = 0
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
