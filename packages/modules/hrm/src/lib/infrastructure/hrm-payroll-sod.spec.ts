import { assertPayrollSod, payrollSodViolation } from './hrm-payroll-sod';

const on = { separateCalcFinalize: true, separateFinalizePublish: true };
const off = { separateCalcFinalize: false, separateFinalizePublish: false };

describe('payroll segregation of duties', () => {
  it('blocks the calculator from finalizing', () => {
    expect(
      payrollSodViolation(on, 'finalize', 'u1', { calculated_by: 'u1' }),
    ).toMatch(/Người tính lương/);
    expect(
      payrollSodViolation(on, 'finalize', 'u2', { calculated_by: 'u1' }),
    ).toBeNull();
  });
  it('blocks the finalizer from publishing or paying', () => {
    expect(
      payrollSodViolation(on, 'publish', 'u1', { finalized_by: 'u1' }),
    ).toMatch(/phát hành/);
    expect(
      payrollSodViolation(on, 'pay', 'u1', { finalized_by: 'u1' }),
    ).toMatch(/chi trả/);
    expect(
      payrollSodViolation(on, 'pay', 'u2', { finalized_by: 'u1' }),
    ).toBeNull();
  });
  it('does nothing when disabled or when legacy data lacks the actor', () => {
    expect(
      payrollSodViolation(off, 'finalize', 'u1', { calculated_by: 'u1' }),
    ).toBeNull();
    expect(
      payrollSodViolation(off, 'publish', 'u1', { finalized_by: 'u1' }),
    ).toBeNull();
    expect(
      payrollSodViolation(on, 'finalize', 'u1', { calculated_by: null }),
    ).toBeNull();
  });

  const dbWith = (opts: {
    ready: boolean;
    setting?: boolean | null;
    run?: object;
  }) => ({
    query: jest.fn(async (sql: string) => {
      if (sql.includes('AS ready')) return { rows: [{ ready: opts.ready }] };
      if (sql.includes('payroll_sod_settings'))
        return {
          rows:
            opts.setting === null
              ? []
              : [
                  {
                    separate_calc_finalize: opts.setting,
                    separate_finalize_publish: opts.setting,
                  },
                ],
        };
      return { rows: [opts.run ?? {}] };
    }),
  });

  it('throws 403 SEGREGATION_OF_DUTIES from the DB-backed check', async () => {
    const db = dbWith({
      ready: true,
      setting: true,
      run: { calculated_by: 'u1' },
    });
    await expect(
      assertPayrollSod(db as never, 't', 'r', 'finalize', 'u1'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SEGREGATION_OF_DUTIES' },
    });
  });
  it('treats a tenant without a settings row as enabled (new tenant)', async () => {
    const db = dbWith({
      ready: true,
      setting: null,
      run: { calculated_by: 'u1' },
    });
    await expect(
      assertPayrollSod(db as never, 't', 'r', 'finalize', 'u1'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('keeps existing tenants unaffected (row = false) and skips when migration is missing', async () => {
    await expect(
      assertPayrollSod(
        dbWith({
          ready: true,
          setting: false,
          run: { calculated_by: 'u1' },
        }) as never,
        't',
        'r',
        'finalize',
        'u1',
      ),
    ).resolves.toBeUndefined();
    const notReady = dbWith({ ready: false });
    await expect(
      assertPayrollSod(notReady as never, 't', 'r', 'finalize', 'u1'),
    ).resolves.toBeUndefined();
    expect(notReady.query).toHaveBeenCalledTimes(1);
  });
});
