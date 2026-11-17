import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heartbeatIsFresh, HEARTBEAT_MAX_AGE_MS, startFileHeartbeat } from './heartbeat';

function harness(healthy: { value: boolean }) {
  const writes: string[] = [];
  const removed: string[] = [];
  let tick: (() => void) | undefined;
  let now = 1_000;
  const stop = startFileHeartbeat({
    file: '/tmp/worker.alive',
    isHealthy: () => healthy.value,
    now: () => now,
    writeFile: (_file, content) => writes.push(content),
    removeFile: (file) => removed.push(file),
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => undefined,
  });
  return {
    writes,
    removed,
    stop,
    beat(at: number) {
      now = at;
      tick?.();
    },
  };
}

describe('startFileHeartbeat', () => {
  it('ghi ngay và theo chu kỳ khi consumer còn khoẻ', () => {
    const h = harness({ value: true });
    h.beat(16_000);
    expect(h.writes).toEqual(['1000', '16000']);
  });

  it('consumer mất kênh RabbitMQ thì ngừng ghi để HEALTHCHECK báo không khoẻ', () => {
    const healthy = { value: true };
    const h = harness(healthy);
    healthy.value = false;
    h.beat(16_000);
    h.beat(31_000);
    expect(h.writes).toEqual(['1000']);
    healthy.value = true;
    h.beat(46_000);
    expect(h.writes).toEqual(['1000', '46000']);
  });

  it('dừng thì xoá tệp và không ghi nữa', () => {
    const h = harness({ value: true });
    h.stop();
    h.beat(16_000);
    expect(h.removed).toEqual(['/tmp/worker.alive']);
    expect(h.writes).toEqual(['1000']);
  });

  it('ghi lỗi thì chỉ cảnh báo một lần, không làm sập tiến trình', () => {
    const warn = jest.fn();
    let tick: (() => void) | undefined;
    startFileHeartbeat({
      file: '/khong-ghi-duoc/worker.alive',
      isHealthy: () => true,
      writeFile: () => {
        throw new Error('EACCES');
      },
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => undefined,
      warn,
    });
    tick?.();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('heartbeatIsFresh', () => {
  it('tệp mới ghi thì khoẻ, quá hạn hoặc không có tệp thì không khoẻ', () => {
    const stat = () => ({ mtimeMs: 100_000 });
    expect(heartbeatIsFresh('f', HEARTBEAT_MAX_AGE_MS, 100_000 + 59_999, stat)).toBe(true);
    expect(heartbeatIsFresh('f', HEARTBEAT_MAX_AGE_MS, 100_000 + 60_000, stat)).toBe(false);
    expect(
      heartbeatIsFresh('f', HEARTBEAT_MAX_AGE_MS, 0, () => {
        throw new Error('ENOENT');
      }),
    ).toBe(false);
  });

  it('chạy với tệp thật', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heartbeat-'));
    const file = join(dir, 'worker.alive');
    try {
      expect(heartbeatIsFresh(file)).toBe(false);
      const stop = startFileHeartbeat({ file, isHealthy: () => true, intervalMs: 60_000 });
      expect(heartbeatIsFresh(file)).toBe(true);
      stop();
      expect(heartbeatIsFresh(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
