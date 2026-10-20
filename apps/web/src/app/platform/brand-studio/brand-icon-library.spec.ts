import { SVNDTS_ICON_PRESETS } from './brand-icon.types';
import {
  mergeWithPresets,
  normalizeIconList,
  normalizeIconSpec,
  parseIconLibrary,
} from './brand-icon-library';

const valid = {
  id: 'custom-1',
  name: 'Đơn hàng',
  category: 'custom',
  description: 'Icon đơn hàng',
  viewBoxSize: 24,
  containerShape: 'hexagon',
  containerFill: 'solid',
  strokeWidth: 2,
  colorTone: 'emerald',
  cornerRadius: 4,
  accentDot: true,
  glyphPath: 'M 4 4 L 20 20',
};

describe('brand-icon-library', () => {
  it('accepts a well-formed icon', () => {
    expect(normalizeIconSpec(valid)).toMatchObject({ id: 'custom-1', containerShape: 'hexagon', isCustom: true });
  });

  it('rejects icons without a usable id, name or glyph path', () => {
    expect(normalizeIconSpec(null)).toBeNull();
    expect(normalizeIconSpec({ ...valid, id: 'bad id!' })).toBeNull();
    expect(normalizeIconSpec({ ...valid, name: '  ' })).toBeNull();
    expect(normalizeIconSpec({ ...valid, glyphPath: 'M 1 1" onload="x' })).toBeNull();
    expect(normalizeIconSpec({ ...valid, glyphPath: 42 })).toBeNull();
  });

  it('falls back to safe defaults and clamps numbers', () => {
    const spec = normalizeIconSpec({
      ...valid,
      containerShape: 'star',
      containerFill: 'weird',
      colorTone: 'pink',
      strokeWidth: 99,
      cornerRadius: -3,
      glyphScale: 5,
      secondaryPath: '<script>',
    });
    expect(spec).toMatchObject({
      containerShape: 'squircle',
      containerFill: 'none',
      colorTone: 'sapphire',
      strokeWidth: 4,
      cornerRadius: 0,
    });
    expect(spec?.glyphScale).toBeUndefined();
    expect(spec?.secondaryPath).toBeUndefined();
  });

  it('keeps a valid glyph scale and secondary path', () => {
    const spec = normalizeIconSpec({ ...valid, glyphScale: 0.7, secondaryPath: 'M 1 1 L 2 2' });
    expect(spec?.glyphScale).toBe(0.7);
    expect(spec?.secondaryPath).toBe('M 1 1 L 2 2');
  });

  it('skips broken and duplicate entries instead of failing the whole import', () => {
    const { icons, skipped } = normalizeIconList([valid, { ...valid }, { nonsense: true }, { ...valid, id: 'custom-2' }]);
    expect(icons.map((icon) => icon.id)).toEqual(['custom-1', 'custom-2']);
    expect(skipped).toBe(2);
  });

  it('throws readable errors for bad files', () => {
    expect(() => parseIconLibrary('not json')).toThrow('JSON');
    expect(() => parseIconLibrary('{"a":1}')).toThrow('mảng');
    expect(parseIconLibrary(JSON.stringify([valid])).icons).toHaveLength(1);
  });

  it('adds presets that are missing from a stored library without duplicating', () => {
    const stored = [{ ...SVNDTS_ICON_PRESETS[0], strokeWidth: 3 }];
    const merged = mergeWithPresets(stored);
    expect(merged).toHaveLength(SVNDTS_ICON_PRESETS.length);
    expect(merged[0].strokeWidth).toBe(3);
    expect(new Set(merged.map((icon) => icon.id)).size).toBe(merged.length);
  });
});
