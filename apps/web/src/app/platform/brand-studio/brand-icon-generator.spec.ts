import ts from 'typescript';
import { SVNDTS_ICON_PRESETS, type StructuredIconSpec } from './brand-icon.types';
import {
  buildIconModel,
  generateCleanSvg,
  generateReactComponent,
  getAccentPosition,
  getContainerInset,
  getContainerPath,
  isValidPathData,
  resolveGlyphScale,
  sanitizePathData,
  toComponentName,
} from './brand-icon-generator';

const master = SVNDTS_ICON_PRESETS[0];

function syntaxErrors(tsx: string): string[] {
  const result = ts.transpileModule(tsx, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
  });
  return (result.diagnostics ?? []).map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}

describe('brand-icon-generator (Structured SVG Engine)', () => {
  it('generates container paths accurately for all supported shapes', () => {
    const squircle = getContainerPath('squircle', 24, 4);
    expect(squircle).toContain('M');
    expect(squircle).toContain('Z');

    expect(getContainerPath('shield', 24, 4)).toContain('M 12 1.25');
    expect(getContainerPath('hexagon', 24, 4)).toContain('M 12 1.25');
    expect(getContainerPath('circle', 24, 4)).toContain('A');
    expect(getContainerPath('diamond', 24, 4)).toContain('M 12 1.25');
    expect(getContainerPath('none', 24, 4)).toBe('');
  });

  it('keeps thick strokes inside the viewBox', () => {
    expect(getContainerInset(1.75)).toBe(1.25);
    expect(getContainerInset(3)).toBe(1.75);
    // nửa nét (1.5) không vượt quá khoảng chừa
    expect(getContainerInset(3)).toBeGreaterThanOrEqual(3 / 2);
    expect(getContainerPath('diamond', 24, 4, 3)).toContain('M 12 1.75');
  });

  it('places the accent dot on or inside every container', () => {
    const shapes = ['squircle', 'shield', 'hexagon', 'circle', 'diamond', 'none'] as const;
    for (const shape of shapes) {
      const { cx, cy } = getAccentPosition(shape, 24, 1.75);
      expect(cx).toBeGreaterThan(12);
      expect(cy).toBeLessThan(12);
      if (shape === 'circle') {
        expect(Math.hypot(cx - 12, cy - 12)).toBeLessThanOrEqual((24 - 2.5) / 2);
      }
      if (shape === 'diamond') {
        expect(Math.abs(cx - 12) + Math.abs(cy - 12)).toBeLessThanOrEqual(24 / 2 - 1.25);
      }
    }
  });

  it('shrinks the glyph so it stays inside a diamond container', () => {
    const procedure = SVNDTS_ICON_PRESETS.find((item) => item.id === 'procedure-module') as StructuredIconSpec;
    const scale = resolveGlyphScale(procedure);
    expect(scale).toBeLessThan(1);
    // góc xa nhất của nét gốc (6,6) so với tâm; hình thoi chỉ chứa |dx|+|dy| <= 12 - 1.25
    const corner = (Math.abs(6 - 12) + Math.abs(6 - 12)) * scale;
    expect(corner).toBeLessThanOrEqual(12 - 1.25 - procedure.strokeWidth / 2);
  });

  it('honours an explicit glyph scale and ignores out-of-range values', () => {
    expect(resolveGlyphScale({ containerShape: 'circle', glyphScale: 0.6 })).toBe(0.6);
    expect(resolveGlyphScale({ containerShape: 'circle', glyphScale: 9 })).toBe(0.85);
    expect(resolveGlyphScale({ containerShape: 'squircle' })).toBe(1);
  });

  it('generates clean SVG without bloat for all SVNDTS presets', () => {
    for (const preset of SVNDTS_ICON_PRESETS) {
      const svg = generateCleanSvg(preset);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain(`viewBox="0 0 ${preset.viewBoxSize} ${preset.viewBoxSize}"`);
      expect(svg).toContain(preset.glyphPath);
      expect(svg).not.toContain('inkscape');
      expect(svg).not.toContain('sodipodi');
      expect(svg).not.toContain('adobe');
    }
  });

  it('uses currentColor only by default so the icon follows its context', () => {
    for (const preset of SVNDTS_ICON_PRESETS) {
      expect(generateCleanSvg(preset)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it('hard-codes the brand colour only in brand mode', () => {
    const svg = generateCleanSvg(master, { colorMode: 'brand' });
    expect(svg).toContain('#2563eb');
    expect(svg).toContain('url(#svndts-grad-svndts-master)');
  });

  it('renders the gradient with a matching id reference', () => {
    const svg = generateCleanSvg(master, { gradientId: 'g1' });
    expect(svg).toContain('id="g1"');
    expect(svg).toContain('fill="url(#g1)"');
  });

  it('drops path data that could break out of the attribute', () => {
    const evil = { ...master, glyphPath: 'M 1 1" onload="alert(1)', secondaryPath: 'M 0 0 <script>' };
    const svg = generateCleanSvg(evil);
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('<script>');
    expect(isValidPathData('M 1 1 L 2 2 Z')).toBe(true);
    expect(isValidPathData('L 1 1')).toBe(false);
    expect(isValidPathData('M 1 1"')).toBe(false);
    expect(sanitizePathData('  M 1 1 ')).toBe('M 1 1');
    expect(sanitizePathData('M 1 1;')).toBe('');
  });

  it('does not let a name close the SVG comment', () => {
    const svg = generateCleanSvg({ ...master, name: 'A --> <b> B' });
    expect(svg.match(/<!--/g)).toHaveLength(1);
    expect(svg.match(/-->/g)).toHaveLength(1);
  });

  it('builds the same model the exporters use', () => {
    const model = buildIconModel(master, { colorMode: 'brand' });
    expect(model.viewBox).toBe('0 0 24 24');
    expect(model.children.some((node) => node.tag === 'circle')).toBe(true);
  });
});

describe('generateReactComponent', () => {
  it('produces syntactically valid TSX for every preset in both colour modes', () => {
    for (const preset of SVNDTS_ICON_PRESETS) {
      for (const colorMode of ['currentColor', 'brand'] as const) {
        const tsx = generateReactComponent(preset, { colorMode });
        expect(syntaxErrors(tsx)).toEqual([]);
      }
    }
  });

  it('uses React attribute names and no HTML comments', () => {
    const tsx = generateReactComponent(master);
    expect(tsx).not.toContain('<!--');
    expect(tsx).not.toMatch(/stroke-width|stroke-linecap|stop-color|stop-opacity|fill-opacity/);
    expect(tsx).toContain('strokeWidth=');
    expect(tsx).toContain('className={className}');
    expect(tsx).toContain('{...rest}');
    expect(tsx).toContain('Icon(props: SVGProps<SVGSVGElement>)');
    expect(tsx).toContain('aria-hidden="true"');
  });

  it('gives each gradient instance a unique id through useId', () => {
    const tsx = generateReactComponent(master);
    expect(tsx).toContain("import { useId, type SVGProps } from 'react';");
    expect(tsx).toContain('useId()');
    expect(tsx).toContain('id={gradientId}');
    expect(tsx).toContain('fill={`url(#${gradientId})`}');

    const plain = generateReactComponent(SVNDTS_ICON_PRESETS.find((item) => item.containerFill === 'none') as StructuredIconSpec);
    expect(plain).not.toContain('useId');
  });

  it('keeps Vietnamese names readable in the component name', () => {
    expect(toComponentName('Quản trị Nhân sự (HRM)')).toBe('QuanTriNhanSuHRMIcon');
    expect(toComponentName('Đơn hàng')).toBe('DonHangIcon');
    expect(toComponentName('SVNDTS Master Logo')).toBe('SVNDTSMasterLogoIcon');
    expect(toComponentName('Bell Icon')).toBe('BellIcon');
    expect(toComponentName('3D kho')).toBe('Icon3DKhoIcon');
    expect(toComponentName('???')).toBe('BrandIcon');
  });
});
