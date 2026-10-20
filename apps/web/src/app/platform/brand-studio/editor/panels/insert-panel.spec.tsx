import { geometryBounds, type PathGeometry } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { InsertPanel } from './insert-panel';
import { rectShape, renderWithEditor, testDoc } from './panel-test-utils';

const panel = (props: Parameters<typeof InsertPanel>[0]) => <InsertPanel {...props} />;

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const sourceBox = () => screen.getByRole('textbox', { name: 'Mã SVG' }) as HTMLTextAreaElement;

const SVG_THIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1"><path d="M4 12h16"/><circle cx="12" cy="12" r="6"/></svg>';
const SVG_ALIGNED = SVG_THIN.replace('stroke-width="1"', 'stroke-width="1.75"');
const SVG_FILLED = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>';

function pasteSvg(text: string) {
  fireEvent.paste(sourceBox(), { clipboardData: { getData: () => text } });
}

describe('InsertPanel: khung mẫu', () => {
  it('chèn khung xuống dưới cùng, chọn khung và chỉ một bước hoàn tác', () => {
    const { harness } = renderWithEditor(testDoc([rectShape('a')]), panel);
    fireEvent.click(button('Chèn khung vuông bo góc'));
    const shapes = harness.state().doc.shapes;
    expect(shapes).toHaveLength(2);
    expect(shapes[1].id).toBe('a');
    expect(shapes[0].name).toBe('Khung vuông bo góc');
    expect(harness.state().selection).toEqual([shapes[0].id]);
    expect(harness.state().past).toHaveLength(1);
  });

  it('có đủ năm loại khung', () => {
    renderWithEditor(testDoc([]), panel);
    for (const name of ['vuông bo góc', 'tròn', 'lục giác', 'thoi', 'khiên']) {
      expect(button(`Chèn khung ${name}`)).toBeTruthy();
    }
  });

  it('khung lấy cỡ lưới của icon và độ dày theo quy chuẩn', () => {
    const { harness } = renderWithEditor(testDoc([], { size: 32 }), panel);
    fireEvent.click(button('Chèn khung tròn'));
    const frame = harness.state().doc.shapes[0];
    expect(frame.strokeWidth).toBe(1.75);
    expect(frame.geometry).toMatchObject({ type: 'ellipse', cx: 16, cy: 16 });
  });
});

describe('InsertPanel: hình nhanh', () => {
  it('chèn hình chữ nhật, hình tròn và đường thẳng, mỗi lần chọn hình vừa chèn', () => {
    const { harness } = renderWithEditor(testDoc([]), panel);
    fireEvent.click(button('Chèn hình chữ nhật'));
    fireEvent.click(button('Chèn hình tròn'));
    fireEvent.click(button('Chèn đường thẳng'));
    const shapes = harness.state().doc.shapes;
    expect(shapes.map((shape) => shape.geometry.type)).toEqual(['rect', 'ellipse', 'path']);
    expect(harness.state().selection).toEqual([shapes[2].id]);
    expect(shapes.every((shape) => shape.fill === 'none' && shape.stroke === 'currentColor')).toBe(true);
  });

  it('đa giác và ngôi sao theo số cạnh nhập vào', () => {
    const { harness } = renderWithEditor(testDoc([]), panel);
    const sides = screen.getByRole('textbox', { name: 'Số cạnh của đa giác, số cánh của ngôi sao' });
    fireEvent.focus(sides);
    fireEvent.change(sides, { target: { value: '8' } });
    fireEvent.keyDown(sides, { key: 'Enter' });

    fireEvent.click(button('Chèn đa giác'));
    fireEvent.click(button('Chèn ngôi sao'));
    const [polygon, star] = harness.state().doc.shapes.map((shape) => (shape.geometry as PathGeometry).subpaths[0].nodes.length);
    expect(polygon).toBe(8);
    expect(star).toBe(16);
  });

  it('số cạnh bị kẹp trong khoảng 3 đến 12', () => {
    renderWithEditor(testDoc([]), panel);
    const sides = screen.getByRole('textbox', { name: 'Số cạnh của đa giác, số cánh của ngôi sao' }) as HTMLInputElement;
    fireEvent.focus(sides);
    fireEvent.change(sides, { target: { value: '50' } });
    fireEvent.keyDown(sides, { key: 'Enter' });
    expect(sides.value).toBe('12');
  });
});

describe('InsertPanel: thư viện hình mẫu', () => {
  it('chèn hình mẫu thành lớp đường, co theo cỡ lưới', () => {
    const { harness } = renderWithEditor(testDoc([], { size: 48 }), panel);
    fireEvent.click(button(/Chèn hình mẫu Monogram V/));
    const shape = harness.state().doc.shapes[0];
    expect(shape.geometry.type).toBe('path');
    expect(shape.name).toContain('Monogram V');
    expect(geometryBounds(shape.geometry)).toMatchObject({ x: 12, y: 12, width: 24, height: 24 });
    expect(harness.state().selection).toEqual([shape.id]);
  });

  it('có ba nhóm hình mẫu', () => {
    renderWithEditor(testDoc([]), panel);
    for (const group of ['Monogram', 'Nghiệp vụ', 'Hệ thống']) expect(screen.getByText(group)).toBeTruthy();
  });
});

describe('InsertPanel: nhập SVG', () => {
  it('dán mã SVG thì tự nhận ra, đọc thử và hiện tóm tắt', () => {
    renderWithEditor(testDoc([]), panel);
    pasteSvg(SVG_THIN);
    expect(sourceBox().value).toBe(SVG_THIN);
    expect(screen.getByText(/2 hình/)).toBeTruthy();
    expect(screen.getByText(/lệch quy chuẩn/)).toBeTruthy();
  });

  it('dán chữ không phải SVG thì để trình duyệt xử lý như bình thường', () => {
    renderWithEditor(testDoc([]), panel);
    const notPrevented = fireEvent.paste(sourceBox(), { clipboardData: { getData: () => 'M 0 0 L 4 4' } });
    expect(notPrevented).toBe(true);
    expect(sourceBox().value).toBe('');
  });

  it('nét lệch bộ cho phép thì mặc định chuẩn hoá nét; chèn ra độ dày theo quy chuẩn', () => {
    const { harness } = renderWithEditor(testDoc([]), panel);
    pasteSvg(SVG_THIN);
    const tick = screen.getByRole('checkbox', { name: /Chuẩn hoá nét theo quy chuẩn/ }) as HTMLInputElement;
    expect(tick.checked).toBe(true);
    fireEvent.click(button('Chèn vào icon'));
    expect(harness.state().doc.shapes.map((shape) => shape.strokeWidth)).toEqual([1.75, 1.75]);
    expect(harness.state().selection).toHaveLength(2);
    expect(sourceBox().value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('Đã chèn 2 hình.');
  });

  it('bỏ tick thì giữ nguyên độ dày nét của SVG gốc', () => {
    const { harness } = renderWithEditor(testDoc([]), panel);
    pasteSvg(SVG_THIN);
    fireEvent.click(screen.getByRole('checkbox', { name: /Chuẩn hoá nét theo quy chuẩn/ }));
    fireEvent.click(button('Chèn vào icon'));
    expect(harness.state().doc.shapes.map((shape) => shape.strokeWidth)).toEqual([1, 1]);
  });

  it('nét đã đúng quy chuẩn thì mặc định không chuẩn hoá và không báo lệch', () => {
    renderWithEditor(testDoc([]), panel);
    pasteSvg(SVG_ALIGNED);
    expect((screen.getByRole('checkbox', { name: /Chuẩn hoá nét theo quy chuẩn/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/lệch quy chuẩn/)).toBeNull();
  });

  it('SVG chỉ có tô đặc thì không hiện ô chuẩn hoá nét', () => {
    renderWithEditor(testDoc([]), panel);
    pasteSvg(SVG_FILLED);
    expect(screen.getByRole('button', { name: 'Chèn vào icon' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Chuẩn hoá nét/ })).toBeNull();
  });

  it('gõ tay mã SVG cũng đọc thử; mã hỏng hiện lỗi màu đỏ và không có nút chèn', () => {
    renderWithEditor(testDoc([]), panel);
    fireEvent.change(sourceBox(), { target: { value: '<svg><path' } });
    expect(screen.getByRole('alert').textContent).toContain('không hợp lệ');
    expect(screen.queryByRole('button', { name: 'Chèn vào icon' })).toBeNull();

    fireEvent.change(sourceBox(), { target: { value: SVG_ALIGNED } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Chèn vào icon' })).toBeTruthy();
  });

  it('SVG không có hình nào hiện lỗi', () => {
    renderWithEditor(testDoc([]), panel);
    pasteSvg('<svg viewBox="0 0 24 24"></svg>');
    expect(screen.getByRole('alert').textContent).toContain('Không tìm thấy hình nào');
  });

  it('hiện cảnh báo ngắn gọn của bộ nhập, co về lưới của icon', () => {
    renderWithEditor(testDoc([]), panel);
    pasteSvg('<svg viewBox="0 0 100 100" stroke="#000" fill="none"><path d="M10 50h80"/></svg>');
    expect(screen.getByText(/Đã co SVG gốc 100x100 về lưới 24x24/)).toBeTruthy();
  });

  it('chọn tệp .svg bằng FileReader rồi chèn', async () => {
    const { harness, container } = renderWithEditor(testDoc([]), panel);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([SVG_ALIGNED], 'icon.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(sourceBox().value).toBe(SVG_ALIGNED));
    fireEvent.click(button('Chèn vào icon'));
    expect(harness.state().doc.shapes).toHaveLength(2);
  });

  it('từ chối tệp không phải SVG', async () => {
    const { container } = renderWithEditor(testDoc([]), panel);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'anh.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chỉ nhận tệp .svg.'));
    expect(sourceBox().value).toBe('');
  });

  it('kéo thả tệp .svg vào vùng nhập', async () => {
    renderWithEditor(testDoc([]), panel);
    const file = new File([SVG_ALIGNED], 'icon.svg', { type: 'image/svg+xml' });
    fireEvent.drop(sourceBox(), { dataTransfer: { files: [file], getData: () => '' } });
    await waitFor(() => expect(sourceBox().value).toBe(SVG_ALIGNED));
    expect(screen.getByText(/2 hình/)).toBeTruthy();
  });

  it('kéo thả đoạn chữ là mã SVG cũng nhận', () => {
    renderWithEditor(testDoc([]), panel);
    fireEvent.drop(sourceBox(), { dataTransfer: { files: [], getData: () => SVG_ALIGNED } });
    expect(sourceBox().value).toBe(SVG_ALIGNED);
  });

  it('thả tệp không phải SVG hiện lỗi mà không đổi nội dung', async () => {
    renderWithEditor(testDoc([]), panel);
    fireEvent.drop(sourceBox(), { dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })], getData: () => '' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Chỉ nhận tệp .svg.'));
  });

  it('SVG chèn co theo cỡ lưới của icon', () => {
    const { harness } = renderWithEditor(testDoc([], { size: 48 }), panel);
    pasteSvg(SVG_ALIGNED);
    fireEvent.click(button('Chèn vào icon'));
    expect(geometryBounds(harness.state().doc.shapes[0].geometry)).toMatchObject({ x: 8, width: 32 });
  });
});
