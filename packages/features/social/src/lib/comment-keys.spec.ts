import { shouldSubmitOnEnter } from './comment-keys';

const base = { key: 'Enter', shiftKey: false, altKey: false, isComposing: false };

describe('shouldSubmitOnEnter', () => {
  it('Enter gui binh luan', () => {
    expect(shouldSubmitOnEnter(base)).toBe(true);
  });

  it('Shift+Enter va Alt+Enter de xuong dong', () => {
    expect(shouldSubmitOnEnter({ ...base, shiftKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, altKey: true })).toBe(false);
  });

  it('khong gui khi dang go bang IME', () => {
    expect(shouldSubmitOnEnter({ ...base, isComposing: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, keyCode: 229 })).toBe(false);
  });

  it('bo qua phim khac', () => {
    expect(shouldSubmitOnEnter({ ...base, key: 'a' })).toBe(false);
  });
});
