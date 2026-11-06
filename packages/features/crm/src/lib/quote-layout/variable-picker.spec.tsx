/**
 * @jest-environment jsdom
 */
import { QUOTE_LAYOUT_VARIABLES, type CustomFieldDefinition } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TextField } from './layout-fields';
import { VariablePicker, filterQuoteVariables, foldVietnamese, insertAtCaret } from './variable-picker';

jest.mock('./layout-designer.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const field = (id: string, name: string, active: boolean, sortOrder = 1): CustomFieldDefinition => ({
  id,
  entityType: 'quote',
  name,
  fieldType: 'TEXT',
  options: [],
  required: false,
  sortOrder,
  active,
});
const PAY = field('11111111-2222-4333-8444-555555555555', 'Điều khoản thanh toán', true);
const OFF = field('99999999-2222-4333-8444-555555555555', 'Trường đã tắt', false);

describe('filterQuoteVariables', () => {
  it('đủ các nhóm của plan 5.3, đúng thứ tự, có trường tuỳ biến đang bật', () => {
    const groups = filterQuoteVariables('', [PAY, OFF]);
    expect(groups.map((group) => group.label)).toEqual(['Báo giá', 'Khách hàng', 'Dự án', 'Người phụ trách', 'Tiền', 'Ngày in', 'Trường tuỳ biến']);
    expect(groups.slice(0, -1).reduce((sum, group) => sum + group.items.length, 0)).toBe(QUOTE_LAYOUT_VARIABLES.length);
    expect(groups.at(-1)?.items).toEqual([{ key: `custom.${PAY.id}`, label: 'Điều khoản thanh toán' }]);
  });

  it('TC-DS-15: tìm theo nhãn tiếng Việt, có dấu hoặc không dấu', () => {
    for (const query of ['tên khách', 'ten khach', 'TEN KHACH']) {
      const groups = filterQuoteVariables(query);
      expect(groups.flatMap((group) => group.items.map((item) => item.key))).toEqual(['customer.name']);
    }
    expect(filterQuoteVariables('dieu khoan', [PAY]).flatMap((group) => group.items.map((item) => item.key))).toEqual([`custom.${PAY.id}`]);
    expect(filterQuoteVariables('quote.code').flatMap((group) => group.items.map((item) => item.key))).toEqual(['quote.code']);
    expect(filterQuoteVariables('không có biến này')).toEqual([]);
  });

  it('TC-DS-16: trường đang tắt không có trong danh sách', () => {
    expect(filterQuoteVariables('truong da tat', [PAY, OFF])).toEqual([]);
  });

  it('bỏ dấu cả chữ đ', () => {
    expect(foldVietnamese(' Điện Thoại ')).toBe('dien thoai');
  });
});

describe('insertAtCaret', () => {
  it('chèn tại con trỏ, thay vùng chọn, không có con trỏ thì chèn cuối', () => {
    expect(insertAtCaret('Kính gửi ', 9, 9, '{{customer.name}}')).toEqual({ value: 'Kính gửi {{customer.name}}', caret: 26 });
    expect(insertAtCaret('A B', 1, 2, 'X')).toEqual({ value: 'AXB', caret: 2 });
    expect(insertAtCaret('AB', null, null, 'X')).toEqual({ value: 'ABX', caret: 3 });
    expect(insertAtCaret('AB', 50, 99, 'X')).toEqual({ value: 'ABX', caret: 3 });
  });
});

describe('VariablePicker', () => {
  it('chọn biến gọi onPick; Esc đóng', () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    render(<VariablePicker customFields={[PAY]} onPick={onPick} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Tìm biến'), { target: { value: 'ten khach' } });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Tên khách hàng/ }));
    expect(onPick).toHaveBeenCalledWith('customer.name');
    fireEvent.keyDown(screen.getByLabelText('Tìm biến'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('TC-DS-15: ô chữ "Kính gửi " + Chèn biến → "Kính gửi {{customer.name}}" đúng vị trí con trỏ', () => {
    const changes: Array<[string, boolean]> = [];
    function Host() {
      const [value, setValue] = useState('Kính gửi ');
      return (
        <TextField
          label="Nội dung"
          value={value}
          maxLength={4000}
          variables
          onChange={(next, typing) => {
            changes.push([next, typing]);
            setValue(next);
          }}
        />
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('Nội dung') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(9, 9);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole('button', { name: 'Chèn biến vào Nội dung' }));
    fireEvent.change(screen.getByLabelText('Tìm biến'), { target: { value: 'tên khách' } });
    fireEvent.click(screen.getByRole('button', { name: /Tên khách hàng/ }));
    expect(input.value).toBe('Kính gửi {{customer.name}}');
    expect(changes).toEqual([['Kính gửi {{customer.name}}', false]]);
    expect(input.selectionStart).toBe(26);
    expect(screen.queryByLabelText('Tìm biến')).toBeNull();
  });

  it('chèn giữa chuỗi khi con trỏ ở giữa', () => {
    function Host() {
      const [value, setValue] = useState('Số:  ngày');
      return <TextField label="Dòng phụ" value={value} maxLength={4000} variables onChange={(next) => setValue(next)} />;
    }
    render(<Host />);
    const input = screen.getByLabelText('Dòng phụ') as HTMLInputElement;
    input.setSelectionRange(4, 4);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole('button', { name: 'Chèn biến vào Dòng phụ' }));
    fireEvent.click(screen.getByRole('button', { name: /Mã báo giá/ }));
    expect(input.value).toBe('Số: {{quote.code}} ngày');
  });
});
