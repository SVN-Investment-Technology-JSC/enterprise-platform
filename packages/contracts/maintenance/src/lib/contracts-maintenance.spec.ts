import { MAINTENANCE_FREQUENCIES } from './contracts-maintenance.js';

describe('maintenance contracts', () => {
  it('keeps the five matrix frequencies stable', () => {
    expect(MAINTENANCE_FREQUENCIES).toEqual([
      'day',
      'week',
      'month',
      'quarter',
      'year',
    ]);
  });
});

