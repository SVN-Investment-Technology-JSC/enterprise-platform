import { quotaInputError } from './request-quota-screen';

describe('quotaInputError', () => {
  it('treats empty input as unlimited', () => {
    expect(quotaInputError('')).toBeNull();
    expect(quotaInputError('  ')).toBeNull();
  });
  it('accepts whole numbers between 1 and 1000', () => {
    expect(quotaInputError('1')).toBeNull();
    expect(quotaInputError('1000')).toBeNull();
  });
  it('rejects zero, negatives, decimals, text and over-limit values', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '1001']) expect(quotaInputError(bad)).not.toBeNull();
  });
});
