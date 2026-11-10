import { createEditorState, editorReducer } from './editor-state';
import { rotation, scaling, transformShape, translation } from './geometry';
import { createDocument, createShape, type IconShape, type ShapeMask } from './model';
import { DEFAULT_PALETTE } from './palette';
import { buildIconModel, defsNode, generateReactComponent, generateSprite, generateSvg } from './render';
import { LIMITS, normalizeDocument, normalizeShape } from './validate';

const layer = (overrides: Partial<IconShape> = {}): IconShape =>
  createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 0 }, { fill: '#ffffff', stroke: 'none', ...overrides });

const cut = (): IconShape =>
  createShape(
    { type: 'path', subpaths: [{ closed: false, nodes: [{ x: 6, y: 12 }, { x: 18, y: 12 }] }] },
    { fill: 'none', stroke: '#000000', strokeWidth: 2 },
  );

const MASK: ShapeMask = { layers: [layer(), cut()] };

/** `null` là lớp không có mặt nạ (không dùng `undefined` vì tham số mặc định sẽ thay bằng MASK). */
const masked = (mask: ShapeMask | null = MASK, overrides: Partial<IconShape> = {}): IconShape =>
  createShape({ type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 4 }, { fill: '#ffffff', stroke: 'none', ...(mask ? { mask } : {}), ...overrides });

describe('mặt nạ: kiểm tra hợp lệ', () => {
  it('giữ mặt nạ hợp lệ và chuẩn hoá màu thành hex chữ thường', () => {
    const shape = normalizeShape(masked({ layers: [layer({ fill: '#FFF' }), cut()] }));
    expect(shape?.mask?.layers).toHaveLength(2);
    expect(shape?.mask?.layers[0].fill).toBe('#ffffff');
    expect(shape?.mask?.layers[1].stroke).toBe('#000000');
  });

  it('màu trong mặt nạ chỉ là none, hex hoặc dải màu toàn hex: currentColor thành đen, giá trị lạ về mặc định (không tô, không nét)', () => {
    const shape = normalizeShape(
      masked({
        layers: [
          layer({ fill: 'currentColor', stroke: 'rác' }),
          layer({ fill: 'brand:sapphire', stroke: 'linear:45:#ffffff@0,#000000@1' }),
          layer({ fill: 'linear:45:brand:sapphire@0,#000000@1', stroke: 'none' }),
        ],
      }),
    );
    const [first, second, third] = shape?.mask?.layers ?? [];
    expect([first.fill, first.stroke]).toEqual(['#000000', 'none']);
    expect([second.fill, second.stroke]).toEqual(['none', 'linear:45:#ffffff@0,#000000@1']);
    expect(third.fill).toBe('none');
  });

  it('hình trong mặt nạ không bị ẩn hay khoá, và không có mặt nạ lồng', () => {
    const inner = layer({ hidden: true, locked: true, mask: { layers: [layer()] } });
    const shape = normalizeShape(masked({ layers: [inner] }));
    expect(shape?.mask?.layers[0]).toMatchObject({ hidden: false, locked: false });
    expect(shape?.mask?.layers[0].mask).toBeUndefined();
  });

  it('hình hỏng trong mặt nạ bị bỏ; không còn hình nào hoặc sai kiểu thì bỏ mặt nạ nhưng giữ lớp', () => {
    expect(normalizeShape(masked({ layers: [layer(), { geometry: 'hỏng' } as unknown as IconShape] }))?.mask?.layers).toHaveLength(1);
    for (const bad of [{ layers: [] }, { layers: [{ geometry: 'hỏng' }] }, { layers: 'x' }, 'x', 5, null]) {
      const shape = normalizeShape({ ...masked(), mask: bad });
      expect(shape).not.toBeNull();
      expect(shape?.mask).toBeUndefined();
    }
  });

  it('cắt mặt nạ ở số hình tối đa', () => {
    const many: ShapeMask = { layers: Array.from({ length: LIMITS.maxMaskLayers + 10 }, () => layer()) };
    expect(normalizeShape(masked(many))?.mask?.layers).toHaveLength(LIMITS.maxMaskLayers);
  });

  it('lớp không có mặt nạ thì không có trường mask; qua JSON rồi nạp lại không đổi', () => {
    expect(Object.keys(normalizeShape(masked(null)) ?? {})).not.toContain('mask');
    const doc = createDocument({ name: 'Có mặt nạ', shapes: [masked()] });
    const again = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    expect(again?.shapes[0].mask?.layers.map((item) => [item.fill, item.stroke, item.strokeWidth])).toEqual(
      MASK.layers.map((item) => [item.fill, item.stroke, item.strokeWidth]),
    );
  });
});

describe('mặt nạ: biến đổi lớp kéo theo mặt nạ', () => {
  it('di chuyển', () => {
    const moved = transformShape(masked(), translation(3, -2));
    expect(moved.geometry).toMatchObject({ x: 5, y: 0 });
    expect(moved.mask?.layers[0].geometry).toMatchObject({ type: 'rect', x: 7, y: 2 });
    expect(moved.mask?.layers[1].geometry).toMatchObject({ type: 'path' });
    const line = moved.mask?.layers[1].geometry;
    expect(line?.type === 'path' ? line.subpaths[0].nodes[0] : null).toMatchObject({ x: 9, y: 10 });
  });

  it('co giãn theo lưới', () => {
    const scaled = transformShape(masked(), scaling(2, 2, 0, 0));
    expect(scaled.mask?.layers[0].geometry).toMatchObject({ x: 8, y: 8, width: 32, height: 32 });
  });

  it('xoay không phải bội 90 độ biến hình chữ nhật trong mặt nạ thành đường', () => {
    const turned = transformShape(masked(), rotation(30, 12, 12));
    expect(turned.mask?.layers[0].geometry.type).toBe('path');
  });

  it('không có mặt nạ thì không thêm mặt nạ; không đổi lớp gốc', () => {
    const plain = masked(null);
    expect('mask' in transformShape(plain, translation(1, 1))).toBe(false);
    const original = masked();
    transformShape(original, translation(1, 1));
    expect(original.mask?.layers[0].geometry).toMatchObject({ x: 4, y: 4 });
  });
});

describe('mặt nạ: vẽ và xuất', () => {
  const doc = createDocument({ name: 'Báo cáo', shapes: [masked()] });

  it('dựng thẻ mask trong defs và gắn vào lớp; mọi hình trong mặt nạ ghi rõ fill, stroke của chính nó', () => {
    const model = buildIconModel(doc, { colorMode: 'brand', palette: DEFAULT_PALETTE });
    expect(model.defs).toHaveLength(1);
    const mask = model.defs[0];
    expect(mask.tag).toBe('mask');
    expect(mask.attrs).toMatchObject({ maskUnits: 'userSpaceOnUse', x: '-24', y: '-24', width: '72', height: '72' });
    expect(model.children[0].attrs.mask).toBe(`url(#${mask.attrs.id})`);
    const [white, black] = mask.children ?? [];
    expect(white.attrs).toMatchObject({ fill: '#ffffff', stroke: 'none' });
    expect(black.attrs).toMatchObject({ fill: 'none', stroke: '#000000', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  });

  it('chế độ currentColor: màu của lớp theo chữ nhưng mặt nạ vẫn giữ độ sáng thật', () => {
    const model = buildIconModel(doc, { colorMode: 'currentColor' });
    expect(model.children[0].attrs.fill).toBe('currentColor');
    expect(model.defs[0].children?.[1].attrs.stroke).toBe('#000000');
  });

  it('hai lớp cùng mặt nạ dùng chung một thẻ; mặt nạ khác hoặc cỡ lưới khác thì mã khác', () => {
    const twin = buildIconModel(createDocument({ name: 'Đôi', shapes: [masked(), masked()] }), { colorMode: 'brand' });
    expect(twin.defs).toHaveLength(1);
    expect(twin.children[0].attrs.mask).toBe(twin.children[1].attrs.mask);

    const other = buildIconModel(createDocument({ name: 'Khác', shapes: [masked({ layers: [layer()] })] }), { colorMode: 'brand' });
    const bigger = buildIconModel(createDocument({ name: 'Lớn', size: 48, shapes: [masked()] }), { colorMode: 'brand' });
    const ids = [twin.defs[0], other.defs[0], bigger.defs[0]].map((node) => node.attrs.id);
    expect(new Set(ids).size).toBe(3);
    expect(bigger.defs[0].attrs).toMatchObject({ x: '-48', width: '144' });
  });

  it('lớp ẩn không sinh mặt nạ; mặt nạ cùng gradient cùng nằm trong một thẻ defs', () => {
    const hidden = buildIconModel(createDocument({ name: 'Ẩn', shapes: [masked(MASK, { hidden: true })] }), { colorMode: 'brand' });
    expect(hidden.defs).toEqual([]);
    const both = buildIconModel(
      createDocument({ name: 'Cả hai', shapes: [createShape({ type: 'rect', x: 0, y: 0, width: 24, height: 24, rx: 5 }, { fill: 'linear:45:#4cc3ff@0,#0263c9@1', stroke: 'none' }), masked()] }),
      { colorMode: 'brand' },
    );
    expect(both.defs.map((node) => node.tag).sort()).toEqual(['linearGradient', 'mask']);
    expect(defsNode(both)?.children).toHaveLength(2);
  });

  it('SVG xuất có <mask> trong <defs> và thuộc tính mask trỏ đúng mã', () => {
    const svg = generateSvg(doc, { colorMode: 'brand' });
    const id = /<mask id="([^"]+)"/.exec(svg)?.[1];
    expect(id).toBeTruthy();
    expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<rect x="2"'));
    expect(svg).toContain(`mask="url(#${id})"`);
    expect(svg).toContain('maskUnits="userSpaceOnUse"');
    expect(generateSvg(createDocument({ name: 'Thường', shapes: [masked(null)] }), { colorMode: 'brand' })).not.toContain('<mask');
  });

  it('component React dùng tên thuộc tính camelCase; sprite đặt mã mặt nạ theo từng symbol', () => {
    const tsx = generateReactComponent(doc, { colorMode: 'brand' });
    expect(tsx).toContain('maskUnits="userSpaceOnUse"');
    expect(tsx).toContain('strokeWidth="2"');
    expect(tsx).toContain('<mask ');

    const second = createDocument({ name: 'Hai', shapes: [masked()] });
    const sprite = generateSprite([doc, second], { colorMode: 'brand' });
    const ids = [...sprite.matchAll(/<mask id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0].startsWith('svndts-bao-cao-mask-')).toBe(true);
    expect(ids[1].startsWith('svndts-hai-mask-')).toBe(true);
  });
});

describe('mặt nạ: các thao tác trong trình thiết kế kéo theo mặt nạ', () => {
  const start = () => {
    const shape = { ...masked(), id: 'a' };
    return createEditorState(createDocument({ name: 'Thử', shapes: [shape] }));
  };
  const maskBox = (state: ReturnType<typeof start>, index = 0) => state.doc.shapes[index].mask?.layers[0].geometry;

  it('di chuyển (transform)', () => {
    const next = editorReducer(start(), { type: 'transform', ids: ['a'], matrix: translation(2, 3) });
    expect(maskBox(next)).toMatchObject({ x: 6, y: 7, width: 16 });
  });

  it('lớp bị khoá không bị biến đổi, mặt nạ cũng giữ nguyên', () => {
    const locked = createEditorState(createDocument({ name: 'Khoá', shapes: [{ ...masked(MASK, { locked: true }), id: 'a' }] }));
    const next = editorReducer(locked, { type: 'transform', ids: ['a'], matrix: translation(2, 3) });
    expect(maskBox(next)).toMatchObject({ x: 4, y: 4 });
  });

  it('nhân đôi: bản sao lệch đi và mặt nạ lệch theo; bản gốc không đổi', () => {
    const next = editorReducer(start(), { type: 'duplicate', ids: ['a'], offset: 2 });
    expect(next.doc.shapes).toHaveLength(2);
    const [original, copy] = next.doc.shapes;
    expect(original.mask?.layers[0].geometry).toMatchObject({ x: 4, y: 4 });
    expect(copy.geometry).toMatchObject({ x: 4, y: 4 });
    expect(copy.mask?.layers[0].geometry).toMatchObject({ x: 6, y: 6 });
    expect(copy.mask).toBeDefined();
  });

  it('đổi cỡ lưới và co hình: mặt nạ co theo; không co thì giữ nguyên', () => {
    const scaled = editorReducer(start(), { type: 'setSize', size: 48, scale: true });
    expect(maskBox(scaled)).toMatchObject({ x: 8, y: 8, width: 32 });
    const kept = editorReducer(start(), { type: 'setSize', size: 48, scale: false });
    expect(maskBox(kept)).toMatchObject({ x: 4, y: 4, width: 16 });
  });

  it('căn vào khung vẽ dời cả lớp lẫn mặt nạ cùng một đoạn', () => {
    const next = editorReducer(start(), { type: 'align', ids: ['a'], mode: 'left', to: 'canvas' });
    const shape = next.doc.shapes[0];
    const dx = (shape.geometry as { x: number }).x - 2;
    expect(dx).not.toBe(0);
    expect(shape.mask?.layers[0].geometry).toMatchObject({ x: 4 + dx });
  });
});
