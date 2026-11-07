/**
 * @jest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fixtureLine } from '../quote-layout/quote-layout.fixtures';
import { LINES_LOCKED_TEXT, QuoteLinesTable, lineMenuItems } from './quote-lines-table';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../pricing/pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./quote-workspace.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

// Bảng antd đo kích thước bằng API jsdom không có; thay bằng bảng HTML giữ đúng `columns`, `onRow`, `rowClassName`.
jest.mock('antd', () => ({
  Table: ({
    columns,
    dataSource,
    rowKey,
    onRow,
    rowClassName,
    locale,
  }: {
    columns: { key?: string; dataIndex?: string; render?: (value: unknown, row: unknown, index: number) => unknown }[];
    dataSource: Record<string, unknown>[];
    rowKey: string;
    onRow: (row: unknown, index: number) => Record<string, unknown>;
    rowClassName: (row: unknown) => string;
    locale: { emptyText: string };
  }) => (
    <table>
      <tbody>
        {dataSource.length ? (
          dataSource.map((row, index) => (
            <tr key={String(row[rowKey])} data-row-key={String(row[rowKey])} className={rowClassName(row)} {...onRow(row, index)}>
              {columns.map((column, cell) => (
                <td key={column.key ?? column.dataIndex ?? cell}>
                  {(column.render ? column.render(column.dataIndex ? row[column.dataIndex] : undefined, row, index) : row[column.dataIndex ?? '']) as never}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td>{locale.emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  ),
}));

const lines = [
  fixtureLine({ id: 'l1', lineNo: 1, materialCode: 'VT-01', materialName: 'Máy bơm' }),
  fixtureLine({ id: 'l2', lineNo: 2, materialCode: 'VT-02', materialName: 'Van một chiều' }),
  fixtureLine({ id: 'l3', lineNo: 3, materialCode: 'VT-03', materialName: 'Ống thép' }),
];

function setup(patch: Partial<Parameters<typeof QuoteLinesTable>[0]> = {}) {
  const handlers = {
    onAdd: jest.fn(),
    onInsert: jest.fn(),
    onEdit: jest.fn(),
    onView: jest.fn(),
    onRemove: jest.fn().mockResolvedValue(true),
  };
  render(<QuoteLinesTable title="Dòng hàng" lines={lines} editable {...handlers} {...patch} />);
  return handlers;
}

const row = (lineNo: number) => screen.getByRole('row', { name: new RegExp(`^Dòng ${lineNo}:`) });
const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent?.trim());

describe('QuoteLinesTable (P3C4-04)', () => {
  it('menu theo quyền sửa: Nháp có Thêm / Hiệu chỉnh / Chèn / Xoá; không còn Nháp chỉ có Xem', () => {
    expect(lineMenuItems(true)).toEqual(['add', 'edit', 'insert', 'remove']);
    expect(lineMenuItems(false)).toEqual(['view']);
  });

  it('TC-QW-11: ô tìm và nút + mở chọn mặt hàng với chữ đang gõ; Enter ở ô tìm cũng mở', () => {
    const { onAdd } = setup();
    fireEvent.change(screen.getByLabelText('Tìm sản phẩm, hàng hoá, dịch vụ'), { target: { value: ' máy bơm ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng hàng' }));
    expect(onAdd).toHaveBeenLastCalledWith('máy bơm');
    fireEvent.change(screen.getByLabelText('Tìm sản phẩm, hàng hoá, dịch vụ'), { target: { value: 'van' } });
    fireEvent.keyDown(screen.getByLabelText('Tìm sản phẩm, hàng hoá, dịch vụ'), { key: 'Enter' });
    expect(onAdd).toHaveBeenLastCalledWith('van');
  });

  it('TC-QW-12: bấm đúp dòng 2 mở sửa đúng dòng 2', () => {
    const { onEdit } = setup();
    fireEvent.doubleClick(row(2));
    expect(onEdit).toHaveBeenCalledWith(lines[1]);
  });

  it('TC-QW-13, TC-QW-14: chuột phải → Thêm (thêm cuối) và Chèn (trên dòng đang chọn)', () => {
    const { onAdd, onInsert } = setup();
    fireEvent.contextMenu(row(1), { clientX: 10, clientY: 20 });
    expect(menuItems()).toEqual(['Thêm', 'Hiệu chỉnh', 'Chèn', 'Xoá']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Thêm' }));
    expect(onAdd).toHaveBeenCalledWith('');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(row(2), { clientX: 10, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chèn' }));
    expect(onInsert).toHaveBeenCalledWith(lines[1]);
  });

  it('chuột phải → Hiệu chỉnh mở sửa dòng', () => {
    const { onEdit } = setup();
    fireEvent.contextMenu(row(3));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hiệu chỉnh' }));
    expect(onEdit).toHaveBeenCalledWith(lines[2]);
  });

  it('TC-QW-16: Xoá hỏi xác nhận; Huỷ không xoá, Xoá thì gọi xoá đúng dòng', async () => {
    const { onRemove } = setup();
    fireEvent.contextMenu(row(2));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xoá' }));
    const dialog = screen.getByRole('dialog', { name: 'Xoá dòng 2?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.contextMenu(row(2));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xoá' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(lines[1]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('TC-QW-17: Enter sửa, Delete hỏi xoá, Shift+F10 và phím menu mở menu, Esc đóng menu, mũi tên chọn dòng', () => {
    const { onEdit } = setup();
    fireEvent.keyDown(row(1), { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith(lines[0]);

    fireEvent.keyDown(row(1), { key: 'ArrowDown' });
    expect(row(2).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(row(2));

    fireEvent.keyDown(row(2), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Dòng 2' })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Thêm');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Hiệu chỉnh');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(row(3), { key: 'ContextMenu' });
    expect(screen.getByRole('menu', { name: 'Dòng 3' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(row(3), { key: 'Delete' });
    expect(screen.getByRole('dialog', { name: 'Xoá dòng 3?' })).toBeTruthy();
  });

  it('TC-QW-18: không còn Nháp thì chỉ xem: menu chỉ có Xem, bấm đúp mở chỉ đọc, không có ô tìm, nút +, Chiết khấu', () => {
    const discount = { enabled: true, hint: 'x', onOpen: jest.fn() };
    const { onView, onEdit, onRemove } = setup({ editable: false, discount });
    expect(screen.queryByRole('button', { name: 'Thêm dòng hàng' })).toBeNull();
    expect(screen.queryByLabelText('Tìm sản phẩm, hàng hoá, dịch vụ')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chiết khấu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();

    fireEvent.contextMenu(row(1));
    expect(menuItems()).toEqual(['Xem']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xem' }));
    expect(onView).toHaveBeenCalledWith(lines[0]);

    fireEvent.doubleClick(row(2));
    expect(onView).toHaveBeenLastCalledWith(lines[1]);
    fireEvent.keyDown(row(2), { key: 'Delete' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('TC-QW-18, TC-QW-09: nút Chiết khấu tắt kèm chú giải khi mẫu theo dòng; bật thì mở phần chiết khấu tổng đơn', () => {
    const onOpen = jest.fn();
    const { unmount } = render(
      <QuoteLinesTable
        title="Dòng hàng"
        lines={lines}
        editable
        discount={{ enabled: false, hint: 'Mẫu báo giá này tính chiết khấu theo dòng.', onOpen }}
        onAdd={jest.fn()}
        onInsert={jest.fn()}
        onEdit={jest.fn()}
        onView={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    const off = screen.getByRole('button', { name: /Chiết khấu/ }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(screen.getByText('Mẫu báo giá này tính chiết khấu theo dòng.')).toBeTruthy();
    unmount();

    setup({ discount: { enabled: true, hint: 'Nhập chiết khấu một lần cho cả báo giá.', onOpen } });
    fireEvent.click(screen.getByRole('button', { name: /Chiết khấu/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('TC-QW-26: báo giá chưa lưu thì khoá bảng kèm câu hướng dẫn; nút + vẫn bấm được', () => {
    const { onAdd } = setup({ lines: [], editable: false, lockedText: LINES_LOCKED_TEXT });
    expect(screen.getByText('Lưu báo giá để thêm dòng hàng')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng hàng' }));
    expect(onAdd).toHaveBeenCalledWith('');
  });

  it('nút + khoá khi đang bận', () => {
    const { onAdd } = setup({ busy: true });
    const add = screen.getByRole('button', { name: 'Thêm dòng hàng' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Tìm sản phẩm, hàng hoá, dịch vụ'), { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('TC-QW-17: Huỷ hộp xoá thì focus trở về hàng, Shift+F10 dùng tiếp được', async () => {
    setup();
    row(2).focus();
    fireEvent.keyDown(row(2), { key: 'Delete' });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Xoá dòng 2?' })).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(document.activeElement).toBe(row(2)));
    fireEvent.keyDown(row(2), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Dòng 2' })).toBeTruthy();
  });

  it('TC-P3PERM-08: không có quyền xem giá vốn thì ẩn cột giá vốn và biên', () => {
    setup();
    const shown = within(row(1)).getAllByRole('cell').length;
    cleanup();
    setup({ costHidden: true });
    expect(within(row(1)).getAllByRole('cell')).toHaveLength(shown - 2);
  });
});
