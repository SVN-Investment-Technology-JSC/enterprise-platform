import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from './searchable-select';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('SearchableSelect Escape handling', () => {
  it('closes only the dropdown and hides Escape from outer dialog listeners', () => {
    const outerEscape = jest.fn();
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') outerEscape();
    };
    // Giả lập Dialog nghe Esc ở pha capture trên document.
    document.addEventListener('keydown', onDocKey, true);
    render(<SearchableSelect options={options} value="a" />);
    const input = screen.getByRole('textbox');
    fireEvent.click(input);
    expect(screen.queryByRole('listbox')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();

    // Dropdown đã đóng: Esc đi tiếp tới Dialog như bình thường.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onDocKey, true);
  });
});

describe('SearchableSelect trong hộp thoại có thuộc tính translate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('trừ gốc toạ độ của khung bao dùng translate/scale để danh sách không bị lệch', () => {
    const realComputed = window.getComputedStyle.bind(window);
    jest.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = realComputed(el, pseudo);
      if (!(el as HTMLElement).dataset?.dialog) return style;
      // Tailwind v4: -translate-x-1/2 -translate-y-1/2 đặt qua thuộc tính translate, transform vẫn là none.
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'translate') return '-336px -200px';
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    const rect = (r: Partial<DOMRect>) => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...r }) as DOMRect;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset?.dialog) return rect({ left: 100, top: 50, width: 600, height: 500 });
      if (this.className.includes('container')) return rect({ left: 130, top: 140, width: 500, height: 36, bottom: 176, right: 630 });
      return rect({});
    });

    render(
      <div data-dialog="true">
        <SearchableSelect options={options} value="a" />
      </div>,
    );
    fireEvent.click(screen.getByRole('textbox'));
    const dropdown = screen.getByRole('listbox').parentElement as HTMLElement;
    // Ô cách mép trái hộp thoại 30px và mép trên 126px: danh sách phải nằm ngay dưới ô, không cộng thêm toạ độ hộp thoại.
    expect(dropdown.style.left).toBe('30px');
    expect(dropdown.style.top).toBe('130px');
  });
});
