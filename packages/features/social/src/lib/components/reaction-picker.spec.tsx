/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import { SOCIAL_REACTION_LABELS, SOCIAL_REACTION_TYPES } from '@enterprise-platform/contracts-social';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactionPicker } from './reaction-picker';

jest.mock('./reaction-icon', () => ({
  ReactionIcon: ({ type, playing }: { type: string; playing?: boolean }) => {
    const { createElement: h } = jest.requireActual('react');
    return h('i', { 'data-icon': type, 'data-playing': String(Boolean(playing)) });
  },
}));

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

const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
const render = (onSelect: jest.Mock, value?: (typeof SOCIAL_REACTION_TYPES)[number]) =>
  act(() => root.render(createElement(ReactionPicker, { value, onSelect })));

describe('ReactionPicker', () => {
  it('hiện đủ 8 nút, mỗi nút có aria-label và tooltip theo nhãn', () => {
    render(jest.fn());
    expect(options()).toHaveLength(8);
    SOCIAL_REACTION_TYPES.forEach((type, index) => {
      const button = options()[index];
      expect(button.getAttribute('aria-label')).toBe(SOCIAL_REACTION_LABELS[type]);
      expect(button.textContent).toBe(SOCIAL_REACTION_LABELS[type]);
    });
  });

  it('bấm một nút gọi onSelect đúng loại', () => {
    const onSelect = jest.fn();
    render(onSelect);
    act(() => options()[5].click());
    expect(onSelect).toHaveBeenCalledWith('angry');
  });

  it('chỉ biểu tượng đang hover mới chạy hoạt hình', () => {
    render(jest.fn());
    const playing = () => Array.from(container.querySelectorAll('[data-playing="true"]'));
    expect(playing()).toHaveLength(0);
    act(() => {
      options()[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(playing().map((node) => node.getAttribute('data-icon'))).toEqual(['haha']);
    act(() => {
      options()[2].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(playing()).toHaveLength(0);
  });

  it('đánh dấu loại đang được chọn', () => {
    render(jest.fn(), 'love');
    expect(options()[1].getAttribute('aria-pressed')).toBe('true');
    expect(options()[0].getAttribute('aria-pressed')).toBe('false');
  });
});
