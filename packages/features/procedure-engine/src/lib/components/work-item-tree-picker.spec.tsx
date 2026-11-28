/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { ProjectWorkItemOption } from '../workspace-api';
import { buildWorkItemTree, WorkItemTreePicker } from './work-item-tree-picker';

// Workspace trả theo độ sâu rồi thứ tự sắp xếp, không theo thứ tự cây.
const ITEMS: ProjectWorkItemOption[] = [
  { id: 'a', code: 'CV001', title: 'Thiết kế', depth: 0 },
  { id: 'b', code: 'CV002', title: 'Thi công', depth: 0 },
  { id: 'z', code: 'CV099', title: 'Đã nghiệm thu', depth: 0, closed: true },
  { id: 'a1', code: 'CV003', title: 'Bản vẽ móng', depth: 1, parentId: 'a' },
  { id: 'b1', code: 'CV004', title: 'Đổ bê tông', depth: 1, parentId: 'b' },
  { id: 'b2', code: 'CV005', title: 'Lắp cáp', depth: 1, parentId: 'b', closed: true },
  { id: 'b21', code: 'CV006', title: 'Kéo cáp ngầm', depth: 2, parentId: 'b2' },
];

function Harness({
  initial = '',
  excludeId,
  onChange,
}: {
  initial?: string;
  excludeId?: string;
  onChange?: (id: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WorkItemTreePicker
      label="Công việc cha"
      items={ITEMS}
      value={value}
      excludeId={excludeId}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

const rowNames = () =>
  screen.getAllByRole('treeitem').map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

describe('buildWorkItemTree', () => {
  it('dựng cây theo parentId, giữ thứ tự anh em, bỏ việc đã đóng không còn con mở', () => {
    const tree = buildWorkItemTree(ITEMS);
    expect(tree.map((node) => node.item.id)).toEqual(['a', 'b']);
    const thiCong = tree[1];
    expect(thiCong.children.map((node) => node.item.id)).toEqual(['b1', 'b2']);
    // Việc đã đóng còn con mở: hiện để giữ cấu trúc nhưng không chọn được.
    expect(thiCong.children[1]).toMatchObject({ selectable: false });
    expect(thiCong.children[1].children.map((node) => node.item.id)).toEqual(['b21']);
  });

  it('bỏ công việc bị loại cùng nhánh con; cha không xem được thì đặt ở gốc', () => {
    expect(buildWorkItemTree(ITEMS, 'b').map((node) => node.item.id)).toEqual(['a']);
    const orphan = buildWorkItemTree([{ id: 'x', code: 'CV010', title: 'Con lạc', depth: 2, parentId: 'missing' }]);
    expect(orphan.map((node) => node.item.id)).toEqual(['x']);
  });
});

/** Mở ô chọn thả xuống (bình thường chỉ hiện lựa chọn hiện tại). */
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /^Công việc cha:/ }));

describe('WorkItemTreePicker', () => {
  it('đóng sẵn: chỉ hiện ô ghi lựa chọn hiện tại (mặc định "Gốc dự án"), không bày cả cây', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Công việc cha: Gốc dự án' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tree')).toBeNull();
    openPicker();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('tree', { name: 'Công việc cha' })).toBeTruthy();
    // Esc đóng lại, không đổi lựa chọn.
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('mở ra: "Gốc dự án" đầu tiên (đang chọn), các nhánh thu gọn, mở / thu bằng nút', () => {
    render(<Harness />);
    openPicker();
    const tree = screen.getByRole('tree', { name: 'Công việc cha' });
    expect(rowNames()).toEqual(['Gốc dự án', 'CV001Thiết kế', 'CV002Thi công']);
    const root = within(tree).getAllByRole('treeitem')[0];
    expect(root.getAttribute('aria-selected')).toBe('true');
    const thiCong = screen.getByRole('treeitem', { name: /CV002/ });
    expect(thiCong.getAttribute('aria-expanded')).toBe('false');
    expect(thiCong.getAttribute('aria-level')).toBe('1');

    fireEvent.click(thiCong.querySelector('[aria-hidden="true"]') as Element);
    expect(thiCong.getAttribute('aria-expanded')).toBe('true');
    expect(rowNames()).toEqual([
      'Gốc dự án',
      'CV001Thiết kế',
      'CV002Thi công',
      'CV004Đổ bê tông',
      'CV005Lắp cápđã đóng',
    ]);
    expect(screen.getByRole('treeitem', { name: /CV004/ }).getAttribute('aria-level')).toBe('2');
  });

  it('bấm chọn một công việc thì chọn và đóng lại; việc đã đóng không chọn được', () => {
    const onChange = jest.fn();
    render(<Harness initial="b1" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Công việc cha: CV004 · Đổ bê tông' })).toBeTruthy();
    openPicker();
    // Lựa chọn hiện tại: nhánh cha được mở sẵn và dòng được tô.
    expect(screen.getByRole('treeitem', { name: /CV004/ }).getAttribute('aria-selected')).toBe('true');

    const closed = screen.getByRole('treeitem', { name: /CV005/ });
    expect(closed.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(closed);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('treeitem', { name: /CV001/ }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Công việc cha: CV001 · Thiết kế' })).toBeTruthy();
    openPicker();
    fireEvent.click(screen.getByRole('treeitem', { name: /Gốc dự án/ }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('tìm kiếm giữ lại các nhánh cha của kết quả, không phân biệt dấu', () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'keo cap' } });
    expect(rowNames()).toEqual(['CV002Thi công', 'CV005Lắp cápđã đóng', 'CV006Kéo cáp ngầm']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'không có' } });
    expect(screen.queryAllByRole('treeitem')).toEqual([]);
    expect(screen.getByText('Không có công việc khớp “không có”.')).toBeTruthy();
  });

  it('điều khiển bằng bàn phím: lên / xuống, phải mở nhánh và xuống con, trái lên cha / thu nhánh, Enter chọn', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    openPicker();
    const root = screen.getByRole('treeitem', { name: /Gốc dự án/ });
    expect(root.tabIndex).toBe(0);
    root.focus();

    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    const thiCong = screen.getByRole('treeitem', { name: /CV002/ });
    expect(document.activeElement).toBe(thiCong);
    expect(thiCong.tabIndex).toBe(0);

    fireEvent.keyDown(thiCong, { key: 'ArrowRight' });
    expect(thiCong.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(thiCong, { key: 'ArrowRight' });
    const child = screen.getByRole('treeitem', { name: /CV004/ });
    expect(document.activeElement).toBe(child);

    fireEvent.keyDown(child, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(thiCong);
    fireEvent.keyDown(thiCong, { key: 'ArrowLeft' });
    expect(thiCong.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(thiCong, { key: 'Home' });
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    // Chọn xong thì đóng và trả tiêu điểm về ô chọn.
    expect(screen.queryByRole('tree')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Công việc cha:/ }));
  });

  it('ẩn công việc đang liên kết cùng nhánh con; tắt khi chưa chọn dự án; báo đang tải', () => {
    const { rerender } = render(<Harness excludeId="b" />);
    openPicker();
    expect(rowNames()).toEqual(['Gốc dự án', 'CV001Thiết kế']);
    rerender(
      <WorkItemTreePicker label="Công việc cha" items={[]} value="" onChange={jest.fn()} disabled disabledText="Chọn dự án trước" />,
    );
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByText('Chọn dự án trước')).toBeTruthy();
    rerender(<WorkItemTreePicker label="Công việc cha" items={[]} value="" onChange={jest.fn()} loading />);
    expect(screen.getByRole('button', { name: /^Công việc cha:/ }).textContent).toBe('Đang tải công việc của dự án…');
  });
});
