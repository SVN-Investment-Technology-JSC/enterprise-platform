'use client';

import {
  buildIconModel,
  toCamelAttr,
  type BrandPalette,
  type ColorMode,
  type IconDocument,
  type SvgNode,
} from '@enterprise-platform/shared-brand-icon';
import { createElement, memo, useMemo, type ReactNode } from 'react';

/** Màu mực dùng cho `currentColor` trên canvas. */
export const CANVAS_INK = '#0f172a';
const GRID_MINOR = '#e8edf3';
const GRID_MAJOR = '#d3dbe5';
const FRAME_LINE = '#b6c2d1';
const SAFE_LINE = '#7aa7f5';

function toProps(attrs: Record<string, string>): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) props[toCamelAttr(name)] = value;
  return props;
}

function renderNode(node: SvgNode, index: number): ReactNode {
  return createElement(node.tag, { key: index, ...toProps(node.attrs) }, node.children?.map(renderNode));
}

/**
 * Các lớp hình của icon trong toạ độ lưới. Dùng đúng cây phần tử của bộ xuất (`buildIconModel`) nên hình trên canvas
 * luôn khớp mã xuất. Bọc `memo` để chỉ vẽ lại khi tài liệu, bảng màu hoặc chế độ màu đổi, không vẽ lại khi con trỏ di chuyển.
 */
export const ShapesLayer = memo(function ShapesLayer({
  doc,
  colorMode,
  palette,
  opacity = 1,
}: {
  doc: IconDocument;
  colorMode: ColorMode;
  palette: BrandPalette;
  opacity?: number;
}) {
  const model = useMemo(() => buildIconModel(doc, { colorMode, palette }), [doc, colorMode, palette]);
  return (
    <g {...toProps(model.rootAttrs)} opacity={opacity} pointerEvents="none" style={{ color: CANVAS_INK }}>
      {model.children.map(renderNode)}
    </g>
  );
});

/**
 * Mặt giấy vẽ: nền trắng, lưới (vạch đậm mỗi 4 ô), viền lưới và vùng an toàn mờ.
 * Nét vẽ dùng `non-scaling-stroke` nên luôn mảnh 1 pixel dù phóng to bao nhiêu.
 */
export const GridLayer = memo(function GridLayer({
  size,
  safePadding,
  showGrid,
  fine,
}: {
  size: number;
  safePadding: number;
  showGrid: boolean;
  /** Đủ gần để vẽ từng đơn vị lưới. */
  fine: boolean;
}) {
  const { minor, major } = useMemo(() => {
    const minorParts: string[] = [];
    const majorParts: string[] = [];
    for (let line = 1; line < size; line += 1) {
      const part = `M ${line} 0 V ${size} M 0 ${line} H ${size}`;
      (line % 4 === 0 ? majorParts : minorParts).push(part);
    }
    return { minor: minorParts.join(' '), major: majorParts.join(' ') };
  }, [size]);

  const pad = Math.min(safePadding, size / 2);
  return (
    <g pointerEvents="none" fill="none">
      <rect x={0} y={0} width={size} height={size} fill="#ffffff" />
      {showGrid && fine ? <path d={minor} stroke={GRID_MINOR} strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
      {showGrid ? <path d={major} stroke={GRID_MAJOR} strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
      {pad > 0 ? (
        <rect
          x={pad}
          y={pad}
          width={size - pad * 2}
          height={size - pad * 2}
          stroke={SAFE_LINE}
          strokeOpacity={0.55}
          strokeDasharray="3 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <rect x={0} y={0} width={size} height={size} stroke={FRAME_LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

/** Làm mờ phần nằm ngoài khung vẽ, vì phần đó bị cắt khi xuất. */
export const OutsideMask = memo(function OutsideMask({ size }: { size: number }) {
  const far = 100000;
  return (
    <path
      d={`M ${-far} ${-far} H ${far} V ${far} H ${-far} Z M 0 0 V ${size} H ${size} V 0 Z`}
      fill="#f1f5f9"
      fillOpacity={0.72}
      fillRule="evenodd"
      pointerEvents="none"
    />
  );
});
