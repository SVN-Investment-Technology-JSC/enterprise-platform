import { UnprocessableEntityException } from '@nestjs/common';
import {
  REQUEST_QUOTA_EXCEEDED,
  assertQuotaOnApprove,
  assertQuotaOnCreate,
  quotaTypeCode,
} from './hrm-request-quota.js';

/** Giả lập DB: `limit` là hạn mức của loại đơn (null = chưa đặt), `used` là số đơn đã duyệt trong tháng. */
function fakeDb(opts: { ready?: boolean; limit: number | null; used: number }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ ok: opts.ready ?? true }] };
      if (sql.includes('request_quota_settings'))
        return { rows: opts.limit === null ? [] : [{ monthly_limit: opts.limit }] };
      return { rows: [{ n: opts.used }] };
    },
  } as never;
}

const row = { employee_id: 'e1', created_at: '2026-09-30T20:00:00Z' };

describe('request quota', () => {
  it('maps system kinds to type codes and custom requests to their own code', () => {
    expect(quotaTypeCode('ot', {})).toBe('OVERTIME');
    expect(quotaTypeCode('leave', {})).toBe('LEAVE');
    expect(quotaTypeCode('custom', { type_code: 'WFH' })).toBe('WFH');
    expect(quotaTypeCode('custom', {})).toBeNull();
  });

  it('is unlimited when no limit is set', async () => {
    await expect(assertQuotaOnCreate(fakeDb({ limit: null, used: 99 }), 't', 'ot', row)).resolves.toBeUndefined();
  });

  it('is unlimited when the tenant has not run the migration', async () => {
    await expect(
      assertQuotaOnCreate(fakeDb({ ready: false, limit: 1, used: 5 }), 't', 'ot', row),
    ).resolves.toBeUndefined();
  });

  it('allows creating while approved requests are below the limit', async () => {
    await expect(assertQuotaOnCreate(fakeDb({ limit: 3, used: 2 }), 't', 'leave', row)).resolves.toBeUndefined();
  });

  it('blocks creating once the approved count reaches the limit', async () => {
    const attempt = assertQuotaOnCreate(fakeDb({ limit: 3, used: 3 }), 't', 'leave', row);
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(attempt).rejects.toMatchObject({ response: { code: REQUEST_QUOTA_EXCEEDED, limit: 3, used: 3 } });
  });

  it('blocks approving an older pending request when its month is already full', async () => {
    await expect(assertQuotaOnApprove(fakeDb({ limit: 1, used: 1 }), 't', 'ot', row)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('counts the month of the request creation time when approving', async () => {
    const db = fakeDb({ limit: 2, used: 0 });
    await assertQuotaOnApprove(db, 't', 'ot', row);
    const count = (db as unknown as { calls: { sql: string; params: unknown[] }[] }).calls.find((c) =>
      c.sql.includes('count(*)'),
    );
    expect(count?.params).toEqual(['t', 'e1', row.created_at, 'OVERTIME']);
  });

  it('filters custom requests by their own type code', async () => {
    const db = fakeDb({ limit: 2, used: 0 });
    await assertQuotaOnCreate(db, 't', 'custom', { ...row, type_code: 'WFH' });
    const count = (db as unknown as { calls: { sql: string }[] }).calls.find((c) => c.sql.includes('count(*)'));
    expect(count?.sql).toContain('custom_requests');
    expect(count?.sql).toContain('upper(type_code)');
  });
});
