import { ServiceUnavailableException } from '@nestjs/common';
import { healthController, ServiceHealth, type ServiceHealthDependencies } from './service-health';

const healthyDatabase = () => ({ query: jest.fn(async () => ({ rows: [{ '?column?': 1 }] })) });
const brokenDatabase = () => ({ query: jest.fn(async () => Promise.reject(new Error('connect ECONNREFUSED'))) });

describe('ServiceHealth', () => {
  it('OPS014-03: DB và RabbitMQ bình thường thì ready', async () => {
    const database = healthyDatabase();
    const health = new ServiceHealth('crm-api', { database, messaging: { isReady: () => true } });
    await expect(health.ready()).resolves.toEqual({ status: 'ready', service: 'crm-api' });
    expect(database.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('OPS014-02: DB lỗi thì 503 kèm lý do', async () => {
    const health = new ServiceHealth('hrm-api', { database: brokenDatabase() });
    const error = await health.ready().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'not-ready',
      service: 'hrm-api',
      reason: 'connect ECONNREFUSED',
    });
  });

  it('OPS014-02: DB treo quá thời hạn thì 503, không treo healthcheck', async () => {
    const database = { query: jest.fn(() => new Promise<never>(() => undefined)) };
    const health = new ServiceHealth('api', { database, timeoutMs: 20 });
    await expect(health.ready()).rejects.toMatchObject({ status: 503 });
  });

  it('OPS014-04: kênh RabbitMQ đứt thì 503', async () => {
    const health = new ServiceHealth('realtime', { database: healthyDatabase(), messaging: { isReady: () => false } });
    await expect(health.ready()).rejects.toMatchObject({
      status: 503,
      response: { reason: 'Kênh RabbitMQ chưa sẵn sàng.' },
    });
  });

  it('OPS014-05: live không chạm DB, luôn trả live', () => {
    const database = brokenDatabase();
    const health = new ServiceHealth('workspace-api', { database });
    expect(health.live()).toEqual({ status: 'live', service: 'workspace-api' });
    expect(database.query).not.toHaveBeenCalled();
  });
});

describe('healthController', () => {
  type Probe = { live(): unknown; ready(): Promise<unknown>; onModuleDestroy(): Promise<void> };
  const make = (dependencies: ServiceHealthDependencies) => {
    const Controller = healthController('crm-api', { dependencies: () => dependencies });
    return new (Controller as new () => Probe)();
  };

  it('đặt đường dẫn health/live, health/ready để guard nhận ra healthcheck', () => {
    const Controller = healthController('crm-api', { dependencies: () => ({ database: healthyDatabase() }) });
    expect(Reflect.getMetadata('path', Controller)).toBe('health');
    expect(Reflect.getMetadata('path', Controller.prototype.live)).toBe('live');
    expect(Reflect.getMetadata('path', Controller.prototype.ready)).toBe('ready');
    // Guard HRM chỉ xét controller có tên bắt đầu bằng `Hrm`: healthcheck không bị đòi đăng nhập (OPS014-10).
    expect(Controller.name).toBe('HealthController');
  });

  it('ready dùng phụ thuộc thật: DB lỗi thì 503, live vẫn 200', async () => {
    const controller = make({ database: brokenDatabase() });
    expect(controller.live()).toEqual({ status: 'live', service: 'crm-api' });
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
    await expect(controller.onModuleDestroy()).resolves.toBeUndefined();
  });
});
