import { startHeartbeat } from './heartbeat.js';

function setup(overrides: { healthy?: () => boolean; writeFile?: jest.Mock } = {}) {
  let tick: (() => void) | undefined;
  const writeFile = overrides.writeFile ?? jest.fn();
  const removeFile = jest.fn();
  const clearInterval = jest.fn();
  const warn = jest.fn();
  let clock = 1000;
  const stop = startHeartbeat({
    file: '/tmp/alive',
    isHealthy: overrides.healthy ?? (() => true),
    now: () => clock,
    writeFile,
    removeFile,
    setInterval: (callback, ms) => {
      expect(ms).toBe(15_000);
      tick = callback;
      return 1;
    },
    clearInterval,
    warn,
  });
  return {
    stop,
    writeFile,
    removeFile,
    clearInterval,
    warn,
    tick: () => {
      clock += 15_000;
      tick?.();
    },
  };
}

describe('startHeartbeat', () => {
  it('ghi ngay lúc khởi động và định kỳ', () => {
    const h = setup();
    expect(h.writeFile).toHaveBeenCalledTimes(1);
    expect(h.writeFile).toHaveBeenCalledWith('/tmp/alive', '1000');
    h.tick();
    expect(h.writeFile).toHaveBeenCalledTimes(2);
    expect(h.writeFile).toHaveBeenLastCalledWith('/tmp/alive', '16000');
  });

  it('không ghi khi chưa khoẻ rồi ghi khi khoẻ trở lại', () => {
    let healthy = false;
    const h = setup({ healthy: () => healthy });
    h.tick();
    expect(h.writeFile).not.toHaveBeenCalled();
    healthy = true;
    h.tick();
    expect(h.writeFile).toHaveBeenCalledTimes(1);
  });

  it('dừng thì ngừng ghi, xoá tệp và không ghi lại', () => {
    const h = setup();
    h.stop();
    expect(h.clearInterval).toHaveBeenCalledWith(1);
    expect(h.removeFile).toHaveBeenCalledWith('/tmp/alive');
    h.writeFile.mockClear();
    h.tick();
    expect(h.writeFile).not.toHaveBeenCalled();
    h.stop();
    expect(h.removeFile).toHaveBeenCalledTimes(1);
  });

  it('lỗi ghi không ném và chỉ cảnh báo một lần', () => {
    const writeFile = jest.fn(() => {
      throw new Error('EACCES');
    });
    const h = setup({ writeFile });
    expect(() => h.tick()).not.toThrow();
    h.tick();
    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(h.warn).toHaveBeenCalledTimes(1);
  });
});
