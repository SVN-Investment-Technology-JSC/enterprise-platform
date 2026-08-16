import { RabbitMqPublisher } from './adapter-events.js';

describe('RabbitMqPublisher', () => {
  it('is configured without opening a connection eagerly', () => {
    expect(new RabbitMqPublisher('amqp://localhost')).toBeInstanceOf(RabbitMqPublisher);
  });
});
