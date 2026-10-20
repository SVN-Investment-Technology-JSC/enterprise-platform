import { flattenGeometry, geometryBounds, hitTestShape, visualBounds } from './geometry.js';
import { GLYPH_LIBRARY, LEGACY_PRESETS, type LegacyIconSpec } from './legacy-data.js';
import {
  FRAME_KINDS,
  FRAME_LABELS,
  PRESET_IDS,
  createFrameShape,
  createPresetDocuments,
  documentFromLegacySpec,
  frameGeometry,
  frameInset,
  type FrameKind,
} from './legacy.js';
import { createShape, type EllipseGeometry, type IconDocument, type PathGeometry, type RectGeometry } from './model.js';
import { isValidPathData, parsePathData } from './path-data.js';

const TIMESTAMP = '2026-10-16T00:00:00.000Z';
const spec = (overrides: Partial<LegacyIconSpec> = {}): LegacyIconSpec => ({ ...LEGACY_PRESETS[2], ...overrides });

describe('khung chứa', () => {
  it('frameInset chừa tối thiểu 1,25 và tăng theo độ dày nét', () => {
    expect(frameInset()).toBe(1.25);
    expect(frameInset(1.75)).toBe(1.25);
    expect(frameInset(3)).toBe(1.75);
    expect(frameInset(3)).toBeGreaterThanOrEqual(3 / 2);
  });

  it('FRAME_KINDS và nhãn tiếng Việt đủ cho mọi khung', () => {
    expect(FRAME_KINDS).toEqual(['squircle', 'circle', 'hexagon', 'diamond', 'shield']);
    for (const kind of FRAME_KINDS) expect(FRAME_LABELS[kind].length).toBeGreaterThan(0);
  });

  it('mọi khung, mọi cỡ lưới và độ dày nét: cả nét viền nằm gọn trong lưới', () => {
    for (const kind of FRAME_KINDS) {
      for (const size of [16, 24, 32, 48]) {
        for (const strokeWidth of [0.5, 1.75, 3, 4]) {
          const shape = createFrameShape(kind, { size, strokeWidth });
          const bounds = visualBounds(shape);
          expect(bounds.x).toBeGreaterThanOrEqual(-1e-6);
          expect(bounds.y).toBeGreaterThanOrEqual(-1e-6);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(size + 1e-6);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(size + 1e-6);
        }
      }
    }
  });

  it('khung đối xứng qua trục dọc giữa lưới', () => {
    for (const kind of FRAME_KINDS) {
      const bounds = geometryBounds(frameGeometry(kind, 24, 4, 1.75));
      expect(bounds.x + bounds.width / 2).toBeCloseTo(12, 5);
    }
  });

  it('khung vuông bo góc, tròn, lục giác, thoi, khiên có hình học đúng loại', () => {
    expect(frameGeometry('squircle', 24, 5, 1.75)).toEqual({ type: 'rect', x: 1.25, y: 1.25, width: 21.5, height: 21.5, rx: 5 });
    expect(frameGeometry('circle', 24, 4, 1.75)).toEqual({ type: 'ellipse', cx: 12, cy: 12, rx: 10.75, ry: 10.75 });
    for (const kind of ['hexagon', 'diamond', 'shield'] as const) {
      const geometry = frameGeometry(kind, 24, 4, 1.75) as PathGeometry;
      expect(geometry.type).toBe('path');
      expect(geometry.subpaths).toHaveLength(1);
      expect(geometry.subpaths[0].closed).toBe(true);
    }
    expect((frameGeometry('hexagon') as PathGeometry).subpaths[0].nodes).toHaveLength(6);
    expect((frameGeometry('diamond') as PathGeometry).subpaths[0].nodes).toHaveLength(4);
  });

  it('bo góc của khung vuông bị kẹp trong khoảng hợp lý', () => {
    expect((frameGeometry('squircle', 24, 0) as RectGeometry).rx).toBe(2);
    expect((frameGeometry('squircle', 24, 99) as RectGeometry).rx).toBeCloseTo(10.75);
    expect((frameGeometry('squircle', 24, 4) as RectGeometry).rx).toBe(4);
  });

  it('createFrameShape đặt tên, nét mặc định currentColor, không tô', () => {
    const shape = createFrameShape('hexagon');
    expect(shape.name).toBe('Khung lục giác');
    expect(shape).toMatchObject({ stroke: 'currentColor', fill: 'none', fillOpacity: 1, strokeWidth: 1.75 });
    const custom = createFrameShape('circle', { stroke: 'brand:emerald', fill: 'brand:emerald', fillOpacity: 0.2, strokeWidth: 2 });
    expect(custom).toMatchObject({ stroke: 'brand:emerald', fill: 'brand:emerald', fillOpacity: 0.2, strokeWidth: 2 });
  });
});

describe('documentFromLegacySpec', () => {
  it('chuyển các trường cơ bản', () => {
    const doc = documentFromLegacySpec(spec(), TIMESTAMP);
    expect(doc).toMatchObject({
      schema: 1,
      id: 'hrm-module',
      name: LEGACY_PRESETS[2].name,
      category: 'module',
      tags: [],
      status: 'published',
      size: 24,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
  });

  it('khung + nét chính (+ nét phụ + điểm nhấn) theo đúng thứ tự lớp và tên', () => {
    const master = documentFromLegacySpec(LEGACY_PRESETS[0], TIMESTAMP);
    expect(master.shapes.map((shape) => shape.name)).toEqual(['Khung', 'Nét chính', 'Nét phụ', 'Điểm nhấn']);
    const plain = documentFromLegacySpec(spec({ accentDot: false, secondaryPath: undefined }), TIMESTAMP);
    expect(plain.shapes.map((shape) => shape.name)).toEqual(['Khung', 'Nét chính']);
    const noFrame = documentFromLegacySpec(spec({ containerShape: 'none' }), TIMESTAMP);
    expect(noFrame.shapes.map((shape) => shape.name)).toEqual(['Nét chính']);
  });

  it('màu nhận diện chuyển thành brand:<khoá>; nét phụ mờ 0,6; chấm nhấn chỉ tô', () => {
    const doc = documentFromLegacySpec(LEGACY_PRESETS[0], TIMESTAMP);
    const [frame, glyph, secondary, dot] = doc.shapes;
    expect(frame.stroke).toBe('brand:sapphire');
    expect(glyph.stroke).toBe('brand:sapphire');
    expect(glyph.fill).toBe('none');
    expect(secondary.opacity).toBe(0.6);
    expect(dot).toMatchObject({ fill: 'brand:sapphire', stroke: 'none' });
    expect((dot.geometry as EllipseGeometry).rx).toBe(1.5);
  });

  it('nền khung: solid 0,12, gradient 0,15, none thì không tô', () => {
    expect(documentFromLegacySpec(spec({ containerFill: 'solid' }), TIMESTAMP).shapes[0]).toMatchObject({ fill: 'brand:sapphire', fillOpacity: 0.12 });
    expect(documentFromLegacySpec(spec({ containerFill: 'gradient' }), TIMESTAMP).shapes[0]).toMatchObject({ fill: 'brand:sapphire', fillOpacity: 0.15 });
    expect(documentFromLegacySpec(spec({ containerFill: 'none' }), TIMESTAMP).shapes[0]).toMatchObject({ fill: 'none', fillOpacity: 1 });
  });

  it('tỉ lệ co mặc định theo khung, tỉ lệ tuỳ chỉnh hợp lệ được giữ, ngoài khoảng thì bỏ', () => {
    const glyphWidth = (overrides: Partial<LegacyIconSpec>) => {
      const doc = documentFromLegacySpec(spec({ glyphPath: 'M 4 12 L 20 12', accentDot: false, secondaryPath: undefined, ...overrides }), TIMESTAMP);
      const glyph = doc.shapes[doc.shapes.length - 1];
      return geometryBounds(glyph.geometry).width;
    };
    expect(glyphWidth({ containerShape: 'squircle' })).toBeCloseTo(16);
    expect(glyphWidth({ containerShape: 'circle' })).toBeCloseTo(16 * 0.85);
    expect(glyphWidth({ containerShape: 'shield' })).toBeCloseTo(16 * 0.8);
    expect(glyphWidth({ containerShape: 'diamond' })).toBeCloseTo(16 * 0.7);
    expect(glyphWidth({ containerShape: 'none' })).toBeCloseTo(16);
    expect(glyphWidth({ containerShape: 'circle', glyphScale: 0.5 })).toBeCloseTo(8);
    expect(glyphWidth({ containerShape: 'circle', glyphScale: 9 })).toBeCloseTo(16 * 0.85);
    expect(glyphWidth({ containerShape: 'circle', glyphScale: 0.1 })).toBeCloseTo(16 * 0.85);
  });

  it('co hình quanh tâm lưới nên tâm của nét không dịch', () => {
    const doc = documentFromLegacySpec(spec({ glyphPath: 'M 8 12 L 16 12', containerShape: 'circle', accentDot: false, secondaryPath: undefined }), TIMESTAMP);
    const bounds = geometryBounds(doc.shapes[1].geometry);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(12);
    expect(bounds.y).toBeCloseTo(12);
  });

  it('đường dữ liệu không hợp lệ hoặc rỗng thì bỏ lớp đó, không ném lỗi', () => {
    for (const glyphPath of ['', 'L 1 1', 'M 1 1" x="y', 'M 1 1 X 3', 'M 5']) {
      const doc = documentFromLegacySpec(spec({ glyphPath, secondaryPath: undefined, accentDot: false }), TIMESTAMP);
      expect(doc.shapes.map((shape) => shape.name)).toEqual(['Khung']);
    }
    const doc = documentFromLegacySpec(spec({ secondaryPath: 'bậy bạ' }), TIMESTAMP);
    expect(doc.shapes.some((shape) => shape.name === 'Nét phụ')).toBe(false);
  });

  it('mã icon sai định dạng được cấp mã mới', () => {
    expect(documentFromLegacySpec(spec({ id: 'ok-1' }), TIMESTAMP).id).toBe('ok-1');
    expect(documentFromLegacySpec(spec({ id: 'a b' }), TIMESTAMP).id).toMatch(/^icon-/);
    expect(documentFromLegacySpec(spec({ id: '' }), TIMESTAMP).id).toMatch(/^icon-/);
  });

  it('độ dày nét bị kẹp trong 0,5..4 và số lỗi dùng mặc định 1,75', () => {
    expect(documentFromLegacySpec(spec({ strokeWidth: 9 }), TIMESTAMP).shapes[1].strokeWidth).toBe(4);
    expect(documentFromLegacySpec(spec({ strokeWidth: 0 }), TIMESTAMP).shapes[1].strokeWidth).toBe(0.5);
    expect(documentFromLegacySpec(spec({ strokeWidth: Number.NaN }), TIMESTAMP).shapes[1].strokeWidth).toBe(1.75);
  });

  it('cỡ lưới không hợp lệ quay về 24; tên và mô tả được cắt gọn', () => {
    expect(documentFromLegacySpec(spec({ viewBoxSize: 0 }), TIMESTAMP).size).toBe(24);
    expect(documentFromLegacySpec(spec({ viewBoxSize: Number.NaN }), TIMESTAMP).size).toBe(24);
    expect(documentFromLegacySpec(spec({ viewBoxSize: 32 }), TIMESTAMP).size).toBe(32);
    const doc = documentFromLegacySpec(spec({ name: `  ${'n'.repeat(120)}  `, description: 'd'.repeat(500) }), TIMESTAMP);
    expect(doc.name).toHaveLength(80);
    expect(doc.description).toHaveLength(300);
    expect(documentFromLegacySpec(spec({ name: '   ' }), TIMESTAMP).name).toBe('Icon');
  });

  it('icon tự tạo (isCustom) là bản nháp, icon mẫu là đã xuất bản', () => {
    expect(documentFromLegacySpec(spec({ isCustom: true }), TIMESTAMP).status).toBe('draft');
    expect(documentFromLegacySpec(spec({ isCustom: false }), TIMESTAMP).status).toBe('published');
  });

  it('ném lỗi (để lớp ngoài bắt) khi khung chứa là giá trị lạ', () => {
    expect(() => documentFromLegacySpec(spec({ containerShape: 'tam-giac' as unknown as FrameKind }), TIMESTAMP)).toThrow();
  });
});

describe('icon mẫu', () => {
  const presets = createPresetDocuments();

  it('có 8 icon mẫu với mã duy nhất và khớp PRESET_IDS', () => {
    expect(presets).toHaveLength(8);
    expect(new Set(presets.map((doc) => doc.id)).size).toBe(8);
    expect(PRESET_IDS.size).toBe(8);
    for (const doc of presets) expect(PRESET_IDS.has(doc.id)).toBe(true);
  });

  it('dựng cố định: cùng mã, cùng dấu thời gian cho mọi lần gọi', () => {
    const again = createPresetDocuments();
    expect(again.map((doc) => [doc.id, doc.createdAt, doc.updatedAt])).toEqual(presets.map((doc) => [doc.id, doc.createdAt, doc.updatedAt]));
    expect(presets.every((doc) => doc.createdAt === TIMESTAMP)).toBe(true);
  });

  it('mọi hình của mọi icon mẫu (kể cả nét viền) nằm trong lưới', () => {
    for (const doc of presets) {
      expect(doc.shapes.length).toBeGreaterThanOrEqual(2);
      for (const shape of doc.shapes) {
        const bounds = visualBounds(shape);
        const label = `${doc.id}/${shape.name}`;
        expect([label, bounds.x >= 0]).toEqual([label, true]);
        expect([label, bounds.y >= 0]).toEqual([label, true]);
        expect([label, bounds.x + bounds.width <= doc.size]).toEqual([label, true]);
        expect([label, bounds.y + bounds.height <= doc.size]).toEqual([label, true]);
      }
    }
  });

  it('nét chính của mỗi icon nằm gọn trong khung chứa của nó', () => {
    for (const doc of presets) {
      const frame = doc.shapes.find((shape) => shape.name === 'Khung');
      if (!frame) continue;
      const solid = { ...frame, fill: 'currentColor', stroke: 'none' };
      for (const shape of doc.shapes.filter((item) => item.name === 'Nét chính' || item.name === 'Nét phụ')) {
        for (const line of flattenGeometry(shape.geometry)) {
          for (const point of line.points) {
            expect([doc.id, hitTestShape(solid, point, 0.01)]).toEqual([doc.id, true]);
          }
        }
      }
    }
  });

  it('chấm nhấn nằm trong khung chứa', () => {
    for (const doc of presets) {
      const dot = doc.shapes.find((shape) => shape.name === 'Điểm nhấn');
      if (!dot) continue;
      const frame = doc.shapes.find((shape) => shape.name === 'Khung');
      const center = { x: (dot.geometry as EllipseGeometry).cx, y: (dot.geometry as EllipseGeometry).cy };
      if (frame) expect([doc.id, hitTestShape({ ...frame, fill: 'currentColor', stroke: 'none' }, center, 0)]).toEqual([doc.id, true]);
      expect(center.x).toBeGreaterThan(doc.size / 2);
      expect(center.y).toBeLessThan(doc.size / 2);
    }
  });

  it('chỉ dùng màu trong bảng màu mặc định', () => {
    const keys = new Set(['sapphire', 'navy', 'emerald', 'amber', 'crimson', 'violet', 'slate']);
    for (const doc of presets) {
      for (const shape of doc.shapes) {
        for (const paint of [shape.fill, shape.stroke]) {
          if (paint.startsWith('brand:')) expect(keys.has(paint.slice(6))).toBe(true);
          else expect(['none', 'currentColor']).toContain(paint);
        }
      }
    }
  });

  it('icon mẫu có tên tiếng Việt và mô tả', () => {
    for (const doc of presets) {
      expect(doc.name.length).toBeGreaterThan(0);
      expect(doc.description.length).toBeGreaterThan(0);
    }
  });
});

describe('dữ liệu hình mẫu', () => {
  it('mọi nét trong thư viện hình mẫu hợp lệ, đọc được và nằm trong lưới 24', () => {
    expect(GLYPH_LIBRARY.length).toBeGreaterThanOrEqual(15);
    expect(new Set(GLYPH_LIBRARY.map((glyph) => glyph.id)).size).toBe(GLYPH_LIBRARY.length);
    for (const glyph of GLYPH_LIBRARY) {
      expect(isValidPathData(glyph.path)).toBe(true);
      const geometry = parsePathData(glyph.path);
      expect(geometry.subpaths.length).toBeGreaterThan(0);
      const shape = createShape(geometry, { strokeWidth: 1.75 });
      const bounds = visualBounds(shape);
      expect([glyph.id, bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 24 && bounds.y + bounds.height <= 24]).toEqual([glyph.id, true]);
    }
  });

  it('nét của icon mẫu đều là dữ liệu path hợp lệ', () => {
    for (const item of LEGACY_PRESETS) {
      expect(isValidPathData(item.glyphPath)).toBe(true);
      expect(isValidPathData(item.secondaryPath)).toBe(true);
    }
  });

  it('tất cả icon mẫu đều có mã duy nhất', () => {
    const doc: IconDocument[] = createPresetDocuments();
    expect(new Set(doc.map((item) => item.id)).size).toBe(doc.length);
  });
});
