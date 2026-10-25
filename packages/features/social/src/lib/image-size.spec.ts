import { SOCIAL_IMAGE_MAX_DIMENSION } from '@enterprise-platform/contracts-social';
import { readImageSize, validImageSize, type ImageSizeDeps } from './image-size';

const file = new Blob(['x'], { type: 'image/jpeg' });

describe('validImageSize', () => {
  it('nhận số nguyên dương trong giới hạn, loại phần còn lại', () => {
    expect(validImageSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(validImageSize(SOCIAL_IMAGE_MAX_DIMENSION, 1)).toEqual({ width: SOCIAL_IMAGE_MAX_DIMENSION, height: 1 });
    expect(validImageSize(0, 10)).toBeUndefined();
    expect(validImageSize(-5, 10)).toBeUndefined();
    expect(validImageSize(10.5, 10)).toBeUndefined();
    expect(validImageSize(SOCIAL_IMAGE_MAX_DIMENSION + 1, 10)).toBeUndefined();
    expect(validImageSize(Number.NaN, 10)).toBeUndefined();
    expect(validImageSize(undefined, 10)).toBeUndefined();
  });
});

describe('readImageSize qua createImageBitmap', () => {
  it('đọc width/height rồi close', async () => {
    const close = jest.fn();
    const deps: ImageSizeDeps = { createImageBitmap: async () => ({ width: 640, height: 480, close }) };
    expect(await readImageSize(file, deps)).toEqual({ width: 640, height: 480 });
    expect(close).toHaveBeenCalled();
  });

  it('ảnh hỏng (createImageBitmap ném) thì trả undefined, không ném', async () => {
    const deps: ImageSizeDeps = { createImageBitmap: async () => Promise.reject(new Error('hỏng')) };
    expect(await readImageSize(file, deps)).toBeUndefined();
  });

  it('kích thước không hợp lệ thì trả undefined và vẫn close', async () => {
    const close = jest.fn();
    const deps: ImageSizeDeps = {
      createImageBitmap: async () => ({ width: SOCIAL_IMAGE_MAX_DIMENSION + 1, height: 10, close }),
    };
    expect(await readImageSize(file, deps)).toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('quá thời hạn thì trả undefined', async () => {
    const deps: ImageSizeDeps = { createImageBitmap: () => new Promise(() => undefined), timeoutMs: 10 };
    expect(await readImageSize(file, deps)).toBeUndefined();
  });
});

describe('readImageSize qua thẻ ảnh', () => {
  function imageDeps(outcome: 'load' | 'error' | 'never', natural = { w: 1200, h: 800 }) {
    const revoke = jest.fn();
    const img = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      naturalWidth: natural.w,
      naturalHeight: natural.h,
      _src: '',
      get src() {
        return this._src;
      },
      set src(value: string) {
        this._src = value;
        if (outcome === 'load') queueMicrotask(() => this.onload?.());
        if (outcome === 'error') queueMicrotask(() => this.onerror?.());
      },
    };
    const deps: ImageSizeDeps = {
      createImage: () => img,
      createObjectURL: () => 'blob:test',
      revokeObjectURL: revoke,
      timeoutMs: 10,
    };
    return { deps, revoke };
  }

  it('đọc naturalWidth/Height và thu hồi URL', async () => {
    const { deps, revoke } = imageDeps('load');
    expect(await readImageSize(file, deps)).toEqual({ width: 1200, height: 800 });
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  it('lỗi tải thì trả undefined và vẫn thu hồi URL', async () => {
    const { deps, revoke } = imageDeps('error');
    expect(await readImageSize(file, deps)).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  it('không phản hồi thì hết thời hạn', async () => {
    const { deps } = imageDeps('never');
    expect(await readImageSize(file, deps)).toBeUndefined();
  });

  it('kích thước 0 (ảnh không đọc được) thì trả undefined', async () => {
    const { deps } = imageDeps('load', { w: 0, h: 0 });
    expect(await readImageSize(file, deps)).toBeUndefined();
  });

  it('không có phương tiện đọc nào thì trả undefined', async () => {
    expect(await readImageSize(file, {})).toBeUndefined();
  });
});
