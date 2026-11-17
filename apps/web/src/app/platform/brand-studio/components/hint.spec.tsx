import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Hint } from './hint';

const renderHint = (ui: React.ReactElement) => render(<TooltipProvider delay={0}>{ui}</TooltipProvider>);

const hover = (element: HTMLElement) => {
  fireEvent.pointerEnter(element);
  fireEvent.mouseEnter(element);
  fireEvent.pointerMove(element);
  fireEvent.mouseMove(element);
};

describe('Hint', () => {
  it('rê chuột vào phần tử thì hiện nội dung gợi ý; phần tử giữ nguyên thuộc tính và không có title', async () => {
    renderHint(
      <Hint label="Lưu (Ctrl+S)">
        <button aria-label="Lưu" type="button">
          L
        </button>
      </Hint>,
    );
    const button = screen.getByRole('button', { name: 'Lưu' });
    expect(button.getAttribute('title')).toBeNull();
    expect(screen.queryByText('Lưu (Ctrl+S)')).toBeNull();
    hover(button);
    expect(await screen.findByText('Lưu (Ctrl+S)')).toBeTruthy();
  });

  it('focus bàn phím cũng hiện gợi ý', async () => {
    renderHint(
      <Hint label="Gợi ý bàn phím">
        <button type="button">Nút</button>
      </Hint>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Nút' }));
    expect(await screen.findByText('Gợi ý bàn phím')).toBeTruthy();
  });

  it('nhãn rỗng thì trả nguyên phần tử, không có tooltip', () => {
    for (const label of [undefined, null, '', false]) {
      const { unmount } = renderHint(
        <Hint label={label}>
          <button type="button">Trống</button>
        </Hint>,
      );
      const button = screen.getByRole('button', { name: 'Trống' });
      hover(button);
      expect(screen.queryByRole('tooltip')).toBeNull();
      unmount();
    }
  });

  it('chuyển ref và onClick của thành phần bọc (như Popconfirm) xuống phần tử con', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = jest.fn();
    renderHint(
      <Hint label="Gợi ý" onClick={onClick} ref={ref}>
        <button type="button">Mở</button>
      </Hint>,
    );
    const button = screen.getByRole('button', { name: 'Mở' });
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('wrapperClassName: nút nằm trong thẻ bọc, và thẻ bọc giữ nguyên khi nút chuyển giữa khoá và bật', () => {
    const view = renderHint(
      <Hint label="Gợi ý" wrapperClassName="">
        <button disabled type="button">
          Lưu
        </button>
      </Hint>,
    );
    const button = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(button.parentElement?.tagName).toBe('SPAN');
    expect(button.disabled).toBe(true);

    view.rerender(
      <TooltipProvider delay={0}>
        <Hint label="Gợi ý" wrapperClassName="">
          <button type="button">Lưu</button>
        </Hint>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Lưu' })).toBe(button);
    expect(button.disabled).toBe(false);
  });

  it('không có wrapperClassName thì không thêm thẻ bọc', () => {
    const { container } = renderHint(
      <Hint label="Gợi ý">
        <button type="button">Trần</button>
      </Hint>,
    );
    expect(screen.getByRole('button', { name: 'Trần' }).parentElement).toBe(container);
  });
});
