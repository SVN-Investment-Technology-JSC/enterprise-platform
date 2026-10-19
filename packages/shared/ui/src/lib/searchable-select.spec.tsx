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

describe('SearchableSelect trong khung @container (container-type)', () => {
  afterEach(() => jest.restoreAllMocks());

  const rect = (r: Partial<DOMRect>) =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...r }) as DOMRect;
  // Trình duyệt thật: `fixed` tính theo cửa sổ, nên vị trí thật của danh sách chính là left/top đã đặt.
  function mockBrowser(containerStyle: Record<string, string>) {
    jest.replaceProperty(window, 'innerWidth', 1920);
    jest.replaceProperty(window, 'innerHeight', 900);
    const realComputed = window.getComputedStyle.bind(window);
    jest.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = realComputed(el, pseudo);
      if (!(el as HTMLElement).dataset?.cq) return style;
      return new Proxy(style, {
        get(target, prop) {
          if (typeof prop === 'string' && prop in containerStyle) return containerStyle[prop];
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // Khung @container nằm lệch cửa sổ: trái 548, đã cuộn lên 580px.
      if (this.dataset?.cq) return rect({ left: 548, top: -580, width: 1300, height: 2000 });
      if (this.className.includes('container')) return rect({ left: 698, top: 320, width: 504, height: 36, bottom: 356, right: 1202 });
      if (this.className.includes('dropdown'))
        return rect({ left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 504, height: 120 });
      return rect({});
    });
  }

  it('không trừ gốc của khung @container: danh sách nằm ngay dưới ô', () => {
    mockBrowser({ containerType: 'inline-size' });
    render(
      <div data-cq="true">
        <SearchableSelect options={options} value="a" />
      </div>,
    );
    fireEvent.click(screen.getByRole('textbox'));
    const dropdown = screen.getByRole('listbox').parentElement as HTMLElement;
    expect(dropdown.style.left).toBe('698px');
    expect(dropdown.style.top).toBe('360px');
  });

  it('tự hiệu chỉnh khi khung bao bị suy luận sai khối chứa của phần tử fixed', () => {
    // Khung báo transform (suy luận gốc 548,-580) nhưng trình duyệt vẫn tính fixed theo cửa sổ.
    mockBrowser({ transform: 'matrix(1, 0, 0, 1, 0, 0)' });
    render(
      <div data-cq="true">
        <SearchableSelect options={options} value="a" />
      </div>,
    );
    fireEvent.click(screen.getByRole('textbox'));
    const dropdown = screen.getByRole('listbox').parentElement as HTMLElement;
    expect(dropdown.style.left).toBe('698px');
    expect(dropdown.style.top).toBe('360px');
  });
});

describe('SearchableSelect searchInDropdown', () => {
  it('ô ngoài chỉ hiện giá trị (không gõ trực tiếp), ô tìm nằm trong danh sách và lọc được', () => {
    // jsdom không có scrollIntoView (danh sách dùng khi di chuyển bằng phím mũi tên).
    Element.prototype.scrollIntoView = jest.fn();
    const onChange = jest.fn();
    render(<SearchableSelect searchInDropdown clearable={false} options={options} value="a" onChange={onChange} />);
    const trigger = screen.getByDisplayValue('Alpha') as HTMLInputElement;
    expect(trigger.readOnly).toBe(true);
    // Chưa mở: chưa có ô tìm trong danh sách.
    expect(screen.queryByLabelText('Tìm trong danh sách')).toBeNull();

    fireEvent.click(trigger);
    const search = screen.getByLabelText('Tìm trong danh sách') as HTMLInputElement;
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.change(search, { target: { value: 'bet' } });
    const filtered = screen.getAllByRole('option');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].textContent).toContain('Beta');
    // Gõ ở ô tìm không đổi giá trị hiển thị của ô ngoài.
    expect(trigger.value).toBe('Alpha');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ô ngoài không có kính lúp đè lên giá trị đã chọn', () => {
    const { container, rerender } = render(<SearchableSelect options={options} value="a" />);
    // Kiểu gõ trực tiếp vẫn có kính lúp trong ô.
    expect(container.querySelector('.searchIcon')).not.toBeNull();

    // Phải không có trong DOM: chỉ đặt `hidden` thì app không có preflight Tailwind vẫn vẽ nó (`.searchIcon` đặt `display: flex`).
    rerender(<SearchableSelect searchInDropdown options={options} value="a" />);
    expect(container.querySelector('.searchIcon')).toBeNull();
  });

  it('đóng dropdown và không bị mở lại khi được bọc trong thẻ <label>', () => {
    const onChange = jest.fn();
    render(
      <label>
        <span>Loại hợp đồng</span>
        <SearchableSelect options={options} value="a" onChange={onChange} />
      </label>,
    );
    const trigger = screen.getByDisplayValue('Alpha') as HTMLInputElement;
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeNull();

    const optionBeta = screen.getByRole('option', { name: /Beta/i });
    fireEvent.mouseDown(optionBeta);
    fireEvent.click(optionBeta);

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

