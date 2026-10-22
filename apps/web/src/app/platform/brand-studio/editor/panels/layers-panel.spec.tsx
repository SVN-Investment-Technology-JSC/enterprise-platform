import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import { LayersPanel } from './layers-panel';
import { rectShape, renderWithEditor, testDoc } from './panel-test-utils';

const panel = (props: Parameters<typeof LayersPanel>[0]) => <LayersPanel {...props} />;

const rows = () => within(screen.getByRole('list', { name: 'Danh sách lớp' })).getAllByRole('listitem');
const rowOf = (name: string) => rows().find((row) => within(row).queryByText(name)) as HTMLElement;
const pick = (name: string) => within(rowOf(name)).getByRole('button', { name });
const names = () => rows().map((row) => row.textContent?.trim() ?? '');

const threeLayers = () => testDoc([rectShape('a'), rectShape('b'), rectShape('c')]);
const order = (harness: { state: () => { doc: { shapes: readonly { id: string }[] } } }) =>
  harness.state().doc.shapes.map((shape) => shape.id).join('');

function mockRect(row: HTMLElement) {
  row.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
}

type DragKind = 'dragOver' | 'drop';

/** jsdom không có DragEvent nên `clientY` trong tham số bị bỏ; gắn thẳng vào sự kiện để thử vị trí thả. */
function dragAt(kind: DragKind, target: HTMLElement, transfer: object, clientY: number) {
  const event = createEvent[kind](target, { dataTransfer: transfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(target, event);
}

function dataTransfer() {
  return { setData: jest.fn(), getData: jest.fn(), effectAllowed: '', dropEffect: '' };
}

describe('LayersPanel', () => {
  it('hiện lớp trên cùng ở đầu danh sách', () => {
    renderWithEditor(threeLayers(), panel);
    expect(names().map((text) => text.charAt(0))).toEqual(['c', 'b', 'a']);
  });

  it('hiện trạng thái trống khi chưa có lớp', () => {
    renderWithEditor(testDoc([]), panel);
    expect(screen.getByText('Chưa có lớp nào')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('bấm để chọn một lớp', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.click(pick('b'));
    expect(harness.state().selection).toEqual(['b']);
    fireEvent.click(pick('c'));
    expect(harness.state().selection).toEqual(['c']);
    expect(pick('c').getAttribute('aria-pressed')).toBe('true');
  });

  it('Ctrl hoặc Shift thêm hoặc bớt lớp trong vùng chọn', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.click(pick('a'));
    fireEvent.click(pick('c'), { ctrlKey: true });
    expect(harness.state().selection).toEqual(['a', 'c']);
    fireEvent.click(pick('a'), { ctrlKey: true });
    expect(harness.state().selection).toEqual(['c']);
  });

  it('Shift chọn cả khoảng từ lớp chọn trước đó', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.click(pick('c'));
    fireEvent.click(pick('a'), { shiftKey: true });
    expect([...harness.state().selection].sort()).toEqual(['a', 'b', 'c']);
  });

  it('phím Enter và Space chọn lớp khi dòng đang được tiêu điểm', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.keyDown(pick('b'), { key: 'Enter' });
    expect(harness.state().selection).toEqual(['b']);
    fireEvent.keyDown(pick('a'), { key: ' ' });
    expect(harness.state().selection).toEqual(['a']);
  });

  it('nút mắt ẩn rồi hiện lớp', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.click(within(rowOf('b')).getByRole('button', { name: 'Ẩn lớp' }));
    expect(harness.shape('b').hidden).toBe(true);
    fireEvent.click(within(rowOf('b')).getByRole('button', { name: 'Hiện lớp' }));
    expect(harness.shape('b').hidden).toBe(false);
  });

  it('nút khoá khoá rồi mở khoá lớp', () => {
    const { harness } = renderWithEditor(threeLayers(), panel);
    fireEvent.click(within(rowOf('a')).getByRole('button', { name: 'Khoá lớp' }));
    expect(harness.shape('a').locked).toBe(true);
    fireEvent.click(within(rowOf('a')).getByRole('button', { name: 'Mở khoá lớp' }));
    expect(harness.shape('a').locked).toBe(false);
  });

  it('chỉ lớp được chọn mới có nút nhân đôi và xoá', () => {
    renderWithEditor(threeLayers(), panel);
    expect(screen.queryByRole('button', { name: 'Xoá lớp đã chọn' })).toBeNull();
    fireEvent.click(pick('b'));
    const row = rowOf('b');
    expect(within(row).getByRole('button', { name: 'Xoá lớp đã chọn' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Nhân đôi lớp đã chọn' })).toBeTruthy();
    expect(within(rowOf('a')).queryByRole('button', { name: 'Xoá lớp đã chọn' })).toBeNull();
  });

  it('nhân đôi và xoá tác động lên toàn bộ vùng chọn', () => {
    const { harness } = renderWithEditor(threeLayers(), panel, { selection: ['a', 'b'] });
    expect(screen.getAllByRole('button', { name: 'Xoá lớp đã chọn' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Nhân đôi lớp đã chọn' }));
    expect(harness.state().doc.shapes).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lớp đã chọn' }));
    expect(harness.state().doc.shapes).toHaveLength(3);
  });

  describe('đổi tên bằng nhấp đôi', () => {
    const startRename = (name: string) => {
      fireEvent.doubleClick(pick(name));
      return screen.getByRole('textbox', { name: 'Tên lớp' }) as HTMLInputElement;
    };

    it('Enter lưu tên mới', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const input = startRename('b');
      expect(input.value).toBe('b');
      fireEvent.change(input, { target: { value: '  Khung   chính ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(harness.shape('b').name).toBe('Khung chính');
      expect(screen.queryByRole('textbox', { name: 'Tên lớp' })).toBeNull();
      expect(harness.state().past).toHaveLength(1);
    });

    it('rời ô cũng lưu tên', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const input = startRename('a');
      fireEvent.change(input, { target: { value: 'Nền' } });
      fireEvent.blur(input);
      expect(harness.shape('a').name).toBe('Nền');
    });

    it('Esc huỷ, tên rỗng giữ tên cũ, tên không đổi không tạo bước hoàn tác', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      let input = startRename('a');
      fireEvent.change(input, { target: { value: 'Đổi' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(harness.shape('a').name).toBe('a');

      input = startRename('a');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(harness.shape('a').name).toBe('a');

      input = startRename('a');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(harness.state().past).toHaveLength(0);
    });

    it('phím F2 mở ô đổi tên', () => {
      renderWithEditor(threeLayers(), panel);
      fireEvent.keyDown(pick('c'), { key: 'F2' });
      expect(screen.getByRole('textbox', { name: 'Tên lớp' })).toBeTruthy();
    });
  });

  describe('kéo thả đổi thứ tự', () => {
    it('kéo lớp dưới cùng thả lên nửa trên của lớp trên cùng thì nó lên trên cùng', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const source = rowOf('a');
      const target = rowOf('c');
      mockRect(target);
      const transfer = dataTransfer();
      fireEvent.dragStart(source, { dataTransfer: transfer });
      dragAt('dragOver', target, transfer, 5);
      dragAt('drop', target, transfer, 5);
      expect(order(harness)).toBe('bca');
      expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'a');
    });

    it('thả ở nửa dưới của một dòng thì lớp nằm ngay dưới dòng đó', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const target = rowOf('a');
      mockRect(target);
      const transfer = dataTransfer();
      fireEvent.dragStart(rowOf('c'), { dataTransfer: transfer });
      dragAt('dragOver', target, transfer, 35);
      dragAt('drop', target, transfer, 35);
      expect(order(harness)).toBe('cab');
    });

    it('thả lên chính nó hoặc kéo xong không thả vào đâu thì không đổi gì', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const own = rowOf('b');
      mockRect(own);
      const transfer = dataTransfer();
      fireEvent.dragStart(own, { dataTransfer: transfer });
      dragAt('drop', own, transfer, 5);
      fireEvent.dragEnd(own, { dataTransfer: transfer });
      expect(order(harness)).toBe('abc');
      expect(harness.state().past).toHaveLength(0);
    });

    it('thả khi không có lớp nào đang được kéo (kéo thứ khác vào) thì bỏ qua', () => {
      const { harness } = renderWithEditor(threeLayers(), panel);
      const target = rowOf('a');
      mockRect(target);
      dragAt('drop', target, dataTransfer(), 5);
      expect(order(harness)).toBe('abc');
    });
  });
});
