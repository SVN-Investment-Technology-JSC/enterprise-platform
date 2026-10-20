import {
  createDocument,
  createShape,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';

/** Icon mẫu hợp lệ: một khung bo góc viền xanh Sapphire, tô xanh đen, và một hình tròn nhỏ. */
export function sampleDocument(
  overrides: Partial<IconDocument> = {},
): IconDocument {
  return createDocument({
    id: 'icon-a',
    name: 'Biểu tượng A',
    description: 'Icon mẫu cho test',
    category: 'brand',
    tags: ['mau'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shapes: [
      createShape(
        { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 4 },
        {
          id: 'frame',
          name: 'Khung',
          stroke: 'brand:sapphire',
          fill: 'brand:navy',
          strokeWidth: 1.75,
        },
      ),
      createShape(
        { type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 3 },
        { id: 'dot', name: 'Chấm', stroke: 'currentColor' },
      ),
    ],
    ...overrides,
  });
}

/** Icon gồm 15 đường, mỗi đường 2000 điểm neo (vẫn trong giới hạn chuẩn hoá) nhưng vượt cỡ tối đa khi lưu. */
export function oversizedDocument(): IconDocument {
  const nodes = Array.from({ length: 2000 }, (_, index) => ({
    x: 1 + (index % 20) * 1.123456,
    y: 1 + Math.floor(index / 20) * 0.123456,
  }));
  return sampleDocument({
    id: 'icon-big',
    name: 'Icon rất lớn',
    shapes: Array.from({ length: 15 }, (_, index) =>
      createShape(
        { type: 'path', subpaths: [{ nodes, closed: false }] },
        { id: `path-${index}` },
      ),
    ),
  });
}
