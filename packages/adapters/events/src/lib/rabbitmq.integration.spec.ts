import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import {
  PermanentMessageError,
  RabbitMqConsumer,
  RabbitMqPublisher,
  buildRetryQueueDefinitions,
} from './adapter-events.js';

const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = rabbitUrl ? describe : describe.skip;

integration('RabbitMQ retry and DLQ integration', () => {
  it('sends a permanent processing failure directly to DLQ with diagnostic headers', async () => {
    if (!rabbitUrl) throw new Error('RABBITMQ_TEST_URL is required');
    const suffix = randomUUID();
    const eventType = `test.notification.invalid.${suffix}`;
    const consumerQueue = `test.notifications.${suffix}`;
    const consumer = new RabbitMqConsumer(rabbitUrl, {
      queue: consumerQueue,
      bindings: [eventType],
      prefetch: 1,
    });
    const publisher = new RabbitMqPublisher(rabbitUrl);
    const observerConnection = await amqp.connect(rabbitUrl);
    const observer = await observerConnection.createChannel();
    const deadQueue = await observer.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    const expectedFailure = 'acceptance-invalid-payload';
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await consumer.start(async () => {
        throw new PermanentMessageError(expectedFailure);
      });
      await observer.assertExchange('enterprise.events.dlx', 'topic', {
        durable: true,
      });
      await observer.bindQueue(
        deadQueue.queue,
        'enterprise.events.dlx',
        eventType,
      );
      await publisher.publish({
        id: randomUUID(),
        type: eventType,
        version: 1,
        occurredAt: new Date().toISOString(),
        tenantId: randomUUID(),
        source: 'realtime-acceptance',
        correlationId: suffix,
        payload: { invalid: true },
      });

      const deadLetter = await waitForMessage(observer, deadQueue.queue);
      expect(deadLetter.fields.routingKey).toBe(eventType);
      expect(deadLetter.properties.headers).toMatchObject({
        'x-retry-attempt': 0,
        'x-failure-reason': expectedFailure,
        'x-original-routing-key': eventType,
      });
    } finally {
      errorLog.mockRestore();
      await publisher.close();
      await consumer.close();
      await observer.deleteQueue(consumerQueue);
      for (const retry of buildRetryQueueDefinitions(consumerQueue)) {
        await observer.deleteQueue(retry.queue);
      }
      await observer.close();
      await observerConnection.close();
    }
  });
});

async function waitForMessage(
  channel: import('amqplib').Channel,
  queue: string,
): Promise<Exclude<Awaited<ReturnType<typeof channel.get>>, false>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: true });
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for RabbitMQ dead letter.');
}
