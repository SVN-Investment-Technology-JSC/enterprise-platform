import { editorReducer, geometryBounds, type IconShape } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, screen } from '@testing-library/react';
import { makeShape, rectShape, renderWithEditor, testDoc } from './panel-test-utils';
import { PropertiesPanel } from './properties-panel';

const panel = (props: Parameters<typeof PropertiesPanel>[0]) => <PropertiesPanel {...props} />;

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

function commitNumber(name: string, value: string) {
  const input = field(name);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const boundsOf = (shape: IconShape) => geometryBounds(shape.geometry);

describe('PropertiesPanel khi chưa chọn lớp nào (cài đặt icon)', () => {
  const render = (doc = testDoc([rectShape('a')])) => renderWithEditor(doc, panel);

  it('hiện tên, mô tả và đổi tên ngay khi gõ nhưng chỉ tạo một bước hoàn tác', () => {
    const { harness } = render();
    expect(field('Tên icon').value).toBe('Icon thử');
    fireEvent.focus(field('Tên icon'));
    fireEvent.change(field('Tên icon'), { target: { value: 'Kho' } });
    fireEvent.change(field('Tên icon'), { target: { value: 'Kho vật tư' } });
    fireEvent.blur(field('Tên icon'));
    expect(harness.state().doc.name).toBe('Kho vật tư');
    expect(harness.state().past).toHaveLength(1);
    expect(harness.state().gesture).toBe(false);
  });

  it('chỉ bấm vào ô rồi rời đi thì không để lại bước hoàn tác rỗng', () => {
    const { harness } = render();
    fireEvent.focus(field('Tên icon'));
    fireEvent.blur(field('Tên icon'));
    expect(harness.state().past).toHaveLength(0);
    expect(harness.actions).toEqual([]);
  });

  it('đổi tên rồi hoàn tác một lần là về tên cũ', () => {
    const { harness } = render();
    fireEvent.change(field('Tên icon'), { target: { value: 'A' } });
    fireEvent.change(field('Tên icon'), { target: { value: 'AB' } });
    fireEvent.blur(field('Tên icon'));
    expect(harness.state().doc.name).toBe('AB');
    expect(editorReducer(harness.state(), { type: 'undo' }).doc.name).toBe('Icon thử');
  });

  it('đổi mô tả', () => {
    const { harness } = render();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mô tả' }), { target: { value: 'Quản lý kho' } });
    expect(harness.state().doc.description).toBe('Quản lý kho');
  });

  it('chọn danh mục bằng nhóm nút', () => {
    const { harness } = render();
    expect(button('Tùy biến').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Hệ thống'));
    expect(harness.state().doc.category).toBe('system');
    expect(button('Hệ thống').getAttribute('aria-pressed')).toBe('true');
  });

  it('thêm nhãn bằng Enter, bỏ trùng, xoá bằng nút x và Backspace', () => {
    const { harness } = render();
    const input = field('Thêm nhãn');
    fireEvent.change(input, { target: { value: 'kho' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(field('Thêm nhãn'), { target: { value: 'KHO' } });
    fireEvent.keyDown(field('Thêm nhãn'), { key: 'Enter' });
    fireEvent.change(field('Thêm nhãn'), { target: { value: 'vật tư' } });
    fireEvent.keyDown(field('Thêm nhãn'), { key: ',' });
    expect(harness.state().doc.tags).toEqual(['kho', 'vật tư']);

    fireEvent.click(button('Xoá nhãn kho'));
    expect(harness.state().doc.tags).toEqual(['vật tư']);
    fireEvent.keyDown(field('Thêm nhãn'), { key: 'Backspace' });
    expect(harness.state().doc.tags).toEqual([]);
  });

  it('thêm nhãn đang gõ khi rời ô', () => {
    const { harness } = render();
    fireEvent.change(field('Thêm nhãn'), { target: { value: 'nhân sự' } });
    fireEvent.blur(field('Thêm nhãn'));
    expect(harness.state().doc.tags).toEqual(['nhân sự']);
  });

  it('đổi cỡ lưới và co hình theo mặc định', () => {
    const { harness } = render(testDoc([rectShape('a', 6, 6, 12, 12)]));
    fireEvent.click(button('Lưới 48 x 48'));
    expect(harness.state().doc.size).toBe(48);
    expect(boundsOf(harness.shape('a'))).toMatchObject({ x: 12, y: 12, width: 24, height: 24 });
  });

  it('bỏ chọn co hình thì đổi lưới mà giữ nguyên toạ độ hình', () => {
    const { harness } = render(testDoc([rectShape('a', 6, 6, 12, 12)]));
    fireEvent.click(screen.getByRole('checkbox', { name: /Co hình theo lưới/ }));
    fireEvent.click(button('Lưới 32 x 32'));
    expect(harness.state().doc.size).toBe(32);
    expect(boundsOf(harness.shape('a'))).toMatchObject({ x: 6, y: 6, width: 12, height: 12 });
  });

  it('nhập cỡ lưới tuỳ chọn và kẹp trong khoảng 8 đến 128', () => {
    const { harness } = render();
    commitNumber('Cỡ lưới tuỳ chọn', '999');
    expect(harness.state().doc.size).toBe(128);
  });

  it('chọn trạng thái nháp hoặc phát hành', () => {
    const { harness } = render();
    fireEvent.click(button(/Phát hành/));
    expect(harness.state().doc.status).toBe('published');
    fireEvent.click(button(/Nháp/));
    expect(harness.state().doc.status).toBe('draft');
  });
});

describe('PropertiesPanel khi có lớp được chọn', () => {
  const stroked = (id: string, overrides: Partial<Omit<IconShape, 'geometry'>> = {}) => rectShape(id, 6, 6, 12, 12, overrides);

  it('đổi màu nét bằng bảng màu thương hiệu', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    fireEvent.click(button('Màu nét: Theo chữ'));
    fireEvent.click(screen.getByRole('button', { name: 'Xanh ngọc' }));
    expect(harness.shape('a').stroke).toBe('brand:emerald');
  });

  it('đổi màu tô và bỏ tô', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a', { fill: 'brand:sapphire' })]), panel, { selection: ['a'] });
    fireEvent.click(button('Màu tô: Xanh Sapphire'));
    fireEvent.click(screen.getByRole('button', { name: 'Không có màu' }));
    expect(harness.shape('a').fill).toBe('none');
  });

  it('hiện độ mờ tô và quy tắc tô chỉ khi có màu tô', () => {
    renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    expect(screen.queryByRole('slider', { name: 'Độ mờ màu tô (thanh trượt)' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Quy tắc tô' })).toBeNull();
  });

  it('độ mờ tô và quy tắc tô khoét lỗ', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a', { fill: 'currentColor' })]), panel, { selection: ['a'] });
    commitNumber('Độ mờ màu tô', '40');
    expect(harness.shape('a').fillOpacity).toBe(0.4);
    fireEvent.click(button('Khoét lỗ ở phần chồng nhau'));
    expect(harness.shape('a').fillRule).toBe('evenodd');
  });

  it('nút nhanh độ dày lấy từ bộ nét cho phép của quy chuẩn', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    expect(button('Độ dày 1,75').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Độ dày 2'));
    expect(harness.shape('a').strokeWidth).toBe(2);
    expect(screen.queryByText('Ngoài bộ nét cho phép')).toBeNull();
  });

  it('cảnh báo nhẹ khi nét ngoài bộ cho phép và chuẩn hoá về giá trị gần nhất', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a', { strokeWidth: 1 }), stroked('b', { strokeWidth: 3 })]), panel, {
      selection: ['a', 'b'],
    });
    expect(screen.getByText('Ngoài bộ nét cho phép')).toBeTruthy();
    fireEvent.click(button('Chuẩn hoá'));
    expect(harness.shape('a').strokeWidth).toBe(1.5);
    expect(harness.shape('b').strokeWidth).toBe(2);
    expect(harness.state().past).toHaveLength(1);
    expect(screen.queryByText('Ngoài bộ nét cho phép')).toBeNull();
  });

  it('ẩn nhóm Nét khi lớp không có nét', () => {
    renderWithEditor(testDoc([stroked('a', { stroke: 'none', fill: 'currentColor' })]), panel, { selection: ['a'] });
    expect(screen.queryByRole('group', { name: 'Đầu nét' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Độ dày nét (thanh trượt)' })).toBeNull();
  });

  it('đầu nét và góc nối chọn bằng nhóm nút biểu tượng', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    fireEvent.click(button('Đầu nét phẳng'));
    fireEvent.click(button('Góc nối vát'));
    expect(harness.shape('a')).toMatchObject({ linecap: 'butt', linejoin: 'bevel' });
  });

  it('kéo thanh trượt độ mờ chỉ tạo một bước hoàn tác', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    const slider = screen.getByRole('slider', { name: 'Độ mờ (thanh trượt)' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.pointerUp(slider);
    expect(harness.shape('a').opacity).toBe(0.3);
    expect(harness.state().past).toHaveLength(1);
    expect(harness.state().gesture).toBe(false);
  });

  it('hiện giá trị trống khi nhiều lớp có độ dày khác nhau', () => {
    renderWithEditor(testDoc([stroked('a', { strokeWidth: 1.5 }), stroked('b', { strokeWidth: 2 })]), panel, { selection: ['a', 'b'] });
    expect(field('Độ dày nét').value).toBe('');
    expect(field('Độ dày nét').placeholder).toBe('—');
    expect(button('Độ dày 1,5').getAttribute('aria-pressed')).toBe('false');
  });

  it('hiện vị trí và kích thước theo khung bao hình học', () => {
    renderWithEditor(testDoc([stroked('a', { strokeWidth: 3 })]), panel, { selection: ['a'] });
    expect(field('Vị trí X').value).toBe('6');
    expect(field('Vị trí Y').value).toBe('6');
    expect(field('Chiều rộng').value).toBe('12');
    expect(field('Chiều cao').value).toBe('12');
  });

  it('đổi X và Y dịch hình', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    commitNumber('Vị trí X', '2,5');
    commitNumber('Vị trí Y', '4');
    expect(boundsOf(harness.shape('a'))).toMatchObject({ x: 2.5, y: 4, width: 12, height: 12 });
  });

  it('đổi rộng kéo theo cao khi khoá tỷ lệ (mặc định) và độc lập khi mở khoá', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a', 4, 4, 16, 8)]), panel, { selection: ['a'] });
    commitNumber('Chiều rộng', '8');
    expect(boundsOf(harness.shape('a'))).toMatchObject({ width: 8, height: 4 });

    fireEvent.click(button('Đang khoá tỷ lệ'));
    commitNumber('Chiều cao', '10');
    expect(boundsOf(harness.shape('a'))).toMatchObject({ width: 8, height: 10 });
  });

  it('đổi cỡ nhóm nhiều lớp theo khung bao chung', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a', 2, 2, 4, 4), rectShape('b', 10, 2, 4, 4)]), panel, {
      selection: ['a', 'b'],
    });
    expect(field('Chiều rộng').value).toBe('12');
    commitNumber('Chiều rộng', '6');
    expect(boundsOf(harness.shape('a'))).toMatchObject({ x: 2, width: 2 });
    expect(boundsOf(harness.shape('b'))).toMatchObject({ x: 6, width: 2 });
  });

  it('bo góc chỉ hiện cho hình chữ nhật và đổi được', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    commitNumber('Bo góc', '3');
    expect(harness.shape('a').geometry).toMatchObject({ type: 'rect', rx: 3 });
  });

  it('không có ô bo góc với hình tròn', () => {
    renderWithEditor(testDoc([makeShape('c', { type: 'ellipse', cx: 12, cy: 12, rx: 5, ry: 5 })]), panel, { selection: ['c'] });
    expect(screen.queryByRole('textbox', { name: 'Bo góc' })).toBeNull();
  });

  it('xoay phải 90 độ hoán đổi rộng cao quanh tâm', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a', 4, 10, 16, 4)]), panel, { selection: ['a'] });
    fireEvent.click(button('Xoay phải 90 độ'));
    const box = boundsOf(harness.shape('a'));
    expect(box.width).toBeCloseTo(4);
    expect(box.height).toBeCloseTo(16);
    expect(box.x).toBeCloseTo(10);
  });

  it('lật ngang một nhóm quanh tâm chung', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a', 2, 6, 2, 4), rectShape('b', 10, 6, 2, 4)]), panel, {
      selection: ['a', 'b'],
    });
    fireEvent.click(button('Lật ngang'));
    expect(boundsOf(harness.shape('a')).x).toBe(10);
    expect(boundsOf(harness.shape('b')).x).toBe(2);
  });

  it('xoay thêm góc tuỳ ý biến hình chữ nhật thành đường và ô nhập trống lại sau khi áp dụng', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    commitNumber('Xoay thêm (độ), Enter để áp dụng', '45');
    expect(harness.shape('a').geometry.type).toBe('path');
    expect(field('Xoay thêm (độ), Enter để áp dụng').value).toBe('');
  });

  it('xoay thêm 0 độ không làm gì', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    commitNumber('Xoay thêm (độ), Enter để áp dụng', '0');
    expect(harness.state().past).toHaveLength(0);
  });

  it('một lớp căn theo khung vẽ', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a', 6, 6, 4, 4, { strokeWidth: 2 })]), panel, { selection: ['a'] });
    expect(button('Căn so với vùng chọn').disabled).toBe(true);
    fireEvent.click(button('Căn giữa theo chiều ngang'));
    expect(harness.actions.at(-1)).toMatchObject({ type: 'align', mode: 'center', to: 'canvas' });
    const box = boundsOf(harness.shape('a'));
    expect(box.x + box.width / 2).toBeCloseTo(12);
  });

  it('nhiều lớp mặc định căn theo vùng chọn, đổi sang khung vẽ được', () => {
    const { harness } = renderWithEditor(
      testDoc([rectShape('a', 2, 2, 4, 4, { stroke: 'none', fill: 'currentColor' }), rectShape('b', 12, 8, 4, 4, { stroke: 'none', fill: 'currentColor' })]),
      panel,
      { selection: ['a', 'b'] },
    );
    fireEvent.click(button('Căn trái'));
    expect(harness.actions.at(-1)).toMatchObject({ type: 'align', mode: 'left', to: 'selection' });
    expect(boundsOf(harness.shape('b')).x).toBe(2);

    fireEvent.click(button('Căn so với khung vẽ'));
    fireEvent.click(button('Căn phải'));
    expect(harness.actions.at(-1)).toMatchObject({ type: 'align', mode: 'right', to: 'canvas' });
    expect(boundsOf(harness.shape('a')).x).toBe(20);
  });

  it('chia đều khoảng cách cần ít nhất ba lớp', () => {
    const shapes = [rectShape('a', 0, 4, 2, 2), rectShape('b', 3, 4, 2, 2), rectShape('c', 20, 4, 2, 2)].map((shape) => ({
      ...shape,
      stroke: 'none',
      fill: 'currentColor',
    }));
    const { unmount } = renderWithEditor(testDoc(shapes), panel, { selection: ['a', 'b'] });
    expect(button(/Chia đều khoảng cách ngang/).disabled).toBe(true);
    unmount();

    const { harness } = renderWithEditor(testDoc(shapes), panel, { selection: ['a', 'b', 'c'] });
    fireEvent.click(button(/Chia đều khoảng cách ngang/));
    expect(boundsOf(harness.shape('b')).x).toBe(10);
  });

  it('đổi thứ tự lớp', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a'), stroked('b'), stroked('c')]), panel, { selection: ['a'] });
    fireEvent.click(button('Đưa lên trên cùng'));
    expect(harness.state().doc.shapes.map((shape) => shape.id)).toEqual(['b', 'c', 'a']);
    fireEvent.click(button('Đưa xuống dưới cùng'));
    expect(harness.state().doc.shapes.map((shape) => shape.id)).toEqual(['a', 'b', 'c']);
    fireEvent.click(button('Đưa lên một lớp'));
    expect(harness.state().doc.shapes.map((shape) => shape.id)).toEqual(['b', 'a', 'c']);
    fireEvent.click(button('Đưa xuống một lớp'));
    expect(harness.state().doc.shapes.map((shape) => shape.id)).toEqual(['a', 'b', 'c']);
  });

  it('nhân đôi và xoá', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    fireEvent.click(button('Nhân đôi'));
    expect(harness.state().doc.shapes).toHaveLength(2);
    const copyId = harness.state().selection[0];
    expect(copyId).not.toBe('a');
    fireEvent.click(button('Xoá'));
    expect(harness.state().doc.shapes.map((shape) => shape.id)).toEqual(['a']);
  });

  it('gộp, tách và chuyển thành đường', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a'), stroked('b')]), panel, { selection: ['a', 'b'] });
    expect(button(/Tách/).disabled).toBe(true);
    fireEvent.click(button(/Chuyển hình thành đường/));
    expect(harness.shape('a').geometry.type).toBe('path');
    expect(button(/Chuyển hình thành đường/).disabled).toBe(true);

    fireEvent.click(button(/Gộp nhiều đường/));
    expect(harness.state().doc.shapes).toHaveLength(1);
    const merged = harness.state().doc.shapes[0];
    expect(merged.geometry.type === 'path' && merged.geometry.subpaths).toHaveLength(2);

    expect(button(/Tách/).disabled).toBe(false);
    fireEvent.click(button(/Tách/));
    expect(harness.state().doc.shapes).toHaveLength(2);
  });

  it('gộp bị vô hiệu với một lớp', () => {
    renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    expect(button(/Gộp nhiều đường/).disabled).toBe(true);
  });

  it('khoá lớp rồi mọi điều khiển sửa bị vô hiệu và có thể mở khoá lại', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a')]), panel, { selection: ['a'] });
    fireEvent.click(button('Khoá lớp'));
    expect(harness.shape('a').locked).toBe(true);
    expect(screen.getByText('Lớp đang khoá, mở khoá để chỉnh.')).toBeTruthy();
    expect(button('Xoá').disabled).toBe(true);
    expect(button('Màu nét: Theo chữ').disabled).toBe(true);
    expect(button('Độ dày 2').disabled).toBe(true);

    fireEvent.click(button('Mở khoá lớp'));
    expect(harness.shape('a').locked).toBe(false);
    expect(button('Xoá').disabled).toBe(false);
  });

  it('lớp khoá lẫn lớp thường: chỉ sửa lớp thường', () => {
    const { harness } = renderWithEditor(testDoc([stroked('a'), stroked('b', { locked: true })]), panel, { selection: ['a', 'b'] });
    fireEvent.click(button('Độ dày 2'));
    expect(harness.shape('a').strokeWidth).toBe(2);
    expect(harness.shape('b').strokeWidth).toBe(1.75);
  });

  it('tiêu đề là tên lớp, hoặc số lớp khi chọn nhiều', () => {
    const { unmount } = renderWithEditor(testDoc([stroked('a'), stroked('b')]), panel, { selection: ['a'] });
    expect(screen.getByText('a')).toBeTruthy();
    unmount();
    renderWithEditor(testDoc([stroked('a'), stroked('b')]), panel, { selection: ['a', 'b'] });
    expect(screen.getByText('2 lớp')).toBeTruthy();
  });
});
