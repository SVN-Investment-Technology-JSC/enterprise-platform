import { act, fireEvent, render, screen } from '@testing-library/react';
import { TitleTooltips } from './title-tooltips';

function hover(element: Element) {
  act(() => {
    fireEvent.pointerOver(element, { pointerType: 'mouse' });
    jest.advanceTimersByTime(200);
  });
}

describe('TitleTooltips', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('hiện tooltip thay chú thích gốc khi rê chuột và trả lại title khi rời đi', () => {
    render(
      <>
        <button type="button" title="Đăng xuất">
          <svg />
        </button>
        <TitleTooltips />
      </>,
    );
    const button = screen.getByRole('button');
    hover(button.querySelector('svg') as Element);

    expect(screen.getByRole('tooltip').textContent).toBe('Đăng xuất');
    // Gỡ tạm title để trình duyệt không hiện thêm chú thích gốc.
    expect(button.hasAttribute('title')).toBe(false);

    act(() => {
      fireEvent.pointerOut(button, { relatedTarget: document.body });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('title')).toBe('Đăng xuất');
  });

  it('hiện khi focus bàn phím và đóng bằng Escape', () => {
    render(
      <>
        <button type="button" title="Thu gọn thanh bên">
          x
        </button>
        <TitleTooltips />
      </>,
    );
    const button = screen.getByRole('button');
    act(() => {
      fireEvent.focusIn(button);
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Thu gọn thanh bên');

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('bỏ qua iframe và phần tử không có title', () => {
    render(
      <>
        <iframe title="Trợ lý" />
        <span>không có chú thích</span>
        <TitleTooltips />
      </>,
    );
    hover(document.querySelector('iframe') as Element);
    hover(screen.getByText('không có chú thích'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
