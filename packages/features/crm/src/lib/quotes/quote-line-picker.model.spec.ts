import type { CrmCatalogMaterial } from '@enterprise-platform/contracts-crm';
import {
  addLinesLabel,
  buildLines,
  describeLineErrors,
  duplicatePicks,
  lineErrorsOf,
  setPicked,
  setPickedQuantity,
  type PickedMap,
} from './quote-line-picker.model';

const material = (id: string): CrmCatalogMaterial =>
  ({ id, code: `MH-${id}`, name: `Mặt hàng ${id}`, unit: 'Cái', category: null, kind: 'STOCK', avgCost: 1, totalAvailable: 5 }) as CrmCatalogMaterial;
const [a, b, c] = ['a', 'b', 'c'].map(material);
const empty: PickedMap = new Map();

describe('chọn nhiều mặt hàng (TC-FB-01..04)', () => {
  it('TC-FB-01: chọn 3 mặt hàng, nhãn nút hiện đúng số dòng', () => {
    const picked = setPicked(empty, [a, b, c], true);
    expect(picked.size).toBe(3);
    expect(addLinesLabel(picked.size)).toBe('Thêm 3 dòng');
    expect(addLinesLabel(0)).toBe('Thêm dòng');
    expect(addLinesLabel(2, true)).toBe('Vẫn thêm 2 dòng');
  });

  it('TC-FB-02: giữ tập đã chọn khi danh sách tìm kiếm đổi; bỏ chọn một mặt hàng không ảnh hưởng mặt hàng khác', () => {
    let picked = setPicked(empty, [a], true);
    picked = setPickedQuantity(picked, 'a', '7');
    // Kết quả tìm mới chỉ có b; a không còn trong bảng nhưng vẫn được chọn, giữ số lượng.
    picked = setPicked(picked, [b], true);
    expect([...picked.keys()]).toEqual(['a', 'b']);
    expect(picked.get('a')?.quantity).toBe('7');
    // Chọn lại a khi nó quay về bảng không đặt lại số lượng.
    expect(setPicked(picked, [a], true).get('a')?.quantity).toBe('7');
    expect([...setPicked(picked, [b], false).keys()]).toEqual(['a']);
  });

  it('TC-FB-03: mỗi mặt hàng có số lượng riêng, mặc định 1', () => {
    let picked = setPicked(empty, [a, b], true);
    expect(picked.get('a')?.quantity).toBe('1');
    picked = setPickedQuantity(setPickedQuantity(picked, 'a', '2'), 'b', '5');
    expect(buildLines(picked)).toEqual({
      ok: true,
      lines: [
        { materialId: 'a', quantity: 2 },
        { materialId: 'b', quantity: 5 },
      ],
    });
  });

  it.each(['0', '-1', '', 'abc'])('TC-FB-03: số lượng "%s" không hợp lệ thì không dựng dòng nào', (text) => {
    const picked = setPickedQuantity(setPicked(empty, [a, b], true), 'b', text);
    expect(buildLines(picked)).toEqual({ ok: false, error: 'Số lượng phải lớn hơn 0.', invalidIds: ['b'] });
  });

  it('chưa chọn gì thì báo chọn ít nhất một mặt hàng', () => {
    expect(buildLines(empty)).toMatchObject({ ok: false, error: 'Vui lòng chọn ít nhất một mặt hàng.' });
  });

  it('TC-FB-04: nhận ra mặt hàng đã có trong báo giá', () => {
    const picked = setPicked(empty, [a, b], true);
    expect(duplicatePicks(picked, new Set(['b', 'z'])).map((entry) => entry.material.id)).toEqual(['b']);
    expect(duplicatePicks(picked, new Set())).toEqual([]);
  });

  it('lỗi theo dòng từ API được đọc và gắn mã mặt hàng', () => {
    const picked = setPicked(empty, [a, b, c], true);
    const cause = { statusCode: 400, code: 'LINES_INVALID', errors: [{ line: 2, materialId: 'b', code: 'PRICE_NOT_FOUND', message: 'Chưa có giá bán.' }] };
    expect(describeLineErrors(lineErrorsOf(cause), picked)).toEqual(['Dòng 2 (MH-b): Chưa có giá bán.']);
    expect(lineErrorsOf({ message: 'x' })).toEqual([]);
    expect(lineErrorsOf(undefined)).toEqual([]);
  });
});
