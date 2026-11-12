import { assertProductionEnvironment } from './assert-production-env';
import { HealthController } from './health.controller';

describe('hrm-api', () => {
  it('returns live and ready health statuses', () => {
    const health = new HealthController();
    expect(health.live()).toEqual({ status: 'live', service: 'hrm-api' });
    expect(health.ready()).toEqual({ status: 'ready', service: 'hrm-api' });
  });

  it('skips production env assertion outside production and throws when missing in production', () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertProductionEnvironment({ NODE_ENV: 'production' })).toThrow(
      /PROCEDURE_API_URL/,
    );
  });
});

