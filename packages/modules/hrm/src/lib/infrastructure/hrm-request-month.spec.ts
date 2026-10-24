import { UnprocessableEntityException } from '@nestjs/common';
import { REQUEST_CROSSES_MONTH, assertRequestWithinMonth, requestDateRange } from './hrm-request-month.js';

describe('request month', () => {
  it('takes the date range from the date columns of each kind', () => {
    expect(requestDateRange('leave', { from_date: '2026-10-30', to_date: '2026-10-31' })).toEqual({ from: '2026-10-30', to: '2026-10-31' });
    expect(requestDateRange('ot', { work_date: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(requestDateRange('correction', { request_date: new Date(2026, 9, 5) })).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(requestDateRange('profile_correction', {})).toBeNull();
  });

  it('uses the Vietnam date of timestamps for custom requests', () => {
    expect(requestDateRange('custom', { from_at: '2026-10-31T20:00:00Z', to_at: '2026-10-31T21:00:00Z' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
    expect(requestDateRange('custom', {})).toBeNull();
  });

  it('accepts requests inside one month, including the last and first day', () => {
    expect(() => assertRequestWithinMonth('leave', { from_date: '2026-10-01', to_date: '2026-10-31' })).not.toThrow();
    expect(() => assertRequestWithinMonth('ot', { work_date: '2026-10-31' })).not.toThrow();
    expect(() => assertRequestWithinMonth('profile_correction', {})).not.toThrow();
  });

  it('rejects requests that run over two months', () => {
    const attempt = () => assertRequestWithinMonth('business_trip', { from_date: '2026-10-30', to_date: '2026-11-02' });
    expect(attempt).toThrow(UnprocessableEntityException);
    try {
      attempt();
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toMatchObject({ code: REQUEST_CROSSES_MONTH });
    }
  });
});
