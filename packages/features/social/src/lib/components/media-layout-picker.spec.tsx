/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import { SOCIAL_MEDIA_LAYOUT_LABELS, type SocialMediaLayout } from '@enterprise-platform/contracts-social';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaLayoutPicker, MediaMoveButtons } from './media-layout-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const radios = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
const checked = () => radios().find((radio) => radio.getAttribute('aria-checked') === 'true');

function Harness({ initial = 'auto', onValue }: { initial?: SocialMediaLayout; onValue?: (v: SocialMediaLayout) => void }) {
  const [value, setValue] = useState<SocialMediaLayout>(initial);
  return createElement(MediaLayoutPicker, {
    value,
    onChange: (next: SocialMediaLayout) => {
      setValue(next);
      onValue?.(next);
    },
  });
}

const keyDown = (key: string) =>
  act(() => {
    checked()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('MediaLayoutPicker', () => {
  it('là nhóm radio có 4 bố cục chọn được (Xếp dọc đang ẩn), nhãn tiếng Việt và aria', () => {
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Bố cục hiển thị ảnh và video');
    expect(radios()).toHaveLength(4);
    for (const [layout, label] of Object.entries(SOCIAL_MEDIA_LAYOUT_LABELS)) {
      if (layout === 'stack') expect(container.textContent).not.toContain(label);
      else expect(container.textContent).toContain(label);
    }
    expect(radios().every((radio) => radio.getAttribute('aria-label')?.includes(':'))).toBe(true);
    expect(checked()?.textContent).toBe('Tự động');
    expect(radios().filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });

  it('bấm chuột chọn bố cục', () => {
    const values: SocialMediaLayout[] = [];
    act(() => root.render(createElement(Harness, { onValue: (v: SocialMediaLayout) => values.push(v) })));
    act(() => radios()[3].click());
    expect(values).toEqual(['carousel']);
    expect(checked()?.textContent).toBe('Trượt ngang');
  });

  it('mũi tên chuyển bố cục theo vòng, Home và End về hai đầu', () => {
    act(() => root.render(createElement(Harness)));
    keyDown('ArrowRight');
    expect(checked()?.textContent).toBe('Lưới đều');
    keyDown('ArrowDown');
    expect(checked()?.textContent).toBe('Nổi bật');
    keyDown('ArrowLeft');
    expect(checked()?.textContent).toBe('Lưới đều');
    keyDown('End');
    expect(checked()?.textContent).toBe('Trượt ngang');
    keyDown('ArrowRight');
    expect(checked()?.textContent).toBe('Tự động');
    keyDown('ArrowLeft');
    expect(checked()?.textContent).toBe('Trượt ngang');
    keyDown('Home');
    expect(checked()?.textContent).toBe('Tự động');
  });

  it('bài đã lưu bố cục đang ẩn: không nút nào được chọn nhưng nút đầu vẫn vào được bằng Tab', () => {
    act(() => root.render(createElement(MediaLayoutPicker, { value: 'stack', onChange: jest.fn() })));
    expect(checked()).toBeUndefined();
    expect(radios().filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    expect(radios()[0].tabIndex).toBe(0);
  });

  it('khoá thì không đổi được', () => {
    const onChange = jest.fn();
    act(() => root.render(createElement(MediaLayoutPicker, { value: 'auto', onChange, disabled: true })));
    act(() => radios()[1].click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MediaMoveButtons', () => {
  it('có nhãn aria theo tên tệp, gọi đúng hướng và tắt nút ở biên', () => {
    const onMove = jest.fn();
    act(() =>
      root.render(
        createElement(MediaMoveButtons, { fileName: 'a.png', canEarlier: false, canLater: true, onMove }),
      ),
    );
    const earlier = container.querySelector<HTMLButtonElement>('[aria-label="Chuyển a.png lên trước"]');
    const later = container.querySelector<HTMLButtonElement>('[aria-label="Chuyển a.png ra sau"]');
    expect(earlier?.disabled).toBe(true);
    expect(later?.disabled).toBe(false);
    act(() => later?.click());
    expect(onMove).toHaveBeenCalledWith('later');
  });
});
