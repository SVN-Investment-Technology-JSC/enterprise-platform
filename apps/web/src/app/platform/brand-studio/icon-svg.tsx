import {
  buildIconModel,
  toCamelAttr,
  type BrandPalette,
  type ColorMode,
  type IconDocument,
  type SvgNode,
} from '@enterprise-platform/shared-brand-icon';
import { createElement, type CSSProperties, type ReactNode } from 'react';

function toProps(attrs: Record<string, string>): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) props[toCamelAttr(name)] = value;
  return props;
}

function renderNode(node: SvgNode, index: number): ReactNode {
  return createElement(node.tag, { key: index, ...toProps(node.attrs) }, node.children?.map(renderNode));
}

/**
 * Vẽ icon bằng đúng cây phần tử mà bộ xuất SVG/TSX dùng, nên hình trên màn hình luôn khớp mã xuất.
 * Chế độ `currentColor` lấy màu từ `color` (CSS) nên đổi theo chữ xung quanh; chế độ `brand` dùng màu thật của bảng màu.
 */
export function IconSvg({
  doc,
  palette,
  colorMode = 'brand',
  color,
  className,
  style,
  title,
}: {
  doc: IconDocument;
  palette?: BrandPalette;
  colorMode?: ColorMode;
  /** Màu chữ cho chế độ currentColor; bỏ trống thì kế thừa. */
  color?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const model = buildIconModel(doc, { colorMode, palette });
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      role={title ? 'img' : undefined}
      style={color ? { color, ...style } : style}
      viewBox={model.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      {...toProps(model.rootAttrs)}
    >
      {model.children.map(renderNode)}
    </svg>
  );
}
