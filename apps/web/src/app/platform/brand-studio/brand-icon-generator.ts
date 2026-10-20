import {
  BRAND_COLORS,
  type ContainerShape,
  type StructuredIconSpec,
} from './brand-icon.types';

/**
 * Tạo SVG path chính xác theo hình học cho khung chứa (Container Shape)
 */
export function getContainerPath(
  shape: ContainerShape,
  size = 24,
  radius = 4,
): string {
  if (shape === 'none') return '';

  const padding = 1.25;
  const min = padding;
  const max = size - padding;
  const mid = size / 2;
  const r = Math.min(Math.max(radius, 2), (size - padding * 2) / 2);

  switch (shape) {
    case 'squircle':
      return `M ${min + r} ${min} H ${max - r} A ${r} ${r} 0 0 1 ${max} ${min + r} V ${max - r} A ${r} ${r} 0 0 1 ${max - r} ${max} H ${min + r} A ${r} ${r} 0 0 1 ${min} ${max - r} V ${min + r} A ${r} ${r} 0 0 1 ${min + r} ${min} Z`;

    case 'shield':
      // Hình khiên bảo mật doanh nghiệp đối xứng
      return `M ${mid} ${min} L ${max - 1} ${min + 3.5} V ${mid} C ${max - 1} ${max - 2} ${mid} ${max} ${mid} ${max} C ${mid} ${max} ${min + 1} ${max - 2} ${min + 1} ${mid} V ${min + 3.5} Z`;

    case 'hexagon':
      // Lục giác vát cạnh kỹ thuật
      const dy = (max - min) / 4;
      return `M ${mid} ${min} L ${max} ${min + dy} V ${max - dy} L ${mid} ${max} L ${min} ${max - dy} V ${min + dy} Z`;

    case 'circle':
      const cr = (size - padding * 2) / 2;
      return `M ${mid - cr} ${mid} A ${cr} ${cr} 0 1 0 ${mid + cr} ${mid} A ${cr} ${cr} 0 1 0 ${mid - cr} ${mid} Z`;

    case 'diamond':
      return `M ${mid} ${min} L ${max} ${mid} L ${mid} ${max} L ${min} ${mid} Z`;

    default:
      return '';
  }
}

/**
 * Sinh chuỗi SVG sạch 100%, tuân thủ triết lý Structured SVG (không metadata thừa)
 */
export function generateCleanSvg(spec: StructuredIconSpec): string {
  const colorDef = BRAND_COLORS[spec.colorTone] ?? BRAND_COLORS.sapphire;
  const size = spec.viewBoxSize;
  const containerPath = getContainerPath(spec.containerShape, size, spec.cornerRadius);

  let fillDef = 'none';
  let gradientSnippet = '';

  if (spec.containerFill === 'solid') {
    fillDef = colorDef.bgSoft;
  } else if (spec.containerFill === 'gradient') {
    fillDef = `url(#grad-${spec.id})`;
    gradientSnippet = `
  <defs>
    <linearGradient id="grad-${spec.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorDef.primary}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${colorDef.secondary}" stop-opacity="0.05" />
    </linearGradient>
  </defs>`;
  }

  const containerElem = containerPath
    ? `  <path d="${containerPath}" fill="${fillDef}" stroke="${colorDef.primary}" stroke-width="${spec.strokeWidth}" stroke-linejoin="round" />\n`
    : '';

  const secondaryElem = spec.secondaryPath
    ? `  <path d="${spec.secondaryPath}" stroke="${colorDef.border}" stroke-width="${spec.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" />\n`
    : '';

  const accentElem = spec.accentDot
    ? `  <circle cx="${size - 3.5}" cy="3.5" r="1.5" fill="${colorDef.primary}" />\n`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor">
  <!-- SVNDTS Structured SVG - ${spec.name} -->${gradientSnippet}
${containerElem}  <path d="${spec.glyphPath}" stroke="${colorDef.primary}" stroke-width="${spec.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />
${secondaryElem}${accentElem}</svg>`.trim();
}

/**
 * Sinh mã nguồn React Component TSX sẵn sàng nhúng vào @enterprise-platform/shared-ui
 */
export function generateReactComponent(spec: StructuredIconSpec): string {
  const componentName = spec.name
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('') + 'Icon';

  const cleanSvg = generateCleanSvg(spec);

  return `import type { SVGProps } from 'react';

/**
 * ${spec.name}
 * ${spec.description}
 * Chuẩn nhận diện thương hiệu SVNDTS (Structured SVG)
 */
export function ${componentName}(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;
  return (
    ${cleanSvg
      .replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" className={className} {...rest}')
      .split('\n')
      .map((line, idx) => (idx === 0 ? line : `    ${line}`))
      .join('\n')}
  );
}
`;
}

/**
 * Tải file SVG trực tiếp trên trình duyệt
 */
export function downloadSvgFile(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
