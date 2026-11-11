import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useFillViewportHeight } from './use-fill-viewport';
import { useMediaQuery } from './use-media-query';

function Box({ enabled = true, minHeight = 300, bottomGap }: { enabled?: boolean; minHeight?: number; bottomGap?: number }) {
  const ref = useRef<HTMLElement>(null);
  useFillViewportHeight(ref, minHeight, undefined, enabled, bottomGap);
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <div style={{ paddingBottom: '20px' }}>
        <section data-testid="box" ref={ref} />
      </div>
    </div>
  );
}

function mockGeometry({ scrollerHeight, boxTop }: { scrollerHeight: number; boxTop: number }) {
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(scrollerHeight);
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = (this as HTMLElement).dataset.testid === 'box' ? boxTop : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

afterEach(() => jest.restoreAllMocks());

describe('useFillViewportHeight', () => {
  it('khung cao đúng phần còn lại của vùng cuộn, trừ phần đệm dưới của khối bao quanh', () => {
    mockGeometry({ scrollerHeight: 800, boxTop: 200 });
    render(<Box />);
    expect(screen.getByTestId('box').style.height).toBe('580px');
  });

  it('bottomGap nhỏ hơn phần đệm thì khung cao thêm và phần đệm dư được lấy lại bằng lề âm', () => {
    mockGeometry({ scrollerHeight: 800, boxTop: 200 });
    render(<Box bottomGap={8} />);
    const box = screen.getByTestId('box');
    expect(box.style.height).toBe('592px'); // 800 - 200 - 8
    expect(box.style.marginBottom).toBe('-12px'); // đệm 20 - chừa 8
  });

  it('bottomGap lớn hơn hoặc bằng phần đệm thì không dùng lề âm', () => {
    mockGeometry({ scrollerHeight: 800, boxTop: 200 });
    render(<Box bottomGap={30} />);
    const box = screen.getByTestId('box');
    expect(box.style.height).toBe('570px');
    expect(box.style.marginBottom).toBe('');
  });

  it('màn hình quá thấp thì giữ chiều cao tối thiểu', () => {
    mockGeometry({ scrollerHeight: 400, boxTop: 200 });
    render(<Box minHeight={360} />);
    expect(screen.getByTestId('box').style.height).toBe('360px');
  });

  it('tắt thì không đặt chiều cao, và bỏ chiều cao đã đặt khi chuyển từ bật sang tắt', () => {
    mockGeometry({ scrollerHeight: 800, boxTop: 200 });
    const view = render(<Box enabled={false} />);
    expect(screen.getByTestId('box').style.height).toBe('');

    view.rerender(<Box enabled />);
    expect(screen.getByTestId('box').style.height).toBe('580px');
    view.rerender(<Box enabled={false} />);
    expect(screen.getByTestId('box').style.height).toBe('');
    expect(screen.getByTestId('box').style.marginBottom).toBe('');
  });

  it('đo lại khi đổi cỡ cửa sổ', () => {
    mockGeometry({ scrollerHeight: 800, boxTop: 200 });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<Box />);
    expect(screen.getByTestId('box').style.height).toBe('580px');

    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1000);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('box').style.height).toBe('780px');
  });
});

describe('useMediaQuery', () => {
  function Probe() {
    return <span data-testid="probe">{String(useMediaQuery('(min-width: 768px)'))}</span>;
  }

  it('không có matchMedia (jsdom) thì dùng giá trị mặc định', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });

  it('theo kết quả của media query và cập nhật khi nó đổi', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = jest.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));
    try {
      render(<Probe />);
      expect(screen.getByTestId('probe').textContent).toBe('false');
      matches = true;
      act(() => listeners.forEach((listener) => listener()));
      expect(screen.getByTestId('probe').textContent).toBe('true');
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
