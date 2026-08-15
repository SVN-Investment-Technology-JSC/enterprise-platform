import { createConnectionKey } from './adapter-database.js';

describe('createConnectionKey', () => {
  it('creates a stable tenant connection key', () => {
    expect(createConnectionKey('tenant-a', 'primary')).toBe('tenant-a:primary');
  });

  it('rejects empty key parts', () => {
    expect(() => createConnectionKey('tenant-a', '')).toThrow();
  });
});
