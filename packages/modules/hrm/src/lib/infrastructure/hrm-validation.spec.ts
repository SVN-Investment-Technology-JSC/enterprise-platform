import { requireDate, requireText, requireUuid } from './hrm-validation';
import { hrmTransaction } from './hrm-transaction';
import type { Pool } from 'pg';

describe('HRM input and transaction boundaries', () => {
  it('rejects overflow dates and accepts leap days', () => {
    expect(() => requireDate('2026-02-29', 'date')).toThrow();
    expect(() => requireDate('2026-04-31', 'date')).toThrow();
    expect(requireDate('2028-02-29', 'date')).toBe('2028-02-29');
  });
  it('validates names and identifiers before SQL', () => {
    expect(() => requireText(' ', 'name')).toThrow();
    expect(() => requireUuid('not-an-id', 'employee')).toThrow();
    expect(requireText('  Nguyen Van A  ', 'name')).toBe('Nguyen Van A');
  });
  it('rolls back and releases the client when a business operation fails', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool;
    await expect(
      hrmTransaction(pool, async () => {
        throw new Error('conflict');
      }),
    ).rejects.toThrow('conflict');
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
