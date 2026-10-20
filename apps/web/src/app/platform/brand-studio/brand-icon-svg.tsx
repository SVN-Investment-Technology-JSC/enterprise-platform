import { createElement, useId, type ReactNode } from 'react';
import { buildIconModel, toCamelAttr, type SvgNode } from './brand-icon-generator';
import { BRAND_COLORS, type ExportColorMode, type StructuredIconSpec } from './brand-icon.types';

function toReactProps(attrs: SvgNode['attrs']): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === 'object') continue;
    props[toCamelAttr(name)] = value;
  }
  return props;
}

function renderNode(node: SvgNode, index: number): ReactNode {
  return createElement(
    node.tag,
    { key: index, ...toReactProps(node.attrs) },
    node.children?.map((child, childIndex) => renderNode(child, childIndex)),
  );
}

/**
 * Vẽ icon bằng đúng cây phần tử mà bộ xuất SVG/TSX dùng, nên không có chỗ để hình trên màn hình lệch khỏi mã xuất.
 * Thuộc tính `color` đặt theo tông thương hiệu để chế độ `currentColor` hiển thị đúng màu khi xem trước.
 */
export function BrandIconSvg({
  spec,
  colorMode = 'brand',
  className,
}: {
  spec: StructuredIconSpec;
  colorMode?: ExportColorMode;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const model = buildIconModel(spec, { colorMode, gradientId: `bi-${uid}` });
  const tone = BRAND_COLORS[spec.colorTone] ?? BRAND_COLORS.sapphire;

  return (
    <svg
      aria-hidden="true"
      className={className}
      style={{ color: tone.primary }}
      viewBox={model.viewBox}
      {...toReactProps(model.rootAttrs)}
    >
      {model.children.map((child, index) => renderNode(child, index))}
    </svg>
  );
}
