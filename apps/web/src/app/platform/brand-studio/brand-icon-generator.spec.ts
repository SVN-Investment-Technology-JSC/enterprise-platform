import {
  SVNDTS_ICON_PRESETS,
} from './brand-icon.types';
import {
  generateCleanSvg,
  generateReactComponent,
  getContainerPath,
} from './brand-icon-generator';

describe('brand-icon-generator (Structured SVG Engine)', () => {
  it('generates container paths accurately for all supported shapes', () => {
    const squircle = getContainerPath('squircle', 24, 4);
    expect(squircle).toContain('M');
    expect(squircle).toContain('Z');

    const shield = getContainerPath('shield', 24, 4);
    expect(shield).toContain('M 12 1.25');

    const hexagon = getContainerPath('hexagon', 24, 4);
    expect(hexagon).toContain('M 12 1.25');

    const circle = getContainerPath('circle', 24, 4);
    expect(circle).toContain('A');

    const diamond = getContainerPath('diamond', 24, 4);
    expect(diamond).toContain('M 12 1.25');

    const none = getContainerPath('none', 24, 4);
    expect(none).toBe('');
  });

  it('generates clean SVG without bloat for all SVNDTS presets', () => {
    for (const preset of SVNDTS_ICON_PRESETS) {
      const svg = generateCleanSvg(preset);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain(`viewBox="0 0 ${preset.viewBoxSize} ${preset.viewBoxSize}"`);
      expect(svg).toContain(preset.glyphPath);
      // Kiểm tra không có thuộc tính rác của các phần mềm khác
      expect(svg).not.toContain('inkscape');
      expect(svg).not.toContain('sodipodi');
      expect(svg).not.toContain('adobe');
    }
  });

  it('generates valid React TSX component definition', () => {
    const masterPreset = SVNDTS_ICON_PRESETS[0];
    const tsxCode = generateReactComponent(masterPreset);

    expect(tsxCode).toContain('export function');
    expect(tsxCode).toContain('Icon(props: SVGProps<SVGSVGElement>)');
    expect(tsxCode).toContain('className={className}');
    expect(tsxCode).toContain('{...rest}');
  });
});
