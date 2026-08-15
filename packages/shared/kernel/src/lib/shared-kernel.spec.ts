import { Result } from './shared-kernel.js';

describe('Result', () => {
  it('creates success and failure values', () => {
    expect(Result.ok('saved')).toEqual({ ok: true, value: 'saved' });
    expect(Result.err('failed')).toEqual({ ok: false, error: 'failed' });
  });
});
