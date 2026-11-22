import {
  assertRequiredEnvironment,
  assertServiceEnvironment,
  missingEnvironment,
  productionRequiredValue,
  PRODUCTION_REQUIRED_ENV,
  type ProductionService,
} from './required-environment';

describe('assertRequiredEnvironment', () => {
  it('OPS015-01: production thiếu biến thì ném lỗi nêu tên service và tên biến', () => {
    expect(() =>
      assertRequiredEnvironment('crm-api', ['PLATFORM_DATABASE_URL', 'INTERNAL_SERVICE_TOKEN'], {
        NODE_ENV: 'production',
        PLATFORM_DATABASE_URL: 'postgresql://platform@db/platform',
      }),
    ).toThrow(/^crm-api không khởi động được trong production: thiếu biến môi trường INTERNAL_SERVICE_TOKEN\./);
  });

  it('OPS015-01: nêu đủ mọi biến thiếu, theo thứ tự danh sách', () => {
    expect(() => assertRequiredEnvironment('worker', ['A', 'B', 'C'], { NODE_ENV: 'production', B: 'x' })).toThrow(
      /thiếu biến môi trường A, C\./,
    );
  });

  it('OPS015-02: môi trường dev hoặc không đặt NODE_ENV thì không kiểm', () => {
    expect(() => assertRequiredEnvironment('api', ['AUTH_PRIVATE_KEY'], { NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertRequiredEnvironment('api', ['AUTH_PRIVATE_KEY'], { NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertRequiredEnvironment('api', ['AUTH_PRIVATE_KEY'], {})).not.toThrow();
  });

  it('OPS015-03: giá trị rỗng hoặc chỉ có khoảng trắng coi như thiếu', () => {
    expect(missingEnvironment(['A', 'B', 'C'], { A: '', B: '  \t', C: 'ok' })).toEqual(['A', 'B']);
    expect(() =>
      assertRequiredEnvironment('hrm-api', ['INTERNAL_SERVICE_TOKEN'], {
        NODE_ENV: 'production',
        INTERNAL_SERVICE_TOKEN: '  ',
      }),
    ).toThrow(/INTERNAL_SERVICE_TOKEN/);
  });

  it('production đủ biến thì cho khởi động', () => {
    expect(() =>
      assertRequiredEnvironment('api', ['A', 'B'], { NODE_ENV: 'production', A: '1', B: '2' }),
    ).not.toThrow();
  });
});

describe('assertServiceEnvironment', () => {
  const services = Object.keys(PRODUCTION_REQUIRED_ENV) as ProductionService[];

  it.each(services)('%s: production đủ biến trong danh sách thì khởi động được', (service) => {
    const env = Object.fromEntries(PRODUCTION_REQUIRED_ENV[service].map((name) => [name, 'value']));
    expect(() => assertServiceEnvironment(service, { ...env, NODE_ENV: 'production' })).not.toThrow();
  });

  it.each(services)('%s: production thiếu biến đầu danh sách thì không khởi động', (service) => {
    const [first, ...rest] = PRODUCTION_REQUIRED_ENV[service];
    const env = Object.fromEntries(rest.map((name) => [name, 'value']));
    expect(() => assertServiceEnvironment(service, { ...env, NODE_ENV: 'production' })).toThrow(
      new RegExp(`^${service} .*${first}`),
    );
  });

  it('mỗi danh sách không có tên trùng', () => {
    for (const service of services) {
      const names = PRODUCTION_REQUIRED_ENV[service];
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('hrm-api giữ đủ các biến của bản kiểm cũ (assert-production-env.ts)', () => {
    expect(PRODUCTION_REQUIRED_ENV['hrm-api']).toEqual(
      expect.arrayContaining([
        'PROCEDURE_API_URL',
        'S3_INTERNAL_ENDPOINT',
        'S3_PUBLIC_ENDPOINT',
        'S3_REGION',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
      ]),
    );
  });

  it('api bắt buộc khoá ký JWT và token nội bộ', () => {
    expect(PRODUCTION_REQUIRED_ENV.api).toEqual(
      expect.arrayContaining(['AUTH_PRIVATE_KEY', 'AUTH_PUBLIC_KEY', 'INTERNAL_SERVICE_TOKEN']),
    );
  });
});

describe('productionRequiredValue', () => {
  it('có giá trị thì trả giá trị', () => {
    expect(productionRequiredValue('svc', 'S3_ACCESS_KEY_ID', 'platform', { NODE_ENV: 'production', S3_ACCESS_KEY_ID: 'k' })).toBe('k');
  });

  it('dev thiếu thì dùng giá trị dev như cũ', () => {
    expect(productionRequiredValue('svc', 'S3_ACCESS_KEY_ID', 'platform', { NODE_ENV: 'development' })).toBe('platform');
  });

  it('production thiếu thì ném lỗi, không trả giá trị dev', () => {
    expect(() => productionRequiredValue('svc', 'S3_ACCESS_KEY_ID', 'platform', { NODE_ENV: 'production' })).toThrow(
      /svc .*S3_ACCESS_KEY_ID/,
    );
  });
});
