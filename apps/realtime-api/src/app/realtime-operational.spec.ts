import { RealtimeDeliveryConsumer } from './realtime-delivery';
import {
  featureFlag,
  RealtimeMutationPolicy,
} from './realtime-operational';
import { ServiceUnavailableException } from '@nestjs/common';

describe('featureFlag', () => {
  it('parses explicit rollout values and rejects ambiguous configuration', () => {
    expect(featureFlag(undefined, false)).toBe(false);
    expect(featureFlag('true', false)).toBe(true);
    expect(featureFlag('false', true)).toBe(false);
    expect(() => featureFlag('yes', false)).toThrow('true or false');
  });
});

describe('RealtimeMutationPolicy', () => {
  it('supports a REST read-only rollback mode', () => {
    expect(() => new RealtimeMutationPolicy(true).assertEnabled()).not.toThrow();
    expect(() => new RealtimeMutationPolicy(false).assertEnabled()).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('RealtimeDeliveryConsumer', () => {
  it('is ready without opening RabbitMQ while dark delivery is disabled', async () => {
    const rabbit = { start: jest.fn(), close: jest.fn() };
    const delivery = new RealtimeDeliveryConsumer(
      'amqp://unused',
      { handle: jest.fn() } as never,
      rabbit as never,
      false,
    );

    await delivery.start();

    expect(rabbit.start).not.toHaveBeenCalled();
    expect(delivery.ready()).toBe(true);
  });

  it('becomes ready only after the enabled RabbitMQ consumer starts', async () => {
    const rabbit = {
      start: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const delivery = new RealtimeDeliveryConsumer(
      'amqp://unused',
      { handle: jest.fn() } as never,
      rabbit as never,
      true,
    );

    expect(delivery.ready()).toBe(false);
    await delivery.start();
    expect(delivery.ready()).toBe(true);
    await delivery.close();
    expect(delivery.ready()).toBe(false);
  });
});
