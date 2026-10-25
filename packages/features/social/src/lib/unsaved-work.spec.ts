import { hasUnsavedWork, registerUnsavedWork } from './unsaved-work';

describe('unsaved-work', () => {
  it('khong co nguon nao thi khong co viec do dang', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it('chi bao co viec do dang khi mot nguon dang do', () => {
    let a = false;
    let b = false;
    const offA = registerUnsavedWork(() => a);
    const offB = registerUnsavedWork(() => b);
    expect(hasUnsavedWork()).toBe(false);
    b = true;
    expect(hasUnsavedWork()).toBe(true);
    offB();
    expect(hasUnsavedWork()).toBe(false);
    a = true;
    expect(hasUnsavedWork()).toBe(true);
    offA();
    expect(hasUnsavedWork()).toBe(false);
  });
});
