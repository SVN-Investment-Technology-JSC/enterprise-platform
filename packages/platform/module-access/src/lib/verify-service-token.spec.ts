import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { verifyServiceToken } from './module-access';

describe('verifyServiceToken (SEC-BE039-01)', () => {
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  it('token đúng thì true', () => {
    expect(verifyServiceToken('bi-mat-123', 'bi-mat-123')).toBe(true);
  });

  it('sai cùng độ dài thì false', () => {
    expect(verifyServiceToken('bi-mat-124', 'bi-mat-123')).toBe(false);
  });

  it('sai khác độ dài thì false, không ném lỗi', () => {
    expect(() => verifyServiceToken('bi', 'bi-mat-123')).not.toThrow();
    expect(verifyServiceToken('bi', 'bi-mat-123')).toBe(false);
    expect(verifyServiceToken('bi-mat-123-dai-hon', 'bi-mat-123')).toBe(false);
  });

  it('token gửi lên rỗng, thiếu hoặc không phải chuỗi thì false', () => {
    expect(verifyServiceToken('', 'bi-mat-123')).toBe(false);
    expect(verifyServiceToken(undefined, 'bi-mat-123')).toBe(false);
    expect(verifyServiceToken(123, 'bi-mat-123')).toBe(false);
  });

  it('thiếu biến môi trường thì false, kể cả khi token gửi lên rỗng', () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    expect(verifyServiceToken('bat-ky')).toBe(false);
    expect(verifyServiceToken('')).toBe(false);
    expect(verifyServiceToken('', '')).toBe(false);
  });

  it('mặc định so với INTERNAL_SERVICE_TOKEN đọc lúc gọi', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'tu-env';
    expect(verifyServiceToken('tu-env')).toBe(true);
    expect(verifyServiceToken('khac')).toBe(false);
  });

  it('header dạng mảng thì lấy phần tử đầu', () => {
    expect(verifyServiceToken(['bi-mat-123', 'x'], 'bi-mat-123')).toBe(true);
  });
});

/**
 * SEC-BE039-02: không còn chỗ nào so token dịch vụ nội bộ bằng `===`/`!==`.
 * Quét mã nguồn `apps/` và `packages/` (bỏ qua spec, node_modules, dist).
 */
describe('Không so token dịch vụ nội bộ trực tiếp (SEC-BE039-02)', () => {
  const root = join(__dirname, '../../../../..');
  const skipDirs = new Set(['node_modules', 'dist', '.next', 'out-tsc', 'test-output', 'coverage']);
  const patterns = [
    /[!=]==?\s*process\.env(\.INTERNAL_SERVICE_TOKEN|\[['"]INTERNAL_SERVICE_TOKEN['"]\])/,
    /process\.env(\.INTERNAL_SERVICE_TOKEN|\[['"]INTERNAL_SERVICE_TOKEN['"]\])\s*[!=]==?/,
    /\[['"]x-service-token['"]\]\s*[!=]==?/,
    /[!=]==?\s*\w+\.headers\[['"]x-service-token['"]\]/,
  ];

  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.(spec|test)\.[tj]sx?$/.test(entry)) {
        out.push(path);
      }
    }
  }

  it('mọi chỗ xác thực dùng verifyServiceToken', () => {
    const files: string[] = [];
    walk(join(root, 'apps'), files);
    walk(join(root, 'packages'), files);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
        .map(({ index }) => `${relative(root, file)}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
