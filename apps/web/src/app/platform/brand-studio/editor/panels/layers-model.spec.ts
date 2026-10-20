import { editorReducer, createEditorState } from '@enterprise-platform/shared-brand-icon';
import {
  displayOrder,
  dropPosition,
  dropTargetIndex,
  layerThumbnailDoc,
  MAX_LAYER_NAME,
  normalizeLayerName,
  rangeIds,
} from './layers-model';
import { rectShape, testDoc } from './panel-test-utils';

describe('displayOrder', () => {
  it('đưa lớp cuối mảng (trên cùng) lên đầu danh sách, không đổi mảng gốc', () => {
    const shapes = [rectShape('a'), rectShape('b'), rectShape('c')];
    expect(displayOrder(shapes).map((shape) => shape.id)).toEqual(['c', 'b', 'a']);
    expect(shapes.map((shape) => shape.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('rangeIds', () => {
  const order = ['d', 'c', 'b', 'a'];

  it('lấy các mã từ điểm neo tới đích theo cả hai chiều', () => {
    expect(rangeIds(order, 'd', 'b')).toEqual(['d', 'c', 'b']);
    expect(rangeIds(order, 'a', 'c')).toEqual(['c', 'b', 'a']);
  });

  it('không có điểm neo hoặc điểm neo đã mất thì chỉ chọn đích', () => {
    expect(rangeIds(order, null, 'c')).toEqual(['c']);
    expect(rangeIds(order, 'zzz', 'c')).toEqual(['c']);
  });

  it('đích không có trong danh sách thì không chọn gì', () => {
    expect(rangeIds(order, 'a', 'zzz')).toEqual([]);
  });
});

describe('dropPosition', () => {
  it('nửa trên là above, nửa dưới là below', () => {
    const rect = { top: 100, height: 40 };
    expect(dropPosition(110, rect)).toBe('above');
    expect(dropPosition(119, rect)).toBe('above');
    expect(dropPosition(120, rect)).toBe('below');
    expect(dropPosition(139, rect)).toBe('below');
  });
});

describe('dropTargetIndex', () => {
  // Mảng 0..3 (0 là lớp dưới cùng); trên màn hình hiển thị đảo ngược.
  const ids = ['a', 'b', 'c', 'd'];
  const move = (from: number, over: number, position: 'above' | 'below') => {
    const doc = testDoc(ids.map((id) => rectShape(id)));
    const next = editorReducer(createEditorState(doc), { type: 'moveShape', id: ids[from], toIndex: dropTargetIndex(from, over, position) });
    return next.doc.shapes.map((shape) => shape.id).join('');
  };

  it('thả lên phía trên một dòng ở trên: lớp đi lên và nằm ngay trên dòng đó', () => {
    expect(move(0, 2, 'above')).toBe('bcad');
    expect(move(0, 3, 'above')).toBe('bcda');
  });

  it('thả xuống phía dưới một dòng ở dưới: lớp đi xuống và nằm ngay dưới dòng đó', () => {
    expect(move(3, 1, 'below')).toBe('adbc');
    expect(move(3, 0, 'below')).toBe('dabc');
  });

  it('thả sát vị trí hiện tại thì không đổi gì', () => {
    expect(move(1, 2, 'below')).toBe('abcd');
    expect(move(2, 1, 'above')).toBe('abcd');
    expect(move(0, 1, 'below')).toBe('abcd');
  });

  it('thả lên phía trên dòng ở dưới và phía dưới dòng ở trên', () => {
    expect(move(3, 1, 'above')).toBe('abdc');
    expect(move(0, 2, 'below')).toBe('bacd');
  });
});

describe('normalizeLayerName', () => {
  it('gọn khoảng trắng, cắt độ dài, rỗng thì giữ tên cũ', () => {
    expect(normalizeLayerName('  Khung   ngoài ', 'cũ')).toBe('Khung ngoài');
    expect(normalizeLayerName('   ', 'cũ')).toBe('cũ');
    expect(normalizeLayerName('x'.repeat(100), 'cũ')).toHaveLength(MAX_LAYER_NAME);
  });
});

describe('layerThumbnailDoc', () => {
  it('chỉ chứa một lớp và luôn hiện kể cả lớp đang ẩn', () => {
    const shape = rectShape('a', 6, 6, 12, 12, { hidden: true });
    const doc = layerThumbnailDoc(32, shape);
    expect(doc.size).toBe(32);
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0]).toMatchObject({ id: 'a', hidden: false });
    expect(shape.hidden).toBe(true);
  });
});
