import { isValidPathData } from './brand-icon-generator';
import { looksLikeSvgMarkup, svgMarkupToPathData } from './brand-icon-svg-import';

const lucide = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x">${inner}</svg>`;

describe('svgMarkupToPathData', () => {
  it('converts a single relative path and anchors its first moveto', () => {
    const result = svgMarkupToPathData(lucide('<path d="m9 18 6-6-6-6"/>'));
    expect(result.path).toBe('M 9 18 l 6 -6 -6 -6');
    expect(result.warnings).toEqual([]);
  });

  it('keeps later paths in place when joining several elements', () => {
    const result = svgMarkupToPathData(lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'));
    expect(result.path).toBe('M18 6 6 18 M 6 6 l 12 12');
    expect(result.elementCount).toBe(2);
  });

  it('converts circle, rect, line, polyline and polygon', () => {
    const result = svgMarkupToPathData(
      lucide(
        '<circle cx="12" cy="12" r="10"/><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="4" x2="20" y1="12" y2="12"/><polyline points="3 3 6 6 9 3"/><polygon points="0 0 4 0 4 4"/>',
      ),
    );
    expect(result.elementCount).toBe(5);
    expect(result.path).toContain('M 2 12 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 z');
    expect(result.path).toContain('M 5 3 h 14 a 2 2 0 0 1 2 2');
    expect(result.path).toContain('M 4 12 L 20 12');
    expect(result.path).toContain('M 3 3 L 6 6 L 9 3');
    expect(result.path).toContain('M 0 0 L 4 0 L 4 4 z');
    expect(isValidPathData(result.path.length > 4000 ? '' : result.path)).toBe(true);
  });

  it('accepts a bare element without the svg wrapper', () => {
    expect(svgMarkupToPathData('<path d="M1 1 L2 2"/>').path).toBe('M1 1 L2 2');
  });

  it('ignores shapes inside defs and clip paths', () => {
    const result = svgMarkupToPathData(lucide('<defs><clipPath id="c"><rect width="9" height="9"/></clipPath></defs><path d="M1 1 L2 2"/>'));
    expect(result.elementCount).toBe(1);
  });

  it('warns about viewBox, transform and filled icons', () => {
    const result = svgMarkupToPathData(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="scale(2)"><path d="M0 0 L5 5"/></g></svg>',
    );
    expect(result.warnings).toHaveLength(3);
  });

  it('throws readable errors', () => {
    expect(() => svgMarkupToPathData('<svg><path d="M0 0"')).toThrow('không hợp lệ');
    expect(() => svgMarkupToPathData(lucide(''))).toThrow('Không tìm thấy');
  });

  it('recognises markup versus raw path data', () => {
    expect(looksLikeSvgMarkup('  <svg xmlns="x"></svg>')).toBe(true);
    expect(looksLikeSvgMarkup('<path d="M0 0"/>')).toBe(true);
    expect(looksLikeSvgMarkup('M 1 1 L 2 2')).toBe(false);
  });
});
