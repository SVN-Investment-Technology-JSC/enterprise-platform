/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MultiSelect, type MultiSelectOption } from './multi-select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom thiếu các API mà bộ định vị của popover dùng.
beforeAll(() => {
  const noop = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= noop;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= noop;
});

const OPTIONS: readonly MultiSelectOption[] = [
  { value: 'a', label: 'An toàn lao động' },
  { value: 'b', label: 'Hoạt động công đoàn' },
  { value: 'c', label: 'Thí nghiệm' },
];

function Harness({ initial = [], max }: { readonly initial?: readonly string[]; readonly max?: number }) {
  const [values, setValues] = useState<readonly string[]>(initial);
  return (
    <>
      <MultiSelect options={OPTIONS} values={values} onChange={setValues} placeholder="Chọn chuyên mục" max={max} aria-label="Chuyên mục" />
      <output data-testid="values">{values.join(',')}</output>
    </>
  );
}

const open = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Chuyên mục' }));
  });
};

const optionByName = (name: string) => screen.getByRole('option', { name: new RegExp(name) });

describe('MultiSelect', () => {
  it('hiện placeholder khi chưa chọn và các thẻ khi đã chọn', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByText('Chọn chuyên mục')).toBeTruthy();
    rerender(<Harness initial={['a', 'c']} />);
  });

  it('bấm mục để chọn rồi bỏ, danh sách vẫn mở và thẻ hiện trong ô', async () => {
    render(<Harness />);
    await open();
    await act(async () => {
      fireEvent.click(within(optionByName('Hoạt động công đoàn')).getByRole('button'));
    });
    expect(screen.getByTestId('values').textContent).toBe('b');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(optionByName('Hoạt động công đoàn').getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      fireEvent.click(within(optionByName('Thí nghiệm')).getByRole('button'));
    });
    expect(screen.getByTestId('values').textContent).toBe('b,c');
    await act(async () => {
      fireEvent.click(within(optionByName('Hoạt động công đoàn')).getByRole('button'));
    });
    expect(screen.getByTestId('values').textContent).toBe('c');
  });

  it('nút x trên thẻ bỏ mục mà không mở danh sách', async () => {
    render(<Harness initial={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ An toàn lao động' }));
    expect(screen.getByTestId('values').textContent).toBe('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('đủ số tối đa thì khoá các mục chưa chọn nhưng vẫn bỏ được mục đã chọn', async () => {
    render(<Harness initial={['a', 'b']} max={2} />);
    await open();
    expect(within(optionByName('Thí nghiệm')).getByRole('button').hasAttribute('disabled')).toBe(true);
    await act(async () => {
      fireEvent.click(within(optionByName('An toàn lao động')).getByRole('button'));
    });
    expect(screen.getByTestId('values').textContent).toBe('b');
    expect(within(optionByName('Thí nghiệm')).getByRole('button').hasAttribute('disabled')).toBe(false);
  });

  it('tìm không phân biệt dấu và dùng phím mũi tên cùng Enter để chọn', async () => {
    render(<Harness />);
    await open();
    const search = screen.getByRole('textbox', { name: 'Tìm…' });
    await act(async () => {
      fireEvent.change(search, { target: { value: 'thi nghiem' } });
    });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Enter' });
    });
    expect(screen.getByTestId('values').textContent).toBe('c');
    await act(async () => {
      fireEvent.change(search, { target: { value: '' } });
    });
    await act(async () => {
      fireEvent.keyDown(search, { key: 'ArrowDown' });
    });
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Enter' });
    });
    expect(screen.getByTestId('values').textContent).toBe('c,b');
  });

  it('Backspace khi ô tìm trống bỏ mục chọn cuối', async () => {
    render(<Harness initial={['a', 'b']} />);
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Tìm…' }), { key: 'Backspace' });
    });
    expect(screen.getByTestId('values').textContent).toBe('a');
  });
});
